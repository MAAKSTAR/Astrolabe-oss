import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExovonSidebarProvider } from './ExovonSidebarProvider';

let sidebarProvider: ExovonSidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	console.log('Exovon Hub Suite is now active.');

	// Instantiate and register our sidebar view provider
	sidebarProvider = new ExovonSidebarProvider(context);
	const viewDisposable = vscode.window.registerWebviewViewProvider(
		ExovonSidebarProvider.viewType,
		sidebarProvider
	);
	context.subscriptions.push(viewDisposable);

	// Hellworld command registers as secondary action
	const commandDisposable = vscode.commands.registerCommand('exovonhub.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Exovon Hub Suite!');
	});

	const setApiKeyDisposable = vscode.commands.registerCommand('exovonhub.setApiKey', async () => {
		const apiKey = await vscode.window.showInputBox({
			prompt: 'Enter your Google Gen AI API Key',
			password: true,
			ignoreFocusOut: true
		});
		if (apiKey) {
			await context.secrets.store('exovonhub.googleApiKey', apiKey);
			vscode.window.showInformationMessage('Exovon Hub: API Key securely stored!');
		}
	});

	context.subscriptions.push(commandDisposable, setApiKeyDisposable);
}

export function deactivate() {
	// Cleanup shadow workspace on extension deactivation to prevent disk bloat
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot) {
		const shadowPath = path.resolve(workspaceRoot, '.exovon-shadow');
		if (fs.existsSync(shadowPath)) {
			try {
				fs.rmSync(shadowPath, { recursive: true, force: true });
			} catch (e) {
				// Best-effort cleanup
			}
		}
	}
	sidebarProvider = undefined;
}
