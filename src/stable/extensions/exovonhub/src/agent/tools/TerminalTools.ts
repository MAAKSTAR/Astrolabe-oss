import * as childProcess from 'child_process';
import * as vscode from 'vscode';

export interface TerminalToolsInterface {
  runCommand(command: string): Promise<string>;
  sendTerminalInput?(processId: string, input: string): Promise<string>;
  checkTerminalStatus?(processId: string): Promise<string>;
}
export class TerminalTools implements TerminalToolsInterface {
  private workspaceRoot: string;
  private targetRoot: string;
  private approvalCallback: (command: string) => Promise<boolean>;
  private activeProcesses: Map<string, { process: childProcess.ChildProcess, outputBuffer: string }> = new Map();

  constructor(approvalCallback: (command: string) => Promise<boolean>) {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.targetRoot = this.workspaceRoot;
    this.approvalCallback = approvalCallback;
  }

  public setTargetRoot(path: string) {
    this.targetRoot = path;
  }

  public async sendTerminalInput(processId: string, input: string): Promise<string> {
    const active = this.activeProcesses.get(processId);
    if (!active) {
      return `Error: No active process found with ID ${processId}. It may have exited.`;
    }
    
    return new Promise((resolve) => {
      active.process.stdin?.write(input + '\n');
      
      let idleTimer: NodeJS.Timeout;
      const onData = (data: any) => {
        active.outputBuffer += data.toString();
        resetTimer();
      };

      const finish = () => {
        active.process.stdout?.off('data', onData);
        active.process.stderr?.off('data', onData);
        
        let out = active.outputBuffer.trim();
        const limit = 2500;
        if (out.length > limit) { out = `[TRUNCATED]:\n... ${out.slice(-limit)}`; }
        resolve(JSON.stringify({ status: 'interactive_prompt', processId, stdout: out }, null, 2));
      };

      const resetTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, 3000);
      };

      active.process.stdout?.on('data', onData);
      active.process.stderr?.on('data', onData);
      
      // If process exits immediately after input
      active.process.once('close', () => {
        clearTimeout(idleTimer);
        finish();
      });

      resetTimer();
    });
  }

  /**
   * Run a terminal command with host-native execution after obtaining user approval.
   * Terminal commands ALWAYS execute in the real workspace root so they have full access to node_modules and dependencies.
   */
  public async runCommand(command: string): Promise<string> {
    try {
      if (!this.workspaceRoot) {
        return 'Error: No open workspace root found.';
      }

      // Security check: Blocklist destructive commands instantly
      const blockedPatterns = [
        /^\s*rm\s+-r.*f/i, // rm -rf
        /^\s*rm\s+.*-r.*f/i, // rm ... -rf
        /^\s*rm\s+.*\/\s*$/i, // rm on root
        /^\s*rm\s+.*\/\*\s*$/i, // rm on root wildcards
        /^\s*rm\s+.*node_modules/i, // deleting node_modules
        /^\s*mkfs/i, // mkfs
        /^\s*dd\s+/i, // dd
        /^\s*>.*\/dev\/(sda|hda|nvme)/i, // Overwriting disks
        /^\s*mv\s+.*\/dev\/null/i, // moving to null
        /^\s*chmod\s+-R\s+777\s+\//i, // recursive full permissions on root
        /^\s*chown\s+-R\s+.*:\s*\//i, // recursive chown on root
      ];

      for (const pattern of blockedPatterns) {
        if (pattern.test(command)) {
          return JSON.stringify({
            success: false,
            error: "Command blocked for security reasons.",
            suggestion: "Destructive commands (like rm -rf) are strictly prohibited. Please perform this action manually if absolutely necessary."
          }, null, 2);
        }
      }

      // Security whitelist check will be handled by the orchestrator before auto-approving

      // 1. Request approval from User via the sidebar UI
      const isApproved = await this.approvalCallback(command);
      if (!isApproved) {
        return `Error: Command execution rejected by user.`;
      }

      // 2. Execute natively
      return new Promise<string>((resolve) => {
        let output = '';
        let errors = '';
        
        const child = childProcess.spawn(command, { 
          cwd: this.workspaceRoot,
          shell: true
        });

        const processId = Date.now().toString();
        const activeProcess = { process: child, outputBuffer: '' };
        this.activeProcesses.set(processId, activeProcess);

        const timeoutId = setTimeout(() => {
          child.kill('SIGKILL');
          errors += '\n[EXOVON TIMEOUT] Process killed after 60 seconds.';
          this.activeProcesses.delete(processId);
        }, 60000);

        let idleTimer: NodeJS.Timeout;
        let isResolved = false;

        const checkIdle = () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            
            let out = activeProcess.outputBuffer.trim();
            const limit = 2500;
            if (out.length > limit) { out = `[TRUNCATED]:\n... ${out.slice(-limit)}`; }
            resolve(JSON.stringify({ status: 'interactive_prompt', processId, stdout: out }, null, 2));
          }
        };

        const resetIdleTimer = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(checkIdle, 3000);
        };

        child.stdout?.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          activeProcess.outputBuffer += chunk;
          resetIdleTimer();
        });

        child.stderr?.on('data', (data) => {
          const chunk = data.toString();
          errors += chunk;
          activeProcess.outputBuffer += chunk;
          resetIdleTimer();
        });

        resetIdleTimer(); // start idle timer

        child.on('error', (error) => {
          if (isResolved) { return; }
          isResolved = true;
          clearTimeout(timeoutId);
          clearTimeout(idleTimer);
          this.activeProcesses.delete(processId);
          resolve(JSON.stringify({
            status: 'failed',
            exitCode: -1,
            error: error.message,
            stderr: errors,
            stdout: output
          }, null, 2));
        });

        child.on('close', (code) => {
          if (isResolved) { return; }
          isResolved = true;
          clearTimeout(timeoutId);
          clearTimeout(idleTimer);
          this.activeProcesses.delete(processId);
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
          } else {
            resolve(JSON.stringify({
              status: 'success',
              exitCode: 0,
              stdout: output,
              stderr: errors
            }, null, 2));
          }
        });
      });
    } catch (error: any) {
      return `Error executing command: ${error.message}`;
    }
  }


  public async checkTerminalStatus(processId: string): Promise<string> {
    const active = this.activeProcesses.get(processId);
    if (!active) {
      return `Error: No active process found with ID ${processId}. It may have exited.`;
    }
    
    let out = active.outputBuffer.trim();
    const limit = 2500;
    if (out.length > limit) { out = `[TRUNCATED]:\n... ${out.slice(-limit)}`; }
    
    // Clear buffer after reading
    active.outputBuffer = '';
    return JSON.stringify({ status: 'running', processId, stdout: out }, null, 2);
  }
}
