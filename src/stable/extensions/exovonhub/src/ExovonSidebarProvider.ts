import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentOrchestrator } from './agent/AgentOrchestrator';
import { DiagnosticsWatchdog } from './agent/DiagnosticsWatchdog';
import { FileSystemTools } from './agent/tools/FileSystemTools';
import { AuthService } from './auth/AuthService';
import { PlanReviewProvider } from './agent/PlanReviewProvider';
import { PlanViewerProvider } from './agent/PlanViewerProvider';
import { PlanCommentController } from './agent/PlanCommentController';
import { InspectorProxy } from './agent/InspectorProxy';
import { DaemonManager } from './agent/DaemonManager';
import { WorkspacePreparer } from './agent/WorkspacePreparer';
import { DevServerManager } from './agent/DevServerManager';

import { IBrainCoordinator } from './types/shared';

interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'success' | 'failed';
}

export class ExovonSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'exovonhub.sidebar';
  private static _instance?: ExovonSidebarProvider;
  public static getInstance(): ExovonSidebarProvider | undefined {
    return ExovonSidebarProvider._instance;
  }

  private _view?: vscode.WebviewView;
  private _activeOrchestrator?: AgentOrchestrator;

  private _pendingApprovals = new Map<string, (approved: boolean) => void>();
  private _watchdog?: DiagnosticsWatchdog;
  private _isInspectorActive: boolean = false;
  private _inspectorProxy?: InspectorProxy;
  private _currentTargetPort: number | null = null;
  private _statusBarItem: vscode.StatusBarItem;

  public updateActiveModel(modelName: string | null, ctxSize?: number) {
    if (modelName) {
      const config = vscode.workspace.getConfiguration('exovonhub');
      config.update('localLlmModelName', modelName, vscode.ConfigurationTarget.Global);
      this.postMessage({
        type: 'settingsState',
        localLlmModelName: modelName,
        ctx_size: ctxSize || 8192
      });
    } else {
      this.postMessage({
        type: 'modelUnloaded'
      });
    }
  }

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _authService?: AuthService,
    private readonly _brainCoordinator?: IBrainCoordinator,
    private readonly _planReviewProvider?: PlanReviewProvider,
    private readonly _planCommentController?: PlanCommentController
  ) {
    ExovonSidebarProvider._instance = this;
    this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._statusBarItem.command = 'exovonhub.changeInspectorPort';
    this._statusBarItem.tooltip = 'Change Astrolabe Inspector Port';
    this._context.subscriptions.push(this._statusBarItem);

    this._watchdog = new DiagnosticsWatchdog((msg) => {
      if (msg.type === 'watchdogError') {
        this.postMessage({ type: 'agentLog', text: msg.text, logType: msg.logType });
        
        if (this._activeOrchestrator && !this._activeOrchestrator.isExecuting) {
          const config = vscode.workspace.getConfiguration('exovonhub');
          const isAutonomous = config.get<boolean>('autonomousMode') || false;
          if (isAutonomous) {
            const fixPrompt = `The compiler/linter returned an error in ${msg.relPath} at line ${msg.lineNum}:\n\n${msg.errorMsg}\n\nCode context:\n\`\`\`typescript\n${msg.brokenCode}\n\`\`\`\n\nPlease fix this error.`;
            this.postMessage({ type: 'appendInput', text: fixPrompt });
            // We will add retrigger to AgentOrchestrator next
            if ((this._activeOrchestrator as any).retrigger) {
              (this._activeOrchestrator as any).retrigger(fixPrompt);
            }
          }
        }
      } else {
        this.postMessage(msg);
      }
    });
    
    if (this._authService) {
      this._authService.onDidChangeAuthState(async (token) => {
        if (token) {
           const { ApiService } = await import('./agent/ApiService.js');
           const profile = await ApiService.getUserProfile(token);
           this.postMessage({ 
             type: 'workspaceInfo', 
             isLoggedIn: true, 
             tokenQuota: profile.remaining,
             modelRates: profile.modelRates,
             profilePic: profile.profilePic,
             membershipType: profile.membershipType,
             displayName: profile.displayName,
             email: profile.email
           });
        } else {
           this.postMessage({ type: 'workspaceInfo', isLoggedIn: false, tokenQuota: '...' });
        }
        this.postMessage({ type: 'authStateChanged', loggedIn: !!token });
        this.broadcastStateToSettings();
      });
    }
  }

  public postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public async resetInspectorPort() {
    if (!this._inspectorProxy) return;
    
    const action = await vscode.window.showQuickPick(
      ['Change Target Port', 'Stop Inspector Server'],
      { placeHolder: `Inspector is running on port ${this._currentTargetPort}` }
    );

    if (action === 'Stop Inspector Server') {
      this._inspectorProxy.stop();
      DevServerManager.killServer();
      this._currentTargetPort = null;
      this._statusBarItem.hide();
      vscode.window.showInformationMessage('Astrolabe Inspector stopped.');
    } else if (action === 'Change Target Port') {
      this._inspectorProxy.stop();
      DevServerManager.killServer();
      this._currentTargetPort = null;
      this._statusBarItem.hide();
      
      this._handleToggleInspector();
    }
  }

  private async _handleToggleInspector() {
    if (!this._inspectorProxy) {
      this._inspectorProxy = new InspectorProxy((elementData) => {
        if (elementData.type === 'liveEdit') {
          const prompt = `I just visually edited the text on the page from "${elementData.oldText}" to "${elementData.newText}" at DOM path: ${elementData.domPath}. Please find this text in the codebase and apply the change.`;
          this.postMessage({ type: 'appendInputAndSubmit', text: prompt });
          vscode.window.showInformationMessage('Live Edit sent to Agent!');
        } else if (elementData.type === 'openCssEditor') {
          this.postMessage({ type: 'openCssEditor', elementData });
        } else if (elementData.type === 'openInEditor') {
          const filePath = elementData.file;
          const line = Math.max(0, parseInt(elementData.line || '1') - 1);
          const col = Math.max(0, parseInt(elementData.column || '1') - 1);
          vscode.workspace.openTextDocument(filePath).then(doc => {
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(line, col, line, col)
            });
          });
        } else {
          // sendToAgent or legacy
          const compStr = elementData.component ? `, component="${elementData.component}"` : '';
          const htmlSnippet = `<${elementData.tagName}${elementData.id ? ` id="${elementData.id}"` : ''}${elementData.className ? ` class="${elementData.className}"` : ''}>${elementData.text ? elementData.text.substring(0, 30).trim() + (elementData.text.length > 30 ? '...' : '') : ''}</${elementData.tagName}>`;
          const formattedContext = `@selected_ui_element(path="${elementData.domPath}", html='${htmlSnippet}'${compStr})`;
          this.postMessage({ type: 'inspectorElementSelected', context: formattedContext });
          vscode.window.showInformationMessage('UI Element selected!');
        }
      });
    }

    let targetPortStr: string | undefined;

    // If we already know the target port from a previous click, just reuse it!
    if (this._currentTargetPort) {
        targetPortStr = this._currentTargetPort.toString();
    } else {
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 0) {
            const wsPath = wsFolders[0].uri.fsPath;
            await WorkspacePreparer.prepareWorkspace(wsPath);
            const port = await DevServerManager.startServer(wsPath);
            if (port) {
                targetPortStr = port.toString();
            }
        }
        
        if (!targetPortStr) {
           targetPortStr = await vscode.window.showInputBox({
             prompt: 'Failed to start dev server. Enter your port manually:',
             placeHolder: '3000'
           });
        }
    }

    if (targetPortStr && !isNaN(parseInt(targetPortStr))) {
      const targetPort = parseInt(targetPortStr);
      this._currentTargetPort = targetPort; // Remember it!
      
      // Update Status Bar
      this._statusBarItem.text = `$(search) Astrolabe: ${targetPort}`;
      this._statusBarItem.show();

      try {
        const proxyPort = await this._inspectorProxy!.start(targetPort);
        vscode.commands.executeCommand('simpleBrowser.show', `http://127.0.0.1:${proxyPort}`);
      } catch (e: any) {
        this._currentTargetPort = null; // reset if it failed
        this._statusBarItem.hide();
        vscode.window.showErrorMessage(`Failed to start inspector proxy: ${e.message}`);
      }
    }
  }

  public async broadcastStateToSettings() {
    let isLoggedIn = false;
    let tokenQuota: string | number = '...';
    let profilePic: string | undefined = undefined;
    let membershipType: string | undefined = undefined;
    let displayName: string | undefined = undefined;
    
    let email: string | undefined = undefined;
    let modelRates: any[] | undefined = undefined;
    let usedPercentage: number | undefined = undefined;
    let dailyLimit: number | undefined = undefined;
    let tokensUsed: number | undefined = undefined;
    let resetsIn: string | undefined = undefined;
    
    if (this._authService) {
       const token = this._authService.getToken();
       isLoggedIn = !!token;
       if (isLoggedIn) {
          const { ApiService } = await import('./agent/ApiService.js');
          const profile = await ApiService.getUserProfile(token);
          tokenQuota = profile.remaining;
          profilePic = profile.profilePic || '';
          membershipType = profile.membershipType || 'Free';
          displayName = profile.displayName || profile.email || 'Astrolabe User';
          email = profile.email;
          modelRates = profile.modelRates;
          usedPercentage = profile.usedPercentage;
          dailyLimit = profile.dailyLimit;
          tokensUsed = profile.tokensUsed;
          resetsIn = profile.resetsIn;
       }
    }
    
    // We send this to the SettingsProvider's panel
    const { SettingsProvider } = await import('./SettingsProvider.js');
    if (SettingsProvider.currentPanel) {
      SettingsProvider.currentPanel.postMessage({
        type: 'workspaceInfo',
        isLoggedIn,
        tokenQuota,
        profilePic,
        membershipType,
        displayName,
        email,
        modelRates,
        usedPercentage,
        dailyLimit,
        tokensUsed,
        resetsIn
      });
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    // Establish webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    vscode.commands.executeCommand('setContext', 'exovonhubSidebarVisible', true);

    // Memory safety: clean up when webview is disposed (sidebar hidden/closed)
    webviewView.onDidDispose(() => {
      vscode.commands.executeCommand('setContext', 'exovonhubSidebarVisible', false);
      // Reject all pending approvals to prevent leaked Promises
      for (const [id, resolve] of this._pendingApprovals) {
        resolve(false);
      }
      this._pendingApprovals.clear();
      this._activeOrchestrator?.dispose();
      this._activeOrchestrator = undefined;
      this._view = undefined;
      
      this._watchdog?.dispose();
      this._editorDisposable?.dispose();
    });

    // Set up message hooks
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case 'getWorkspaceInfo': {
          const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'isolated-exovon';
          let filesCount = 0;
          try {
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
            filesCount = files.length;
          } catch (e) { console.error('[Exovon Error]', e); }

          const config = vscode.workspace.getConfiguration('exovonhub');
          const isAutonomous = config.get<boolean>('autonomousMode') || false;
          
          let isLoggedIn = false;
          let tokenQuota: string | number = '...';
          let modelRates: any[] | undefined = undefined;
          let profilePic: string | undefined = undefined;
          let membershipType: string | undefined = undefined;
          let displayName: string | undefined = undefined;
          let email: string | undefined = undefined;
          let usedPercentage: number | undefined = undefined;
          let dailyLimit: number | undefined = undefined;
          let tokensUsed: number | undefined = undefined;
          let resetsIn: string | undefined = undefined;
          
          if (this._authService) {
             const token = this._authService.getToken();
             isLoggedIn = !!token;
             if (isLoggedIn) {
                const { ApiService } = await import('./agent/ApiService.js');
                const profile = await ApiService.getUserProfile(token);
                tokenQuota = profile.remaining;
                modelRates = profile.modelRates;
                profilePic = profile.profilePic;
                membershipType = profile.membershipType;
                displayName = profile.displayName;
                email = profile.email;
                usedPercentage = profile.usedPercentage;
                dailyLimit = profile.dailyLimit;
                tokensUsed = profile.tokensUsed;
                resetsIn = profile.resetsIn;
             }
          }

          webviewView.webview.postMessage({
            type: 'workspaceInfo',
            name: workspaceName,
            filesCount: filesCount,
            isAutonomous: isAutonomous,
            isLoggedIn: isLoggedIn,
            tokenQuota: tokenQuota,
            modelRates: modelRates,
            profilePic: profilePic,
            membershipType: membershipType,
            displayName: displayName,
            email: email,
            usedPercentage: usedPercentage,
            dailyLimit: dailyLimit,
            tokensUsed: tokensUsed,
            resetsIn: resetsIn
          });

          // Send settings state
          webviewView.webview.postMessage({
             type: 'settingsState',
             model: config.get<string>('preferredModel') || 'Qwen/Qwen3-235B-A22B-Instruct-2507'
          });

          // Send initial Cortex Graph if an editor is already open
          if (vscode.window.activeTextEditor && this._brainCoordinator) {
            const elements = this._brainCoordinator.getGraphForFile(vscode.window.activeTextEditor.document.uri.fsPath);
            webviewView.webview.postMessage({ type: 'cortexGraphUpdate', elements });
          }
          break;
        }

        case 'getGovernorStatus': {
          let status = {
            cpuThreads: 0,
            allocatedMb: 0,
            totalMemMb: 0,
            nodeCount: 0,
            engine: 'N/A',
            pruningGuardrails: 'N/A'
          };
          
          if (this._brainCoordinator) {
            status = this._brainCoordinator.getGovernorStatus();
          }

          webviewView.webview.postMessage({
            type: 'governorStatus',
            status
          });
          break;
        }
        
        case 'openSettings': {
          vscode.commands.executeCommand('exovon.openSettings');
          break;
        }

        case 'openMotionStudio': {
          vscode.commands.executeCommand('exovon.openMotionStudio');
          break;
        }

        case 'compileMotion': {
          vscode.commands.executeCommand('exovon.compileMotion');
          break;
        }

        case 'executeVscodeCommand': {
          if (data.vscodeCommand) {
            vscode.commands.executeCommand(data.vscodeCommand);
          }
          break;
        }

        case 'clearKvCache': {
          if (this._activeOrchestrator) {
            this._activeOrchestrator.cancel();
            this._activeOrchestrator.dispose();
            this._activeOrchestrator = undefined;
          }
          webviewView.webview.postMessage({ 
            type: 'contextCleared',
            text: 'KV Cache and agent conversational context have been reset.'
          });
          vscode.window.showInformationMessage('Exovon Engine: KV Cache & Agent Context Cleared.');
          break;
        }

        case 'setContextKeepLastNTurns': {
          const turns = Math.max(1, Math.min(20, Number(data.turns) || 3));
          const config = vscode.workspace.getConfiguration('exovonhub');
          await config.update('contextKeepLastNTurns', turns, vscode.ConfigurationTarget.Global);
          break;
        }

        case 'pruneKvCache': {
          const config = vscode.workspace.getConfiguration('exovonhub');
          const turns = config.get<number>('contextKeepLastNTurns') || 3;
          // Approximate pruned tokens (~800 tokens per kept turn)
          const estimatedTokens = Math.max(400, turns * 850);
          webviewView.webview.postMessage({ 
            type: 'contextPruned',
            keptTurns: turns,
            estimatedTokens
          });
          vscode.window.showInformationMessage(`Exovon Engine: KV Cache Pruned to last ${turns} turns.`);
          break;
        }

        case 'getSettingsState': {
          const config = vscode.workspace.getConfiguration('exovonhub');
          let activeCtxSize = 8192;
          try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch('http://127.0.0.1:47990/v1/health');
            if (res.ok) {
              const data = await res.json() as any;
              if (data.ctx_size) {
                activeCtxSize = data.ctx_size;
              }
            }
          } catch {}

          webviewView.webview.postMessage({ 
            type: 'settingsState', 
            model: config.get<string>('preferredModel') || 'Qwen/Qwen3-235B-A22B-Instruct-2507',
            localLlmModelName: config.get<string>('localLlmModelName') || 'llama3.1:latest',
            localModelsDirectory: config.get<string>('localModelsDirectory') || '~/.exovon/models',
            contextKeepLastNTurns: config.get<number>('contextKeepLastNTurns') || 3,
            ctx_size: activeCtxSize
          });
          break;
        }

        case 'updatePreferredModel': {
          const config = vscode.workspace.getConfiguration('exovonhub');
          await config.update('preferredModel', data.value, vscode.ConfigurationTarget.Global);
          webviewView.webview.postMessage({ 
            type: 'settingsState', 
            model: data.value,
            localLlmModelName: config.get<string>('localLlmModelName') || 'llama3.1:latest',
            localModelsDirectory: config.get<string>('localModelsDirectory') || '~/.exovon/models'
          });
          break;
        }

        case 'toggleInspector': {
          if (this._isInspectorActive) {
            this._isInspectorActive = false;
            if (this._inspectorProxy) this._inspectorProxy.stop();
            this._currentTargetPort = null;
            this._statusBarItem.hide();
            this.postMessage({ type: 'inspectorStateChanged', isActive: false });
            vscode.window.showInformationMessage('Inspector deactivated.');
            break;
          }
          this._isInspectorActive = true;
          this.postMessage({ type: 'inspectorStateChanged', isActive: true });

          if (!this._inspectorProxy) {
            this._inspectorProxy = new InspectorProxy((elementData) => {
              if (elementData.type === 'liveEdit') {
                const prompt = `I just visually edited the text on the page from "${elementData.oldText}" to "${elementData.newText}" at DOM path: ${elementData.domPath}. Please find this text in the codebase and apply the change.`;
                this.postMessage({ type: 'appendInputAndSubmit', text: prompt });
                vscode.window.showInformationMessage('Live Edit sent to Agent!');
              } else {
                // sendToAgent or legacy
                const compStr = elementData.component ? `, component="${elementData.component}"` : '';
                const htmlSnippet = `<${elementData.tagName}${elementData.id ? ` id="${elementData.id}"` : ''}${elementData.className ? ` class="${elementData.className}"` : ''}>${elementData.text ? elementData.text.substring(0, 30).trim() + (elementData.text.length > 30 ? '...' : '') : ''}</${elementData.tagName}>`;
                const formattedContext = `@selected_ui_element(path="${elementData.domPath}", html='${htmlSnippet}'${compStr})`;
                this.postMessage({ type: 'inspectorElementSelected', context: formattedContext });
                vscode.window.showInformationMessage('UI Element selected!');
              }
            });
          }
          await this._handleToggleInspector();
          break;
        }

        case 'initiateAgent': {
          const { mode, prompt, contextFiles, threadId, messageId } = data;

          let previousMessages: any[] = [];
          if (threadId && this._brainCoordinator) {
             previousMessages = this._brainCoordinator.getChatMessages(threadId);
          }

          // 1. Gather Rich Active Editor Context (surrounding 200 lines to preserve token boundaries)
          const activeEditor = vscode.window.activeTextEditor;
          let activeFileContext = '';
          
          if (activeEditor) {
            const document = activeEditor.document;
            const selection = activeEditor.selection;
            const cursorLine = selection.active.line;
            const cursorChar = selection.active.character;
            
            const startLine = Math.max(0, cursorLine - 100);
            const endLine = Math.min(document.lineCount - 1, cursorLine + 100);
            
            let surroundingLines: string[] = [];
            for (let i = startLine; i <= endLine; i++) {
              surroundingLines.push(`${i + 1}: ${document.lineAt(i).text}`);
            }
            
            activeFileContext = `
[Active File Details]
Path: ${document.fileName}
Cursor Position: Line ${cursorLine + 1}, Col ${cursorChar + 1}
Surrounding Lines range (${startLine + 1} to ${endLine + 1}):
\`\`\`
${surroundingLines.join('\n')}
\`\`\`
`;
          }

          // 2. Scan Workspace Linter Diagnostics (active Errors / Warnings warnings matrix)
          let diagnosticContext = '';
          const diagnostics = vscode.languages.getDiagnostics();
          let errorsCount = 0;
          let warningLines: string[] = [];
          
          for (const [uri, fileDiagnostics] of diagnostics) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            for (const diag of fileDiagnostics) {
              if (diag.severity === vscode.DiagnosticSeverity.Error || diag.severity === vscode.DiagnosticSeverity.Warning) {
                errorsCount++;
                if (warningLines.length < 15) {
                  const severityText = diag.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
                  warningLines.push(`[${severityText}] ${relativePath}:${diag.range.start.line + 1} - ${diag.message}`);
                }
              }
            }
          }
          
          if (errorsCount > 0) {
            diagnosticContext = `
[Workspace Linter Warnings & Errors Matrix]
Total Errors/Warnings detected: ${errorsCount}
Recent Diagnostics:
${warningLines.join('\n')}
`;
          }

          // 3. Read user-selected context files
          let contextFilesContent = '';
          if (contextFiles && Array.isArray(contextFiles) && contextFiles.length > 0) {
            const contextParts: string[] = [];
            for (const fileName of contextFiles.slice(0, 5)) { // Cap at 5 files to prevent token bloat
              try {
                const fileUris = await vscode.workspace.findFiles(`**/${fileName}`, '**/node_modules/**', 1);
                if (fileUris.length > 0) {
                  const content = await vscode.workspace.fs.readFile(fileUris[0]);
                  const decoded = new TextDecoder('utf-8').decode(content);
                  const truncated = decoded.length > 5000 ? decoded.slice(0, 5000) + '\n[TRUNCATED...]' : decoded;
                  contextParts.push(`[Context File: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``);
                }
              } catch (e) { console.error('[Exovon Error]', e); }
            }
            if (contextParts.length > 0) {
              contextFilesContent = `\n[USER-SELECTED CONTEXT FILES]\n${contextParts.join('\n\n')}\n[/USER-SELECTED CONTEXT FILES]\n`;
            }
          }

          // 4. Diagnostic Injection (Problem reporting)
          let finalPrompt = prompt;
          if (finalPrompt.includes('@problems')) {
             const diagnostics = vscode.languages.getDiagnostics();
             const problemLines: string[] = [];
             for (const [uri, diags] of diagnostics) {
                 const relPath = vscode.workspace.asRelativePath(uri, false);
                 for (const d of diags) {
                     const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
                     problemLines.push(`[${severity}] ${relPath}:${d.range.start.line + 1} - ${d.message}`);
                 }
             }
             
             let problemsContext = "No problems found in workspace.";
             if (problemLines.length > 0) {
                 problemsContext = `The following problems exist in the workspace:\n${problemLines.join('\n')}`;
             }
             finalPrompt = finalPrompt.replace('@problems', problemsContext);
          }

          const richPrompt = `
[IDE WORKSPACE ACTIVE CONTEXT]
${activeFileContext}
${diagnosticContext}
${contextFilesContent}
[/IDE WORKSPACE ACTIVE CONTEXT]

Developer Action Request: "${finalPrompt}"
`;

          // Clean up old orchestrator to prevent MCP router memory leaks (B6)
          if (this._activeOrchestrator) {
            this._activeOrchestrator.dispose();
          }

          // Initialize orchestrator with Webview messaging bridge
          const orchestrator = new AgentOrchestrator(
            async (command: string) => {
              // Setup pending approval promise
              return new Promise<boolean>((resolve) => {
                const approvalId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                
                // Add 120s timeout (BUG-3)
                const timeout = setTimeout(() => {
                  this._pendingApprovals.delete(approvalId);
                  webviewView.webview.postMessage({ type: 'agentLog', text: `⏳ Approval timed out after 120 seconds.`, logType: 'warning' });
                  resolve(false);
                }, 120000);

                this._pendingApprovals.set(approvalId, (approved: boolean) => {
                  clearTimeout(timeout);
                  resolve(approved);
                });

                // Ask Webview for approval
                webviewView.webview.postMessage({
                  type: 'commandApprovalRequested',
                  id: approvalId,
                  command: command
                });
              });
            },
            async (fileChange: { type: 'modify' | 'create' | 'delete'; path: string; details: string }) => {
              return new Promise<boolean>((resolve) => {
                const approvalId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                
                // Add 120s timeout (BUG-3)
                const timeout = setTimeout(() => {
                  this._pendingApprovals.delete(approvalId);
                  webviewView.webview.postMessage({ type: 'agentLog', text: `⏳ File approval timed out after 120 seconds.`, logType: 'warning' });
                  resolve(false);
                }, 120000);

                this._pendingApprovals.set(approvalId, (approved: boolean) => {
                   clearTimeout(timeout);
                   resolve(approved);
                });

                // Ask Webview for approval
                webviewView.webview.postMessage({
                  type: 'fileApprovalRequested',
                  id: approvalId,
                  changeType: fileChange.type,
                  filePath: fileChange.path,
                  details: fileChange.details
                });
              });
            },
            (update) => {
              if (update.type === 'complete') {
                webviewView.webview.postMessage({ type: 'agentComplete', messageId });
                // We keep _activeOrchestrator alive here so the user can still interact with speculative diffs
                this._pendingApprovals.clear();
              } else if (update.type === 'reasoning') {
                webviewView.webview.postMessage({ type: 'agentReasoning', text: update.text, messageId });
              } else if (update.type === 'promptProgress') {
                webviewView.webview.postMessage({ 
                  type: 'agentPromptProgress', 
                  promptTokens: update.promptTokens, 
                  promptProcessed: update.promptProcessed, 
                  messageId 
                });
              } else if (update.type === 'metrics') {
                webviewView.webview.postMessage({ type: 'agentMetrics', metrics: update.metrics, messageId });
              } else if (update.type === 'finalAnswer') {
                webviewView.webview.postMessage({ type: 'agentFinalAnswer', text: update.text, messageId });
              } else if (update.type === 'log') {
                webviewView.webview.postMessage({ type: 'agentLog', text: update.text, logType: update.logType, messageId });
              } else if (update.type === 'toolStart') {
                webviewView.webview.postMessage({ type: 'agentToolStart', toolId: update.toolId, toolName: update.toolName, toolArgs: update.toolArgs, messageId });
              } else if (update.type === 'agentToolComplete') {
                webviewView.webview.postMessage({ type: 'agentToolComplete', toolId: update.toolId, toolStatus: update.toolStatus, messageId });
              } else if (update.type === 'plan') {
                webviewView.webview.postMessage({ type: 'agentPlanUpdate', planSteps: update.planSteps, messageId });
              } else if (update.type === 'planReview') {
                // Send plan to webview for user review
                webviewView.webview.postMessage({ type: 'agentPlanReview', messageId });
                const planMarkdown = (update as any).planMarkdown || '';

                // Open the rich rendered implementation plan in a dedicated editor tab!
                PlanViewerProvider.createOrShow(this._context, planMarkdown, this._activeOrchestrator);

                // Update the Read-Only Document Provider & Comment Controller if active
                if (this._planReviewProvider) {
                    this._planReviewProvider.updatePlan(planMarkdown);
                }
                if (this._planCommentController) {
                    this._planCommentController.setActiveOrchestrator(this._activeOrchestrator);
                }

                // Also save the plan to a persistent container
                try {
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (workspaceRoot) {
                        const plansDir = path.join(workspaceRoot, '.exovon', 'plans');
                        if (!fs.existsSync(plansDir)) {
                            fs.mkdirSync(plansDir, { recursive: true });
                        }
                        // Create a readable timestamp
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const planPath = path.join(plansDir, `Implementation_Plan_${timestamp}.md`);
                        fs.writeFileSync(planPath, planMarkdown, 'utf8');
                        const activePlanPath = path.join(plansDir, 'Implementation_Plan.md');
                        fs.writeFileSync(activePlanPath, planMarkdown, 'utf8');
                    }
                } catch (e) {
                    console.error('Failed to save implementation plan', e);
                }
              } else if (update.type === ('planResolved' as any)) {
                webviewView.webview.postMessage({ type: 'agentPlanResolved', approved: (update as any).approved });
              } else if (update.type === ('diffs' as any)) {
                const diffsPayload = JSON.parse(update.text || '[]');
                webviewView.webview.postMessage({ type: 'agentSpeculativeDiffs', diffs: diffsPayload, messageId });
              } else if (update.type === 'usage') {
                webviewView.webview.postMessage({ type: 'agentUsage', totalTokens: update.totalTokens, messageId });
              } else if (update.type === ('chat' as any)) {
                webviewView.webview.postMessage({ type: 'agentChat', text: update.text, messageId });
              } else if (update.type === ('preemptingQueue' as any)) {
                webviewView.webview.postMessage({ type: 'agentPreemptingQueue', messageId });
              } else if (update.type === ('agentFocusNodes' as any)) {
                webviewView.webview.postMessage({ type: 'agentFocusNodes', nodeIds: (update as any).nodeIds, messageId });
              }
            },
            this._brainCoordinator,
            this._context,
            () => this._authService ? (this._authService.getToken() || null) : null
          );

          this._activeOrchestrator = orchestrator;

          const config = vscode.workspace.getConfiguration('exovonhub');
          const selectedModel = config.get<string>('preferredModel') || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
          
          // Run orchestrator with injected diagnostics & file lines matrix context
          orchestrator.execute(richPrompt, selectedModel, previousMessages, messageId, data.images);
          break;
        }

        case 'respondToCommandApproval':
        case 'respondToFileApproval': {
          const { id, approved, filePath } = data;
          const resolveApproval = this._pendingApprovals.get(id);
          if (resolveApproval) {
            resolveApproval(approved);
            this._pendingApprovals.delete(id);
            
            if (!approved) {
              vscode.window.showInputBox({
                prompt: `Why are you rejecting the file changes to ${path.basename(filePath || 'this file')}? (Optional, press Enter to skip)`,
                placeHolder: 'e.g. You missed an import, the variable is named wrong...'
              }).then((reason) => {
                const feedback = reason?.trim() || 'None provided';
                const eventMsg = `[Environment Event: User rejected your last speculative file modification. Reason: ${feedback}. The shadow file has been reverted. Please ask the user for clarification if needed, and try again.]`;
                webviewView.webview.postMessage({ type: 'injectRejectionFeedback', text: eventMsg });
              });
            }
          }
          break;
        }

        case 'acceptSpeculativeDiff': {
          await this.commitShadowFile(data.filePath);
          break;
        }

        case 'rejectSpeculativeDiff': {
          await this.revertShadowFile(data.filePath);
          break;
        }

        case 'openSpeculativeDiff': {
          const { filePath } = data;
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
             const realUri = vscode.Uri.file(path.join(workspaceRoot, filePath));
             const shadowUri = vscode.Uri.file(path.join(workspaceRoot, '.exovon-shadow', filePath));
             vscode.commands.executeCommand('vscode.diff', realUri, shadowUri, `Shadow Sandbox Diff: ${filePath}`);
          }
          break;
        }

        case 'cancelAgent': {
          if (this._activeOrchestrator) {
            this._activeOrchestrator.cancel();
            // A5: Keep orchestrator alive so user can still accept/reject diffs after cancel
            this._pendingApprovals.clear();
          }
          break;
        }

        case 'respondToPlanApproval': {
          // C3: Forward plan approval/rejection to the orchestrator
          if (this._activeOrchestrator) {
            this._activeOrchestrator.resolvePlanApproval(data.approved);
            if (this._planCommentController) {
                this._planCommentController.setActiveOrchestrator(undefined);
            }
            // Close the plan tab if it's open
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.uri.scheme === PlanReviewProvider.scheme) {
                vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
          }
          break;
        }

        case 'reviewPlanAgain': {
          const planMarkdown = this._planReviewProvider?.getPlan() || '';
          PlanViewerProvider.createOrShow(this._context, planMarkdown, this._activeOrchestrator);
          break;
        }

        case 'revertSandbox': {
          if (this._activeOrchestrator) {
            const res = await this._activeOrchestrator.getFsTools().clearShadowWorkspace();
            webviewView.webview.postMessage({ type: 'agentLog', text: `🔄 ${res}`, logType: 'info' });
          } else {
            // Even if no active orchestrator, we can instantiate a fresh tool just to clean
            const fsTools = new FileSystemTools();
            const res = await fsTools.clearShadowWorkspace();
            webviewView.webview.postMessage({ type: 'agentLog', text: `🔄 ${res}`, logType: 'info' });
          }
          break;
        }

        case 'updateAutonomousMode': {
          const { value } = data;
          const config = vscode.workspace.getConfiguration('exovonhub');
          await config.update('autonomousMode', value, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`⚡ Exovon Autopilot Mode set to: ${value ? 'Fully Autonomous' : 'Review/Approval Required'}`);
          break;
        }

        case 'openUrl': {
          if (data.url) {
            vscode.env.openExternal(vscode.Uri.parse(data.url));
          }
          break;
        }

        case 'login': {
          if (this._authService) {
            this._authService.login();
          }
          break;
        }

        case 'startDaemon': {
          const daemon = DaemonManager.getInstance();
          const success = await daemon.startDaemon(this._context);
          webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: success });
          break;
        }

        case 'stopDaemon': {
          const daemon = DaemonManager.getInstance();
          daemon.stopDaemon();
          webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: false });
          break;
        }

        case 'getDaemonStatus': {
          try {
            const daemon = DaemonManager.getInstance();
            const alive = await daemon.isAlive();
            webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: alive });
          } catch {
            webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: false });
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
              webviewView.webview.postMessage({ type: 'daemonHealth', health: body });
              webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: true });
            } else {
              webviewView.webview.postMessage({ type: 'daemonHealth', health: null });
            }
          } catch (e) {
            webviewView.webview.postMessage({ type: 'daemonHealth', health: null });
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
              webviewView.webview.postMessage({ type: 'localModels', models: body.data || [] });
              webviewView.webview.postMessage({ type: 'daemonStatus', isRunning: true });
            } else {
              webviewView.webview.postMessage({ type: 'localModels', models: [] });
            }
          } catch (e) {
            webviewView.webview.postMessage({ type: 'localModels', models: [] });
          }
          break;
        }

        case 'setLocalLlmModelName': {
          if (data.model) {
            await vscode.workspace.getConfiguration('exovonhub').update('localLlmModelName', data.model, vscode.ConfigurationTarget.Global);
            const updatedModel = vscode.workspace.getConfiguration('exovonhub').get<string>('localLlmModelName');
            const preferredModel = vscode.workspace.getConfiguration('exovonhub').get<string>('preferredModel');
            webviewView.webview.postMessage({ type: 'settingsState', model: preferredModel, localLlmModelName: updatedModel });
            vscode.window.showInformationMessage(`Active Local Model set to ${data.model}`);
          }
          break;
        }

        case 'browseLocalModelsDirectory': {
          const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Models Directory'
          });
          if (uri && uri[0]) {
            const fsPath = uri[0].fsPath;
            await vscode.workspace.getConfiguration('exovonhub').update('localModelsDirectory', fsPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Models directory updated. Please restart the Local Engine for changes to take effect.`);
            webviewView.webview.postMessage({ type: 'settingsState', localModelsDirectory: fsPath });
          }
          break;
        }

        case 'setLocalModelsDirectory': {
          if (data.directory !== undefined) {
            await vscode.workspace.getConfiguration('exovonhub').update('localModelsDirectory', data.directory, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Models directory updated. Please restart the Local Engine for changes to take effect.`);
          }
          break;
        }

        case 'searchHuggingFace': {
          if (data.query) {
            try {
              const fetch = (await import('node-fetch')).default;
              const controller = new AbortController();
              const timeout = setTimeout(() => { controller.abort(); }, 8000);
              const res = await fetch(`http://127.0.0.1:47990/v1/models/search?q=${encodeURIComponent(data.query)}`, { signal: controller.signal as any });
              clearTimeout(timeout);

              if (res.ok) {
                const body = await res.json() as any;
                webviewView.webview.postMessage({ type: 'hfSearchResults', results: body.results || [] });
              } else {
                vscode.window.showErrorMessage('Failed to search Hugging Face models.');
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`Search error: ${e.message}`);
            }
          }
          break;
        }

        case 'downloadLocalModel': {
          if (data.url && data.filename) {
            try {
              const daemon = DaemonManager.getInstance();
              if (!daemon.isRunning()) {
                vscode.window.showErrorMessage('Please start the Local Engine first to download models.');
                break;
              }
              vscode.window.showInformationMessage(`Starting download for ${data.filename}... Check the terminal for progress if attached.`);
              const fetch = (await import('node-fetch')).default;
              
              fetch('http://127.0.0.1:47990/v1/models/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: data.url, filename: data.filename })
              })
              .then(async (res) => {
                if (res.ok) {
                  const body = await res.json() as any;
                  vscode.window.showInformationMessage(`Successfully downloaded ${data.filename} to ${body.path}`);
                  // Refresh models
                  this.postMessage({ command: 'getLocalModels' });
                } else {
                  vscode.window.showErrorMessage(`Failed to download ${data.filename}`);
                }
              })
              .catch((e: any) => {
                vscode.window.showErrorMessage(`Download error: ${e.message}`);
              });
            } catch (e: any) {
              vscode.window.showErrorMessage(`Download setup error: ${e.message}`);
            }
          }
          break;
        }

        case 'installSGLang': {
          vscode.window.showInformationMessage('Starting SGLang installation... This may take a few minutes.');
          try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch('http://127.0.0.1:47990/v1/system/install_sglang', {
              method: 'POST'
            });
            const body = await res.json() as any;
            if (res.ok) {
              vscode.window.showInformationMessage(`SGLang Installation: ${body.message}`);
            } else {
              vscode.window.showErrorMessage(`SGLang Installation failed: ${body.message}`);
            }
          } catch (e: any) {
             vscode.window.showErrorMessage(`Failed to connect to daemon: ${e.message}`);
          }
          break;
        }

        case 'pasteAuthToken': {
          vscode.commands.executeCommand('exovon.pasteAuthToken');
          break;
        }

        case 'checkAuth': {
          if (this._authService) {
            const token = this._authService.getToken();
            this.postMessage({ type: 'authStateChanged', loggedIn: !!token });
          }
          break;
        }

        case 'fetchQuota': {
          if (this._authService) {
            const token = this._authService.getToken();
            if (token) {
              const config = vscode.workspace.getConfiguration('exovon');
              const gatewayUrl = config.get<string>('apiGatewayUrl') || 'https://exovon.in';
              fetch(`${gatewayUrl}/api/user/quota`, {
                headers: { 'Authorization': `Bearer ${token}` }
              })
                .then(res => res.json())
                .then(data => {
                  this.postMessage({ type: 'quotaInfo', data });
                })
                .catch(err => {
                  console.error('Failed to fetch quota:', err);
                });
            }
          }
          break;
        }

        case 'logout': {
          if (this._authService) {
            this._authService.logout();
          }
          break;
        }

        case 'openFile': {
          if (data.path) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const fullPath = path.resolve(workspaceRoot, data.path);
            vscode.workspace.openTextDocument(fullPath).then(doc => {
               vscode.window.showTextDocument(doc, { preview: false });
            }, (e: any) => {
               vscode.window.showErrorMessage(`Failed to open file: ${data.path}`);
            });
          }
          break;
        }

        case 'showNotification': {
          if (data.type === 'error') {
            vscode.window.showErrorMessage(data.message);
          } else if (data.type === 'warning') {
            vscode.window.showWarningMessage(data.message);
          } else {
            vscode.window.showInformationMessage(data.message);
          }
          break;
        }

        case 'getChatThreads': {
          if (this._brainCoordinator) {
             const threads = this._brainCoordinator.getChatThreads();
             webviewView.webview.postMessage({ type: 'chatThreadsLoaded', threads });
          }
          break;
        }

        case 'createNewThread': {
          if (this._brainCoordinator) {
             const threadId = this._brainCoordinator.createNewThread();
             webviewView.webview.postMessage({ type: 'newThreadCreated', threadId });
          }
          break;
        }

        case 'requestDeleteChatThread': {
          if (this._brainCoordinator && data.threadId) {
             vscode.window.showWarningMessage('Are you sure you want to delete this chat?', { modal: true }, 'Yes', 'No').then(selection => {
                if (selection === 'Yes') {
                    this._brainCoordinator!.deleteChatThread(data.threadId);
                    webviewView.webview.postMessage({ type: 'threadDeleted', threadId: data.threadId });
                    const threads = this._brainCoordinator!.getChatThreads();
                    webviewView.webview.postMessage({ type: 'chatThreadsLoaded', threads });
                }
             });
          }
          break;
        }

        case 'loadChatThread': {
          if (this._brainCoordinator && data.threadId) {
            const messages = this._brainCoordinator.loadChatThread(data.threadId);
            webviewView.webview.postMessage({
              type: 'chatHistoryLoaded',
              messages,
              threadId: data.threadId
            });
          }
          break;
        }

        case 'installAgent': {
          vscode.window.showInformationMessage(`Agent ${data.agentId} installed successfully!`);
          break;
        }

        case 'saveChatMessage': {
          if (this._brainCoordinator && data.threadId && data.message) {
            this._brainCoordinator.saveChatMessage(data.threadId, data.message);
          }
          break;
        }

        case 'deleteChatMessage': {
          if (this._brainCoordinator && data.threadId && data.messageId) {
            this._brainCoordinator.deleteChatMessage(data.threadId, data.messageId);
          }
          break;
        }
      }
    });

    // Send active editor updates to webview
    this._editorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && webviewView) {
        webviewView.webview.postMessage({
          type: 'activeEditorChanged',
          fileName: path.basename(editor.document.fileName)
        });
      }
    });

    if (vscode.window.activeTextEditor && webviewView) {
      webviewView.webview.postMessage({
        type: 'activeEditorChanged',
        fileName: path.basename(vscode.window.activeTextEditor.document.fileName)
      });
    }
  }

  public async commitShadowFile(filePath: string) {
    if (this._activeOrchestrator) {
      const res = await this._activeOrchestrator.getFsTools().commitShadowFile(filePath);
      this._view?.webview.postMessage({ type: 'agentLog', text: `✔️ Committed sandboxed changes: ${res}`, logType: 'success' });
      // Notify webview to remove it from the list
      this._view?.webview.postMessage({ type: 'speculativeDiffResolved', filePath });
    }
  }

  public async revertShadowFile(filePath: string) {
    if (this._activeOrchestrator) {
      const res = await this._activeOrchestrator.getFsTools().revertShadowFile(filePath);
      this._view?.webview.postMessage({ type: 'agentLog', text: `❌ Reverted sandbox changes: ${res}`, logType: 'warning' });
      // Notify webview to remove it from the list
      this._view?.webview.postMessage({ type: 'speculativeDiffResolved', filePath });
    }
  }

  private _editorDisposable?: vscode.Disposable;

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui', 'dist', 'index.html');
    let htmlContent = '';
    
    try {
      htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
    } catch (e) {
      return `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: sans-serif; padding: 24px; color: var(--vscode-editor-foreground, #cccccc); background: var(--vscode-editor-background, #121212); text-align: center; }
            .card { border: 1px dashed #333333; padding: 24px; border-radius: 12px; max-width: 320px; margin: 40px auto; }
            .btn { background: #5856d6; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; }
            code { background: #222222; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="card">
            <h3 style="color:#8b5cf6;">Exovon Hub UI Not Built</h3>
            <p style="font-size:12px; line-height:1.5; color:#888888;">The React compiled assets were not found under <code>webview-ui/dist</code>.</p>
            <p style="font-size:12px; margin-bottom: 20px; color:#888888;">Please execute compile scripts in the root project directory:</p>
            <p><code>npm run compile</code></p>
          </div>
        </body>
      </html>`;
    }

    const baseUri = vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui', 'dist');

    // Rewrite all attributes starting with absolute or relative paths like src="/assets/index.js" or href="./assets/index.css"
    // to their corresponding webview-safe URIs and append a cache-buster
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

    // Inject compatible CSP meta tag
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">`;
    webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);

    return webviewHtml;
  }
}
