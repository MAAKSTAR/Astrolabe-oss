import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ASTChunker } from './ASTChunker';

export interface FileSystemToolsInterface {
  listDir(relativePath: string): Promise<string>;
  viewFile(relativePath: string, startLine?: number, endLine?: number): Promise<string>;
  replaceFileContent(relativePath: string, targetContent: string, replacementContent: string): Promise<string>;
  multiReplaceFileContent(relativePath: string, startLine: number, endLine: number, replacementContent: string): Promise<string>;
  createFile(relativePath: string, content: string): Promise<string>;
  deleteFile(relativePath: string): Promise<string>;
  grepSearch(query: string, includePattern?: string): Promise<string>;
}

export class FileSystemTools implements FileSystemToolsInterface {
  private workspaceRoot: string;
  private targetRoot: string;
  private shadowPath: string = '';
  private shadowInitialized: boolean = false;
  
  // Phase 2: Cryptographic Indexing (Merkle Tree)
  private fileHashes: Map<string, string> = new Map();
  private dirHashes: Map<string, string> = new Map();
  private fsWatcher: vscode.FileSystemWatcher | null = null;
  private isIndexing: boolean = false;

  constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.targetRoot = this.workspaceRoot;
    
    // Initialize Merkle Indexing in background
    if (this.workspaceRoot) {
      this.initializeMerkleTree().catch(e => console.error('Failed to init Merkle Tree:', e));
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getTargetRoot(): string {
    return this.targetRoot;
  }

  /**
   * Copy-on-Write Shadow Workspace.
   * Instead of cloning the entire workspace upfront (20,000+ I/O ops),
   * we only create the shadow directory. Files are lazily copied into
   * the shadow on first write via ensureShadowFile().
   * Reads go directly to the real workspace unless the file has already
   * been copied into the shadow.
   */
  public async enableShadowWorkspace(): Promise<string> {
    try {
      if (!this.workspaceRoot) {
        return 'Error: No open workspace root found.';
      }
      this.shadowPath = path.resolve(this.workspaceRoot, '.exovon-shadow');
      
      // Clean any previous shadow remnants
      if (fs.existsSync(this.shadowPath)) {
        await fs.promises.rm(this.shadowPath, { recursive: true, force: true });
      }
      fs.mkdirSync(this.shadowPath, { recursive: true });

      this.targetRoot = this.shadowPath;
      this.shadowInitialized = true;
      return `Copy-on-Write Shadow Sandbox provisioned at: ${this.shadowPath} (zero files copied upfront)`;
    } catch (e: any) {
      return `Error provisioning Shadow Sandbox: ${e.message}`;
    }
  }

  /**
   * Reverts all pending changes by completely destroying the shadow sandbox.
   */
  public async clearShadowWorkspace(): Promise<string> {
    try {
      if (this.shadowPath && fs.existsSync(this.shadowPath)) {
        await fs.promises.rm(this.shadowPath, { recursive: true, force: true });
      }
      this.shadowInitialized = false;
      this.targetRoot = this.workspaceRoot; // Reset resolution to real workspace
      return `Sandbox changes reverted successfully.`;
    } catch (e: any) {
      return `Failed to revert sandbox: ${e.message}`;
    }
  }

  // ============================================================================
  // PHASE 2: CRYPTOGRAPHIC MERKLE TREE INDEXING
  // ============================================================================

  /**
   * Initializes the Merkle Tree by scanning the workspace and setting up a file watcher.
   * Runs asynchronously to avoid blocking the Extension Host.
   */
  private async initializeMerkleTree(): Promise<void> {
    if (this.isIndexing) return;
    this.isIndexing = true;

    try {
      await this.buildTree(this.workspaceRoot);
      this.setupFileWatcher();
    } catch (e) {
      console.error('Merkle Tree Build Error:', e);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Recursively builds the Merkle tree. Excludes massive/irrelevant directories.
   */
  private async buildTree(dirPath: string): Promise<string> {
    const ignoreList = ['.git', 'node_modules', '.exovon-shadow', 'dist', 'build', '.next'];
    const basename = path.basename(dirPath);
    if (ignoreList.includes(basename)) return '';

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      let combinedHashes = '';

      // Sort entries to ensure deterministic hashing
      const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of sortedEntries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const dirHash = await this.buildTree(fullPath);
          if (dirHash) combinedHashes += dirHash;
        } else if (entry.isFile()) {
          const fileHash = this.computeFileHash(fullPath);
          if (fileHash) {
            this.fileHashes.set(fullPath, fileHash);
            combinedHashes += fileHash;
          }
        }
      }

      const dirHash = crypto.createHash('sha256').update(combinedHashes).digest('hex');
      this.dirHashes.set(dirPath, dirHash);
      return dirHash;
    } catch (e) {
      return ''; // Gracefully ignore unreadable dirs
    }
  }

