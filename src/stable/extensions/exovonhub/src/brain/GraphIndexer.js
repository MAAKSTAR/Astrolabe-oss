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
exports.GraphIndexer = void 0;
const ts = __importStar(require("typescript"));
class GraphIndexer {
    static parseFile(filePath, fileContent) {
        const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);
        const symbols = [];
        const edges = [];
        const getLineInfo = (node) => {
            const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
            return { lineStart: start.line + 1, lineEnd: end.line + 1 };
        };
        let currentParentId = null;
        const visit = (node) => {
            let isSymbol = false;
            let name = '';
            let kind = '';
            if (ts.isFunctionDeclaration(node)) {
                isSymbol = true;
                name = node.name ? node.name.getText(sourceFile) : 'AnonymousFunction';
                kind = 'function';
            }
            else if (ts.isMethodDeclaration(node)) {
                isSymbol = true;
                name = node.name.getText(sourceFile);
                kind = 'method';
            }
            else if (ts.isClassDeclaration(node)) {
                isSymbol = true;
                name = node.name ? node.name.getText(sourceFile) : 'AnonymousClass';
                kind = 'class';
            }
            else if (ts.isInterfaceDeclaration(node)) {
                isSymbol = true;
                name = node.name.getText(sourceFile);
                kind = 'interface';
            }
            const prevParentId = currentParentId;
            if (isSymbol) {
                const { lineStart, lineEnd } = getLineInfo(node);
                const id = `${filePath}:${name}:${lineStart}`;
                symbols.push({
                    id,
                    filePath,
                    name,
                    kind,
                    lineStart,
                    lineEnd
                });
                // Record a 'contains' or similar relation if we track nested scopes (currently skipping to keep flat)
                currentParentId = id;
            }
            // Check for calls
            if (ts.isCallExpression(node) && currentParentId) {
                const expression = node.expression;
                let targetName = expression.getText(sourceFile);
                if (ts.isPropertyAccessExpression(expression)) {
                    targetName = expression.name.getText(sourceFile);
                }
                edges.push({
                    sourceId: currentParentId,
                    targetId: `unresolved:${targetName}`, // Will be reconciled by the BrainCoordinator
                    relationType: 'calls'
                });
            }
            ts.forEachChild(node, visit);
            currentParentId = prevParentId;
        };
        visit(sourceFile);
        return { symbols, edges };
    }
}
exports.GraphIndexer = GraphIndexer;
//# sourceMappingURL=GraphIndexer.js.map