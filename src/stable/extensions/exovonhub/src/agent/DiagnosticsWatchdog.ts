import * as vscode from 'vscode';

export class DiagnosticsWatchdog {
  private debounceTimer: NodeJS.Timeout | null = null;
  private activeErrors = new Set<string>(); // Keep track to prevent spam
  private postMessageCallback: (msg: any) => void;
  private diagnosticDisposable: vscode.Disposable;

  constructor(postMessageCallback: (msg: any) => void) {
    this.postMessageCallback = postMessageCallback;
    
    // Listen for diagnostic changes
    this.diagnosticDisposable = vscode.languages.onDidChangeDiagnostics((e) => {
      this.handleDiagnostics(e.uris);
    });
  }

  public dispose() {
    this.diagnosticDisposable.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private handleDiagnostics(uris: readonly vscode.Uri[]) {
    // Debounce to avoid spamming while the user is actively typing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      for (const uri of uris) {
        // Skip node_modules or output files
        if (uri.fsPath.includes('node_modules') || uri.fsPath.includes('.git') || uri.fsPath.includes('dist')) { continue; }

        // Skip if the user is currently editing this file
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.toString() === uri.toString()) {
           continue; // Let them finish typing
        }

        const diagnostics = vscode.languages.getDiagnostics(uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

        if (errors.length > 0) {
           const firstError = errors[0];
           const lineNum = firstError.range.start.line + 1;
           const errorKey = `${uri.toString()}:${lineNum}`;
           
           if (!this.activeErrors.has(errorKey)) {
              this.activeErrors.add(errorKey);
              
              // Only alert if we haven't alerted for this specific line recently
              const relPath = vscode.workspace.asRelativePath(uri, false);
              
              try {
                const document = await vscode.workspace.openTextDocument(uri);
                const brokenCode = document.getText(firstError.range).substring(0, 100); // Truncate
                
                const markdownAlert = `👀 **Watchdog Alert**\nI noticed a Syntax Error in \`${relPath}\` on line ${lineNum}.\n\n\`\`\`typescript\n${brokenCode || '<syntax error>'}\n\`\`\`\n*${firstError.message}*\n\nIf you want me to fix it, just ask: **"Fix the error on ${relPath}:${lineNum}"**`;

                this.postMessageCallback({ 
                  type: 'watchdogError', 
                  relPath,
                  lineNum,
                  errorMsg: firstError.message,
                  brokenCode: brokenCode || '<syntax error>',
                  text: markdownAlert,
                  logType: 'warning'
                });
              } catch (e) {
                 console.error("Watchdog read error", e);
              }
           }
        } else {
           // Clear errors that are fixed
           for (const key of Array.from(this.activeErrors)) {
             if (key.startsWith(uri.toString())) {
               this.activeErrors.delete(key);
             }
           }
        }
      }
    }, 10000); // Wait 10 seconds after typing stops/diagnostics change
  }
}
