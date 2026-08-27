declare module 'ts-morph' {
  export class Project {
    constructor(options?: any);
    createSourceFile(path: string, content: string): any;
  }
  export interface SourceFile {
    getFullText(): string;
    getImportDeclarations(): any[];
    getImportDeclaration(condition: any): any;
    addImportDeclaration(declaration: any): any;
    addStatements(statements: string): any;
    getDefaultExportSymbol(): any;
    getFunctions(): any[];
    getVariableDeclarations(): any[];
    replaceWithText(text: string): void;
  }
}
