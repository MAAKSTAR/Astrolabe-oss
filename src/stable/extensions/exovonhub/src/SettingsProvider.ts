import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class SettingsProvider {
  public static readonly viewType = 'exovonhubSettings';
  public static currentPanel: SettingsProvider | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsProvider.currentPanel) {
      SettingsProvider.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsProvider.viewType,
      'Exovon Settings',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')],
        retainContextWhenHidden: true
      }
    );

    SettingsProvider.currentPanel = new SettingsProvider(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (data) => {
        switch (data.command) {
          case 'getWorkspaceInfo': {
            // Need to pass isLoggedIn and tokenQuota
            // For now, ask sidebar provider or service to provide it, 
            // or just trigger the sidebar provider's logic
            vscode.commands.executeCommand('exovonhub.triggerSettingsState');
            break;
          }
          case 'getSettingsState': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            const { DEFAULT_LOCAL_SYSTEM_PROMPT } = require('./agent/prompts');
            this._panel.webview.postMessage({ 
              type: 'settingsState', 
              model: config.get<string>('preferredModel') || 'Qwen/Qwen3-235B-A22B-Instruct-2507',
              localModelsDirectory: config.get<string>('localModelsDirectory') || '',
              localLlmModelName: config.get<string>('localLlmModelName') || '',
              inlineGhostModel: config.get<string>('inlineGhostModel') || '',
              enableGhostText: config.get<boolean>('enableGhostText', true),
              localModelSystemPrompt: config.get<string>('localModelSystemPrompt') || DEFAULT_LOCAL_SYSTEM_PROMPT
            });
            break;
          }
          case 'setInlineGhostModel': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            await config.update('inlineGhostModel', data.model, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Inline Ghost Model set to: ${data.model}`);
            try {
              const { EngineStatusBarManager } = require('./agent/EngineStatusBarManager');
              EngineStatusBarManager.getInstance()?.updateDisplay();
            } catch {}
            this._panel.webview.postMessage({ type: 'inlineGhostModelUpdated', model: data.model });
            break;
          }
          case 'toggleGhostText': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            const current = config.get<boolean>('enableGhostText', true);
            const next = data.enabled !== undefined ? data.enabled : !current;
            await config.update('enableGhostText', next, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Inline Ghost Autocomplete is now ${next ? 'Enabled' : 'Disabled'}.`);
            try {
              const { EngineStatusBarManager } = require('./agent/EngineStatusBarManager');
              EngineStatusBarManager.getInstance()?.updateDisplay();
            } catch {}
            this._panel.webview.postMessage({ type: 'ghostTextToggled', enabled: next });
            break;
          }
          case 'startDaemon': {
            const { DaemonManager } = require('./agent/DaemonManager');
            const daemon = DaemonManager.getInstance();
            const success = await daemon.startDaemon(this._context);
            this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: success });
            break;
          }
          case 'stopDaemon': {
            const { DaemonManager } = require('./agent/DaemonManager');
            const daemon = DaemonManager.getInstance();
            daemon.stopDaemon();
            this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: false });
            break;
          }
          case 'getDaemonStatus': {
            try {
              const { DaemonManager } = require('./agent/DaemonManager');
              const daemon = DaemonManager.getInstance();
              const alive = await daemon.isAlive();
              this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: alive });
            } catch {
              this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: false });
            }
            break;
          }
          case 'getDaemonHealth': {
            try {
              const fetch = (await import('node-fetch')).default;
              const controller = new AbortController();
              const timeout = setTimeout(() => { controller.abort(); }, 3000);
              const res = await fetch('http://127.0.0.1:47990/v1/health', { signal: controller.signal as any });
              clearTimeout(timeout);
              
              if (res.ok) {
                const body = await res.json() as any;
                this._panel.webview.postMessage({ type: 'daemonHealth', health: body });
                this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: true });
              } else {
                this._panel.webview.postMessage({ type: 'daemonHealth', health: null });
              }
            } catch (e) {
              this._panel.webview.postMessage({ type: 'daemonHealth', health: null });
            }
            break;
          }
          case 'getLocalModels': {
            try {
              const fetch = (await import('node-fetch')).default;
              const controller = new AbortController();
              const timeout = setTimeout(() => { controller.abort(); }, 8000);
              const res = await fetch('http://127.0.0.1:47990/v1/models', { signal: controller.signal as any });
              clearTimeout(timeout);
              
              if (res.ok) {
                const body = await res.json() as any;
                this._panel.webview.postMessage({ type: 'localModels', models: body.data || [] });
                this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: true });
              } else {
                this._panel.webview.postMessage({ type: 'localModels', models: [] });
              }
            } catch (e) {
              this._panel.webview.postMessage({ type: 'localModels', models: [] });
            }
            break;
          }
          case 'getActiveDownloads': {
            try {
              const fetch = (await import('node-fetch')).default;
              const res = await fetch('http://127.0.0.1:47990/v1/models/downloads');
              if (res.ok) {
                const body = await res.json() as any;
                this._panel.webview.postMessage({ type: 'activeDownloads', downloads: body.downloads || [] });
              }
            } catch (e) {
              // Fail silently for polling
            }
            break;
          }
          case 'setLocalLlmModelName': {
            if (data.model) {
              await vscode.workspace.getConfiguration('exovonhub').update('localLlmModelName', data.model, vscode.ConfigurationTarget.Global);
              const updatedModel = vscode.workspace.getConfiguration('exovonhub').get<string>('localLlmModelName');
              const preferredModel = vscode.workspace.getConfiguration('exovonhub').get<string>('preferredModel');
              this._panel.webview.postMessage({ type: 'settingsState', model: preferredModel, localLlmModelName: updatedModel });
              vscode.window.showInformationMessage(`Active Local Model set to ${data.model}`);
            }
            break;
          }
          case 'browseLocalModelsDirectory': {
            try {
              const uri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Models Directory'
              });
              if (uri && uri[0]) {
                const fsPath = uri[0].fsPath;
                await vscode.workspace.getConfiguration('exovonhub').update('localModelsDirectory', fsPath, vscode.ConfigurationTarget.Global);
                
                const { DaemonManager } = require('./agent/DaemonManager');
                const daemon = DaemonManager.getInstance();
                if (daemon.isRunning()) {
                  daemon.stopDaemon();
                  await daemon.startDaemon(this._context);
                  vscode.window.showInformationMessage(`Models directory updated to ${fsPath} and Engine restarted.`);
                  this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: true });
                } else {
                  vscode.window.showInformationMessage(`Models directory updated to ${fsPath}. Start the Local Engine to see models.`);
                }
                this._panel.webview.postMessage({ type: 'settingsState', localModelsDirectory: fsPath });
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to update directory: ${err.message}`);
            }
            break;
          }
          case 'setLocalModelsDirectory': {
            try {
              if (data.directory !== undefined) {
                await vscode.workspace.getConfiguration('exovonhub').update('localModelsDirectory', data.directory, vscode.ConfigurationTarget.Global);
                
                const { DaemonManager } = require('./agent/DaemonManager');
                const daemon = DaemonManager.getInstance();
                if (daemon.isRunning()) {
                  daemon.stopDaemon();
                  await daemon.startDaemon(this._context);
                  vscode.window.showInformationMessage(`Models directory updated and Engine restarted.`);
                  this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: true });
                } else {
                  vscode.window.showInformationMessage(`Models directory updated. Start the Local Engine for changes to take effect.`);
                }
                this._panel.webview.postMessage({ type: 'settingsState', localModelsDirectory: data.directory });
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to save path: ${err.message}`);
            }
            break;
          }
          case 'loadLocalModel': {
            try {
              const fetch = (await import('node-fetch')).default;
              
              const payload: any = { model_path: data.modelId };
              if (data.ctxSize !== undefined) payload.ctx_size = data.ctxSize;
              if (data.nGPULayers !== undefined) payload.n_gpu_layers = data.nGPULayers;
              if (data.nThreads !== undefined) payload.n_threads = data.nThreads;
              if (data.nBatch !== undefined) payload.n_batch = data.nBatch;
              if (data.nUbatch !== undefined) payload.n_ubatch = data.nUbatch;
              if (data.backendPreference !== undefined) payload.backend_preference = data.backendPreference;
              if (data.useMmap !== undefined) payload.use_mmap = data.useMmap;
              if (data.flashAttn !== undefined) payload.flash_attn = data.flashAttn;

              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Loading Model: ${path.basename(data.modelId)}`,
                cancellable: false
              }, async (progress) => {
                progress.report({ increment: 10, message: 'Initializing Vulkan compute buffers...' });
                this._panel.webview.postMessage({ 
                  type: 'modelLoadProgress', 
                  modelId: data.modelId, 
                  percent: 10, 
                  message: 'Initializing Vulkan compute buffers...' 
                });

                let currentPercent = 10;
                const ticker = setInterval(() => {
                  if (currentPercent < 90) {
                    currentPercent += Math.min(15, Math.floor(Math.random() * 8) + 6);
                    const msg = currentPercent > 55 ? 'Offloading neural layers to GPU VRAM...' : 'Reading GGUF tensors into memory...';
                    progress.report({ increment: 8, message: `${msg} (${currentPercent}%)` });
                    this._panel.webview.postMessage({ 
                      type: 'modelLoadProgress', 
                      modelId: data.modelId, 
                      percent: currentPercent, 
                      message: msg 
                    });
                  }
                }, 600);

                try {
                  const res = await fetch('http://127.0.0.1:47990/v1/models/load', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  clearInterval(ticker);

                  if (res.ok) {
                    progress.report({ increment: 100, message: 'Model successfully loaded!' });
                    this._panel.webview.postMessage({ 
                      type: 'modelLoadProgress', 
                      modelId: data.modelId, 
                      percent: 100, 
                      message: 'Ready' 
                    });
                    this._panel.webview.postMessage({ type: 'modelLoaded', modelId: data.modelId, ctx_size: data.ctxSize });
                    const baseModelName = path.basename(data.modelId);
                    if (data.maxTokens !== undefined) {
                      try {
                        await vscode.workspace.getConfiguration('exovonhub').update('localMaxTokens', data.maxTokens, vscode.ConfigurationTarget.Global);
                      } catch {}
                    }
                    try {
                      const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
                      ExovonSidebarProvider.getInstance()?.updateActiveModel(baseModelName, data.ctxSize);
                    } catch {}
                    vscode.window.showInformationMessage(`${path.basename(data.modelId)} successfully loaded into memory.`);
                  } else {
                    let errorDetails = '';
                    try {
                      const errorJson = await res.json() as any;
                      errorDetails = errorJson.message || errorJson.error || JSON.stringify(errorJson);
                    } catch {
                      errorDetails = await res.text();
                    }
                    this._panel.webview.postMessage({ type: 'modelLoadError', error: errorDetails, modelId: data.modelId });
                    vscode.window.showErrorMessage(
                      `Failed to load model '${data.modelId}': ${errorDetails || 'Inference engine error'}`,
                      'View Logs',
                      'Retry'
                    ).then(action => {
                      if (action === 'View Logs') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                      }
                    });
                  }
                } catch (err: any) {
                  clearInterval(ticker);
                  this._panel.webview.postMessage({ type: 'modelLoadError', error: err.message, modelId: data.modelId });
                  vscode.window.showErrorMessage(
                    `Failed to connect to Exovon Local Engine: ${err.message}`,
                    'Restart Engine',
                    'View Logs'
                  ).then(action => {
                    if (action === 'Restart Engine') {
                      vscode.commands.executeCommand('exovon.restartDaemon');
                    } else if (action === 'View Logs') {
                      vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/tmp/exovon_daemon_spawn.log'));
                    }
                  });
                }
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to load model: ${e.message}`);
            }
            break;
          }
          case 'unloadLocalModel': {
            try {
              const fetch = (await import('node-fetch')).default;
              const res = await fetch('http://127.0.0.1:47990/v1/models/unload', { method: 'POST' });
              if (res.ok) {
                vscode.window.showInformationMessage(`Model unloaded from memory.`);
                this._panel.webview.postMessage({ type: 'modelUnloaded' });
                try {
                  const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
                  ExovonSidebarProvider.getInstance()?.updateActiveModel(null);
                } catch {}
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to connect to local daemon.');
            }
            break;
          }
          case 'searchHuggingFace': {
            try {
              const fetch = (await import('node-fetch')).default;
              const page = data.page || 0;
              const res = await fetch(`http://127.0.0.1:47990/v1/models/search?q=${encodeURIComponent(data.query)}&page=${page}`);
              if (res.ok) {
                const body = await res.json() as any;
                this._panel.webview.postMessage({ type: 'hfSearchResults', results: body.results || [], page: page });
              } else {
                this._panel.webview.postMessage({ type: 'hfSearchResults', results: [] });
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to connect to local daemon. Is it running?');
              this._panel.webview.postMessage({ type: 'hfSearchResults', results: [] });
            }
            break;
          }
          case 'getHfRepoTree': {
            try {
              if (data.repo) {
                const fetch = (await import('node-fetch')).default;
                const res = await fetch(`http://127.0.0.1:47990/v1/models/tree?repo=${encodeURIComponent(data.repo)}`);
                if (res.ok) {
                  const body = await res.json() as any;
                  this._panel.webview.postMessage({ type: 'hfRepoTree', repo: data.repo, files: body.files || [] });
                } else {
                  vscode.window.showErrorMessage('Failed to fetch repository files.');
                }
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to connect to local daemon.');
            }
            break;
          }
          case 'downloadLocalModel': {
            try {
              const fetch = (await import('node-fetch')).default;
              vscode.window.showInformationMessage(`Starting download for ${data.filename}... Check daemon logs for progress.`);
              const res = await fetch('http://127.0.0.1:47990/v1/models/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: data.url, filename: data.filename })
              });
              
              if (!res.ok) {
                vscode.window.showErrorMessage(`Failed to initiate download for ${data.filename}`);
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to connect to local daemon.');
            }
            break;
          }
          case 'controlDownload': {
            try {
              const fetch = (await import('node-fetch')).default;
              const res = await fetch('http://127.0.0.1:47990/v1/models/downloads/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: data.filename, action: data.action })
              });
              if (res.ok) {
                const act = data.action;
                if (act === 'pause') {
                  vscode.window.showInformationMessage(`Paused download for ${data.filename}`);
                } else if (act === 'retry') {
                  vscode.window.showInformationMessage(`Resuming download for ${data.filename}`);
                } else if (act === 'delete') {
                  vscode.window.showInformationMessage(`Deleted download for ${data.filename}`);
                }
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to control download on local daemon.');
            }
            break;
          }
          case 'updatePreferredModel': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            await config.update('preferredModel', data.value, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Exovon model updated to ${data.value}`);
            break;
          }
          case 'updateLocalModelSystemPrompt': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            await config.update('localModelSystemPrompt', data.prompt, vscode.ConfigurationTarget.Global);
            this._panel.webview.postMessage({ 
              type: 'settingsState', 
              localModelSystemPrompt: data.prompt 
            });
            vscode.window.showInformationMessage('Local Agent System Instruction saved.');
            break;
          }
          case 'resetLocalModelSystemPrompt': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            const { DEFAULT_LOCAL_SYSTEM_PROMPT } = require('./agent/prompts');
            await config.update('localModelSystemPrompt', undefined, vscode.ConfigurationTarget.Global);
            this._panel.webview.postMessage({ 
              type: 'settingsState', 
              localModelSystemPrompt: DEFAULT_LOCAL_SYSTEM_PROMPT 
            });
            vscode.window.showInformationMessage('Local Agent System Instruction reset to default.');
            break;
          }
          case 'login': {
            vscode.commands.executeCommand('exovon.login');
            break;
          }
          case 'logout': {
            vscode.commands.executeCommand('exovon.logout');
            break;
          }
          case 'pasteAuthToken': {
            vscode.commands.executeCommand('exovon.pasteAuthToken');
            break;
          }
          case 'buyProPass': {
            vscode.commands.executeCommand('exovon.buyProPass', data.tier);
            break;
          }
          // IDE Core Commands
          case 'openNativeSettings': {
            vscode.commands.executeCommand('workbench.action.openSettings');
            break;
          }
          case 'openKeybindings': {
            vscode.commands.executeCommand('workbench.action.openGlobalKeybindings');
            break;
          }
          case 'selectTheme': {
            vscode.commands.executeCommand('workbench.action.selectTheme');
            break;
          }
          case 'showCommandPalette': {
            vscode.commands.executeCommand('workbench.action.showCommands');
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    SettingsProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public postMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  private _update() {
    this._panel.title = "Settings - Models";
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui', 'dist', 'index.html');
    let htmlContent = '';
    
    try {
      htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
    } catch (e) {
      return `<html><body><h1>Build Not Found</h1></body></html>`;
    }

    const baseUri = vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui', 'dist');
    const cacheBuster = `?v=${Date.now()}`;
    let webviewHtml = htmlContent.replace(
      /(href|src)="(?:\.\/|\/)?(assets\/[^"]+|favicon\.svg[^"]*)"/g,
      (match, attr, assetPath) => {
        const assetUri = vscode.Uri.joinPath(baseUri, assetPath);
        const webviewUri = webview.asWebviewUri(assetUri);
        return `${attr}="${webviewUri}${cacheBuster}"`;
      }
    );

    // Strip crossorigin attributes which can cause load blocks in Webviews due to protocol restrictions
    webviewHtml = webviewHtml.replace(/\scrossorigin(="")?/g, '');

    // Inject __EXOVON_PAGE__ so React router mounts SettingsApp
    webviewHtml = webviewHtml.replace('<head>', `<head>\n<script>window.__EXOVON_PAGE__ = "settings";</script>`);

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src ${webview.cspSource} 'unsafe-inline' https://sdk.cashfree.com; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https: https://*.cashfree.com; frame-src ${webview.cspSource} https://*.cashfree.com;">`;
    webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);

    return webviewHtml;
  }
}
