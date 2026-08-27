import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

export class AuthService implements vscode.UriHandler {
    private readonly _context: vscode.ExtensionContext;
    private _onDidChangeAuthState = new vscode.EventEmitter<string | undefined>();
    public readonly onDidChangeAuthState = this._onDidChangeAuthState.event;
    private _codeVerifier: string | undefined;
    private _token: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        // Register this class as the URI handler for the extension
        context.subscriptions.push(vscode.window.registerUriHandler(this));
    }

    public async initialize(): Promise<void> {
        this._token = await this._context.secrets.get('EXOVON_PAT');
        if (this._token) {
            this._onDidChangeAuthState.fire(this._token);
        }
    }

    public async login() {
        // 1. Generate PKCE code_verifier
        this._codeVerifier = crypto.randomBytes(32).toString('base64url');
        
        // 2. Compute code_challenge = SHA256(code_verifier)
        const codeChallenge = crypto.createHash('sha256').update(this._codeVerifier).digest('base64url');
        
        // 3. Open browser to the auth endpoint with challenge
        // Production login portal
        const authUrl = `https://exovon.in/auth?source=vscode&challenge=${codeChallenge}`;
        
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        vscode.window.showInformationMessage('Exovon: Please complete the login in your browser.');
    }

    public async logout() {
        await this._context.secrets.delete('EXOVON_PAT');
        this._token = undefined;
        this._onDidChangeAuthState.fire(undefined);
        vscode.window.showInformationMessage('Exovon: Logged out successfully.');
    }

    public getToken(): string | undefined {
        return this._token;
    }

    // Handles callbacks like: vscodium://exovon.exovonhub/auth?code=abc...
    public async handleUri(uri: vscode.Uri) {
        if (uri.path.includes('/auth') || uri.query.includes('code=') || uri.query.includes('token=')) {
            const query = new URLSearchParams(uri.query);
            let code = query.get('code');
            let token = query.get('token');

            // If user used Paste Auth Token fallback, they might have pasted the PKCE code instead of a full token
            if (token && !token.startsWith('eyJ') && token.length < 100) {
                code = token;
                token = null;
            }

            if (token) {
                await this._context.secrets.store('EXOVON_PAT', token);
                this._token = token;
                this._codeVerifier = undefined;
                this._onDidChangeAuthState.fire(this._token);
                vscode.window.showInformationMessage('Exovon: Securely authenticated with Fallback Token!');
                return;
            }

            if (code && this._codeVerifier) {
                try {
                    // Exchange grant code + PKCE verifier for PAT
                    const response = await fetch('https://exovon.in/api/auth/exchange', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code, code_verifier: this._codeVerifier })
                    });
                    
                    const data: any = await response.json();
                    
                    if (response.ok && data.token) {
                        await this._context.secrets.store('EXOVON_PAT', data.token);
                        this._token = data.token;
                        this._codeVerifier = undefined; // Clear the verifier from memory
                        
                        this._onDidChangeAuthState.fire(this._token);
                        vscode.window.showInformationMessage('Exovon: Securely authenticated with Personal Access Token!');
                    } else {
                        vscode.window.showErrorMessage('Exovon: Authentication exchange failed. ' + (data.error || ''));
                    }
                } catch (error) {
                    vscode.window.showErrorMessage('Exovon: Failed to reach authentication server.');
                }
            } else if (!this._codeVerifier) {
                vscode.window.showErrorMessage('Exovon: PKCE verifier not found. Please restart the login process.');
            } else {
                vscode.window.showErrorMessage('Exovon: Login failed. No grant code received.');
            }
        }
    }
}
