import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { LlamaUpdateService } from './agent/LlamaUpdateService';
import {
  buildDaemonLoadPayload,
  getModelPreference,
  loadAllModelPreferences,
  saveModelPreference
} from './agent/ModelPreferencesStore';

export class SettingsProvider {
  public static readonly viewType = 'exovonhubSettings';
  public static currentPanel: SettingsProvider | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext) {
    if (SettingsProvider.currentPanel) {
      SettingsProvider.currentPanel._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsProvider.viewType,
      'Astrolabe Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')],
        retainContextWhenHidden: true
      }
    );

    SettingsProvider.currentPanel = new SettingsProvider(panel, context);

    // Detach into dedicated auxiliary window immediately so Settings opens in its own window
    let moved = false;
    const moveListener = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active && !moved) {
        moved = true;
        moveListener.dispose();
        vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow').then(
          () => {},
          (err) => console.warn('[SettingsProvider] moveEditorToNewWindow failed:', err)
        );
      }
    });

    const fallbackTimer = setTimeout(() => {
      if (!moved) {
        moved = true;
        moveListener.dispose();
        try {
          vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
        } catch (_) {}
      }
    }, 150);

    panel.onDidDispose(() => {
      moveListener.dispose();
      clearTimeout(fallbackTimer);
    });
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    const llamaUpdateService = LlamaUpdateService.initialize(this._context);
    this._disposables.push(
      llamaUpdateService.onStateChange((state) => {
        try {
          this._panel.webview.postMessage({
            type: 'llamaUpdateStatus',
            ...state,
          });
        } catch {
          // Ignore disposed panel post errors
        }
      })
    );

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
              useHfMirror: config.get<boolean>('useHfMirror', false),
              searchProvider: config.get<string>('searchProvider') || 'tavily',
              tavilyApiKey: config.get<string>('tavilyApiKey') || '',
              firesearchApiKey: config.get<string>('firesearchApiKey') || '',
              tinyfishApiKey: config.get<string>('tinyfishApiKey') || '',
              browserEngine: config.get<string>('browserEngine') || 'headless',
              modelPreferences: loadAllModelPreferences()
            });
            break;
          }
          case 'updateSearchConfig': {
            try {
              const config = vscode.workspace.getConfiguration('exovonhub');
              if (data.provider !== undefined) {
                await config.update('searchProvider', data.provider, vscode.ConfigurationTarget.Global);
              }
              if (data.tavilyApiKey !== undefined) {
                await config.update('tavilyApiKey', data.tavilyApiKey, vscode.ConfigurationTarget.Global);
              }
              if (data.firesearchApiKey !== undefined) {
                await config.update('firesearchApiKey', data.firesearchApiKey, vscode.ConfigurationTarget.Global);
              }
              if (data.tinyfishApiKey !== undefined) {
                await config.update('tinyfishApiKey', data.tinyfishApiKey, vscode.ConfigurationTarget.Global);
              }
              if (data.browserEngine !== undefined) {
                await config.update('browserEngine', data.browserEngine, vscode.ConfigurationTarget.Global);
              }
              this._panel.webview.postMessage({
                type: 'settingsState',
                searchProvider: config.get<string>('searchProvider') || 'tavily',
                tavilyApiKey: config.get<string>('tavilyApiKey') || '',
                firesearchApiKey: config.get<string>('firesearchApiKey') || '',
                tinyfishApiKey: config.get<string>('tinyfishApiKey') || '',
                browserEngine: config.get<string>('browserEngine') || 'headless'
              });
              if (data.showNotification !== false) {
                vscode.window.showInformationMessage('Agent Web Search configuration saved.');
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to save web search settings: ${err.message}`);
            }
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
            await this._refreshLocalModels();
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
          case 'setActiveModel':
          case 'setLocalLlmModelName': {
            if (data.model) {
              await vscode.workspace.getConfiguration('exovonhub').update('localLlmModelName', data.model, vscode.ConfigurationTarget.Global);
              const updatedModel = vscode.workspace.getConfiguration('exovonhub').get<string>('localLlmModelName');
              const preferredModel = vscode.workspace.getConfiguration('exovonhub').get<string>('preferredModel');
              this._panel.webview.postMessage({ type: 'settingsState', model: preferredModel, localLlmModelName: updatedModel });
              vscode.window.showInformationMessage(`Active Local Model set to ${data.model}`);
              if (data.openChat) {
                try {
                  vscode.commands.executeCommand('exovonhub.openSidebar');
                } catch {}
              }
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
          case 'openFolder':
          case 'revealInOS': {
            try {
              let targetPath = (data && data.path) || vscode.workspace.getConfiguration('exovonhub').get<string>('localModelsDirectory') || '';
              if (targetPath.startsWith('~/')) {
                const home = process.env.HOME || process.env.USERPROFILE || '';
                targetPath = require('path').join(home, targetPath.slice(2));
              }
              const fs = require('fs');
              if (targetPath && fs.existsSync(targetPath)) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
              } else {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(process.env.HOME || '/'));
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to reveal in OS: ${err.message}`);
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
              const savedPref = getModelPreference(data.modelId);
              const payload = buildDaemonLoadPayload(data.modelId, data, savedPref);
              const effectiveCtxSize = typeof payload.ctx_size === 'number' ? payload.ctx_size : data.ctxSize;
              const effectiveResolution = typeof payload.resolution === 'string' ? payload.resolution : data.resolution;
              if (payload.temperature !== undefined) {
                try {
                  await vscode.workspace.getConfiguration('exovonhub').update('modelTemperature', payload.temperature, vscode.ConfigurationTarget.Global);
                } catch {}
              }

              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Loading Model: ${path.basename(data.modelId)}`,
                cancellable: false
              }, async (progress) => {
                let lastPercent = 0;
                let lastStage = '';
                let isPolling = false;
                let finished = false;

                const emitProgress = (percent: number, stage: string) => {
                  const clamped = Math.max(0, Math.min(99, Math.round(percent)));
                  const increment = Math.max(0, clamped - lastPercent);
                  lastPercent = Math.max(lastPercent, clamped);
                  lastStage = stage || lastStage;
                  if (lastStage) {
                    progress.report({ increment, message: `${lastStage} (${lastPercent}%)` });
                    this._panel.webview.postMessage({
                      type: 'modelLoadProgress',
                      modelId: data.modelId,
                      percent: lastPercent,
                      message: lastStage
                    });
                  }
                };

                const pollStatus = async () => {
                  if (isPolling || finished) return;
                  isPolling = true;
                  try {
                    let status: any = null;
                    try {
                      const statusRes = await fetch('http://127.0.0.1:47990/v1/models/load/status');
                      if (statusRes.ok) {
                        status = await statusRes.json();
                      }
                    } catch {}
                    if (!status) {
                      try {
                        const healthRes = await fetch('http://127.0.0.1:47990/v1/health');
                        if (healthRes.ok) {
                          const health = await healthRes.json() as any;
                          status = health?.loading_model || null;
                        }
                      } catch {}
                    }
                    if (finished || !status || status.active === false) return;
                    const pct = typeof status.percent === 'number'
                      ? status.percent
                      : (typeof status.progress === 'number' ? status.progress : undefined);
                    const stage = String(status.stage || status.message || '');
                    if (pct !== undefined && (pct > lastPercent || (stage && stage !== lastStage))) {
                      emitProgress(pct, stage || lastStage);
                    } else if (stage && stage !== lastStage) {
                      emitProgress(lastPercent, stage);
                    }
                  } finally {
                    isPolling = false;
                  }
                };

                const poller = setInterval(() => { void pollStatus(); }, 250);

                try {
                  void pollStatus();
                  const res = await fetch('http://127.0.0.1:47990/v1/models/load', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  finished = true;
                  clearInterval(poller);

                  if (res.ok) {
                    let loadResult: any = {};
                    try { loadResult = await res.json(); } catch {}

                    progress.report({ increment: Math.max(0, 100 - lastPercent), message: 'Model successfully loaded!' });
                    this._panel.webview.postMessage({
                      type: 'modelLoadProgress',
                      modelId: data.modelId,
                      percent: 100,
                      message: 'Ready'
                    });

                    const baseModelName = path.basename(data.modelId);
                    const normalizedPath = String(data.modelId || '').replace(/\\/g, '/').toLowerCase();
                    const baseLower = baseModelName.toLowerCase();
                    const explicitModality = String(loadResult?.modality || data.modality || '').toLowerCase();
                    const isVideo = explicitModality === 'video'
                      || normalizedPath.includes('/video/')
                      || normalizedPath.startsWith('video/')
                      || baseLower.includes('wan')
                      || baseLower.includes('ltx')
                      || baseLower.includes('hunyuanvideo')
                      || baseLower.includes('cogvideo')
                      || baseLower.includes('mochi');
                    const isImage = explicitModality === 'image'
                      || normalizedPath.includes('/image/')
                      || normalizedPath.startsWith('image/');
                    const isDiffusion = isVideo
                      || isImage
                      || data.target === 'diffusion'
                      || data.modelFamily === 'diffusion_flow'
                      || baseLower.includes('flux')
                      || baseLower.includes('sd-')
                      || baseLower.includes('sd_')
                      || baseLower.includes('sdxl')
                      || baseLower.includes('diffusion')
                      || (baseLower.includes('qwen') && baseLower.includes('image'))
                      || baseLower.includes('dit');
                    const resolvedModality = isVideo ? 'video' : (isDiffusion ? 'image' : 'llm');

                    this._panel.webview.postMessage({ type: 'modelLoaded', modelId: data.modelId, ctx_size: effectiveCtxSize, modality: resolvedModality });

                    if (data.maxTokens !== undefined) {
                      try {
                        await vscode.workspace.getConfiguration('exovonhub').update('localMaxTokens', data.maxTokens, vscode.ConfigurationTarget.Global);
                      } catch {}
                    }
                    try {
                      const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
                      if (isDiffusion) {
                        ExovonSidebarProvider.getInstance()?.updateDiffusionModel(baseModelName, effectiveResolution, resolvedModality);
                        this._panel.webview.postMessage({
                          type: 'settingsState',
                          activeDiffusionModel: baseModelName,
                          activeDiffusionResolution: effectiveResolution,
                          activeDiffusionModality: resolvedModality,
                          model: `diffusion:${baseModelName}`
                        });
                      } else {
                        ExovonSidebarProvider.getInstance()?.updateActiveModel(baseModelName, effectiveCtxSize);
                      }
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
                        const logPath = path.join(os.tmpdir(), 'exovon_daemon_spawn.log');
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
                      }
                    });
                  }
                } catch (err: any) {
                  finished = true;
                  clearInterval(poller);
                  this._panel.webview.postMessage({ type: 'modelLoadError', error: err.message, modelId: data.modelId });
                  vscode.window.showErrorMessage(
                    `Failed to connect to Exovon Local Engine: ${err.message}`,
                    'Restart Engine',
                    'View Logs'
                  ).then(action => {
                    if (action === 'Restart Engine') {
                      vscode.commands.executeCommand('exovon.restartDaemon');
                    } else if (action === 'View Logs') {
                      const logPath = path.join(os.tmpdir(), 'exovon_daemon_spawn.log');
                      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(logPath));
                    }
                  });
                } finally {
                  finished = true;
                  clearInterval(poller);
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
                this._panel.webview.postMessage({ type: 'modelUnloaded', target: data.target });
                try {
                  const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
                  if (data.target === 'diffusion') {
                    ExovonSidebarProvider.getInstance()?.updateDiffusionModel(null);
                  } else {
                    ExovonSidebarProvider.getInstance()?.updateActiveModel(null);
                    ExovonSidebarProvider.getInstance()?.updateDiffusionModel(null);
                  }
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
          case 'saveModelPreference': {
            try {
              if (!data?.modelId) {
                break;
              }
              const updated = saveModelPreference(data.modelId, data.preference || {});
              this._panel.webview.postMessage({
                type: 'modelPreferencesUpdated',
                modelPreferences: updated,
                savedModelId: data.modelId
              });
              try {
                const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
                ExovonSidebarProvider.getInstance()?.notifyModelPreferencesUpdated(updated);
              } catch {}
              vscode.window.showInformationMessage(`Saved tuning preferences for ${path.basename(String(data.modelId))}.`);
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to save model preference: ${err.message}`);
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

              // Auto-ensure exovon-daemon is alive before initiating download
              const { DaemonManager } = require('./agent/DaemonManager');
              const daemon = DaemonManager.getInstance();
              if (!await daemon.isAlive()) {
                await daemon.startDaemon(this._context);
                for (let i = 0; i < 8; i++) {
                  if (await daemon.isAlive()) break;
                  await new Promise(r => setTimeout(r, 250));
                }
              }

              vscode.window.showInformationMessage(`Starting download for ${data.filename}... Priority 16-channel streaming active.`);
              const downloadPayload: any = {
                url: data.url,
                filename: data.filename,
                hf_token: hfToken,
                use_mirror: useMirror
              };
              if ((data.repo_id ?? data.repoId) !== undefined) downloadPayload.repo_id = data.repo_id ?? data.repoId;
              if ((data.pipeline_tag ?? data.pipelineTag) !== undefined) downloadPayload.pipeline_tag = data.pipeline_tag ?? data.pipelineTag;
              if (data.tags !== undefined) downloadPayload.tags = data.tags;
              if ((data.modality_hint ?? data.modalityHint) !== undefined) downloadPayload.modality_hint = data.modality_hint ?? data.modalityHint;
              if ((data.component_role ?? data.componentRole) !== undefined) downloadPayload.component_role = data.component_role ?? data.componentRole;

              const res = await fetch('http://127.0.0.1:47990/v1/models/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadPayload)
              });
              
              if (!res.ok) {
                const errText = await res.text();
                vscode.window.showErrorMessage(`Failed to initiate download for ${data.filename}: ${errText}`);
              } else {
                // Immediately trigger active downloads refresh to the webview
                setTimeout(async () => {
                  try {
                    const dlRes = await fetch('http://127.0.0.1:47990/v1/models/downloads');
                    if (dlRes.ok) {
                      const dlBody = await dlRes.json() as any;
                      this._panel?.webview.postMessage({ type: 'activeDownloads', downloads: dlBody.downloads || [] });
                    }
                  } catch {}
                }, 300);
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to connect to local daemon: ${e.message}`);
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
          case 'closeSettings': {
            this.dispose();
            break;
          }
          case 'popOutWindow': {
            try {
              await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
            } catch (err) {
              console.warn('[SettingsProvider] popOutWindow failed:', err);
            }
            break;
          }
          case 'minimizeSettings': {
            break;
          }
          case 'toggleMaximizeSettings':
          case 'toggleFullScreen': {
            try {
              await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
            } catch (_) {}
            break;
          }
          case 'setTabTitle': {
            if (data.title) {
              this._panel.title = `Settings - ${data.title}`;
            }
            break;
          }
          case 'controlDownload': {
            try {
              const fetch = (await import('node-fetch')).default;
              await fetch('http://127.0.0.1:47990/v1/models/downloads/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: data.filename,
                  action: data.action,
                  url: data.url
                })
              });
            } catch (err) {
              console.error('Failed to control download:', err);
            }
            break;
          }
          case 'clearKvCache': {
            try {
              const fetch = (await import('node-fetch')).default;
              await fetch('http://127.0.0.1:47990/v1/models/clear_kv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });
              vscode.window.showInformationMessage('KV Cache cleared.');
            } catch (err) {
              console.error('Failed to clear KV cache:', err);
            }
            break;
          }
          case 'organizeLocalModels': {
            try {
              const fetch = (await import('node-fetch')).default;
              const dryRun = Boolean(data.dry_run ?? data.dryRun);
              const res = await fetch('http://127.0.0.1:47990/v1/models/organize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dry_run: dryRun })
              });
              const rawBody = res.ok
                ? await res.json().catch(() => ({}))
                : { error: await res.text().catch(() => `HTTP ${res.status}`) };
              const bodyObj = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody as any : {};
              const moves = Array.isArray(rawBody)
                ? rawBody
                : (bodyObj.moves || bodyObj.plan || bodyObj.items || bodyObj.changes || bodyObj.preview || bodyObj.moved);
              this._panel.webview.postMessage({
                ...bodyObj,
                type: 'organizeLocalModelsResult',
                ok: res.ok,
                dry_run: dryRun,
                dryRun,
                ...(moves !== undefined ? { moves } : {}),
                ...(res.ok ? {} : { error: bodyObj.error || `HTTP ${res.status}` }),
                result: rawBody
              });
              if (res.ok && !dryRun) {
                await this._refreshLocalModels();
              }
            } catch (err: any) {
              this._panel.webview.postMessage({
                type: 'organizeLocalModelsResult',
                ok: false,
                error: err?.message || 'Failed to organize local models'
              });
            }
            break;
          }
          case 'moveLocalModel': {
            try {
              const fetch = (await import('node-fetch')).default;
              const movePayload: any = {
                model_path: data.model_path ?? data.modelPath ?? data.modelId ?? data.path,
                target_modality: data.target_modality ?? data.targetModality ?? data.modality ?? data.target
              };
              if ((data.component_role ?? data.componentRole) !== undefined) {
                movePayload.component_role = data.component_role ?? data.componentRole;
              }
              if (data.relative_path !== undefined || data.relativePath !== undefined) {
                movePayload.relative_path = data.relative_path ?? data.relativePath;
              }
              const res = await fetch('http://127.0.0.1:47990/v1/models/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(movePayload)
              });
              const rawBody = res.ok
                ? await res.json().catch(() => ({}))
                : { error: await res.text().catch(() => `HTTP ${res.status}`) };
              const bodyObj = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody as any : {};
              this._panel.webview.postMessage({
                ...bodyObj,
                type: 'moveLocalModelResult',
                ok: res.ok,
                ...(res.ok ? {} : { error: bodyObj.error || `HTTP ${res.status}` }),
                result: rawBody
              });
              if (res.ok) {
                await this._refreshLocalModels();
              } else {
                vscode.window.showErrorMessage(`Failed to move model: ${bodyObj.error || `HTTP ${res.status}`}`);
              }
            } catch (err: any) {
              this._panel.webview.postMessage({
                type: 'moveLocalModelResult',
                ok: false,
                error: err?.message || 'Failed to move model'
              });
              vscode.window.showErrorMessage(`Failed to move model: ${err?.message || err}`);
            }
            break;
          }
          case 'showNotification': {
            if (data.message) {
              vscode.window.showInformationMessage(data.message);
            }
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
          case 'checkLlamaUpdate': {
            const service = LlamaUpdateService.initialize(this._context);
            const current = service.getState();
            if (data.silent === true && current.status && !current.status.error) {
              this._panel.webview.postMessage({
                type: 'llamaUpdateStatus',
                ...current,
              });
            } else {
              await service.checkForUpdates({
                interactive: data.silent !== true,
                respectCooldown: false,
              });
            }
            break;
          }
          case 'installLlamaUpdate': {
            await LlamaUpdateService.initialize(this._context).installUpdate(
              data.expectedTag,
              data.downloadUrl
            );
            break;
          }
          case 'clearSkippedLlamaBuild': {
            await LlamaUpdateService.initialize(this._context).clearSkippedBuild();
            break;
          }
          case 'openExternalUrl': {
            if (typeof data.url === 'string' && /^https:\/\//i.test(data.url)) {
              await vscode.env.openExternal(vscode.Uri.parse(data.url));
            }
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

  private async _refreshLocalModels(): Promise<any[]> {
    try {
      const fetch = (await import('node-fetch')).default;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, 8000);
      const res = await fetch('http://127.0.0.1:47990/v1/models', { signal: controller.signal as any });
      clearTimeout(timeout);

      if (res.ok) {
        const body = await res.json() as any;
        const models = body.data || [];
        this._panel.webview.postMessage({ type: 'localModels', models });
        this._panel.webview.postMessage({ type: 'daemonStatus', isRunning: true });
        try {
          const { ExovonSidebarProvider } = await import('./ExovonSidebarProvider');
          ExovonSidebarProvider.getInstance()?.postMessage({ type: 'localModels', models });
        } catch {}
        return models;
      }
    } catch (e) {}
    this._panel.webview.postMessage({ type: 'localModels', models: [] });
    return [];
  }

  private _update() {
    this._panel.title = "Astrolabe Settings";
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

    // Inject __EXOVON_PAGE__ and window flags so React mounts SettingsApp full viewport
    webviewHtml = webviewHtml.replace('<head>', `<head>\n<script>window.__EXOVON_PAGE__ = "settings"; window.__IS_SEPARATE_WINDOW__ = true;</script>`);

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src ${webview.cspSource} 'unsafe-inline' https://sdk.cashfree.com; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https: https://*.cashfree.com; frame-src ${webview.cspSource} https://*.cashfree.com;">`;
    webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);

    return webviewHtml;
  }
}
