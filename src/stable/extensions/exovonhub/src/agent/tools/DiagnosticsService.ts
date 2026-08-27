import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export class DiagnosticsService {
  private languageService: ts.LanguageService;
  private fileVersions: Map<string, number> = new Map();
  private workspaceRoot: string;
  private shadowRoot: string;
  
  // Cache the file names to avoid slow globbing on every call, update when files are created/deleted
  private cachedFileNames: string[] = [];

  constructor(workspaceRoot: string, shadowRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.shadowRoot = shadowRoot;
    
    // Initial scan of workspace files
    this.rescanWorkspace();

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => this.cachedFileNames,
      getScriptVersion: (fileName) => (this.fileVersions.get(fileName) || 1).toString(),
      getScriptSnapshot: (fileName) => {
        // VIRTUAL ROUTER: The compiler asks for the REAL file.
        // We intercept and check if the agent has a modified version in the SHADOW folder.
        
        // 1. Resolve relative to workspace
        const relativePath = path.relative(this.workspaceRoot, fileName);
        const shadowPath = path.join(this.shadowRoot, relativePath);
        
        // 2. Check if shadow file exists
        if (fs.existsSync(shadowPath)) {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(shadowPath, 'utf8'));
        }
        
        // 3. Fallback to REAL file
        if (fs.existsSync(fileName)) {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
        }
        
        return undefined;
      },
      getCurrentDirectory: () => this.workspaceRoot,
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowJs: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true
      }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) => {
        const relativePath = path.relative(this.workspaceRoot, fileName);
        const shadowPath = path.join(this.shadowRoot, relativePath);
        return fs.existsSync(shadowPath) || fs.existsSync(fileName);
      },
      readFile: (fileName) => {
        const relativePath = path.relative(this.workspaceRoot, fileName);
        const shadowPath = path.join(this.shadowRoot, relativePath);
        if (fs.existsSync(shadowPath)) return fs.readFileSync(shadowPath, 'utf8');
        if (fs.existsSync(fileName)) return fs.readFileSync(fileName, 'utf8');
        return undefined;
      },
      readDirectory: ts.sys.readDirectory
    };

    this.languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  private rescanWorkspace() {
    const scanDir = (dir: string): string[] => {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('.exovon-shadow')) continue;
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(scanDir(fullPath));
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
          results.push(fullPath);
        }
      }
      return results;
    };
    
    try {
      this.cachedFileNames = scanDir(this.workspaceRoot);
    } catch(e) {
      this.cachedFileNames = [];
    }
  }

  /**
   * Called by FileSystemTools after applying a speculative edit to a shadow file.
   * This bumps the internal version, forcing the compiler to re-parse the shadow file,
   * then returns immediate, synchronous diagnostics.
   */
  public getDiagnosticsForFile(relativePath: string): string {
    const realFilePath = path.join(this.workspaceRoot, relativePath);
    
    // Ensure the file is in our cache
    if (!this.cachedFileNames.includes(realFilePath)) {
       this.cachedFileNames.push(realFilePath);
    }
    
    // Bump version to invalidate the AST cache
    const currentVersion = this.fileVersions.get(realFilePath) || 1;
    this.fileVersions.set(realFilePath, currentVersion + 1);

    const diagnostics = this.languageService.getSemanticDiagnostics(realFilePath);
    const syntaxDiagnostics = this.languageService.getSyntacticDiagnostics(realFilePath);
    
    const allDiagnostics = [...syntaxDiagnostics, ...diagnostics];
    const errors = allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);

    if (errors.length === 0) {
      return "\n\n[IDE Diagnostics: Clean. No syntax or dependency errors found after edit.]";
    }

    let diagString = `\n\n[IDE Diagnostics: ${errors.length} error(s) found]`;
    for (const d of errors.slice(0, 5)) {
      if (d.file && d.start !== undefined) {
        const { line } = d.file.getLineAndCharacterOfPosition(d.start);
        diagString += `\n- Line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
      } else {
        diagString += `\n- ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
      }
    }
    
    if (errors.length > 5) {
      diagString += `\n...and ${errors.length - 5} more errors.`;
    }
    
    return diagString;
  }
}
