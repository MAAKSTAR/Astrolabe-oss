import * as vscode from 'vscode';

export class NeighborContextRetriever {
  /**
   * Extract words/identifiers from code to compute similarity
   */
  private static extractTokens(text: string): Set<string> {
    const tokens = new Set<string>();
    const matches = text.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
    for (const m of matches) {
      tokens.add(m);
    }
    return tokens;
  }

  /**
   * Calculate Jaccard similarity between two sets of tokens
   */
  private static jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersection++;
      }
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Retrieve relevant type definitions, exported interfaces, and utility snippets
   * from neighboring open tabs matching the current file's vocabulary.
   */
  public static getNeighborContext(currentDoc: vscode.TextDocument, prefix: string): string {
    const currentTokens = this.extractTokens(prefix);
    if (currentTokens.size === 0) return '';

    const openDocs = vscode.workspace.textDocuments.filter(doc => 
      doc.uri.toString() !== currentDoc.uri.toString() &&
      !doc.isUntitled &&
      !doc.fileName.includes('node_modules') &&
      !doc.fileName.includes('.git') &&
      doc.getText().length < 50000 // avoid massive files
    );

    const relevantSnippets: { relPath: string; score: number; snippet: string }[] = [];

    for (const doc of openDocs) {
      const text = doc.getText();
      const docTokens = this.extractTokens(text);
      const score = this.jaccardSimilarity(currentTokens, docTokens);

      if (score > 0.05) {
        // Extract structural definitions (interfaces, types, exported functions, constants)
        const lines = text.split('\n');
        const candidateLines: string[] = [];
        let capturing = false;
        let braceCount = 0;

        for (const line of lines) {
          const trimmed = line.trim();
          if (/^(?:export\s+)?(?:interface|type|enum|const\s+[A-Z_]+)\b/.test(trimmed)) {
            capturing = true;
            braceCount = 0;
          }

          if (capturing) {
            candidateLines.push(line);
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
            if (braceCount <= 0 && trimmed.endsWith('}') || trimmed.endsWith(';')) {
              capturing = false;
            }
          }
        }

        const snippet = candidateLines.slice(0, 30).join('\n').trim();
        if (snippet.length > 20) {
          const relPath = vscode.workspace.asRelativePath(doc.uri);
          relevantSnippets.push({ relPath, score, snippet });
        }
      }
    }

    // Sort by relevance score descending and pick top 2
    relevantSnippets.sort((a, b) => b.score - a.score);
    const topSnippets = relevantSnippets.slice(0, 2);

    if (topSnippets.length === 0) return '';

    let result = '';
    for (const s of topSnippets) {
      result += `/* Context from ${s.relPath} */\n${s.snippet}\n\n`;
    }
    return result;
  }
}
