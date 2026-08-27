import * as vscode from 'vscode';
import { ExovonSidebarProvider } from './ExovonSidebarProvider';

export class ProblemCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private provider: ExovonSidebarProvider) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    if (context.diagnostics.length === 0) {
      return [];
    }

    const action = new vscode.CodeAction('Send to Agent', vscode.CodeActionKind.QuickFix);
    action.command = {
      command: 'exovon.sendProblemToAgent',
      title: 'Send to Agent',
      arguments: [document.uri, context.diagnostics]
    };
    action.isPreferred = true;

    return [action];
  }
}
