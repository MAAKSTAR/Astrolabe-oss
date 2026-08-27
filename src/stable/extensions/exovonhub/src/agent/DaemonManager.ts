import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class DaemonManager {
    private static instance: DaemonManager;
    private daemonProcess: ChildProcess | null = null;
    private trayProcess: ChildProcess | null = null;
    private isStarting = false;

    private constructor() {}

    public static getInstance(): DaemonManager {
        if (!DaemonManager.instance) {
            DaemonManager.instance = new DaemonManager();
        }
        return DaemonManager.instance;
    }

    /**
     * Start the exovon-daemon if it isn't already running.
     */
    public async startDaemon(context: vscode.ExtensionContext): Promise<boolean> {
        
        if (this.daemonProcess) {
            vscode.window.showInformationMessage('Astrolabe Local Daemon is already running.');
            return true;
        }

        if (this.isStarting) {
            return false;
        }

        this.isStarting = true;

        try {
            const candidatePaths = [
                process.env.ASTROLABE_DAEMON_PATH || '',
                path.join(vscode.env.appRoot, 'bin', 'exovon-daemon'),
                path.join(vscode.env.appRoot, 'resources', 'app', 'bin', 'exovon-daemon'),
                path.join(context.extensionPath, 'bin', 'exovon-daemon'),
                path.resolve(__dirname, '../../../daemon/target/release/exovon-daemon'),
                path.resolve(__dirname, '../../../../daemon/target/release/exovon-daemon'),
                '/run/media/maakstar/c/vscodium/daemon/target/release/exovon-daemon',
                path.join(context.extensionPath, '..', 'exovon-daemon', 'target', 'release', 'exovon-daemon'),
                '/home/maakstar/EXOVON_ECOSYSTEM/exovon-daemon/target/release/exovon-daemon',
                path.join(context.extensionPath, '..', 'exovon-daemon', 'target', 'debug', 'exovon-daemon'),
                '/home/maakstar/EXOVON_ECOSYSTEM/exovon-daemon/target/debug/exovon-daemon'
            ].filter(Boolean);

            let daemonPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[candidatePaths.length - 1];

            const config = vscode.workspace.getConfiguration('exovonhub');
            const customModelsDir = config.get<string>('localModelsDirectory');
            
            const args = customModelsDir && customModelsDir.trim() !== '' ? ['--models-dir', customModelsDir.trim()] : [];

            // Add LD_LIBRARY_PATH so it can find libllama.so, libggml-vulkan.so, etc.
            // The Vulkan GPU libraries live in the cmake cache under the daemon's target dir
            const daemonDir = path.dirname(daemonPath);
            const daemonRoot = path.resolve(daemonDir, '..', '..');
            const cmakeCacheBase = path.join(daemonRoot, 'target', 'llama-cmake-cache');
            let cmakeLibDirs = '';
            try {
                const cacheDirs = fs.readdirSync(cmakeCacheBase);
                cmakeLibDirs = cacheDirs
                    .map(d => path.join(cmakeCacheBase, d, 'lib'))
                    .filter(p => fs.existsSync(p))
                    .join(':');
            } catch { /* cmake cache may not exist */ }
            const daemonEnv = {
                ...process.env,
                LD_LIBRARY_PATH: `${daemonDir}:${path.join(daemonDir, 'deps')}:${cmakeLibDirs}:${process.env.LD_LIBRARY_PATH || ''}`
            };

            const logStream = fs.createWriteStream('/tmp/exovon_daemon_spawn.log', { flags: 'a' });

            this.daemonProcess = spawn(daemonPath, args, {
                cwd: path.dirname(daemonPath),
                env: daemonEnv,
                stdio: ['ignore', 'pipe', 'pipe'] // Capture output
            });

            this.daemonProcess.stdout?.pipe(logStream);
            this.daemonProcess.stderr?.pipe(logStream);

            this.daemonProcess.on('error', (err) => {
                vscode.window.showErrorMessage(
                    `Failed to start Exovon Local Engine: ${err.message}`,
                    'View Logs',
                    'Open Settings'
                ).then(action => {
                    if (action === 'View Logs') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                    } else if (action === 'Open Settings') {
                        vscode.commands.executeCommand('exovon.openSettings');
                    }
                });
                this.daemonProcess = null;
            });

            this.daemonProcess.on('exit', (code, signal) => {
                if (code !== 0 && code !== null) {
                    const signalInfo = signal ? ` (Signal: ${signal})` : '';
                    vscode.window.showErrorMessage(
                        `Exovon Local Engine crashed or exited unexpectedly (Exit code: ${code}${signalInfo}).`,
                        'Restart Engine',
                        'View Logs'
                    ).then(action => {
                        if (action === 'Restart Engine') {
                            this.startDaemon(context);
                        } else if (action === 'View Logs') {
                            vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                        }
                    });
                }
                this.daemonProcess = null;
            });

            // Wait a brief moment to assume it started successfully
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (!this.daemonProcess) {
                vscode.window.showErrorMessage(
                    'Exovon Local Engine failed to spawn. Check permissions and binary path.',
                    'View Logs'
                ).then(action => {
                    if (action === 'View Logs') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                    }
                });
                return false;
            }

            // Launch top panel System Tray indicator (AppIndicator)
            this.startTrayIndicator();

            vscode.window.showInformationMessage('Exovon Local Engine initialized successfully.');
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Failed to initialize Exovon Local Engine: ${error.message}`,
                'View Logs',
                'Retry'
            ).then(action => {
                if (action === 'Retry') {
                    this.startDaemon(context);
                } else if (action === 'View Logs') {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                }
            });
            return false;
        } finally {
            this.isStarting = false;
        }
    }

    private startTrayIndicator() {
        if (this.trayProcess) return;
        const trayScript = '/home/maakstar/EXOVON_ECOSYSTEM/exovon-daemon/tray.py';
        if (fs.existsSync(trayScript)) {
            try {
                this.trayProcess = spawn('python3', [trayScript], {
                    env: {
                        ...process.env,
                        DISPLAY: process.env.DISPLAY || ':0',
                        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
                        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000',
                        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus'
                    },
                    stdio: 'ignore'
                });
                this.trayProcess.on('exit', () => {
                    this.trayProcess = null;
                });
            } catch (e) {
                console.warn('Could not launch tray indicator:', e);
            }
        }
    }

    /**
     * Stop the exovon-daemon if it is running.
     */
    public stopDaemon() {
        if (this.daemonProcess) {
            this.daemonProcess.kill();
            this.daemonProcess = null;
        }
        if (this.trayProcess) {
            this.trayProcess.kill();
            this.trayProcess = null;
        }
        vscode.window.showInformationMessage('Exovon Local Engine stopped.');
    }

    /**
     * Check if the daemon is currently responding on port 47990 or running as child process
     */
    public async isAlive(): Promise<boolean> {
        if (this.daemonProcess !== null) return true;
        try {
            const fetch = (await import('node-fetch')).default;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1500);
            const res = await fetch('http://127.0.0.1:47990/v1/health', { signal: controller.signal as any });
            clearTimeout(timeout);
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if the daemon process was spawned by this manager
     */
    public isRunning(): boolean {
        return this.daemonProcess !== null;
    }
}
