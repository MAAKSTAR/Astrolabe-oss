import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
        // If already responding and healthy on port 47990, sync status and return true
        if (await this.isAlive()) {
            console.log('[DaemonManager] Daemon is already healthy on port 47990.');
            try {
                const { EngineStatusBarManager } = require('./EngineStatusBarManager');
                EngineStatusBarManager.getInstance()?.checkHealth();
            } catch {}
            return true;
        }

        if (this.isStarting) {
            return false;
        }

        this.isStarting = true;

        try {
            // Clean up any stale or orphaned daemon processes holding port 47990.
            // Send SIGTERM first so exovon-daemon can cleanly unload llama-server children.
            if (this.daemonProcess) {
                try { this.daemonProcess.kill('SIGTERM'); } catch {}
                this.daemonProcess = null;
            }
            try {
                const cp = require('child_process');
                if (process.platform === 'win32') {
                    cp.execSync('taskkill /IM exovon-daemon.exe 2>nul || exit 0', { stdio: 'ignore' });
                    await new Promise(r => setTimeout(r, 350));
                    cp.execSync('taskkill /F /IM exovon-daemon.exe 2>nul || exit 0', { stdio: 'ignore' });
                } else {
                    cp.execSync('pkill -TERM -x "exovon-daemon" 2>/dev/null || true', { stdio: 'ignore' });
                    await new Promise(r => setTimeout(r, 350));
                    cp.execSync('pkill -KILL -x "exovon-daemon" 2>/dev/null || true', { stdio: 'ignore' });
                }
            } catch {}
            await new Promise(r => setTimeout(r, 150));

            const isWin = process.platform === 'win32';
            const binName = isWin ? 'exovon-daemon.exe' : 'exovon-daemon';
            const home = os.homedir();

            const candidatePaths = [
                process.env.ASTROLABE_DAEMON_PATH || '',
                path.join(vscode.env.appRoot, 'daemon', binName),
                path.join(vscode.env.appRoot, '..', 'daemon', binName),
                path.join(vscode.env.appRoot, 'resources', 'app', 'daemon', binName),
                path.join(vscode.env.appRoot, 'bin', binName),
                path.join(home, '.local', 'share', 'astrolabe', 'daemon', binName),
                path.join(home, '.local', 'share', 'astrolabe', binName),
                path.join(context.extensionPath, '..', '..', 'daemon', binName),
                path.join(context.extensionPath, '..', '..', '..', 'daemon', binName),
                path.join(context.extensionPath, 'daemon', binName),
                path.join(context.extensionPath, 'bin', binName),
                path.resolve(__dirname, '../../../daemon/target/release', binName),
                path.resolve(__dirname, '../../../../daemon/target/release', binName)
            ].filter(Boolean);

            let daemonPath = candidatePaths.find(p => fs.existsSync(p));
            if (!daemonPath) {
                console.warn('[DaemonManager] Daemon binary not found in candidate paths. Operating in remote/offline mode.');
                this.isStarting = false;
                return false;
            }

            const config = vscode.workspace.getConfiguration('exovonhub');
            const customModelsDir = config.get<string>('localModelsDirectory');
            
            const args = customModelsDir && customModelsDir.trim() !== '' ? ['--models-dir', customModelsDir.trim()] : [];

            // Add LD_LIBRARY_PATH so it can find libllama.so, libggml-vulkan.so, etc.
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

            const logPath = path.join(os.tmpdir(), 'exovon_daemon_spawn.log');
            const logStream = fs.createWriteStream(logPath, { flags: 'a' });

            this.daemonProcess = spawn(daemonPath, args, {
                cwd: path.dirname(daemonPath),
                env: daemonEnv,
                stdio: ['ignore', 'pipe', 'pipe']
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
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
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
                            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
                        }
                    });
                }
                this.daemonProcess = null;
            });

            // Actively poll /v1/health until ready (up to 6 seconds)
            let healthy = false;
            for (let attempt = 0; attempt < 24; attempt++) {
                await new Promise(r => setTimeout(r, 250));
                if (!this.daemonProcess || this.daemonProcess.exitCode !== null) {
                    break;
                }
                if (await this.isAlive()) {
                    healthy = true;
                    break;
                }
            }

            if (!healthy) {
                if (this.daemonProcess) {
                    try { this.daemonProcess.kill('SIGKILL'); } catch {}
                    this.daemonProcess = null;
                }
                vscode.window.showErrorMessage(
                    'Exovon Local Engine failed to respond on port 47990.',
                    'View Logs',
                    'Retry'
                ).then(action => {
                    if (action === 'Retry') {
                        this.startDaemon(context);
                    } else if (action === 'View Logs') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
                    }
                });
                return false;
            }

            // Launch top panel System Tray indicator (AppIndicator)
            this.startTrayIndicator();

            // Trigger immediate status bar update to remove "Offline"
            try {
                const { EngineStatusBarManager } = require('./EngineStatusBarManager');
                EngineStatusBarManager.getInstance()?.checkHealth();
            } catch {}

            vscode.window.showInformationMessage('Exovon Local Engine initialized successfully.');
            return true;
        } catch (error: any) {
            const logPath = path.join(os.tmpdir(), 'exovon_daemon_spawn.log');
            vscode.window.showErrorMessage(
                `Failed to initialize Exovon Local Engine: ${error.message}`,
                'View Logs',
                'Retry'
            ).then(action => {
                if (action === 'Retry') {
                    this.startDaemon(context);
                } else if (action === 'View Logs') {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
                }
            });
            return false;
        } finally {
            this.isStarting = false;
        }
    }

    private startTrayIndicator() {
        if (this.trayProcess) return;
        const home = os.homedir();
        const candidateTrayPaths = [
            path.join(vscode.env.appRoot, 'daemon', 'tray.py'),
            path.join(vscode.env.appRoot, '..', 'daemon', 'tray.py'),
            path.join(home, '.local', 'share', 'astrolabe', 'daemon', 'tray.py'),
            path.join(home, '.local', 'share', 'astrolabe', 'resources', 'app', 'daemon', 'tray.py'),
            path.resolve(__dirname, '../../../daemon/tray.py'),
            path.resolve(__dirname, '../../../../daemon/tray.py')
        ];
        const trayScript = candidateTrayPaths.find(p => fs.existsSync(p));
        if (trayScript) {
            try {
                const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
                this.trayProcess = spawn('python3', [trayScript], {
                    env: {
                        ...process.env,
                        DISPLAY: process.env.DISPLAY || ':0',
                        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
                        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
                        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${uid}/bus`
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
            try { this.daemonProcess.kill('SIGTERM'); } catch {}
            this.daemonProcess = null;
        }
        if (this.trayProcess) {
            try { this.trayProcess.kill('SIGTERM'); } catch {}
            this.trayProcess = null;
        }
        try {
            const cp = require('child_process');
            if (process.platform === 'win32') {
                cp.execSync('taskkill /IM exovon-daemon.exe 2>nul || exit 0', { stdio: 'ignore' });
            } else {
                cp.execSync('pkill -TERM -x "exovon-daemon" 2>/dev/null || true', { stdio: 'ignore' });
            }
        } catch {}
        try {
            const { EngineStatusBarManager } = require('./EngineStatusBarManager');
            EngineStatusBarManager.getInstance()?.checkHealth();
        } catch {}
        vscode.window.showInformationMessage('Exovon Local Engine stopped.');
    }

    /**
     * Check if the daemon is currently responding on port 47990
     */
    public async isAlive(): Promise<boolean> {
        try {
            const fetch = (await import('node-fetch')).default;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch('http://127.0.0.1:47990/v1/health', { signal: controller.signal as any });
            clearTimeout(timeout);
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if the daemon process was spawned by this manager and is alive
     */
    public isRunning(): boolean {
        return this.daemonProcess !== null && this.daemonProcess.exitCode === null;
    }
}
