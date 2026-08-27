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
exports.ASTChunker = void 0;
const ts = __importStar(require("typescript"));
/**
 * Phase 4: AST Chunking Engine
 * Uses the native TypeScript compiler API to parse source files into
 * semantic blocks (Classes, Functions, Interfaces) rather than arbitrary tokens.
 */
class ASTChunker {
    /**
     * Extracts semantic chunks from a TypeScript or JavaScript file content.
     */
    static extractChunks(filePath, fileContent) {
        const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);
        const chunks = [];
        const visit = (node) => {
            let isTargetNode = false;
            let name = 'Anonymous';
            if (ts.isFunctionDeclaration(node)) {
                isTargetNode = true;
                name = node.name ? node.name.getText(sourceFile) : 'AnonymousFunction';
            }
            else if (ts.isMethodDeclaration(node)) {
                isTargetNode = true;
                name = node.name.getText(sourceFile);
            }
            else if (ts.isClassDeclaration(node)) {
                isTargetNode = true;
                name = node.name ? node.name.getText(sourceFile) : 'AnonymousClass';
            }
            else if (ts.isInterfaceDeclaration(node)) {
                isTargetNode = true;
                name = node.name.getText(sourceFile);
            }
            else if (ts.isVariableStatement(node)) {
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
exports.ASTChunker = ASTChunker;
//# sourceMappingURL=ASTChunker.js.map