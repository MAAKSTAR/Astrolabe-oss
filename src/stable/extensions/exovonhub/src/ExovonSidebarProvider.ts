import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentOrchestrator } from './agent/AgentOrchestrator';


interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'success' | 'failed';
}

export class ExovonSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'exovonhub.sidebar';
  private _view?: vscode.WebviewView;
  private _activeOrchestrator?: AgentOrchestrator;

  private _pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(private readonly _context: vscode.ExtensionContext) {}

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

    // Memory safety: clean up when webview is disposed (sidebar hidden/closed)
    webviewView.onDidDispose(() => {
      // Reject all pending approvals to prevent leaked Promises
      for (const [id, resolve] of this._pendingApprovals) {
        resolve(false);
      }
      this._pendingApprovals.clear();
      this._activeOrchestrator = undefined;
      this._view = undefined;
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
          } catch (e) {}

          const config = vscode.workspace.getConfiguration('exovonhub');
          const isAutonomous = config.get<boolean>('autonomousMode') || false;

          webviewView.webview.postMessage({
            type: 'workspaceInfo',
            name: workspaceName,
            filesCount: filesCount,
            isAutonomous: isAutonomous
          });
          break;
        }

        case 'initiateAgent': {
          const { mode, prompt, contextFiles } = data;

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
              } catch (e) {}
            }
            if (contextParts.length > 0) {
              contextFilesContent = `\n[USER-SELECTED CONTEXT FILES]\n${contextParts.join('\n\n')}\n[/USER-SELECTED CONTEXT FILES]\n`;
            }
          }

          // 4. Inject Permanent Compressed Memory (Phase 1 V3 Architecture)
          let projectMemoryContext = '';
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            const memoryPath = path.join(workspaceRoot, '.vscode', 'project_memory.json');
            if (fs.existsSync(memoryPath)) {
              try {
                const memoryContent = fs.readFileSync(memoryPath, 'utf8');
                const memoryObj = JSON.parse(memoryContent);
                if (memoryObj.summary) {
                  projectMemoryContext = `\n[PERMANENT PROJECT MEMORY]\n${memoryObj.summary}\n[/PERMANENT PROJECT MEMORY]\n`;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }

          const richPrompt = `
[IDE WORKSPACE ACTIVE CONTEXT]
${activeFileContext}
${diagnosticContext}
${contextFilesContent}
${projectMemoryContext}
[/IDE WORKSPACE ACTIVE CONTEXT]

Developer Action Request: "${prompt}"
`;

          // Initialize orchestrator with Webview messaging bridge
          const orchestrator = new AgentOrchestrator(
            async (command: string) => {
              // Setup pending approval promise
              return new Promise<boolean>((resolve) => {
                const approvalId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                this._pendingApprovals.set(approvalId, resolve);

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
                this._pendingApprovals.set(approvalId, resolve);

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
                webviewView.webview.postMessage({ type: 'agentComplete' });
                // Memory cleanup: release orchestrator reference after task completes
                this._activeOrchestrator = undefined;
                this._pendingApprovals.clear();
              } else if (update.type === 'log') {
                webviewView.webview.postMessage({ type: 'agentLog', text: update.text, logType: update.logType });
              } else if (update.type === 'toolStart') {
                webviewView.webview.postMessage({ type: 'agentToolStart', toolId: update.toolId, toolName: update.toolName, toolArgs: update.toolArgs });
              } else if (update.type === 'toolComplete') {
                webviewView.webview.postMessage({ type: 'agentToolComplete', toolId: update.toolId, toolStatus: update.toolStatus });
              } else if (update.type === 'plan') {
                webviewView.webview.postMessage({ type: 'agentPlanUpdate', planSteps: update.planSteps });
              } else if (update.type === ('diffs' as any)) {
                webviewView.webview.postMessage({ type: 'agentSpeculativeDiffs', diffs: JSON.parse(update.text || '[]') });
              } else if (update.type === ('chat' as any)) {
                webviewView.webview.postMessage({ type: 'agentChat', text: update.text });
              }
            }
          );

          this._activeOrchestrator = orchestrator;

          const selectedModel = data.model || 'gemma-4-31b-it';
          
          // Run orchestrator with injected diagnostics & file lines matrix context
          orchestrator.execute(richPrompt, selectedModel);
          break;
        }

        case 'respondToCommandApproval':
        case 'respondToFileApproval': {
          const { id, approved } = data;
          const resolveApproval = this._pendingApprovals.get(id);
          if (resolveApproval) {
            resolveApproval(approved);
            this._pendingApprovals.delete(id);
          }
          break;
        }

        case 'acceptSpeculativeDiff': {
          const { filePath } = data;
          if (this._activeOrchestrator) {
            const res = await this._activeOrchestrator.getFsTools().commitShadowFile(filePath);
            webviewView.webview.postMessage({ type: 'agentLog', text: `✔️ Committed sandboxed changes: ${res}`, logType: 'success' });
          }
          break;
        }

        case 'rejectSpeculativeDiff': {
          const { filePath } = data;
          if (this._activeOrchestrator) {
            const res = await this._activeOrchestrator.getFsTools().revertShadowFile(filePath);
            webviewView.webview.postMessage({ type: 'agentLog', text: `❌ Reverted sandbox changes: ${res}`, logType: 'warning' });
          }
          break;
        }

        case 'deployWebApp': {
          // Real deployment will be wired to Cloud Build pipeline.
          // Until then, inform the user this feature is pending.
          webviewView.webview.postMessage({
            type: 'agentLog',
            text: '🚧 Cloud deployment is currently being configured. This feature will be available in the next release.',
            logType: 'warning'
          });
          break;
        }

        case 'cancelAgent': {
          if (this._activeOrchestrator) {
            this._activeOrchestrator.cancel();
            this._activeOrchestrator = undefined;
            this._pendingApprovals.clear();
          }
          break;
        }

        case 'revertSandbox': {
          if (this._activeOrchestrator) {
            const res = await this._activeOrchestrator.getFsTools().clearShadowWorkspace();
            webviewView.webview.postMessage({ type: 'agentLog', text: `🔄 ${res}`, logType: 'info' });
          } else {
            // Even if no active orchestrator, we can instantiate a fresh tool just to clean
            const fsTools = new (require('./agent/tools/FileSystemTools').FileSystemTools)();
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

        case 'loadChatHistory': {
          const history = this._context.workspaceState.get('exovonChatHistory', null);
          if (history) {
            webviewView.webview.postMessage({
              type: 'chatHistoryLoaded',
              messages: history
            });
          }
          break;
        }

        case 'saveChatHistory': {
          if (data.messages && Array.isArray(data.messages)) {
            this._context.workspaceState.update('exovonChatHistory', data.messages);
          }
          break;
        }

        case 'clearChatHistory': {
          this._context.workspaceState.update('exovonChatHistory', undefined);
          vscode.window.showInformationMessage('Exovon Chat History cleared for this workspace.');
          break;
        }
      }
    });
  }

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
    // to their corresponding webview-safe URIs
    let webviewHtml = htmlContent.replace(
      /(href|src)="(?:\.\/|\/)?(assets\/[^"]+|favicon\.svg[^"]*)"/g,
      (match, attr, assetPath) => {
        const assetUri = vscode.Uri.joinPath(baseUri, assetPath);
        const webviewUri = webview.asWebviewUri(assetUri);
        return `${attr}="${webviewUri}"`;
      }
    );

    // Strip crossorigin attributes which can cause load blocks in Webviews due to protocol restrictions
    webviewHtml = webviewHtml.replace(/\scrossorigin(="")?/g, '');

    // Inject compatible CSP meta tag
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">`;
    webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);

    return webviewHtml;
  }
}
