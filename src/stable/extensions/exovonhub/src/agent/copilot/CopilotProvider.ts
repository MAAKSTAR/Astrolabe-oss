import * as vscode from 'vscode';
import { LlamaEngine } from './LlamaEngine';
import { NeighborContextRetriever } from './NeighborContextRetriever';

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

    // Context Window: Grab up to 100 lines before, 20 lines after
    const prefixRange = new vscode.Range(
      new vscode.Position(Math.max(0, position.line - 100), 0),
      position
    );
    const suffixRange = new vscode.Range(
      position,
      new vscode.Position(Math.min(document.lineCount - 1, position.line + 20), 1000)
    );

    const prefix = document.getText(prefixRange);
    const suffix = document.getText(suffixRange);

    if (prefix.trim() === '') {
      return [];
    }

    // Enrich prefix with Relative File Path header & Neighboring open tabs context (Jaccard similarity)
    const relPath = vscode.workspace.asRelativePath(document.uri);
    const neighborContext = NeighborContextRetriever.getNeighborContext(document, prefix);
    const enrichedPrefix = `${neighborContext}// Path: ${relPath}\n${prefix}`;

    // Ask the engine for FIM completion
    const fimResult = await this.engine.getFimCompletion(enrichedPrefix, suffix, token, document.languageId);

    if (!fimResult || !fimResult.text || fimResult.text.trim() === '') {
      return [];
    }

    // Determine replacement range (if a typo was detected, replace the preceding mistyped word)
    const startPos = fimResult.replacePrefixChars > 0
      ? new vscode.Position(position.line, Math.max(0, position.character - fimResult.replacePrefixChars))
      : position;

    // Return the completion item
    const item = new vscode.InlineCompletionItem(fimResult.text, new vscode.Range(startPos, position));
    return [item];
  }
}
