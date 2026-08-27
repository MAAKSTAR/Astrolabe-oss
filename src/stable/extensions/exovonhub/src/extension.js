"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ExovonSidebarProvider_1 = require("./ExovonSidebarProvider");
const BrainCoordinator_1 = require("./brain/BrainCoordinator");
let sidebarProvider;
let brainCoordinator;
function activate(context) {
    console.log('Exovon Hub Suite is now active.');
    // Initialize Project Brain (Offline vector/graph)
    brainCoordinator = new BrainCoordinator_1.BrainCoordinator(context);
    // Instantiate and register our sidebar view provider
    sidebarProvider = new ExovonSidebarProvider_1.ExovonSidebarProvider(context, brainCoordinator);
    const viewDisposable = vscode.window.registerWebviewViewProvider(ExovonSidebarProvider_1.ExovonSidebarProvider.viewType, sidebarProvider);
    context.subscriptions.push(viewDisposable);
    // Hellworld command registers as secondary action
    const commandDisposable = vscode.commands.registerCommand('exovonhub.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Exovon Hub Suite!');
    });
    context.subscriptions.push(commandDisposable);
    // Command to reopen the sidebar from Editor Title
    const openSidebarDisposable = vscode.commands.registerCommand('exovonhub.openSidebar', () => {
        vscode.commands.executeCommand('exovonhub.sidebar.focus');
    });
    context.subscriptions.push(openSidebarDisposable);
    // Incremental Graph/Vector indexer on save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (brainCoordinator && doc.languageId === 'typescript' || doc.languageId === 'javascript') {
            try {
                await brainCoordinator?.indexFile(doc.uri.fsPath, doc.getText());
            }
            catch (e) {
                console.error('Brain background index failed', e);
            }
        }
    }));
}
function deactivate() {
    // Cleanup shadow workspace on extension deactivation to prevent disk bloat
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        const shadowPath = path.resolve(workspaceRoot, '.exovon-shadow');
        if (fs.existsSync(shadowPath)) {
            try {
                fs.rmSync(shadowPath, { recursive: true, force: true });
            }
            catch (e) {
                // Best-effort cleanup
            }
        }
    }
    if (brainCoordinator) {
        brainCoordinator.shutdown();
        brainCoordinator = undefined;
    }
    sidebarProvider = undefined;
}
//# sourceMappingURL=extension.js.map