import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DaemonManager } from './DaemonManager';

export class EngineStatusBarManager {
    private static instance: EngineStatusBarManager;
    private statusBarItem: vscode.StatusBarItem;
    private healthGuardItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;
    private pollInterval: NodeJS.Timeout | null = null;
    private activeModel: string | null = null;
    private isEngineRunning = false;
    private hardwareInfo: any = null;
    private isAgentPaused = false;
    private pauseReason = '';

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.statusBarItem = vscode.window.createStatusBarItem(
            'exovon.engineStatusBar',
            vscode.StatusBarAlignment.Right,
            95
        );
        this.statusBarItem.command = 'exovon.manageEngine';
        this.context.subscriptions.push(this.statusBarItem);

        this.healthGuardItem = vscode.window.createStatusBarItem(
            'exovon.healthGuard',
            vscode.StatusBarAlignment.Right,
            94
        );
        this.healthGuardItem.command = 'exovon.showHealthDetails';
        this.context.subscriptions.push(this.healthGuardItem);

        this.registerCommands();
        this.updateDisplay();
        this.startPolling();
    }

    public static initialize(context: vscode.ExtensionContext): EngineStatusBarManager {
        if (!EngineStatusBarManager.instance) {
            EngineStatusBarManager.instance = new EngineStatusBarManager(context);
        }
        return EngineStatusBarManager.instance;
    }

    public static getInstance(): EngineStatusBarManager {
        return EngineStatusBarManager.instance;
    }

    public getLatestHardwareInfo(): any {
        return this.hardwareInfo;
    }

    public setAgentPaused(paused: boolean, reason?: string) {
        this.isAgentPaused = paused;
        this.pauseReason = reason || '';
        this.updateDisplay();
    }

    public getIsAgentPaused(): boolean {
        return this.isAgentPaused;
    }

    private startPolling() {
        this.checkHealth();
        this.pollInterval = setInterval(() => {
            this.checkHealth();
        }, 3000);
    }

    public dispose() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.statusBarItem.dispose();
        this.healthGuardItem.dispose();
    }

    public async checkHealth() {
        try {
            const fetch = (await import('node-fetch')).default;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch('http://127.0.0.1:47990/v1/health', {
                signal: controller.signal as any
            });
            clearTimeout(timeout);

            if (res.ok) {
                const data = await res.json() as any;
                const newActiveModel = data.active_model || null;
                if (newActiveModel !== this.activeModel) {
                    try {
                        const { ExovonSidebarProvider } = await import('../ExovonSidebarProvider');
                        ExovonSidebarProvider.getInstance()?.updateActiveModel(newActiveModel, data.ctx_size);
                    } catch {}
                }
                this.isEngineRunning = true;
                this.activeModel = newActiveModel;
                this.hardwareInfo = data.hardware || null;
            } else {
                if (this.activeModel !== null) {
                    try {
                        const { ExovonSidebarProvider } = await import('../ExovonSidebarProvider');
                        ExovonSidebarProvider.getInstance()?.updateActiveModel(null);
                    } catch {}
                }
                this.isEngineRunning = false;
                this.activeModel = null;
            }
        } catch {
            if (this.activeModel !== null) {
                try {
                    const { ExovonSidebarProvider } = await import('../ExovonSidebarProvider');
                    ExovonSidebarProvider.getInstance()?.updateActiveModel(null);
                } catch {}
            }
            this.isEngineRunning = false;
            this.activeModel = null;
        }

        this.updateDisplay();
    }

    private updateDisplay() {
        if (!this.isEngineRunning) {
            this.statusBarItem.text = '$(circle-slash) Engine: Offline';
            this.statusBarItem.tooltip = new vscode.MarkdownString(
                '**Exovon Inference Engine**\n\n' +
                'Status: Offline (Port 47990)\n\n' +
                'Click to start daemon or manage settings.'
            );
            this.statusBarItem.color = new vscode.ThemeColor('descriptionForeground');
            this.healthGuardItem.hide();
        } else if (this.activeModel) {
            const shortName = this.formatShortModelName(this.activeModel);
            this.statusBarItem.text = `$(chip) ${shortName} (Vulkan)`;
            this.statusBarItem.tooltip = new vscode.MarkdownString(
                '**Exovon Inference Engine (Vulkan GPU)**\n\n' +
                `• **Status**: Running (127.0.0.1:47990)\n` +
                `• **Active Model**: \`${this.activeModel}\`\n` +
                `• **GPU**: ${this.hardwareInfo?.gpu || 'AMD Radeon (Vulkan)'}\n\n` +
                'Click to manage models, agents, and hardware parameters.'
            );
            this.statusBarItem.color = undefined;
            this.updateHealthGuardDisplay();
        } else {
            this.statusBarItem.text = '$(server) Engine: Ready';
            this.statusBarItem.tooltip = new vscode.MarkdownString(
                '**Exovon Inference Engine**\n\n' +
                '• **Status**: Running (127.0.0.1:47990)\n' +
                '• **Active Model**: None loaded\n\n' +
                'Click to load a model or manage agents.'
            );
            this.statusBarItem.color = undefined;
            this.updateHealthGuardDisplay();
        }
        this.statusBarItem.show();
    }

    private updateHealthGuardDisplay() {
        if (!this.hardwareInfo) {
            this.healthGuardItem.hide();
            return;
        }

        const cpuTemp = this.hardwareInfo.cpu_temp;
        const gpuTemp = this.hardwareInfo.gpu_temp;
        const maxTemp = this.hardwareInfo.max_temp || (cpuTemp ? Math.max(cpuTemp, gpuTemp || 0) : 0);
        const ramUsed = this.hardwareInfo.used_memory_gb || 0;
        const ramTotal = this.hardwareInfo.memory_gb || 0;
        const ramPercent = this.hardwareInfo.memory_percent || 0;

        if (this.isAgentPaused) {
            this.healthGuardItem.text = `$(debug-pause) ${Math.round(maxTemp)}°C [PAUSED - Cooling to 75°C]`;
            this.healthGuardItem.color = new vscode.ThemeColor('errorForeground');
            this.healthGuardItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (maxTemp >= 90) {
            this.healthGuardItem.text = `$(warning) ${Math.round(maxTemp)}°C [Thermal Throttle]`;
            this.healthGuardItem.color = new vscode.ThemeColor('errorForeground');
            this.healthGuardItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (maxTemp >= 80) {
            this.healthGuardItem.text = `$(flame) ${Math.round(maxTemp)}°C | ${ramUsed} GB [High]`;
            this.healthGuardItem.color = new vscode.ThemeColor('charts.orange');
            this.healthGuardItem.backgroundColor = undefined;
        } else {
            this.healthGuardItem.text = `$(flame) ${maxTemp ? Math.round(maxTemp) + '°C' : 'Normal'} | ${ramUsed} GB [Working]`;
            this.healthGuardItem.color = undefined;
            this.healthGuardItem.backgroundColor = undefined;
        }

        const tooltip = new vscode.MarkdownString(
            '**System Health Guard**\n\n' +
            `• **Status**: ${this.isAgentPaused ? 'Paused (Cooling down below 75°C)' : maxTemp >= 90 ? 'Thermal Warning (>= 90°C)' : 'Working (Normal)'}\n` +
            `• **CPU Temperature**: ${cpuTemp ? cpuTemp + '°C' : 'N/A'}\n` +
            `• **GPU Temperature**: ${gpuTemp ? gpuTemp + '°C' : 'N/A'}\n` +
            `• **Peak Temperature**: ${maxTemp ? maxTemp + '°C' : 'N/A'}\n` +
            `• **RAM Usage**: ${ramUsed} GB / ${ramTotal} GB (${ramPercent}%)\n` +
            `• **Safe Limit**: 90°C (Auto-pause threshold)\n` +
            `• **Auto-Resume**: < 75°C\n\n` +
            'Click to view hardware telemetry and options.'
        );
        this.healthGuardItem.tooltip = tooltip;
        this.healthGuardItem.show();
    }

    private formatShortModelName(name: string): string {
        let clean = name.replace(/\.gguf$/i, '');
        const parts = clean.split(/[-_]/);
        if (parts.length > 2) {
            return parts.slice(0, 3).join('-');
        }
        return clean.substring(0, 20);
    }

    private registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('exovon.manageEngine', async () => {
                await this.showManagementMenu();
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('exovon.showHealthDetails', async () => {
                await this.showHealthDetailsMenu();
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('exovon.unloadModel', async () => {
                await this.unloadModel();
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('exovon.restartDaemon', async () => {
                await this.restartDaemon();
            })
        );
    }

    private async showHealthDetailsMenu() {
        await this.checkHealth();
        const hw = this.hardwareInfo;
        const items: vscode.QuickPickItem[] = [];

        if (hw) {
            items.push({
                label: `$(flame) CPU Temperature: ${hw.cpu_temp ? hw.cpu_temp + '°C' : 'N/A'}`,
                description: 'AMD Ryzen Processor Sensor',
                detail: `Peak threshold: 90°C (Auto-pause limit)`
            });
            items.push({
                label: `$(device-desktop) GPU Temperature: ${hw.gpu_temp ? hw.gpu_temp + '°C' : 'N/A'}`,
                description: hw.gpu || 'AMD Radeon Graphics',
                detail: `Hardware acceleration: Vulkan backend`
            });
            items.push({
                label: `$(database) RAM Usage: ${hw.used_memory_gb || 0} GB / ${hw.memory_gb || 0} GB (${hw.memory_percent || 0}%)`,
                description: 'System Memory',
                detail: `Available memory for model context and cache`
            });
            items.push({
                label: `$(shield) Thermal Guard: ${this.isAgentPaused ? 'Paused (Cooling down)' : 'Active (Working)'}`,
                description: 'Automatic hardware protection',
                detail: 'Auto-pauses local inference at 90°C+ and auto-resumes when below 75°C'
            });
        } else {
            items.push({
                label: '$(circle-slash) Hardware Metrics Unavailable',
                description: 'Engine is offline',
                detail: 'Start Exovon daemon to monitor real-time temperature and RAM'
            });
        }

        await vscode.window.showQuickPick(items, {
            placeHolder: 'System Health & Thermal Guard Status'
        });
    }

    private async showManagementMenu() {
        await this.checkHealth();

        interface MenuQuickPickItem extends vscode.QuickPickItem {
            action: string;
        }

        const items: MenuQuickPickItem[] = [];

        // 1. Status Information
        if (this.isEngineRunning) {
            items.push({
                label: '$(pulse) Engine Status: Running (127.0.0.1:47990)',
                detail: `Backend: Vulkan GPU | Host: ${this.hardwareInfo?.cpu || 'AMD Zen 4'}`,
                action: 'status'
            });
        } else {
            items.push({
                label: '$(circle-slash) Engine Status: Offline',
                detail: 'Click to start local inference daemon',
                action: 'startDaemon'
            });
        }

        // 2. Active Model
        if (this.isEngineRunning && this.activeModel) {
            items.push({
                label: `$(chip) Active Model: ${this.activeModel}`,
                detail: 'Loaded in GPU/RAM memory. Click to configure in settings.',
                action: 'openSettings'
            });
        }

        // 3. Quick Actions
        if (this.isEngineRunning) {
            items.push({
                label: '$(database) Load / Switch Model...',
                detail: 'Browse downloaded GGUF models and load into memory',
                action: 'quickLoad'
            });

            if (this.activeModel) {
                items.push({
                    label: '$(trash) Unload Model (Free Memory)',
                    detail: 'Eject active model to release GPU VRAM and system memory',
                    action: 'unloadModel'
                });
            }
        }

        // 4. Agent & Session Management
        items.push({
            label: '$(trash) Clear KV Cache & Reset Context',
            detail: 'Purge GPU/CPU context evaluation buffer and reset session tokens',
            action: 'clearKvCache'
        });

        items.push({
            label: '$(clear-all) Clear Agent Chat & Session',
            detail: 'Reset conversational timeline and task state',
            action: 'clearAgent'
        });

        // 5. Engine Settings & Lifecycle
        items.push({
            label: '$(settings-gear) Open Engine & Hardware Settings',
            detail: 'Configure GPU offload layers, CPU threads, and batch sizes',
            action: 'openSettings'
        });

        if (this.isEngineRunning) {
            items.push({
                label: '$(refresh) Restart Inference Daemon',
                detail: 'Restart daemon process with updated binary and GPU cache',
                action: 'restartDaemon'
            });
        }

        items.push({
            label: '$(output) View Daemon Logs',
            detail: 'Open live log output at /tmp/exovon_daemon_spawn.log',
            action: 'viewLogs'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Exovon Local Engine & Agent Manager',
            title: 'Exovon Engine Controls'
        });

        if (!selected) return;

        switch (selected.action) {
            case 'startDaemon':
                await DaemonManager.getInstance().startDaemon(this.context);
                await this.checkHealth();
                break;
            case 'quickLoad':
                await this.showModelSelector();
                break;
            case 'unloadModel':
                await this.unloadModel();
                break;
            case 'clearKvCache':
                vscode.commands.executeCommand('exovon.clearKvCache');
                break;
            case 'clearAgent':
                vscode.commands.executeCommand('exovonhub.sidebar.focus');
                vscode.commands.executeCommand('exovon.focusAgentInput');
                vscode.window.showInformationMessage('Agent context buffer reset.');
                break;
            case 'openSettings':
                vscode.commands.executeCommand('exovon.openSettings');
                break;
            case 'restartDaemon':
                await this.restartDaemon();
                break;
            case 'viewLogs':
                await this.openLogs();
                break;
        }
    }

    private async showModelSelector() {
        try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch('http://127.0.0.1:47990/v1/models');
            if (!res.ok) {
                vscode.window.showWarningMessage('Failed to fetch local model list from daemon.');
                return;
            }

            const data = await res.json() as any;
            const models: any[] = data.models || [];

            if (models.length === 0) {
                vscode.window.showInformationMessage('No downloaded models found in your models directory.');
                return;
            }

            const items = models.map(m => ({
                label: `$(file-code) ${m.name || m.id}`,
                description: `${m.size_display || ''} | GGUF`,
                detail: m.id === this.activeModel ? '$(check) Currently Loaded' : 'Click to load into GPU memory',
                modelId: m.id
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a model to load into GPU memory',
                title: 'Available Local Models'
            });

            if (!selected) return;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Loading Model: ${path.basename(selected.modelId)}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 10, message: 'Initializing Vulkan GPU memory...' });
                this.statusBarItem.text = `$(sync~spin) Loading ${path.basename(selected.modelId).substring(0, 16)}...`;

                let currentPercent = 10;
                const ticker = setInterval(() => {
                    if (currentPercent < 90) {
                        currentPercent += Math.min(15, Math.floor(Math.random() * 8) + 6);
                        const msg = currentPercent > 55 ? 'Offloading neural layers to GPU VRAM...' : 'Reading GGUF tensors into memory...';
                        progress.report({ increment: 8, message: `${msg} (${currentPercent}%)` });
                    }
                }, 600);

                try {
                    const loadRes = await fetch('http://127.0.0.1:47990/v1/models/load', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model_path: selected.modelId,
                            ctx_size: 8192,
                            n_gpu_layers: -1,
                            n_threads: 0,
                            n_batch: 2048,
                            n_ubatch: 512,
                            use_mmap: false,
                            flash_attn: true
                        })
                    });
                    clearInterval(ticker);

                    if (loadRes.ok) {
                        progress.report({ increment: 100, message: 'Model loaded successfully!' });
                        vscode.window.showInformationMessage(`${path.basename(selected.modelId)} successfully loaded into memory.`);
                        await this.checkHealth();
                    } else {
                        const err = await loadRes.text();
                        vscode.window.showErrorMessage(`Failed to load model: ${err}`);
                        this.updateDisplay();
                    }
                } catch (err: any) {
                    clearInterval(ticker);
                    vscode.window.showErrorMessage(`Error loading model: ${err.message}`);
                    this.updateDisplay();
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error loading model: ${error.message}`);
        }
    }

    private async unloadModel() {
        try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch('http://127.0.0.1:47990/v1/models/unload', { method: 'POST' });
            if (res.ok) {
                vscode.window.showInformationMessage('Model unloaded from memory. VRAM freed.');
                await this.checkHealth();
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to unload model: ${error.message}`);
        }
    }

    private async restartDaemon() {
        const daemon = DaemonManager.getInstance();
        daemon.stopDaemon();
        await new Promise(r => setTimeout(r, 1000));
        await daemon.startDaemon(this.context);
        await this.checkHealth();
        vscode.window.showInformationMessage('Exovon Inference Daemon restarted.');
    }

    private async openLogs() {
        const logPath = '/tmp/exovon_daemon_spawn.log';
        if (fs.existsSync(logPath)) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
            await vscode.window.showTextDocument(doc, { preview: true });
        } else {
            vscode.window.showInformationMessage('No log file found at /tmp/exovon_daemon_spawn.log');
        }
    }
}
