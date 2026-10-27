import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

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
              localModelSystemPrompt: config.get<string>('localModelSystemPrompt') || DEFAULT_LOCAL_SYSTEM_PROMPT,
              huggingFaceToken: config.get<string>('huggingFaceToken') || '',
              useHfMirror: config.get<boolean>('useHfMirror', false)
            });
            break;
          }
          case 'setInlineGhostModel': {
            const config = vscode.workspace.getConfiguration('exovonhub');
            await config.update('inlineGhostModel', data.model, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Inline Ghost Model set to: ${path.basename(data.model)}`);
            
            try {
              const fetch = (await import('node-fetch')).default;
              await fetch('http://127.0.0.1:47990/v1/models/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_path: data.model })
              });
            } catch {}

            try {
              const { EngineStatusBarManager } = require('./agent/EngineStatusBarManager');
              EngineStatusBarManager.getInstance()?.checkHealth();
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
              if (data.kvQuant !== undefined) payload.kv_quant = data.kvQuant;
              if (data.target !== undefined) payload.target = data.target;
              if (data.temperature !== undefined) {
                payload.temperature = data.temperature;
                try {
                  await vscode.workspace.getConfiguration('exovonhub').update('modelTemperature', data.temperature, vscode.ConfigurationTarget.Global);
                } catch {}
              }

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
          case 'updateHfToken': {
            try {
              const config = vscode.workspace.getConfiguration('exovonhub');
              await config.update('huggingFaceToken', data.token || '', vscode.ConfigurationTarget.Global);
              this._panel.webview.postMessage({ type: 'settingsState', huggingFaceToken: data.token || '' });
              vscode.window.showInformationMessage('Hugging Face Token saved.');
              const fetch = (await import('node-fetch')).default;
              await fetch('http://127.0.0.1:47990/v1/system/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hf_token: data.token || '' })
              }).catch(() => {});
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to save token: ${err.message}`);
            }
            break;
          }
          case 'toggleHfMirror': {
            try {
              const config = vscode.workspace.getConfiguration('exovonhub');
              const next = data.useMirror !== undefined ? data.useMirror : !config.get<boolean>('useHfMirror', false);
              await config.update('useHfMirror', next, vscode.ConfigurationTarget.Global);
              this._panel.webview.postMessage({ type: 'settingsState', useHfMirror: next });
              vscode.window.showInformationMessage(`High-Speed CDN Mirror ${next ? 'Enabled' : 'Disabled'}.`);
              const fetch = (await import('node-fetch')).default;
              await fetch('http://127.0.0.1:47990/v1/system/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ use_mirror: next })
              }).catch(() => {});
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to update mirror: ${err.message}`);
            }
            break;
          }
          case 'downloadLocalModel': {
            try {
              const fetch = (await import('node-fetch')).default;
              const config = vscode.workspace.getConfiguration('exovonhub');
              const hfToken = config.get<string>('huggingFaceToken') || undefined;
              const useMirror = config.get<boolean>('useHfMirror', false);

              vscode.window.showInformationMessage(`Starting download for ${data.filename}... Priority 16-channel streaming active.`);
              const res = await fetch('http://127.0.0.1:47990/v1/models/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: data.url,
                  filename: data.filename,
                  hf_token: hfToken,
                  use_mirror: useMirror
                })
              });
              
              if (!res.ok) {
                vscode.window.showErrorMessage(`Failed to initiate download for ${data.filename}`);
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to connect to local daemon.');
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
          case 'checkSystemUpdates': {
            try {
              let currentVersion = 'v1.0.12';
              try {
                const pkgJsonPath = path.join(this._context.extensionPath, 'package.json');
                if (fs.existsSync(pkgJsonPath)) {
                  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                  if (pkg.version) {
                    currentVersion = pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`;
                  }
                }
              } catch (_) {}

              const res = await fetch('https://api.github.com/repos/MAAKSTAR/Astrolabe-oss/releases/latest', {
                headers: { 'User-Agent': 'Astrolabe-IDE' }
              });
              if (!res.ok) {
                throw new Error(`GitHub returned HTTP ${res.status}`);
              }
              const release: any = await res.json();
              const latestVersion = release.tag_name || '';

              const cleanCur = currentVersion.replace(/^v/, '').trim();
              const cleanLatest = latestVersion.replace(/^v/, '').trim();
              const hasUpdate = cleanLatest !== '' && cleanCur !== cleanLatest;

              const isWindows = process.platform === 'win32';
              const targetAsset = release.assets?.find((a: any) =>
                isWindows ? a.name.includes('windows-x64.zip') : a.name.includes('linux-x64.tar.gz')
              );
              const downloadUrl = targetAsset ? targetAsset.browser_download_url : release.html_url;

              this._panel.webview.postMessage({
                type: 'systemUpdateStatus',
                hasUpdate,
                currentVersion,
                latestVersion,
                message: hasUpdate 
                  ? `New release ${latestVersion} is available!` 
                  : `Astrolabe is up to date (${currentVersion}).`,
                downloadUrl,
                releaseNotes: release.body || ''
              });
            } catch (err: any) {
              this._panel.webview.postMessage({
                type: 'systemUpdateStatus',
                hasUpdate: false,
                message: `Update check failed: ${err.message}`
              });
            }
            break;
          }
          case 'installSystemUpdate': {
            const downloadUrl = data.downloadUrl;
            if (!downloadUrl) {
              vscode.window.showErrorMessage('No download URL provided for update.');
              break;
            }

            const isWindows = process.platform === 'win32';
            const defaultLinuxInstallDir = path.join(os.homedir(), '.local', 'share', 'astrolabe');
            const installDir = fs.existsSync(defaultLinuxInstallDir)
              ? defaultLinuxInstallDir
              : path.dirname(path.dirname(process.execPath));

            vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: "Updating Astrolabe...",
              cancellable: false
            }, async (progress) => {
              try {
                progress.report({ message: "Downloading latest release package..." });
                const tmpDir = os.tmpdir();
                const archiveExt = isWindows ? 'zip' : 'tar.gz';
                const tmpArchive = path.join(tmpDir, `astrolabe-update.${archiveExt}`);

                const resp = await fetch(downloadUrl, { headers: { 'User-Agent': 'Astrolabe-IDE' } });
                if (!resp.ok) throw new Error(`Download failed with HTTP ${resp.status}`);

                const arrayBuffer = await resp.arrayBuffer();
                fs.writeFileSync(tmpArchive, Buffer.from(arrayBuffer));

                progress.report({ message: "Applying update in-place..." });
                if (!isWindows) {
                  try {
                    cp.execSync(`tar -xzf "${tmpArchive}" -C "${installDir}" --strip-components=1`, { stdio: 'ignore' });
                  } catch (_) {
                    cp.execSync(`tar -xzf "${tmpArchive}" -C "${installDir}"`, { stdio: 'ignore' });
                  }
                  try {
                    cp.execSync(`chmod +x "${path.join(installDir, 'astrolabe')}" "${path.join(installDir, 'bin', 'astrolabe')}" "${path.join(installDir, 'daemon', 'exovon-daemon')}" 2>/dev/null || true`);
                  } catch (_) {}
                } else {
                  const psCmd = `Expand-Archive -Path "${tmpArchive}" -DestinationPath "${installDir}" -Force`;
                  cp.execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
                }

                try { fs.unlinkSync(tmpArchive); } catch (_) {}

                this._panel?.webview.postMessage({
                  type: 'systemUpdateStatus',
                  hasUpdate: false,
                  message: 'Update applied successfully! Restart to apply changes.'
                });

                const choice = await vscode.window.showInformationMessage(
                  "Astrolabe update applied successfully! Restart now to complete the update.",
                  "Restart Now",
                  "Later"
                );
                if (choice === "Restart Now") {
                  vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
              } catch (err: any) {
                vscode.window.showErrorMessage(`Update installation failed: ${err.message}`);
                this._panel?.webview.postMessage({
                  type: 'systemUpdateStatus',
                  hasUpdate: false,
                  message: `Update installation failed: ${err.message}`
                });
              }
            });
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
