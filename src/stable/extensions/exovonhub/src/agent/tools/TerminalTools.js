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
exports.TerminalTools = void 0;
const childProcess = __importStar(require("child_process"));
const vscode = __importStar(require("vscode"));
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
            // Security whitelist check will be handled by the orchestrator before auto-approving
            // 1. Request approval from User via the sidebar UI
            const isApproved = await this.approvalCallback(command);
            if (!isApproved) {
                return `Error: Command execution rejected by user.`;
            }
            // 2. Execute natively
            return new Promise((resolve) => {
                let output = '';
                let errors = '';
                const child = childProcess.spawn(command, {
                    cwd: this.targetRoot,
                    shell: true
                });
                const timeoutId = setTimeout(() => {
                    child.kill('SIGKILL');
                    errors += '\n[EXOVON TIMEOUT] Process killed after 60 seconds.';
                }, 60000);
                child.stdout?.on('data', (data) => {
                    output += data.toString();
                });
                child.stderr?.on('data', (data) => {
                    errors += data.toString();
                });
                child.on('error', (error) => {
                    clearTimeout(timeoutId);
                    resolve(JSON.stringify({
                        status: 'failed',
                        exitCode: -1,
                        error: error.message,
                        stderr: errors,
                        stdout: output
                    }, null, 2));
                });
                child.on('close', (code) => {
                    clearTimeout(timeoutId);
                    output = output.trim();
                    errors = errors.trim();
                    const TRUNCATE_LIMIT = 2500;
                    if (output.length > TRUNCATE_LIMIT) {
                        output = `[TRUNCATED TO PRESERVE TOKEN BOUNDARIES - Last ${TRUNCATE_LIMIT} characters]:\n... ${output.slice(-TRUNCATE_LIMIT)}`;
                    }
                    if (errors.length > TRUNCATE_LIMIT) {
                        errors = `[TRUNCATED TO PRESERVE TOKEN BOUNDARIES - Last ${TRUNCATE_LIMIT} characters]:\n... ${errors.slice(-TRUNCATE_LIMIT)}`;
                    }
                    if (code !== 0) {
                        resolve(JSON.stringify({
                            status: 'failed',
                            exitCode: code,
                            error: `Process exited with code ${code}`,
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
//# sourceMappingURL=TerminalTools.js.map