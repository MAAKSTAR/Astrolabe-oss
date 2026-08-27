import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { InspectorProxy } from './InspectorProxy';

export class DevServerManager {
    public static activeProcess: cp.ChildProcess | null = null;
    public static activeStaticServer: http.Server | null = null;
    public static AMS_DEDICATED_PORT = 44445;

    public static async startServer(workspaceRoot: string): Promise<number | null> {
        this.killServer(); // ensure clean state

        const pkgPath = path.join(workspaceRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            let pkg;
            try {
                pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch (e) {
                console.error('Failed to parse package.json', e);
            }

            if (pkg && pkg.scripts && pkg.scripts['dev']) {
                // Framework dev server
                return await this.startFrameworkServer(workspaceRoot, pkg);
            }
        }

        // Static folder fallback
        return await this.startStaticServer(workspaceRoot);
    }

    private static startFrameworkServer(cwd: string, pkg: any): Promise<number | null> {
        return new Promise((resolve) => {
            let isResolved = false;
            let cmd = 'npm';
            let args = ['run', 'dev'];

            const isYarn = fs.existsSync(path.join(cwd, 'yarn.lock'));
            const isPnpm = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));
            
            if (isYarn) cmd = 'yarn';
            else if (isPnpm) cmd = 'pnpm';

            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            
            // Try to force the dedicated port
            if (deps['next']) {
                args.push('--');
                args.push('-p');
                args.push(this.AMS_DEDICATED_PORT.toString());
            } else if (deps['vite']) {
                args.push('--');
                args.push('--port');
                args.push(this.AMS_DEDICATED_PORT.toString());
            }

            vscode.window.showInformationMessage(`Starting dev server via ${cmd} run dev...`);
            
            this.activeProcess = cp.spawn(cmd, args, {
                cwd,
                env: { ...process.env, PORT: this.AMS_DEDICATED_PORT.toString() },
                shell: true,
                detached: true
            });

            const onData = (data: Buffer) => {
                const str = data.toString();
                // console.log('[DevServer]', str);
                
                // Try to extract port from stdout like "Local: http://localhost:5173" or "ready - started server on 0.0.0.0:3000"
                if (!isResolved) {
                    const match = str.match(/http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i) || 
                                  str.match(/on (?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i);
                    if (match && match[1]) {
                        isResolved = true;
                        resolve(parseInt(match[1]));
                    }
                }
            };

            this.activeProcess.stdout?.on('data', onData);
            this.activeProcess.stderr?.on('data', onData);

            this.activeProcess.on('exit', () => {
                if (!isResolved) {
                    resolve(null);
                }
                this.activeProcess = null;
            });

            // Timeout fallback
            setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    // If we couldn't parse the port but it didn't exit, assume it bound to our dedicated port
                    resolve(this.AMS_DEDICATED_PORT);
                }
            }, 5000);
        });
    }

    private static startStaticServer(cwd: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.activeStaticServer = http.createServer((req, res) => {
                let filePath = path.join(cwd, req.url === '/' ? 'index.html' : req.url || '');
                if (!fs.existsSync(filePath)) {
                    // SPA Fallback
                    filePath = path.join(cwd, 'index.html');
                }

                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    const extname = String(path.extname(filePath)).toLowerCase();
                    const mimeTypes: { [key: string]: string } = {
                        '.html': 'text/html',
                        '.js': 'text/javascript',
                        '.css': 'text/css',
                        '.json': 'application/json',
                        '.png': 'image/png',
                        '.jpg': 'image/jpg',
                        '.svg': 'image/svg+xml'
                    };
                    const contentType = mimeTypes[extname] || 'application/octet-stream';

                    res.writeHead(200, { 'Content-Type': contentType });
                    fs.createReadStream(filePath).pipe(res);
                } else {
                    res.writeHead(404);
                    res.end('404 Not Found');
                }
            });

            this.activeStaticServer.on('error', (e) => reject(e));
            this.activeStaticServer.listen(this.AMS_DEDICATED_PORT, '127.0.0.1', () => {
                vscode.window.showInformationMessage(`Started static server on port ${this.AMS_DEDICATED_PORT}`);
                resolve(this.AMS_DEDICATED_PORT);
            });
        });
    }

    public static killServer() {
        if (this.activeProcess) {
            // Need to kill child process group on Unix
            try {
                process.kill(-this.activeProcess.pid!);
            } catch (e) {
                this.activeProcess.kill();
            }
            this.activeProcess = null;
        }
        if (this.activeStaticServer) {
            this.activeStaticServer.close();
            this.activeStaticServer = null;
        }
    }
}
