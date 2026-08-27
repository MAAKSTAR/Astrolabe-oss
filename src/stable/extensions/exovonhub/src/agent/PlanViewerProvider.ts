import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentOrchestrator } from './AgentOrchestrator';

export class PlanViewerProvider {
  public static readonly viewType = 'exovonhubPlanViewer';
  public static currentPanel: PlanViewerProvider | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _currentPlanMarkdown: string = '';
  private _activeOrchestrator?: AgentOrchestrator;

  public static createOrShow(context: vscode.ExtensionContext, planMarkdown: string, orchestrator?: AgentOrchestrator) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (PlanViewerProvider.currentPanel) {
      PlanViewerProvider.currentPanel.updatePlan(planMarkdown, orchestrator);
      PlanViewerProvider.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PlanViewerProvider.viewType,
      'Implementation Plan',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')],
        retainContextWhenHidden: true
      }
    );

    PlanViewerProvider.currentPanel = new PlanViewerProvider(panel, context, planMarkdown, orchestrator);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, planMarkdown: string, orchestrator?: AgentOrchestrator) {
    this._panel = panel;
    this._context = context;
    this._currentPlanMarkdown = planMarkdown;
    this._activeOrchestrator = orchestrator;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (data) => {
        switch (data.command) {
          case 'getPlan': {
            this._panel.webview.postMessage({
              type: 'planData',
              markdown: this._currentPlanMarkdown
            });
            break;
          }
          case 'approvePlan': {
            if (this._activeOrchestrator) {
              this._activeOrchestrator.resolvePlanApproval(true);
              vscode.window.showInformationMessage('✅ Implementation Plan Approved. Agent proceeding with execution.');
            }
            break;
          }
          case 'rejectPlan': {
            const feedback = data.feedback || 'User rejected the plan';
            if (this._activeOrchestrator) {
              this._activeOrchestrator.resolvePlanApproval(false, feedback);
              vscode.window.showInformationMessage('Implementation Plan rejected with feedback. Agent is revising...');
            }
            break;
          }
          case 'copyMarkdown': {
            vscode.env.clipboard.writeText(this._currentPlanMarkdown);
            vscode.window.showInformationMessage('📋 Plan copied to clipboard');
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  public updatePlan(planMarkdown: string, orchestrator?: AgentOrchestrator) {
    this._currentPlanMarkdown = planMarkdown;
    if (orchestrator) {
      this._activeOrchestrator = orchestrator;
    }
    this._panel.webview.postMessage({
      type: 'planData',
      markdown: this._currentPlanMarkdown
    });
  }

  public dispose() {
    PlanViewerProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.title = 'Implementation Plan';
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

    webviewHtml = webviewHtml.replace(/\scrossorigin(="")?/g, '');
    webviewHtml = webviewHtml.replace('<head>', `<head>\n<script>window.__EXOVON_PAGE__ = "plan";</script>`);

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource};">`;
    webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);

    return webviewHtml;
  }
}
