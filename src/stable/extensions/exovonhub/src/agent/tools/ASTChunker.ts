import * as ts from 'typescript';

export interface SemanticChunk {
  type: string;
  name: string;
  content: string;
}

/**
 * Phase 4: AST Chunking Engine
 * Uses the native TypeScript compiler API to parse source files into
 * semantic blocks (Classes, Functions, Interfaces) rather than arbitrary tokens.
 */
export class ASTChunker {
  /**
   * Extracts semantic chunks from a TypeScript or JavaScript file content.
   */
  public static extractChunks(filePath: string, fileContent: string): SemanticChunk[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    const chunks: SemanticChunk[] = [];

    const visit = (node: ts.Node) => {
      let isTargetNode = false;
      let name = 'Anonymous';

      if (ts.isFunctionDeclaration(node)) {
        isTargetNode = true;
        name = node.name ? node.name.getText(sourceFile) : 'AnonymousFunction';
      } else if (ts.isMethodDeclaration(node)) {
        isTargetNode = true;
        name = node.name.getText(sourceFile);
      } else if (ts.isClassDeclaration(node)) {
        isTargetNode = true;
        name = node.name ? node.name.getText(sourceFile) : 'AnonymousClass';
      } else if (ts.isInterfaceDeclaration(node)) {
        isTargetNode = true;
        name = node.name.getText(sourceFile);
      } else if (ts.isVariableStatement(node)) {
        // Look for arrow functions assigned to variables
        const decl = node.declarationList.declarations[0];
        if (decl && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          isTargetNode = true;
          name = decl.name.getText(sourceFile);
        }
      }

      if (isTargetNode) {
        chunks.push({
          type: ts.SyntaxKind[node.kind],
          name: name,
          content: node.getText(sourceFile)
        });
      }

      // Do not traverse into children if we already grabbed the block,
      // unless we want nested functions. Usually, getting the top-level block is better for LLMs.
      // But let's grab everything for full semantic search.
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return chunks;
  }
}
