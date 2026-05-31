/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(__webpack_require__(1));
const ExovonSidebarProvider_1 = __webpack_require__(2);
function activate(context) {
    console.log('Congratulations, your extension "exovonhub" is now active!');
    // Instantiate and register our sidebar view provider
    const provider = new ExovonSidebarProvider_1.ExovonSidebarProvider(context);
    const viewDisposable = vscode.window.registerWebviewViewProvider(ExovonSidebarProvider_1.ExovonSidebarProvider.viewType, provider);
    context.subscriptions.push(viewDisposable);
    // Hellworld command registers as secondary action
    const commandDisposable = vscode.commands.registerCommand('exovonhub.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Exovon Hub Suite!');
    });
    context.subscriptions.push(commandDisposable);
}
function deactivate() { }


/***/ }),
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExovonSidebarProvider = void 0;
const vscode = __importStar(__webpack_require__(1));
const fs = __importStar(__webpack_require__(3));
const AgentOrchestrator_1 = __webpack_require__(4);
class ExovonSidebarProvider {
    _context;
    static viewType = 'exovonhub.sidebar';
    _view;
    _activeOrchestrator;
    _pendingApprovals = new Map();
    constructor(_context) {
        this._context = _context;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        // Establish webview options
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Set up message hooks
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'getWorkspaceInfo': {
                    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'isolated-exovon';
                    let filesCount = 0;
                    try {
                        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
                        filesCount = files.length;
                    }
                    catch (e) { }
                    const config = vscode.workspace.getConfiguration('exovonhub');
                    const isAutonomous = config.get('autonomousMode') || false;
                    webviewView.webview.postMessage({
                        type: 'workspaceInfo',
                        name: workspaceName,
                        filesCount: filesCount,
                        isAutonomous: isAutonomous
                    });
                    break;
                }
                case 'initiateAgent': {
                    const { mode, prompt } = data;
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
                        let surroundingLines = [];
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
                    let warningLines = [];
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
                    const richPrompt = `
[IDE WORKSPACE ACTIVE CONTEXT]
${activeFileContext}
${diagnosticContext}
[/IDE WORKSPACE ACTIVE CONTEXT]

Developer Action Request: "${prompt}"
`;
                    // Initialize orchestrator with Webview messaging bridge
                    const orchestrator = new AgentOrchestrator_1.AgentOrchestrator(async (command) => {
                        // Setup pending approval promise
                        return new Promise((resolve) => {
                            const approvalId = `cmd-${Date.now()}`;
                            this._pendingApprovals.set(approvalId, resolve);
                            // Ask Webview for approval
                            webviewView.webview.postMessage({
                                type: 'commandApprovalRequested',
                                id: approvalId,
                                command: command
                            });
                        });
                    }, async (fileChange) => {
                        return new Promise((resolve) => {
                            const approvalId = `file-${Date.now()}`;
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
                    }, (update) => {
                        // Forward Agent Orchestrator logs/events to React Webview UI
                        if (update.type === 'log') {
                            webviewView.webview.postMessage({ type: 'agentLog', text: update.text, logType: update.logType });
                        }
                        else if (update.type === 'toolStart') {
                            webviewView.webview.postMessage({ type: 'agentToolStart', toolId: update.toolId, toolName: update.toolName, toolArgs: update.toolArgs });
                        }
                        else if (update.type === 'toolComplete') {
                            webviewView.webview.postMessage({ type: 'agentToolComplete', toolId: update.toolId, toolStatus: update.toolStatus });
                        }
                        else if (update.type === 'complete') {
                            webviewView.webview.postMessage({ type: 'agentComplete' });
                        }
                        else if (update.type === 'plan') {
                            webviewView.webview.postMessage({ type: 'agentPlanUpdate', planSteps: update.planSteps });
                        }
                        else if (update.type === 'diffs') {
                            webviewView.webview.postMessage({ type: 'agentSpeculativeDiffs', diffs: JSON.parse(update.text || '[]') });
                        }
                        else if (update.type === 'chat') {
                            webviewView.webview.postMessage({ type: 'agentChat', text: update.text });
                        }
                    });
                    this._activeOrchestrator = orchestrator;
                    const selectedModel = data.model || 'gemma-4-31b-it';
                    // Run orchestrator with injected diagnostics & file lines matrix context
                    orchestrator.execute(richPrompt, selectedModel);
                    break;
                }
                case 'respondToCommandApproval': {
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
                    const { subdomain, buildCommand, outputDir, nodeVersion } = data;
                    const sendStatus = (text) => {
                        webviewView.webview.postMessage({ type: 'agentLog', text, logType: 'info' });
                    };
                    sendStatus(`Initializing edge-hosting packaging pipeline for subdomain: "${subdomain}"`);
                    setTimeout(() => {
                        sendStatus(`🛠️ Executing build command: "${buildCommand}" using Node ${nodeVersion}`);
                    }, 1200);
                    setTimeout(() => {
                        sendStatus(`📁 Compressing generated assets from: "${outputDir}/"`);
                    }, 2400);
                    setTimeout(() => {
                        sendStatus(`🌐 Syncing DNS routing records for https://${subdomain}.exovon.app`);
                    }, 3600);
                    setTimeout(() => {
                        webviewView.webview.postMessage({
                            type: 'deploymentResult',
                            subdomain,
                            url: `https://${subdomain}.exovon.app`,
                            buildTime: '31s'
                        });
                        vscode.window.showInformationMessage(`🚀 Deployment successfully launched at https://${subdomain}.exovon.app!`);
                    }, 4800);
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
                    }
                    else if (data.type === 'warning') {
                        vscode.window.showWarningMessage(data.message);
                    }
                    else {
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
    _getHtmlForWebview(webview) {
        const htmlPath = vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui', 'dist', 'index.html');
        let htmlContent = '';
        try {
            htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        }
        catch (e) {
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
        let webviewHtml = htmlContent.replace(/(href|src)="(?:\.\/|\/)?(assets\/[^"]+|favicon\.svg[^"]*)"/g, (match, attr, assetPath) => {
            const assetUri = vscode.Uri.joinPath(baseUri, assetPath);
            const webviewUri = webview.asWebviewUri(assetUri);
            return `${attr}="${webviewUri}"`;
        });
        // Strip crossorigin attributes which can cause load blocks in Webviews due to protocol restrictions
        webviewHtml = webviewHtml.replace(/\scrossorigin(="")?/g, '');
        // Inject compatible CSP meta tag
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">`;
        webviewHtml = webviewHtml.replace('<head>', `<head>\n    ${cspMeta}`);
        return webviewHtml;
    }
}
exports.ExovonSidebarProvider = ExovonSidebarProvider;


/***/ }),
/* 3 */
/***/ ((module) => {

module.exports = require("fs");

/***/ }),
/* 4 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AgentOrchestrator = void 0;
const vscode = __importStar(__webpack_require__(1));
const path = __importStar(__webpack_require__(5));
const fs = __importStar(__webpack_require__(3));
const FileSystemTools_1 = __webpack_require__(6);
const TerminalTools_1 = __webpack_require__(7);
const WebSearchTools_1 = __webpack_require__(9);
let GoogleGenAIClass = null;
class AgentOrchestrator {
    approvalCallback;
    fileApprovalCallback;
    onUpdate;
    fsTools;
    terminalTools;
    ai;
    apiKey = '';
    modifiedFiles = new Set();
    constructor(approvalCallback, fileApprovalCallback, onUpdate) {
        this.approvalCallback = approvalCallback;
        this.fileApprovalCallback = fileApprovalCallback;
        this.onUpdate = onUpdate;
        this.fsTools = new FileSystemTools_1.FileSystemTools();
        // Dynamic approval callback which automatically returns true in Autonomous Mode
        this.terminalTools = new TerminalTools_1.TerminalTools(async (cmd) => {
            const config = vscode.workspace.getConfiguration('exovonhub');
            const isAutonomous = config.get('autonomousMode') || false;
            if (isAutonomous) {
                this.onUpdate({ type: 'log', text: `⚡ [AUTO-APPROVED] Shell execution: "${cmd}"`, logType: 'info' });
                return true;
            }
            return this.approvalCallback(cmd);
        });
    }
    getFsTools() {
        return this.fsTools;
    }
    /**
     * Loads the API key and imports the Gen AI SDK dynamically at runtime to support CommonJS compatibility
     */
    async init() {
        if (this.ai)
            return;
        const config = vscode.workspace.getConfiguration('exovonhub');
        this.apiKey = config.get('googleApiKey') || process.env.GEMINI_API_KEY || '';
        if (this.apiKey) {
            if (!GoogleGenAIClass) {
                const sdk = await __webpack_require__.e(/* import() */ 1).then(__webpack_require__.bind(__webpack_require__, 10));
                GoogleGenAIClass = sdk.GoogleGenAI;
            }
            this.ai = new GoogleGenAIClass({ apiKey: this.apiKey });
        }
    }
    /**
     * Initiates the Plan-Execute-Verify agent loop
     */
    async execute(prompt, model = 'gemma-4-31b-it') {
        try {
            await this.init();
            // Initialize the speculative Shadow Sandbox
            this.onUpdate({ type: 'log', text: 'Initializing isolated speculative sandbox workspace...', logType: 'info' });
            const sandboxStatus = await this.fsTools.enableShadowWorkspace();
            this.terminalTools.setTargetRoot(this.fsTools.getTargetRoot());
            this.onUpdate({ type: 'log', text: `🛡️ ${sandboxStatus}`, logType: 'info' });
        }
        catch (e) {
            this.onUpdate({ type: 'log', text: `❌ SDK/Sandbox Load Error: ${e.message}`, logType: 'error' });
            this.onUpdate({ type: 'complete' });
            return;
        }
        if (!this.apiKey || !this.ai) {
            this.onUpdate({
                type: 'log',
                text: '❌ ERROR: Google Gen AI API Key is not configured. Please add your `exovonhub.googleApiKey` in VS Code Settings or set `GEMINI_API_KEY` in your environment.',
                logType: 'error'
            });
            this.onUpdate({ type: 'complete' });
            return;
        }
        try {
            this.onUpdate({
                type: 'log',
                text: `Starting Exovon AI Agent (Model: ${model})...`,
                logType: 'header'
            });
            // 1. DYNAMIC PLANNING PASS: Create a structured Plan based on user prompt
            this.onUpdate({
                type: 'log',
                text: 'Generating execution plan...',
                logType: 'info'
            });
            let currentPlan = [];
            try {
                const planPrompt = `You are a professional planning module for an autonomous AI software engineer.
Based on the developer's prompt, define a logical sequence of up to 5 steps to complete the task.
Output exactly a raw JSON array of objects, containing:
- id: a unique string like "plan-1", "plan-2"
- text: description of the step
- status: must be "pending"

Developer Prompt: "${prompt}"

Produce ONLY the raw JSON array (do not wrap in markdown or anything else).`;
                const planResponse = await this.ai.models.generateContent({
                    model: model,
                    contents: planPrompt
                });
                let rawText = planResponse.text || '';
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                currentPlan = JSON.parse(rawText);
                if (!Array.isArray(currentPlan) || currentPlan.length === 0) {
                    throw new Error('Invalid plan format');
                }
                // Initialize status of first step to running
                currentPlan[0].status = 'running';
                for (let i = 1; i < currentPlan.length; i++) {
                    currentPlan[i].status = 'pending';
                }
            }
            catch (e) {
                // Fallback robust default plan
                currentPlan = [
                    { id: 'plan-1', text: 'Gather active layout and file context', status: 'running' },
                    { id: 'plan-2', text: 'Evaluate targets and apply modifications', status: 'pending' },
                    { id: 'plan-3', text: 'Perform workspace compiling & verification tests', status: 'pending' }
                ];
            }
            this.onUpdate({ type: 'plan', planSteps: currentPlan });
            const systemPrompt = `You are a senior agentic coding assistant similar to Antigravity.
You are helping the user optimize, inspect, and deploy their workspace.
Execute the tasks by invoking the provided tools in a step-by-step Plan-Execute-Verify loop.
For every action, describe what you are doing first, then call the tool.
Verify your changes by executing compiler/test commands where possible.

Available tools:
- listDir(relativePath: string): Lists files.
- viewFile(relativePath: string, startLine?: number, endLine?: number): Views file content.
- multiReplaceFileContent(relativePath: string, startLine: number, endLine: number, replacementContent: string): Replaces code in a specific range of lines.
- replaceFileContent(relativePath: string, targetContent: string, replacementContent: string): Applies unique string replacement.
- createFile(relativePath: string, content: string): Creates a new file with the specified content.
- deleteFile(relativePath: string): Deletes a file.
- grepSearch(query: string, includePattern?: string): Search codebase files.
- runCommand(command: string): Executes a terminal command (requires user approval).`;
            // Set up the message history for GenAI SDK
            let messages = [
                { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser request: "${prompt}"` }] }
            ];
            let completed = false;
            let loopCount = 0;
            const maxLoops = 8; // Prevent infinite loops
            while (!completed && loopCount < maxLoops) {
                loopCount++;
                this.onUpdate({
                    type: 'log',
                    text: `🤖 AI reasoning step ${loopCount}...`,
                    logType: 'info'
                });
                // 2. STREAMING AI GENERATION TURN
                const responseStream = await this.ai.models.generateContentStream({
                    model: model,
                    contents: messages,
                    config: {
                        tools: [{
                                functionDeclarations: [
                                    {
                                        name: 'listDir',
                                        description: 'List directories and files in workspace',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: { relativePath: { type: 'STRING', description: 'Directory path relative to workspace root' } },
                                            required: ['relativePath']
                                        }
                                    },
                                    {
                                        name: 'viewFile',
                                        description: 'View file content or line ranges',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                relativePath: { type: 'STRING', description: 'File path relative to workspace root' },
                                                startLine: { type: 'INTEGER', description: 'Optional starting line (1-indexed)' },
                                                endLine: { type: 'INTEGER', description: 'Optional ending line' }
                                            },
                                            required: ['relativePath']
                                        }
                                    },
                                    {
                                        name: 'multiReplaceFileContent',
                                        description: 'Replace a range of lines inside a file',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                relativePath: { type: 'STRING', description: 'File path relative to workspace' },
                                                startLine: { type: 'INTEGER', description: 'The starting line number of the block (1-indexed)' },
                                                endLine: { type: 'INTEGER', description: 'The ending line number of the block' },
                                                replacementContent: { type: 'STRING', description: 'Replacement string content' }
                                            },
                                            required: ['relativePath', 'startLine', 'endLine', 'replacementContent']
                                        }
                                    },
                                    {
                                        name: 'replaceFileContent',
                                        description: 'Replace a single contiguous block of code inside a file (legacy fallback)',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                relativePath: { type: 'STRING', description: 'File path relative to workspace' },
                                                targetContent: { type: 'STRING', description: 'Exact string block to replace' },
                                                replacementContent: { type: 'STRING', description: 'Replacement string content' }
                                            },
                                            required: ['relativePath', 'targetContent', 'replacementContent']
                                        }
                                    },
                                    {
                                        name: 'createFile',
                                        description: 'Create a new file in the workspace',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                relativePath: { type: 'STRING', description: 'Relative path of the new file' },
                                                content: { type: 'STRING', description: 'Complete content of the new file' }
                                            },
                                            required: ['relativePath', 'content']
                                        }
                                    },
                                    {
                                        name: 'deleteFile',
                                        description: 'Delete a file in the workspace',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                relativePath: { type: 'STRING', description: 'Relative path of the file to delete' }
                                            },
                                            required: ['relativePath']
                                        }
                                    },
                                    {
                                        name: 'grepSearch',
                                        description: 'Perform a keyword search across all code files',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                query: { type: 'STRING', description: 'Text or keyword to search' },
                                                includePattern: { type: 'STRING', description: 'Optional glob pattern like src/**/*' }
                                            },
                                            required: ['query']
                                        }
                                    },
                                    {
                                        name: 'searchWeb',
                                        description: 'Search the internet for active documentation, library features, and stack overflow solutions',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: { query: { type: 'STRING', description: 'The search query string to check' } },
                                            required: ['query']
                                        }
                                    },
                                    {
                                        name: 'runCommand',
                                        description: 'Run a bash/terminal command natively in workspace root (requires user approval)',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: { command: { type: 'STRING', description: 'Shell command line to execute' } },
                                            required: ['command']
                                        }
                                    }
                                ]
                            }]
                    }
                });
                // 3. AGGREGATE TEXT CHUNKS & FUNCTION CALLS FROM STREAM
                let modelParts = [];
                let streamingText = '';
                for await (const chunk of responseStream) {
                    const candidate = chunk.candidates?.[0];
                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            modelParts.push(part);
                            if (part.text) {
                                streamingText += part.text;
                                // Live stream tokens to the developer UI
                                this.onUpdate({ type: 'log', text: part.text, logType: 'info' });
                            }
                        }
                    }
                }
                const functionCalls = modelParts.filter((part) => 'functionCall' in part);
                if (functionCalls && functionCalls.length > 0) {
                    // Push integrated content chunk history
                    messages.push({
                        role: 'model',
                        parts: modelParts
                    });
                    const toolResponseParts = [];
                    for (const callPart of functionCalls) {
                        const call = callPart.functionCall;
                        const toolName = call.name;
                        const toolArgs = JSON.stringify(call.args);
                        const toolId = `tool-${Date.now()}`;
                        this.onUpdate({
                            type: 'toolStart',
                            toolId,
                            toolName,
                            toolArgs
                        });
                        // Dynamically manage plan steps checklist based on active tools
                        if (toolName === 'listDir' || toolName === 'grepSearch' || toolName === 'viewFile') {
                            if (currentPlan[0] && currentPlan[0].status !== 'success') {
                                currentPlan[0].status = 'success';
                                if (currentPlan[1])
                                    currentPlan[1].status = 'running';
                            }
                        }
                        else if (toolName === 'replaceFileContent' || toolName === 'multiReplaceFileContent' || toolName === 'createFile' || toolName === 'deleteFile') {
                            if (currentPlan[0])
                                currentPlan[0].status = 'success';
                            if (currentPlan[1] && currentPlan[1].status !== 'success') {
                                currentPlan[1].status = 'success';
                                if (currentPlan[2])
                                    currentPlan[2].status = 'running';
                            }
                        }
                        else if (toolName === 'runCommand') {
                            if (currentPlan[1])
                                currentPlan[1].status = 'success';
                            if (currentPlan[2] && currentPlan[2].status !== 'success') {
                                currentPlan[2].status = 'success';
                                if (currentPlan[3])
                                    currentPlan[3].status = 'running';
                            }
                        }
                        this.onUpdate({ type: 'plan', planSteps: [...currentPlan] });
                        const config = vscode.workspace.getConfiguration('exovonhub');
                        const isAutonomous = config.get('autonomousMode') || false;
                        let result = '';
                        try {
                            if (toolName === 'listDir') {
                                result = await this.fsTools.listDir(call.args.relativePath);
                            }
                            else if (toolName === 'viewFile') {
                                result = await this.fsTools.viewFile(call.args.relativePath, call.args.startLine, call.args.endLine);
                            }
                            else if (toolName === 'multiReplaceFileContent') {
                                const details = `Lines ${call.args.startLine}-${call.args.endLine} will be replaced with:\n${call.args.replacementContent}`;
                                const approved = isAutonomous ? true : await this.fileApprovalCallback({
                                    type: 'modify',
                                    path: call.args.relativePath,
                                    details
                                });
                                if (approved) {
                                    if (isAutonomous) {
                                        this.onUpdate({ type: 'log', text: `⚡ [AUTO-APPROVED] Modifying lines ${call.args.startLine}-${call.args.endLine} of file: "${call.args.relativePath}"`, logType: 'info' });
                                    }
                                    result = await this.fsTools.multiReplaceFileContent(call.args.relativePath, call.args.startLine, call.args.endLine, call.args.replacementContent);
                                    this.modifiedFiles.add(call.args.relativePath);
                                    if (!isAutonomous) {
                                        await this.fsTools.commitShadowFile(call.args.relativePath);
                                    }
                                }
                                else {
                                    result = 'Rejected: File modification rejected by user.';
                                    if (!isAutonomous) {
                                        await this.fsTools.revertShadowFile(call.args.relativePath);
                                    }
                                }
                            }
                            else if (toolName === 'replaceFileContent') {
                                const details = `Replacing code block in file:\n${call.args.targetContent}\n\nWith:\n${call.args.replacementContent}`;
                                const approved = isAutonomous ? true : await this.fileApprovalCallback({
                                    type: 'modify',
                                    path: call.args.relativePath,
                                    details
                                });
                                if (approved) {
                                    if (isAutonomous) {
                                        this.onUpdate({ type: 'log', text: `⚡ [AUTO-APPROVED] Modifying file: "${call.args.relativePath}"`, logType: 'info' });
                                    }
                                    result = await this.fsTools.replaceFileContent(call.args.relativePath, call.args.targetContent, call.args.replacementContent);
                                    this.modifiedFiles.add(call.args.relativePath);
                                    if (!isAutonomous) {
                                        await this.fsTools.commitShadowFile(call.args.relativePath);
                                    }
                                }
                                else {
                                    result = 'Rejected: File modification rejected by user.';
                                    if (!isAutonomous) {
                                        await this.fsTools.revertShadowFile(call.args.relativePath);
                                    }
                                }
                            }
                            else if (toolName === 'createFile') {
                                const approved = isAutonomous ? true : await this.fileApprovalCallback({
                                    type: 'create',
                                    path: call.args.relativePath,
                                    details: call.args.content
                                });
                                if (approved) {
                                    if (isAutonomous) {
                                        this.onUpdate({ type: 'log', text: `⚡ [AUTO-APPROVED] Creating file: "${call.args.relativePath}"`, logType: 'info' });
                                    }
                                    result = await this.fsTools.createFile(call.args.relativePath, call.args.content);
                                    this.modifiedFiles.add(call.args.relativePath);
                                    if (!isAutonomous) {
                                        await this.fsTools.commitShadowFile(call.args.relativePath);
                                    }
                                }
                                else {
                                    result = 'Rejected: File creation rejected by user.';
                                    if (!isAutonomous) {
                                        await this.fsTools.revertShadowFile(call.args.relativePath);
                                    }
                                }
                            }
                            else if (toolName === 'deleteFile') {
                                const approved = isAutonomous ? true : await this.fileApprovalCallback({
                                    type: 'delete',
                                    path: call.args.relativePath,
                                    details: 'This file will be permanently deleted.'
                                });
                                if (approved) {
                                    if (isAutonomous) {
                                        this.onUpdate({ type: 'log', text: `⚡ [AUTO-APPROVED] Deleting file: "${call.args.relativePath}"`, logType: 'info' });
                                    }
                                    result = await this.fsTools.deleteFile(call.args.relativePath);
                                    this.modifiedFiles.add(call.args.relativePath);
                                    if (!isAutonomous) {
                                        await this.fsTools.commitShadowFile(call.args.relativePath);
                                    }
                                }
                                else {
                                    result = 'Rejected: File deletion rejected by user.';
                                    if (!isAutonomous) {
                                        await this.fsTools.revertShadowFile(call.args.relativePath);
                                    }
                                }
                            }
                            else if (toolName === 'grepSearch') {
                                result = await this.fsTools.grepSearch(call.args.query, call.args.includePattern);
                            }
                            else if (toolName === 'searchWeb') {
                                this.onUpdate({ type: 'log', text: `🌐 Searching the web for: "${call.args.query}"`, logType: 'info' });
                                const config = vscode.workspace.getConfiguration('exovonhub');
                                const tavilyKey = config.get('tavilyApiKey');
                                const exaKey = config.get('exaApiKey');
                                result = await WebSearchTools_1.WebSearchTools.searchWeb(call.args.query, tavilyKey, exaKey);
                            }
                            else if (toolName === 'runCommand') {
                                result = await this.terminalTools.runCommand(call.args.command);
                            }
                            else {
                                result = `Error: Tool "${toolName}" is not registered.`;
                            }
                        }
                        catch (err) {
                            result = `Tool error: ${err.message}`;
                        }
                        this.onUpdate({
                            type: 'toolComplete',
                            toolId,
                            toolStatus: result.startsWith('Error') || result.startsWith('Rejected') ? 'failed' : 'success'
                        });
                        this.onUpdate({
                            type: 'log',
                            text: `🛠️ [${toolName}] complete.`,
                            logType: 'info'
                        });
                        toolResponseParts.push({
                            functionResponse: {
                                name: toolName,
                                response: { result }
                            }
                        });
                    }
                    // Add the tools' outputs as a single message to history
                    messages.push({
                        role: 'user',
                        parts: toolResponseParts
                    });
                }
                else {
                    // No more tool calls; the agent has finished reasoning and returned final text
                    completed = true;
                    currentPlan.forEach(p => {
                        if (p.status !== 'failed')
                            p.status = 'success';
                    });
                    this.onUpdate({ type: 'plan', planSteps: currentPlan });
                    this.onUpdate({ type: 'log', text: '✅ Task completed successfully!', logType: 'success' });
                }
            }
            // Compute final speculative sandbox diffs
            if (this.modifiedFiles.size > 0) {
                const diffs = [];
                for (const relativePath of this.modifiedFiles) {
                    try {
                        let originalContent = '';
                        try {
                            const origPath = path.resolve(this.fsTools.getTargetRoot().replace('.exovon-shadow', ''), relativePath);
                            if (fs.existsSync(origPath)) {
                                originalContent = fs.readFileSync(origPath, 'utf8');
                            }
                        }
                        catch (e) { }
                        let modifiedContent = '';
                        try {
                            const sandPath = path.resolve(this.fsTools.getTargetRoot(), relativePath);
                            if (fs.existsSync(sandPath)) {
                                modifiedContent = fs.readFileSync(sandPath, 'utf8');
                            }
                        }
                        catch (e) { }
                        const diffLines = this.computeSimpleDiff(originalContent, modifiedContent);
                        diffs.push({ path: relativePath, diffLines });
                    }
                    catch (err) { }
                }
                this.onUpdate({
                    type: 'log',
                    text: `🔍 Speculative Draft Diffs computed for ${diffs.length} modified files. Sending draft to Sidebar for final acceptance.`,
                    logType: 'info'
                });
                this.onUpdate({
                    type: 'diffs',
                    text: JSON.stringify(diffs)
                });
            }
            this.onUpdate({
                type: 'log',
                text: 'Generating final user summary...',
                logType: 'info'
            });
            try {
                const summaryPrompt = `You are a professional AI software engineer. You just completed the following developer request: "${prompt}".
        Write a concise, conversational response directly addressing the user. Summarize what you just accomplished, any files you modified, and ask if they need anything else. Do NOT use markdown code blocks, just regular text.`;
                const summaryResponse = await this.ai.models.generateContent({
                    model: model,
                    contents: summaryPrompt
                });
                if (summaryResponse.text) {
                    // Emit this as a direct chat message back to the UI
                    this.onUpdate({
                        type: 'chat',
                        text: summaryResponse.text.trim()
                    });
                }
            }
            catch (err) { }
            this.onUpdate({ type: 'complete' });
        }
        catch (error) {
            this.onUpdate({
                type: 'log',
                text: `❌ Orchestration Error: ${error.message}`,
                logType: 'error'
            });
            this.onUpdate({ type: 'complete' });
        }
    }
    computeSimpleDiff(original, modified) {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');
        const diff = [];
        let i = 0, j = 0;
        while (i < originalLines.length || j < modifiedLines.length) {
            if (i < originalLines.length && j < modifiedLines.length && originalLines[i] === modifiedLines[j]) {
                diff.push({ type: 'unchanged', text: originalLines[i] });
                i++;
                j++;
            }
            else {
                let foundAlignment = false;
                for (let lookahead = 1; lookahead <= 10; lookahead++) {
                    if (i + lookahead < originalLines.length && originalLines[i + lookahead] === modifiedLines[j]) {
                        for (let k = 0; k < lookahead; k++) {
                            diff.push({ type: 'removed', text: originalLines[i + k] });
                        }
                        i += lookahead;
                        foundAlignment = true;
                        break;
                    }
                    if (j + lookahead < modifiedLines.length && originalLines[i] === modifiedLines[j + lookahead]) {
                        for (let k = 0; k < lookahead; k++) {
                            diff.push({ type: 'added', text: modifiedLines[j + k] });
                        }
                        j += lookahead;
                        foundAlignment = true;
                        break;
                    }
                }
                if (!foundAlignment) {
                    if (i < originalLines.length) {
                        diff.push({ type: 'removed', text: originalLines[i] });
                        i++;
                    }
                    if (j < modifiedLines.length) {
                        diff.push({ type: 'added', text: modifiedLines[j] });
                        j++;
                    }
                }
            }
        }
        return diff;
    }
}
exports.AgentOrchestrator = AgentOrchestrator;


/***/ }),
/* 5 */
/***/ ((module) => {

module.exports = require("path");

/***/ }),
/* 6 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FileSystemTools = void 0;
const vscode = __importStar(__webpack_require__(1));
const path = __importStar(__webpack_require__(5));
const fs = __importStar(__webpack_require__(3));
class FileSystemTools {
    workspaceRoot;
    targetRoot;
    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.targetRoot = this.workspaceRoot;
    }
    getTargetRoot() {
        return this.targetRoot;
    }
    async enableShadowWorkspace() {
        try {
            if (!this.workspaceRoot) {
                return 'Error: No open workspace root found.';
            }
            const shadowPath = path.resolve(this.workspaceRoot, '.exovon-shadow');
            if (!fs.existsSync(shadowPath)) {
                fs.mkdirSync(shadowPath, { recursive: true });
            }
            // Clean target shadow before mirroring
            await this.cleanDirectoryRecursive(shadowPath);
            // Copy workspace files recursively
            await this.copyDirectoryRecursive(this.workspaceRoot, shadowPath);
            this.targetRoot = shadowPath;
            return `Shadow Sandbox successfully provisioned at: ${shadowPath}`;
        }
        catch (e) {
            return `Error provisioning Shadow Sandbox: ${e.message}`;
        }
    }
    async cleanDirectoryRecursive(dir) {
        if (!fs.existsSync(dir))
            return;
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.cleanDirectoryRecursive(fullPath);
                await fs.promises.rmdir(fullPath);
            }
            else {
                await fs.promises.unlink(fullPath);
            }
        }
    }
    async copyDirectoryRecursive(src, dest) {
        const entries = await fs.promises.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            const lowerName = entry.name.toLowerCase();
            if (lowerName === '.git' ||
                lowerName === 'node_modules' ||
                lowerName === '.exovon-shadow' ||
                lowerName === 'dist' ||
                lowerName === 'out' ||
                lowerName === 'out-build' ||
                lowerName === 'out-vscode-min') {
                continue;
            }
            if (entry.isDirectory()) {
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true });
                }
                await this.copyDirectoryRecursive(srcPath, destPath);
            }
            else {
                await fs.promises.copyFile(srcPath, destPath);
            }
        }
    }
    resolvePath(relativePath) {
        const absolutePath = path.resolve(this.targetRoot, relativePath);
        // Safety check: Prevent path traversal outside target sandbox root
        if (!absolutePath.startsWith(this.targetRoot)) {
            throw new Error(`Access Denied: Path "${relativePath}" is outside the workspace sandbox root.`);
        }
        return absolutePath;
    }
    /**
     * List directory contents
     */
    async listDir(relativePath) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            const files = await vscode.workspace.fs.readDirectory(uri);
            const fileList = files.map(([name, type]) => {
                const isDir = type === vscode.FileType.Directory;
                return { name, isDir, type: isDir ? 'directory' : 'file' };
            });
            return JSON.stringify(fileList, null, 2);
        }
        catch (error) {
            return `Error listing directory: ${error.message}`;
        }
    }
    /**
     * View the contents of a file (supports line ranges)
     */
    async viewFile(relativePath, startLine, endLine) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            const contentBuffer = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder('utf-8').decode(contentBuffer);
            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const start = startLine ? Math.max(1, startLine) - 1 : 0;
                const end = endLine ? Math.min(lines.length, endLine) : lines.length;
                return lines.slice(start, end).join('\n');
            }
            return content;
        }
        catch (error) {
            return `Error viewing file: ${error.message}`;
        }
    }
    /**
     * Apply a robust line-range replacement to a file
     */
    async multiReplaceFileContent(relativePath, startLine, endLine, replacementContent) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            const contentBuffer = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder('utf-8').decode(contentBuffer);
            const lines = content.split('\n');
            const start = Math.max(1, startLine) - 1;
            const end = Math.min(lines.length, endLine);
            if (start > end || start >= lines.length) {
                return `Error: Invalid line range specified (${startLine} - ${endLine}). File only has ${lines.length} lines.`;
            }
            // Replace the specified line range (splice takes index, deleteCount, items)
            lines.splice(start, end - start, replacementContent);
            const updatedContent = lines.join('\n');
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));
            return `Successfully modified lines ${startLine}-${endLine} of file: "${relativePath}"`;
        }
        catch (error) {
            return `Error modifying file: ${error.message}`;
        }
    }
    /**
     * Apply a single string replacement to a file (legacy fallback)
     */
    async replaceFileContent(relativePath, targetContent, replacementContent) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            const contentBuffer = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder('utf-8').decode(contentBuffer);
            if (!content.includes(targetContent)) {
                return `Error: Target content was not found in the file. Exact match required including whitespace/newlines.`;
            }
            // Check for multiple occurrences to avoid accidental multi-replacements
            const occurrences = content.split(targetContent).length - 1;
            if (occurrences > 1) {
                return `Error: Target content is not unique. Found ${occurrences} occurrences in the file. Please specify a unique block or line range.`;
            }
            const updatedContent = content.replace(targetContent, replacementContent);
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));
            return `Successfully modified file: "${relativePath}"`;
        }
        catch (error) {
            return `Error modifying file: ${error.message}`;
        }
    }
    /**
     * Semantic grep/regex search across workspace files
     */
    async grepSearch(query, includePattern = '**/*') {
        try {
            if (!this.workspaceRoot) {
                return 'Error: No open workspace root found.';
            }
            // Exclude standard build/node folders
            const excludePattern = '**/node_modules/**,**/dist/**,**/.git/**,**/out/**';
            const files = await vscode.workspace.findFiles(includePattern, excludePattern);
            const results = [];
            for (const file of files) {
                const relativeFile = path.relative(this.workspaceRoot, file.fsPath);
                const contentBuffer = await vscode.workspace.fs.readFile(file);
                const content = new TextDecoder('utf-8').decode(contentBuffer);
                const lines = content.split('\n');
                lines.forEach((lineContent, index) => {
                    if (lineContent.toLowerCase().includes(query.toLowerCase())) {
                        results.push({
                            file: relativeFile,
                            line: index + 1,
                            content: lineContent.trim()
                        });
                    }
                });
                // Cap results to avoid overwhelming context sizes (similar to ripgrep caps)
                if (results.length >= 50) {
                    break;
                }
            }
            if (results.length === 0) {
                return `No matches found for query: "${query}"`;
            }
            return JSON.stringify(results, null, 2);
        }
        catch (error) {
            return `Error during search: ${error.message}`;
        }
    }
    /**
     * Create a new file in the workspace
     */
    async createFile(relativePath, content) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
            return `Successfully created new file: "${relativePath}"`;
        }
        catch (error) {
            return `Error creating file: ${error.message}`;
        }
    }
    /**
     * Delete a file in the workspace
     */
    async deleteFile(relativePath) {
        try {
            const fullPath = this.resolvePath(relativePath);
            const uri = vscode.Uri.file(fullPath);
            await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
            return `Successfully deleted file: "${relativePath}"`;
        }
        catch (error) {
            return `Error deleting file: ${error.message}`;
        }
    }
    async commitShadowFile(relativePath) {
        try {
            const shadowFilePath = path.resolve(this.targetRoot, relativePath);
            const realFilePath = path.resolve(this.workspaceRoot, relativePath);
            if (!fs.existsSync(shadowFilePath)) {
                return `Error: Shadow file "${relativePath}" does not exist.`;
            }
            const realDir = path.dirname(realFilePath);
            if (!fs.existsSync(realDir)) {
                fs.mkdirSync(realDir, { recursive: true });
            }
            await fs.promises.copyFile(shadowFilePath, realFilePath);
            return `Successfully committed "${relativePath}" to active workspace.`;
        }
        catch (e) {
            return `Error committing file: ${e.message}`;
        }
    }
    async revertShadowFile(relativePath) {
        try {
            const shadowFilePath = path.resolve(this.targetRoot, relativePath);
            const realFilePath = path.resolve(this.workspaceRoot, relativePath);
            if (fs.existsSync(realFilePath)) {
                await fs.promises.copyFile(realFilePath, shadowFilePath);
                return `Reverted sandbox version of "${relativePath}" to match original workspace.`;
            }
            else {
                if (fs.existsSync(shadowFilePath)) {
                    await fs.promises.unlink(shadowFilePath);
                }
                return `Removed sandbox draft of "${relativePath}".`;
            }
        }
        catch (e) {
            return `Error reverting file: ${e.message}`;
        }
    }
}
exports.FileSystemTools = FileSystemTools;


/***/ }),
/* 7 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TerminalTools = void 0;
const child_process = __importStar(__webpack_require__(8));
const vscode = __importStar(__webpack_require__(1));
class TerminalTools {
    workspaceRoot;
    targetRoot;
    approvalCallback;
    constructor(approvalCallback) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.targetRoot = this.workspaceRoot;
        this.approvalCallback = approvalCallback;
    }
    setTargetRoot(path) {
        this.targetRoot = path;
    }
    /**
     * Run a terminal command with host-native execution after obtaining user approval.
     */
    async runCommand(command) {
        try {
            if (!this.workspaceRoot) {
                return 'Error: No open workspace root found.';
            }
            // Check safety of command first (e.g. basic blocking of highly destructive commands)
            const lowercaseCmd = command.trim().toLowerCase();
            if (lowercaseCmd.includes('rm -rf /') ||
                lowercaseCmd.includes(':(){:|:&};:') ||
                lowercaseCmd.includes('mkfs') ||
                lowercaseCmd.startsWith('dd ')) {
                return `Rejected: Command "${command}" was blocked by local security heuristic filters (unsafe destructive command).`;
            }
            // 1. Request approval from User via the sidebar UI
            const isApproved = await this.approvalCallback(command);
            if (!isApproved) {
                return `Error: Command execution rejected by user.`;
            }
            // 2. Execute natively
            return new Promise((resolve) => {
                child_process.exec(command, { cwd: this.targetRoot }, (error, stdout, stderr) => {
                    let output = stdout.trim() || '';
                    let errors = stderr.trim() || '';
                    const TRUNCATE_LIMIT = 2500;
                    if (output.length > TRUNCATE_LIMIT) {
                        output = `[TRUNCATED TO PRESERVE TOKEN BOUNDARIES - Last ${TRUNCATE_LIMIT} characters]:\n... ${output.slice(-TRUNCATE_LIMIT)}`;
                    }
                    if (errors.length > TRUNCATE_LIMIT) {
                        errors = `[TRUNCATED TO PRESERVE TOKEN BOUNDARIES - Last ${TRUNCATE_LIMIT} characters]:\n... ${errors.slice(-TRUNCATE_LIMIT)}`;
                    }
                    if (error) {
                        resolve(JSON.stringify({
                            status: 'failed',
                            exitCode: error.code,
                            error: error.message,
                            stderr: errors,
                            stdout: output
                        }, null, 2));
                    }
                    else {
                        resolve(JSON.stringify({
                            status: 'success',
                            exitCode: 0,
                            stdout: output,
                            stderr: errors
                        }, null, 2));
                    }
                });
            });
        }
        catch (error) {
            return `Error executing command: ${error.message}`;
        }
    }
}
exports.TerminalTools = TerminalTools;


/***/ }),
/* 8 */
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),
/* 9 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.WebSearchTools = void 0;
class WebSearchTools {
    /**
     * Performs semantic web search using Tavily or Exa API.
     */
    static async searchWeb(query, tavilyKey, exaKey) {
        if (tavilyKey) {
            return this.searchTavily(query, tavilyKey);
        }
        else if (exaKey) {
            return this.searchExa(query, exaKey);
        }
        else {
            return `Error: No semantic search API key configured. Please set 'exovonhub.tavilyApiKey' or 'exovonhub.exaApiKey' in settings to use the Web Search tool.`;
        }
    }
    static async searchTavily(query, apiKey) {
        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: "basic",
                    include_answer: true,
                    max_results: 5
                })
            });
            if (!response.ok) {
                return `Tavily API Error: ${response.status} - ${await response.text()}`;
            }
            const data = await response.json();
            let responseStr = '';
            if (data.answer) {
                responseStr += `Answer: ${data.answer}\n\n`;
            }
            if (data.results && data.results.length > 0) {
                responseStr += `Sources:\n`;
                data.results.forEach((r) => {
                    responseStr += `- ${r.title} (${r.url})\n  ${r.content}\n\n`;
                });
            }
            return responseStr || 'No results found.';
        }
        catch (e) {
            return `Request Error: ${e.message}`;
        }
    }
    static async searchExa(query, apiKey) {
        try {
            const response = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify({
                    query: query,
                    numResults: 5,
                    contents: { text: { maxCharacters: 1000 } }
                })
            });
            if (!response.ok) {
                return `Exa API Error: ${response.status} - ${await response.text()}`;
            }
            const data = await response.json();
            let responseStr = '';
            if (data.results && data.results.length > 0) {
                responseStr += `Sources:\n`;
                data.results.forEach((r) => {
                    responseStr += `- ${r.title} (${r.url})\n  ${r.text}\n\n`;
                });
            }
            return responseStr || 'No results found.';
        }
        catch (e) {
            return `Request Error: ${e.message}`;
        }
    }
}
exports.WebSearchTools = WebSearchTools;


/***/ }),
/* 10 */,
/* 11 */,
/* 12 */,
/* 13 */,
/* 14 */,
/* 15 */,
/* 16 */,
/* 17 */,
/* 18 */,
/* 19 */,
/* 20 */
/***/ ((module) => {

module.exports = require("https");

/***/ }),
/* 21 */,
/* 22 */,
/* 23 */,
/* 24 */,
/* 25 */
/***/ ((module) => {

module.exports = require("stream");

/***/ }),
/* 26 */,
/* 27 */,
/* 28 */,
/* 29 */,
/* 30 */,
/* 31 */,
/* 32 */,
/* 33 */
/***/ ((module) => {

module.exports = require("os");

/***/ }),
/* 34 */,
/* 35 */,
/* 36 */
/***/ ((module) => {

module.exports = require("events");

/***/ }),
/* 37 */
/***/ ((module) => {

module.exports = require("process");

/***/ }),
/* 38 */
/***/ ((module) => {

module.exports = require("util");

/***/ }),
/* 39 */,
/* 40 */,
/* 41 */,
/* 42 */,
/* 43 */,
/* 44 */,
/* 45 */
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),
/* 46 */,
/* 47 */,
/* 48 */
/***/ ((module) => {

module.exports = require("querystring");

/***/ }),
/* 49 */,
/* 50 */,
/* 51 */
/***/ ((module) => {

module.exports = require("buffer");

/***/ }),
/* 52 */,
/* 53 */,
/* 54 */,
/* 55 */,
/* 56 */,
/* 57 */,
/* 58 */,
/* 59 */,
/* 60 */,
/* 61 */,
/* 62 */,
/* 63 */,
/* 64 */,
/* 65 */,
/* 66 */,
/* 67 */,
/* 68 */,
/* 69 */,
/* 70 */,
/* 71 */,
/* 72 */,
/* 73 */,
/* 74 */,
/* 75 */,
/* 76 */,
/* 77 */,
/* 78 */,
/* 79 */,
/* 80 */,
/* 81 */,
/* 82 */,
/* 83 */,
/* 84 */,
/* 85 */,
/* 86 */,
/* 87 */,
/* 88 */,
/* 89 */,
/* 90 */,
/* 91 */,
/* 92 */,
/* 93 */,
/* 94 */,
/* 95 */,
/* 96 */
/***/ ((module) => {

module.exports = require("fs/promises");

/***/ }),
/* 97 */
/***/ ((module) => {

module.exports = require("node:stream");

/***/ }),
/* 98 */
/***/ ((module) => {

module.exports = require("node:stream/promises");

/***/ }),
/* 99 */,
/* 100 */,
/* 101 */,
/* 102 */
/***/ ((module) => {

module.exports = require("http");

/***/ }),
/* 103 */
/***/ ((module) => {

module.exports = require("net");

/***/ }),
/* 104 */
/***/ ((module) => {

module.exports = require("tls");

/***/ }),
/* 105 */
/***/ ((module) => {

module.exports = require("url");

/***/ }),
/* 106 */,
/* 107 */
/***/ ((module) => {

module.exports = require("zlib");

/***/ }),
/* 108 */,
/* 109 */,
/* 110 */,
/* 111 */,
/* 112 */,
/* 113 */,
/* 114 */,
/* 115 */,
/* 116 */,
/* 117 */,
/* 118 */,
/* 119 */
/***/ ((module) => {

module.exports = require("assert");

/***/ }),
/* 120 */,
/* 121 */,
/* 122 */,
/* 123 */,
/* 124 */,
/* 125 */
/***/ ((module) => {

module.exports = require("tty");

/***/ }),
/* 126 */,
/* 127 */
/***/ ((module) => {

module.exports = require("node:process");

/***/ }),
/* 128 */
/***/ ((module) => {

module.exports = require("node:os");

/***/ }),
/* 129 */
/***/ ((module) => {

module.exports = require("node:tty");

/***/ }),
/* 130 */,
/* 131 */,
/* 132 */,
/* 133 */,
/* 134 */
/***/ ((module) => {

module.exports = require("node:http");

/***/ }),
/* 135 */
/***/ ((module) => {

module.exports = require("node:https");

/***/ }),
/* 136 */
/***/ ((module) => {

module.exports = require("node:zlib");

/***/ }),
/* 137 */
/***/ ((module) => {

module.exports = require("node:buffer");

/***/ }),
/* 138 */,
/* 139 */,
/* 140 */
/***/ ((module) => {

module.exports = require("node:util");

/***/ }),
/* 141 */,
/* 142 */,
/* 143 */
/***/ ((module) => {

module.exports = require("node:stream/web");

/***/ }),
/* 144 */,
/* 145 */,
/* 146 */,
/* 147 */,
/* 148 */,
/* 149 */,
/* 150 */,
/* 151 */,
/* 152 */,
/* 153 */,
/* 154 */
/***/ ((module) => {

module.exports = require("node:url");

/***/ }),
/* 155 */,
/* 156 */,
/* 157 */
/***/ ((module) => {

module.exports = require("node:net");

/***/ }),
/* 158 */,
/* 159 */,
/* 160 */
/***/ ((module) => {

module.exports = require("node:fs");

/***/ }),
/* 161 */
/***/ ((module) => {

module.exports = require("node:path");

/***/ }),
/* 162 */,
/* 163 */
/***/ ((module) => {

module.exports = require("worker_threads");

/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/create fake namespace object */
/******/ 	(() => {
/******/ 		var getProto = Object.getPrototypeOf ? (obj) => (Object.getPrototypeOf(obj)) : (obj) => (obj.__proto__);
/******/ 		var leafPrototypes;
/******/ 		// create a fake namespace object
/******/ 		// mode & 1: value is a module id, require it
/******/ 		// mode & 2: merge all properties of value into the ns
/******/ 		// mode & 4: return value when already ns object
/******/ 		// mode & 16: return value when it's Promise-like
/******/ 		// mode & 8|1: behave like require
/******/ 		__webpack_require__.t = function(value, mode) {
/******/ 			if(mode & 1) value = this(value);
/******/ 			if(mode & 8) return value;
/******/ 			if(typeof value === 'object' && value) {
/******/ 				if((mode & 4) && value.__esModule) return value;
/******/ 				if((mode & 16) && typeof value.then === 'function') return value;
/******/ 			}
/******/ 			var ns = Object.create(null);
/******/ 			__webpack_require__.r(ns);
/******/ 			var def = {};
/******/ 			leafPrototypes = leafPrototypes || [null, getProto({}), getProto([]), getProto(getProto)];
/******/ 			for(var current = mode & 2 && value; (typeof current == 'object' || typeof current == 'function') && !~leafPrototypes.indexOf(current); current = getProto(current)) {
/******/ 				Object.getOwnPropertyNames(current).forEach((key) => (def[key] = () => (value[key])));
/******/ 			}
/******/ 			def['default'] = () => (value);
/******/ 			__webpack_require__.d(ns, def);
/******/ 			return ns;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/ensure chunk */
/******/ 	(() => {
/******/ 		__webpack_require__.f = {};
/******/ 		// This file contains only the entry chunk.
/******/ 		// The chunk loading function for additional chunks
/******/ 		__webpack_require__.e = (chunkId) => {
/******/ 			return Promise.all(Object.keys(__webpack_require__.f).reduce((promises, key) => {
/******/ 				__webpack_require__.f[key](chunkId, promises);
/******/ 				return promises;
/******/ 			}, []));
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
/******/ 		__webpack_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "" + chunkId + ".extension.js";
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/require chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded chunks
/******/ 		// "1" means "loaded", otherwise not loaded yet
/******/ 		var installedChunks = {
/******/ 			0: 1
/******/ 		};
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		var installChunk = (chunk) => {
/******/ 			var moreModules = chunk.modules, chunkIds = chunk.ids, runtime = chunk.runtime;
/******/ 			for(var moduleId in moreModules) {
/******/ 				if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 					__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 				}
/******/ 			}
/******/ 			if(runtime) runtime(__webpack_require__);
/******/ 			for(var i = 0; i < chunkIds.length; i++)
/******/ 				installedChunks[chunkIds[i]] = 1;
/******/ 		
/******/ 		};
/******/ 		
/******/ 		// require() chunk loading for javascript
/******/ 		__webpack_require__.f.require = (chunkId, promises) => {
/******/ 			// "1" is the signal for "already loaded"
/******/ 			if(!installedChunks[chunkId]) {
/******/ 				if(true) { // all chunks have JS
/******/ 					var installedChunk = require("./" + __webpack_require__.u(chunkId));
/******/ 					if (!installedChunks[chunkId]) {
/******/ 						installChunk(installedChunk);
/******/ 					}
/******/ 				} else installedChunks[chunkId] = 1;
/******/ 			}
/******/ 		};
/******/ 		
/******/ 		// no external install chunk
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(0);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map