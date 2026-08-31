import * as vscode from 'vscode';
import { LlamaEngine } from './LlamaEngine';

export class CopilotProvider implements vscode.InlineCompletionItemProvider {
  private engine: LlamaEngine;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs = 250;

  constructor(engine: LlamaEngine) {
    this.engine = engine;
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke || context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      
      // Delay to debounce naturally while respecting VS Code's cancellation token
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, this.debounceMs);
        token.onCancellationRequested(() => {
          clearTimeout(timer);
          resolve();
        });
      });

      if (token.isCancellationRequested) {
        return null;
      }

      try {
        const result = await this.getCompletion(document, position, token);
        return result;
      } catch (e) {
        console.error('Ghost Inline Completion Error:', e);
        return null;
      }
    }

    return null;
  }

  private async getCompletion(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    if (!this.engine.isReady()) {
      return [];
    }

    // Context Window: Grab top 1000 chars before, 200 chars after
    const prefixRange = new vscode.Range(
      new vscode.Position(Math.max(0, position.line - 50), 0),
      position
    );
    const suffixRange = new vscode.Range(
      position,
      new vscode.Position(Math.min(document.lineCount - 1, position.line + 10), 1000)
    );

    const prefix = document.getText(prefixRange);
    const suffix = document.getText(suffixRange);

    if (prefix.trim() === '') {
      return [];
    }

    // Ask the engine for FIM completion
    const completionText = await this.engine.getFimCompletion(prefix, suffix, token, document.languageId);

    if (!completionText || completionText.trim() === '') {
      return [];
    }

    // Return the completion item
    const item = new vscode.InlineCompletionItem(completionText, new vscode.Range(position, position));
    return [item];
  }
}
