import * as child_process from 'child_process';
import * as vscode from 'vscode';

export interface TerminalToolsInterface {
  runCommand(command: string): Promise<string>;
}

export class TerminalTools implements TerminalToolsInterface {
  private workspaceRoot: string;
  private targetRoot: string;
  private approvalCallback: (command: string) => Promise<boolean>;

  constructor(approvalCallback: (command: string) => Promise<boolean>) {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.targetRoot = this.workspaceRoot;
    this.approvalCallback = approvalCallback;
  }

  public setTargetRoot(path: string) {
    this.targetRoot = path;
  }

  /**
   * Run a terminal command with host-native execution after obtaining user approval.
   */
  public async runCommand(command: string): Promise<string> {
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
      return new Promise<string>((resolve) => {
        child_process.exec(
          command,
          { 
            cwd: this.targetRoot,
            timeout: 60000,
            maxBuffer: 1024 * 512
          },
          (error, stdout, stderr) => {
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
            } else {
              resolve(JSON.stringify({
                status: 'success',
                exitCode: 0,
                stdout: output,
                stderr: errors
              }, null, 2));
            }
          }
        );
      });
    } catch (error: any) {
      return `Error executing command: ${error.message}`;
    }
  }
}