  private computeFileHash(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Sets up an incremental VS Code file watcher to update hashes without full rescans.
   */
  private setupFileWatcher() {
    if (this.fsWatcher) {
      this.fsWatcher.dispose();
    }

    this.fsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.workspaceRoot, '**/*'));

    const updateFile = async (uri: vscode.Uri) => {
      if (this.shouldIgnore(uri.fsPath)) return;
      const hash = this.computeFileHash(uri.fsPath);
      if (hash) {
        this.fileHashes.set(uri.fsPath, hash);
        await this.propagateHashUpdate(path.dirname(uri.fsPath));
      }
    };

    const deleteFile = async (uri: vscode.Uri) => {
      if (this.shouldIgnore(uri.fsPath)) return;
      this.fileHashes.delete(uri.fsPath);
      await this.propagateHashUpdate(path.dirname(uri.fsPath));
    };

    this.fsWatcher.onDidChange(updateFile);
    this.fsWatcher.onDidCreate(updateFile);
    this.fsWatcher.onDidDelete(deleteFile);
  }

  private shouldIgnore(filePath: string): boolean {
    const ignoreList = ['/.git/', '/node_modules/', '/.exovon-shadow/', '/dist/', '/build/', '/.next/'];
    return ignoreList.some(ignore => filePath.includes(ignore));
  }

  /**
   * Recalculates the directory hash and propagates it up to the root.
   */
  private async propagateHashUpdate(dirPath: string): Promise<void> {
    if (!dirPath.startsWith(this.workspaceRoot)) return;
    
    await this.buildTree(dirPath); // Re-evaluate this specific directory

    const parentDir = path.dirname(dirPath);
    if (parentDir.length >= this.workspaceRoot.length) {
      await this.propagateHashUpdate(parentDir);
    }
  }

  /**
   * Exposed Tool for Agent: Get the O(1) Merkle root hash of the workspace.
   */
  public async getWorkspaceHash(): Promise<string> {
    if (this.isIndexing) {
      return 'Status: Indexing in progress. Hash unavailable until complete.';
    }
    const rootHash = this.dirHashes.get(this.workspaceRoot);
    return rootHash ? `Workspace Root Merkle Hash: ${rootHash}` : 'Error: Workspace hash not found.';
  }

  // ============================================================================
  // END PHASE 2
  // ============================================================================

  /**
   * Lazily copies a file from real workspace into the shadow on first write.
   * This is the core of the Copy-on-Write optimization.
   */
  private async ensureShadowFile(relativePath: string): Promise<void> {
    if (!this.shadowInitialized) { return; }

    const shadowFilePath = path.resolve(this.shadowPath, relativePath);
    const realFilePath = path.resolve(this.workspaceRoot, relativePath);

    // Already in shadow — no copy needed
    if (fs.existsSync(shadowFilePath)) { return; }

    // Ensure parent directories exist in shadow
    const shadowDir = path.dirname(shadowFilePath);
    if (!fs.existsSync(shadowDir)) {
      fs.mkdirSync(shadowDir, { recursive: true });
    }

    // Copy from real workspace if the source exists
    if (fs.existsSync(realFilePath)) {
      await fs.promises.copyFile(realFilePath, shadowFilePath);
    }
  }

  /**
   * Resolves a relative path, using Copy-on-Write logic:
   * - For reads: prefer shadow if it exists, otherwise fall through to real workspace
   * - For writes: always resolve to shadow (ensureShadowFile must be called first)
   */
  private resolveReadPath(relativePath: string): string {
    if (this.shadowInitialized) {
      const shadowFile = path.resolve(this.shadowPath, relativePath);
      if (fs.existsSync(shadowFile)) {
        // Safety check
        if (!shadowFile.startsWith(this.shadowPath)) {
          throw new Error(`Access Denied: Path "${relativePath}" escapes the sandbox root.`);
        }
        return shadowFile;
      }
    }
    // Fall through to real workspace for reads
    const realPath = path.resolve(this.workspaceRoot, relativePath);
    if (!realPath.startsWith(this.workspaceRoot)) {
      throw new Error(`Access Denied: Path "${relativePath}" is outside the workspace root.`);
    }
    return realPath;
  }

  private resolveWritePath(relativePath: string): string {
    if (this.shadowInitialized) {
      const shadowFile = path.resolve(this.shadowPath, relativePath);
      if (!shadowFile.startsWith(this.shadowPath)) {
        throw new Error(`Access Denied: Path "${relativePath}" escapes the sandbox root.`);
      }
      return shadowFile;
    }
    const realPath = path.resolve(this.workspaceRoot, relativePath);
    if (!realPath.startsWith(this.workspaceRoot)) {
      throw new Error(`Access Denied: Path "${relativePath}" is outside the workspace root.`);
    }
    return realPath;
  }

  /**
   * List directory contents
   */
  public async listDir(relativePath: string): Promise<string> {
    try {
      const fullPath = this.resolveReadPath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      const files = await vscode.workspace.fs.readDirectory(uri);
      
      const fileList = files.map(([name, type]) => {
        const isDir = type === vscode.FileType.Directory;
        return { name, isDir, type: isDir ? 'directory' : 'file' };
      });

      return JSON.stringify(fileList, null, 2);
    } catch (error: any) {
      return `Error listing directory: ${error.message}`;
    }
  }

  /**
   * View the contents of a file (supports line ranges).
   * Reads from shadow if file exists there, otherwise reads from real workspace.
   */
  public async viewFile(relativePath: string, startLine?: number, endLine?: number): Promise<string> {
    try {
      const fullPath = this.resolveReadPath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      const contentBuffer = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(contentBuffer);

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = startLine ? Math.max(1, startLine) - 1 : 0;
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (error: any) {
      return `Error viewing file: ${error.message}`;
    }
  }

  /**
   * Apply a robust line-range replacement to a file.
   * Uses Copy-on-Write: lazily copies the file into shadow before writing.
   */
  public async multiReplaceFileContent(relativePath: string, startLine: number, endLine: number, replacementContent: string): Promise<string> {
    try {
      // CoW: ensure file exists in shadow before modifying
      await this.ensureShadowFile(relativePath);

      const fullPath = this.resolveWritePath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      const contentBuffer = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(contentBuffer);
      const lines = content.split('\n');

      const start = Math.max(1, startLine) - 1;
      const end = Math.min(lines.length, endLine);

      if (start > end || start >= lines.length) {
        return `Error: Invalid line range specified (${startLine} - ${endLine}). File only has ${lines.length} lines.`;
      }

      lines.splice(start, end - start, replacementContent);
      
      const updatedContent = lines.join('\n');
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));

      return `Successfully modified lines ${startLine}-${endLine} of file: "${relativePath}"`;
    } catch (error: any) {
      return `Error modifying file: ${error.message}`;
    }
  }

  /**
   * Apply a single string replacement to a file (legacy fallback).
   * Uses Copy-on-Write.
   */
  public async replaceFileContent(relativePath: string, targetContent: string, replacementContent: string): Promise<string> {
    try {
      // CoW: ensure file exists in shadow before modifying
      await this.ensureShadowFile(relativePath);

      const fullPath = this.resolveWritePath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      const contentBuffer = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(contentBuffer);

      if (!content.includes(targetContent)) {
        return `Error: Target content was not found in the file. Exact match required including whitespace/newlines.`;
      }

      const occurrences = content.split(targetContent).length - 1;
      if (occurrences > 1) {
        return `Error: Target content is not unique. Found ${occurrences} occurrences in the file. Please specify a unique block or line range.`;
      }

      const updatedContent = content.replace(targetContent, replacementContent);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));

      return `Successfully modified file: "${relativePath}"`;
    } catch (error: any) {
      return `Error modifying file: ${error.message}`;
    }
  }

  /**
   * Phase 3: Speculative Edits (Fast Apply)
   * Replaces a specific block of code using a deterministic fuzzy-matching algorithm.
   * Tolerates minor whitespace and indentation drift to prevent patch failures.
   */
  public async applyPatch(relativePath: string, searchBlock: string, replaceBlock: string): Promise<string> {
    try {
      await this.ensureShadowFile(relativePath);

      const fullPath = this.resolveWritePath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      const contentBuffer = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(contentBuffer);

      const fileLines = content.split('\n');
      const searchLines = searchBlock.split('\n');

      if (searchLines.length === 0 || (searchLines.length === 1 && searchLines[0].trim() === '')) {
         return 'Error: Search block is empty.';
      }

      // Fuzzy matching: ignore leading/trailing whitespace and normalize CR/LF
      const normalize = (line: string) => line.trim().replace(/\r/g, '');
      const normalizedSearch = searchLines.map(normalize).filter(l => l.length > 0 || searchLines.length === 1);

      let matchStartIndex = -1;
      let matchEndIndex = -1;
      let matchCount = 0;

      for (let i = 0; i <= fileLines.length - normalizedSearch.length; i++) {
        let isMatch = true;
        let fileOffset = 0;
        let searchOffset = 0;

        while (searchOffset < normalizedSearch.length && i + fileOffset < fileLines.length) {
          const sLine = normalizedSearch[searchOffset];
          const fLine = normalize(fileLines[i + fileOffset]);

          if (fLine === '') {
            // Skip empty lines in the file during fuzzy match
            fileOffset++;
            continue;
          }

          if (sLine !== fLine) {
            isMatch = false;
            break;
          }

          searchOffset++;
          fileOffset++;
        }

        if (isMatch && searchOffset === normalizedSearch.length) {
          matchCount++;
          matchStartIndex = i;
          matchEndIndex = i + fileOffset - 1; // inclusive
        }
      }

      if (matchCount === 0) {
        // Fallback: Try strict exact substring match if fuzzy failed (sometimes LLM outputs exact spacing but missing empty lines)
        const exactMatchIndex = content.indexOf(searchBlock);
        if (exactMatchIndex !== -1) {
           const before = content.slice(0, exactMatchIndex);
           const after = content.slice(exactMatchIndex + searchBlock.length);
           const updated = before + replaceBlock + after;
           await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
           return `Successfully applied patch (exact fallback) to: "${relativePath}"`;
        }
        return `Error: Could not locate the SEARCH block in the file. Ensure you provide enough unique context lines.`;
      }

      if (matchCount > 1) {
        return `Error: The SEARCH block is not unique. Found ${matchCount} matches. Please include more surrounding context in your SEARCH block.`;
      }

      // We have exactly 1 fuzzy match. Replace the lines.
      const beforeLines = fileLines.slice(0, matchStartIndex);
      const afterLines = fileLines.slice(matchEndIndex + 1);
      
      const updatedLines = [...beforeLines, replaceBlock, ...afterLines];
      const updatedContent = updatedLines.join('\n');
      
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updatedContent));

      return `Successfully applied patch to: "${relativePath}"`;
    } catch (error: any) {
      return `Error applying patch: ${error.message}`;
    }
  }

  /**
   * Phase 4: AST Semantic Search
   * Replaces traditional keyword grep for TS/JS files by returning full semantic blocks (classes, methods).
   */
  public async semanticSearch(query: string, includePattern: string = '**/*'): Promise<string> {
    try {
      const results: Array<{ file: string; type: string; name: string; matchLines: string }> = [];
      const excludePattern = '**/node_modules/**,**/dist/**,**/.git/**,**/out/**,**/.exovon-shadow/**';
      
      const files = await vscode.workspace.findFiles(includePattern, excludePattern, 1000);
      
      for (const file of files) {
        const ext = path.extname(file.fsPath).toLowerCase();
        
        // Fast pre-filter: does the file even contain the query?
        const contentBuffer = await vscode.workspace.fs.readFile(file);
        const content = new TextDecoder('utf-8').decode(contentBuffer);
        
        if (!content.toLowerCase().includes(query.toLowerCase())) {
          continue;
        }

        const relativeFile = path.relative(this.workspaceRoot, file.fsPath);

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          // Use AST Chunking
          try {
            const chunks = ASTChunker.extractChunks(file.fsPath, content);
            for (const chunk of chunks) {
              if (chunk.name.toLowerCase().includes(query.toLowerCase()) || chunk.content.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  file: relativeFile,
                  type: chunk.type,
                  name: chunk.name,
                  matchLines: chunk.content
                });
                if (results.length >= 10) break; // Return top 10 full AST blocks to prevent context overflow
              }
            }
          } catch (e) {
            // Ignore AST errors and fallback
          }
        }
        
        if (results.length >= 10) break;
      }
      
      if (results.length > 0) {
        return JSON.stringify(results.slice(0, 10), null, 2);
      }
      
      // Fallback to standard grepSearch if no AST matches or non-JS files
      return await this.grepSearch(query, includePattern);
      
    } catch (error: any) {
      return `Error during semantic search: ${error.message}`;
    }
  }

  /**
   * Optimized search using child_process ripgrep (bundled with VS Code).
   * Falls back to manual file-read if rg is not available.
   */
  public async grepSearch(query: string, includePattern: string = '**/*'): Promise<string> {
    try {
      if (!this.workspaceRoot) {
        return 'Error: No open workspace root found.';
      }

      const results: Array<{ file: string; line: number; content: string }> = [];

      // Try native ripgrep first (bundled with VS Code)
      try {
        const { execFileSync } = require('child_process');
        const rgPath = (vscode as any).env?.ripgrepPath || 'rg';
        const rgArgs = [
          '--json',
          '--max-count', '50',
          '--case-sensitive=false',
          '--glob', '!node_modules',
          '--glob', '!.git',
          '--glob', '!dist',
          '--glob', '!out',
          '--glob', '!.exovon-shadow',
          query,
          this.workspaceRoot
        ];

        const output = execFileSync(rgPath, rgArgs, {
          timeout: 10000,
          maxBuffer: 1024 * 256,
          encoding: 'utf-8'
        });

        for (const line of output.split('\n')) {
          if (!line.trim()) { continue; }
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match' && parsed.data) {
              const filePath = path.relative(this.workspaceRoot, parsed.data.path.text);
              results.push({
                file: filePath,
                line: parsed.data.line_number,
                content: parsed.data.lines.text.trim()
              });
            }
          } catch (_e) {
            // Skip malformed JSON lines
          }
          if (results.length >= 50) { break; }
        }
      } catch (_rgError) {
        // Ripgrep not available — fallback to manual file search (slower but always works)
        const excludePattern = '**/node_modules/**,**/dist/**,**/.git/**,**/out/**,**/.exovon-shadow/**';
        const files = await vscode.workspace.findFiles(includePattern, excludePattern, 500);

        for (const file of files) {
          const relativeFile = path.relative(this.workspaceRoot, file.fsPath);
          const contentBuffer = await vscode.workspace.fs.readFile(file);
          const content = new TextDecoder('utf-8').decode(contentBuffer);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              results.push({
                file: relativeFile,
                line: i + 1,
                content: lines[i].trim()
              });
            }
          }

          if (results.length >= 50) { break; }
        }
      }

      if (results.length === 0) {
        return `No matches found for query: "${query}"`;
      }

      return JSON.stringify(results.slice(0, 50), null, 2);
    } catch (error: any) {
      return `Error during search: ${error.message}`;
    }
  }

  /**
   * Create a new file in the workspace. Uses Copy-on-Write.
   */
  public async createFile(relativePath: string, content: string): Promise<string> {
    try {
      const fullPath = this.resolveWritePath(relativePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const uri = vscode.Uri.file(fullPath);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      return `Successfully created new file: "${relativePath}"`;
    } catch (error: any) {
      return `Error creating file: ${error.message}`;
    }
  }

  /**
   * Delete a file in the workspace
   */
  public async deleteFile(relativePath: string): Promise<string> {
    try {
      const fullPath = this.resolveWritePath(relativePath);
      const uri = vscode.Uri.file(fullPath);
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      return `Successfully deleted file: "${relativePath}"`;
    } catch (error: any) {
      return `Error deleting file: ${error.message}`;
    }
  }

  public async commitShadowFile(relativePath: string): Promise<string> {
    try {
      const shadowFilePath = path.resolve(this.shadowPath, relativePath);
      const realFilePath = path.resolve(this.workspaceRoot, relativePath);
      
      if (!fs.existsSync(shadowFilePath)) {
        return `Error: Shadow file "${relativePath}" does not exist.`;
      }
      
      const realDir = path.dirname(realFilePath);
      if (!fs.existsSync(realDir)) {
        fs.mkdirSync(realDir, { recursive: true });
      }
      
      await fs.promises.copyFile(shadowFilePath, realFilePath);
      return `Successfully committed "${relativePath}" to active workspace.`;
    } catch (e: any) {
      return `Error committing file: ${e.message}`;
    }
  }

  public async revertShadowFile(relativePath: string): Promise<string> {
    try {
      const shadowFilePath = path.resolve(this.shadowPath, relativePath);
      const realFilePath = path.resolve(this.workspaceRoot, relativePath);
      
      if (fs.existsSync(realFilePath)) {
        await fs.promises.copyFile(realFilePath, shadowFilePath);
        return `Reverted sandbox version of "${relativePath}" to match original workspace.`;
      } else {
        if (fs.existsSync(shadowFilePath)) {
          await fs.promises.unlink(shadowFilePath);
        }
        return `Removed sandbox draft of "${relativePath}".`;
      }
    } catch (e: any) {
      return `Error reverting file: ${e.message}`;
    }
  }

  /**
   * Cleanup shadow workspace on extension deactivation.
   */
  public async cleanupShadow(): Promise<void> {
    if (this.shadowPath && fs.existsSync(this.shadowPath)) {
      try {
        await fs.promises.rm(this.shadowPath, { recursive: true, force: true });
      } catch (e) {
        // Best effort cleanup
      }
    }
  }
}
