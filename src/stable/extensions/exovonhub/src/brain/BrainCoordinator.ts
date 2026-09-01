import * as vscode from 'vscode';
import type Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import os from 'os';
import * as crypto from 'crypto';
import { GraphIndexer } from './GraphIndexer';
import { IBrainCoordinator, GovernorStatus } from '../types/shared';

function getBetterSqlite3(): any {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
}

function getSqliteVec(): any {
  try {
    return require('sqlite-vec');
  } catch {
    return null;
  }
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export class BrainCoordinator implements IBrainCoordinator {
  public db!: Database.Database;
  public dbPath: string;
  public lastError: string | null = null;
  public status: 'idle' | 'indexing' | 'ready' | 'failed' = 'idle';
  private workers: Worker[] = [];
  private workerRoundRobin = 0;
  private pendingEmbeddings: Map<string, { resolve: (val: number[] | null) => void, reject: (err: any) => void, timer?: NodeJS.Timeout }> = new Map();
  public isSyncing = false;
  private syncDebounceTimer: NodeJS.Timeout | null = null;
  private dirtyFiles: Map<string, string> = new Map();
  private downloadProgresses: Map<string, { report: (val: any) => void, resolve: () => void }> = new Map();
  private isWorkerReady = false;
  public currentBranch = 'main';
  public worldVersion = 0;
  private workerRespawnCount = 0;
  private contextCache = new Map<string, { result: string, version: number }>();

  constructor(
    private context: vscode.ExtensionContext,
    private onSyncStateChange?: (isSyncing: boolean) => void
  ) {
    const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;
    this.dbPath = path.join(storagePath, '.exovon_brain.db');
    
    const SqliteDatabase = getBetterSqlite3();
    const sqliteVec = getSqliteVec();

    if (SqliteDatabase) {
      try {
        if (!fs.existsSync(storagePath)) {
          fs.mkdirSync(storagePath, { recursive: true });
        }

        this.db = new SqliteDatabase(this.dbPath);
        if (sqliteVec?.load) {
          sqliteVec.load(this.db);
        }

        this.db.pragma?.('journal_mode = WAL');
        this.db.pragma?.('busy_timeout = 5000');
        this.status = 'ready';
      } catch (err: any) {
        this.lastError = err?.message || String(err);
        this.status = 'failed';
        console.error('Brain initialization failed:', err);
        try {
          this.db = new SqliteDatabase(':memory:');
        } catch {
          this.db = null as any;
        }
      }
    } else {
      console.warn('Native better-sqlite3 not available; running in lightweight brain mode.');
      this.status = 'idle';
      this.db = null as any;
    }

    if (this.db && typeof this.db.exec === 'function') {
      try {
        const CURRENT_ENGINE_VERSION = '1.0.0';
        this.db.exec(`CREATE TABLE IF NOT EXISTS brain_metadata (key TEXT PRIMARY KEY, value TEXT);`);
        const dbVersion = this.db.prepare('SELECT value FROM brain_metadata WHERE key = ?').get('engine_version') as { value: string } | undefined;
        
        if (!dbVersion || dbVersion.value !== CURRENT_ENGINE_VERSION) {
           console.log('🔄 Exovon Engine version changed or corrupted. Wiping cache for clean rebuild...');
           this.db.exec(`
             DROP TABLE IF EXISTS symbols;
             DROP TABLE IF EXISTS edges;
             DROP TABLE IF EXISTS indexed_files;
             DROP TABLE IF EXISTS vec_symbols;
           `);
           this.db.prepare('INSERT OR REPLACE INTO brain_metadata (key, value) VALUES (?, ?)').run('engine_version', CURRENT_ENGINE_VERSION);
        }

        // Setup Schema
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS indexed_files (
            relative_path TEXT PRIMARY KEY,
            mtime INTEGER,
            size INTEGER
          );
          CREATE TABLE IF NOT EXISTS symbols (
            id TEXT PRIMARY KEY,
            hash_id INTEGER,
            file_path TEXT,
            name TEXT,
            kind TEXT,
            line_start INTEGER,
            line_end INTEGER,
            content TEXT
          );
          CREATE TABLE IF NOT EXISTS edges (
            source_id TEXT,
            target_id TEXT,
            relation_type TEXT,
            file_path TEXT,
            PRIMARY KEY(source_id, target_id, relation_type)
          );
          CREATE TABLE IF NOT EXISTS commits (
            hash TEXT,
            branch_name TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            symbol_ids JSON
          );
          CREATE TABLE IF NOT EXISTS chat_threads (
            id TEXT PRIMARY KEY,
            title TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            workspace_path TEXT
          );
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            sender TEXT,
            text TEXT,
            reasoning TEXT,
            timestamp TEXT,
            plan_steps JSON,
            tool_calls JSON,
            proposed_files JSON,
            FOREIGN KEY(thread_id) REFERENCES chat_threads(id)
          );
        `);

        // Migration for missing columns
        try {
          this.db.exec('ALTER TABLE symbols ADD COLUMN hash_id INTEGER');
        } catch (e) {}
        try {
          this.db.exec('ALTER TABLE chat_threads ADD COLUMN workspace_path TEXT');
        } catch (e) {}
        try {
          this.db.exec('ALTER TABLE edges ADD COLUMN file_path TEXT');
        } catch (e) {}
        try {
          this.db.exec('ALTER TABLE chat_messages ADD COLUMN meta JSON');
        } catch (e) {}

        // Indexes
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
          CREATE INDEX IF NOT EXISTS idx_edges_file ON edges(file_path);
          CREATE INDEX IF NOT EXISTS idx_chat_threads_workspace ON chat_threads(workspace_path);
        `);

        try {
          this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_symbols USING vec0(embedding float[384])`);
        } catch (e) {
          // vec0 might already exist
        }
      } catch (schemaErr) {
        console.warn('Schema setup error:', schemaErr);
      }
    }

    this.initializeWorkers();
  }

  private initializeWorkers() {
    const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
    const cpuCount = os.cpus().length;
    
    let workerCount = 1;
    if (totalMemGB > 16 && cpuCount > 8) {
      workerCount = 2; // Cap at 2 to leave CPU headroom for VS Codium and Language Servers
    } else if (totalMemGB < 4) {
      workerCount = 0; // Graph only mode
    }

    const workerPath = path.join(__dirname, 'VectorWorker.js');
    
    for (let i = 0; i < workerCount; i++) {
      this.spawnWorker(workerPath);
    }
  }

  private spawnWorker(workerPath: string) {
    if (!fs.existsSync(workerPath)) {
        console.warn('VectorWorker.js not found, embeddings disabled.');
        return;
    }
    
    const worker = new Worker(workerPath);
    
    worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        this.isWorkerReady = true;
        this.workerRespawnCount = 0;
      } else if (msg.type === 'embed_result') {
        const pending = this.pendingEmbeddings.get(msg.id);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve(msg.embedding);
          this.pendingEmbeddings.delete(msg.id);
        }
      } else if (msg.type === 'embed_error') {
        const pending = this.pendingEmbeddings.get(msg.id);
        if (pending) {
          console.warn("Vector Worker Error:", msg.error);
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve(null);
          this.pendingEmbeddings.delete(msg.id);
        }
      } else if (msg.type === 'progress') {
        const info = msg.info;
        // Only track the main model weights file to prevent UI spam from multiple workers/files
        if (info.file && info.file.includes('model_quantized.onnx')) {
           if (info.status === 'initiate') {
             if (!this.downloadProgresses.has(info.file)) {
               this.downloadProgresses.set(info.file, { report: () => {}, resolve: () => {} }); // lock
               vscode.window.withProgress({
                 location: vscode.ProgressLocation.Notification,
                 title: `Downloading Exovon Semantic Engine: Core Weights`,
                 cancellable: false
               }, (progress) => {
                 return new Promise<void>((resolve) => {
                    this.downloadProgresses.set(info.file, { report: progress.report.bind(progress), resolve });
                 });
               });
             }
           } else if (info.status === 'progress') {
             const p = this.downloadProgresses.get(info.file);
             if (p) {
                const percentage = Math.round(info.progress || 0);
                p.report({ message: `${percentage}%` });
             }
           } else if (info.status === 'done') {
             const p = this.downloadProgresses.get(info.file);
             if (p) {
                p.resolve();
                this.downloadProgresses.delete(info.file);
             }
           }
        }
      } else if (msg.type === 'memory_exceeded') {
        // Worker is voluntarily dying, the 'exit' handler will spawn a new one to replace it
        worker.terminate();
      }
    });

    worker.on('error', (err) => {
      console.error('Vector Worker unhandled exception:', err);
    });

    worker.on('exit', () => {
      // Remove from pool
      this.workers = this.workers.filter(w => w !== worker);
      if ((worker as any).heartbeatInterval) {
        clearInterval((worker as any).heartbeatInterval);
      }
      
      this.workerRespawnCount++;
      if (this.workerRespawnCount >= 3) {
         console.warn('VectorWorker.js crashed 3 times. Vector embeddings disabled to prevent infinite loop. Please check telemetry logs.');
         this.isWorkerReady = false;
         return;
      }

      // Heartbeat watchdog handles restarting if needed, but we can do it here for crashes
      setTimeout(() => this.spawnWorker(workerPath), 1000);
    });

    // Heartbeat
    (worker as any).heartbeatInterval = setInterval(() => {
      worker.postMessage({ type: 'ping' });
    }, 10000);

    this.workers.push(worker);
  }

  private async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.isWorkerReady || this.workers.length === 0) { return null; }

    const worker = this.workers[this.workerRoundRobin];
    this.workerRoundRobin = (this.workerRoundRobin + 1) % this.workers.length;

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const pending: any = { resolve, reject };
      this.pendingEmbeddings.set(id, pending);
      worker.postMessage({ type: 'embed', text, id });
      
      // Timeout after 10s
      pending.timer = setTimeout(() => {
        if (this.pendingEmbeddings.has(id)) {
          this.pendingEmbeddings.delete(id);
          resolve(null); // Fail gracefully
        }
      }, 10000);
    });
  }

  private setSyncing(state: boolean) {
    if (this.isSyncing !== state) {
      this.isSyncing = state;
      this.onSyncStateChange?.(state);
    }
  }

  // Enqueue file for debounced indexing
  public indexFile(filePath: string, fileContent: string) {
    const relPath = vscode.workspace.asRelativePath(filePath, false);
    this.dirtyFiles.set(relPath, fileContent);
    
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.setSyncing(true);

    this.syncDebounceTimer = setTimeout(() => {
      this.flushDirtyQueue();
    }, 3000); // 3 second idle debounce
  }

  // Get Brain Stats & Health for UI
  public async getStats(): Promise<{ entities: number, sizeMB: number, status: string, lastError: string | null, dbPath: string }> {
    try {
      let sizeMB = 0;
      if (fs.existsSync(this.dbPath)) {
        const stat = await fs.promises.stat(this.dbPath);
        sizeMB = stat.size / (1024 * 1024);
      }
      
      const row = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number } | undefined;
      const entities = row?.c ?? 0;
      return {
        entities,
        sizeMB: Number(sizeMB.toFixed(2)),
        status: this.status,
        lastError: this.lastError,
        dbPath: this.dbPath
      };
    } catch(e: any) {
      this.lastError = e?.message || String(e);
      this.status = 'failed';
      return { entities: 0, sizeMB: 0, status: 'failed', lastError: this.lastError, dbPath: this.dbPath };
    }
  }

  // Wipe and completely rebuild the Brain database
  public async rebuildBrain(): Promise<void> {
    try {
      this.setSyncing(true);
      this.status = 'indexing';
      this.lastError = null;
      this.db.exec(`
        DROP TABLE IF EXISTS symbols;
        DROP TABLE IF EXISTS edges;
        DROP TABLE IF EXISTS indexed_files;
        DROP TABLE IF EXISTS vec_symbols;
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS indexed_files (
          relative_path TEXT PRIMARY KEY,
          mtime INTEGER,
          size INTEGER
        );
        CREATE TABLE IF NOT EXISTS symbols (
          id TEXT PRIMARY KEY,
          hash_id INTEGER,
          file_path TEXT,
          name TEXT,
          kind TEXT,
          line_start INTEGER,
          line_end INTEGER,
          content TEXT
        );
        CREATE TABLE IF NOT EXISTS edges (
          source_id TEXT,
          target_id TEXT,
          relation_type TEXT,
          file_path TEXT,
          PRIMARY KEY(source_id, target_id, relation_type)
        );
      `);
      try {
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_symbols USING vec0(embedding float[384])`);
      } catch (e) {}
      await this.seedWorkspace();
      this.status = 'ready';
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      this.status = 'failed';
      throw err;
    } finally {
      this.setSyncing(false);
    }
  }

  // Seed the workspace on startup using a gitignore-aware Delta Cache sequence
  public async seedWorkspace() {
    console.log('🌱 Delta Cache Engine: Synchronizing Exovon Brain...');
    
    // 1. Dynamic Privacy Engine (Phase 1): Parse .gitignore and .exovonignore
    const ignorePatterns: RegExp[] = [];
    try {
      const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!rootUri) return;
      const gitignoreUri = vscode.Uri.joinPath(rootUri, '.gitignore');
      const exovonignoreUri = vscode.Uri.joinPath(rootUri, '.exovonignore');
      
      const parseIgnoreFile = async (uri: vscode.Uri) => {
         try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(content);
            const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            for (const line of lines) {
               let regexStr = line
                  .replace(/\./g, '\\.')
                  .replace(/\*\*/g, '.*')
                  .replace(/\*/g, '[^/]*')
                  .replace(/\?/g, '.');
               if (regexStr.startsWith('/')) { regexStr = '^' + regexStr.slice(1); }
               else { regexStr = '(^|/)' + regexStr; }
               ignorePatterns.push(new RegExp(regexStr));
            }
         } catch(e) {}
      };
      
      await parseIgnoreFile(gitignoreUri);
      await parseIgnoreFile(exovonignoreUri);
    } catch (e) {}
    
    // 2. Live Scan: Gather all currently valid files
    const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,build,out,coverage,.next,.exovon-shadow,*.png,*.jpg,*.jpeg,*.gif,*.webp,*.ico,*.svg,*.pdf,*.mp4,*.zip,*.tar.gz,*.wasm,*.ttf,*.woff,*.woff2}/**');
    
    // Map live files to a quick lookup and grab mtime/size
    const liveFiles = new Map<string, { uri: vscode.Uri, mtime: number, size: number }>();
    for (const f of files) {
       const relPath = vscode.workspace.asRelativePath(f.fsPath, false);
       
       // Explicitly filter out dynamic ignore patterns
       if (ignorePatterns.some(p => p.test(relPath))) { continue; }

       try {
         const stat = await vscode.workspace.fs.stat(f);
         liveFiles.set(relPath, { uri: f, mtime: stat.mtime, size: stat.size });
       } catch (e) {}
    }

    // 2. Database Diff: Fetch all previously cached files
    const cachedFiles = this.db.prepare('SELECT relative_path, mtime, size FROM indexed_files').all() as any[];
    
    const toDelete: string[] = [];
    const toIndex: string[] = [];

    for (const cached of cachedFiles) {
       const live = liveFiles.get(cached.relative_path);
       if (!live) {
          // File was deleted on disk OR newly added to .gitignore (Problem 2, 6)
          toDelete.push(cached.relative_path);
       } else if (live.mtime !== cached.mtime || live.size !== cached.size) {
          // File was modified (Problem 9)
          toIndex.push(cached.relative_path);
          liveFiles.delete(cached.relative_path); // Handled
       } else {
          // Cache hit! Skip completely.
          liveFiles.delete(cached.relative_path);
       }
    }

    // Anything remaining in liveFiles is brand new
    for (const relPath of liveFiles.keys()) {
       toIndex.push(relPath);
    }

    console.log(`📊 Cache Summary: ${toDelete.length} orphaned files to delete, ${toIndex.length} modified/new files to index.`);

    // 3. Garbage Collection: Sweep orphaned files transactionally (Problem 2 & 6)
    if (toDelete.length > 0) {
       const gcTx = this.db.transaction(() => {
          for (const relPath of toDelete) {
             const oldSymbols = this.db.prepare('SELECT hash_id FROM symbols WHERE file_path = ?').all(relPath) as any[];
             for (const oldSym of oldSymbols) {
                if (oldSym.hash_id) {
                    this.db.prepare('DELETE FROM vec_symbols WHERE rowid = ?').run(oldSym.hash_id);
                }
             }
             this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(relPath);
             this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(relPath);
             this.db.prepare('DELETE FROM indexed_files WHERE relative_path = ?').run(relPath);
          }
       });
       gcTx();
    }

    // 4. Yielding Queue: Push valid files to be parsed
    const BATCH_SIZE = 50;
    let processed = 0;

    const processBatch = async () => {
      const batch = toIndex.slice(processed, processed + BATCH_SIZE);
      if (batch.length === 0) {
        console.log(`✅ Delta Cache sync complete.`);
        return;
      }

      for (const relPath of batch) {
        try {
          const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (!rootUri) continue;
          const uri = vscode.Uri.joinPath(rootUri, relPath);
          const contentBuffer = await vscode.workspace.fs.readFile(uri);
          
          // Auto-Detect Binary vs Text (VS Code / Git Heuristic)
          let isBinary = false;
          const scanLength = Math.min(contentBuffer.length, 1024);
          for (let i = 0; i < scanLength; i++) {
             if (contentBuffer[i] === 0) {
                 isBinary = true;
                 break;
             }
          }
          
          if (isBinary) { continue; } // Skip binaries instantly
          
          const text = new TextDecoder('utf-8').decode(contentBuffer);
          
          // Smart heuristic to skip massive generated/minified files but allow monolithic source code files
          if (contentBuffer.length > 2 * 1024 * 1024) { continue; } // Hard limit 2MB
          
          if (contentBuffer.length > 100 * 1024) {
             const lines = text.split('\n');
             const avgLineLength = lines.length > 0 ? text.length / lines.length : 0;
             if (avgLineLength > 300) { continue; } // Likely a minified JS/JSON dump or dataset
          }

          this.indexFile(uri.fsPath, text);
        } catch (e) {
          // Ignore unreadable files
        }
      }

      processed += BATCH_SIZE;
      setTimeout(processBatch, 0);
    };

    processBatch();
  }

  private async flushDirtyQueue() {
    if (this.dirtyFiles.size === 0) {
      this.setSyncing(false);
      return;
    }

    // Capture current snapshot of dirty files (keys are already relative paths)
    const filesToProcess = Array.from(this.dirtyFiles.entries()).map(([relPath, content]) => ({ relPath, content }));
    this.dirtyFiles.clear();

    const insertSymbol = this.db.prepare('INSERT OR REPLACE INTO symbols (id, hash_id, file_path, name, kind, line_start, line_end, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertEdge = this.db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, file_path) VALUES (?, ?, ?, ?)');
    const insertVec = this.db.prepare('INSERT INTO vec_symbols(rowid, embedding) VALUES(?, ?)');
    const insertFileMeta = this.db.prepare('INSERT OR REPLACE INTO indexed_files (relative_path, mtime, size) VALUES (?, ?, ?)');

    const itemsToInsert: any[] = [];
    const filesMetaToInsert: any[] = [];
    const pLimit = 4; // concurrency limit
    let running = 0;
    
    // 1. Gather all data including async embeddings with concurrency control
    // Process in smaller chunks to avoid event loop starvation and massive promise arrays
    const CHUNK_SIZE = 10;
    
    for (let i = 0; i < filesToProcess.length; i += CHUNK_SIZE) {
      const chunk = filesToProcess.slice(i, i + CHUNK_SIZE);
      const promises: Promise<void>[] = [];
      
      for (const file of chunk) {
        try {
          // Determine absolute path for physical disk ops, but store relative
          const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (!rootUri) continue;
          const absPath = vscode.Uri.joinPath(rootUri, file.relPath).fsPath;
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
          filesMetaToInsert.push({ relPath: file.relPath, mtime: stat.mtime, size: stat.size });
          
          const { symbols, edges } = await GraphIndexer.parseFile(absPath, file.content);
          
          // Yield main thread after each heavy parsing operation to keep UI responsive
          await new Promise(r => setTimeout(r, 5));
          
          for (const sym of symbols) {
            const rowId = fnv1a32(sym.id); // Robust deterministic ID
            const lines = file.content.split('\n');
            const content = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
            
            const task = async () => {
               while(running >= pLimit) { await new Promise(r => setTimeout(r, 10)); }
               running++;
               try {
                 const embedding = await this.getEmbedding(content);
                 // Rewrite sym file paths to relative for storage
                 const relativeSymPath = vscode.workspace.asRelativePath(sym.filePath, false);
                 itemsToInsert.push({ file, sym: { ...sym, filePath: relativeSymPath }, rowId, content, embedding, edges });
               } finally {
                 running--;
               }
            };
            promises.push(task());
          }
        } catch (e) {
          console.error(`Failed to index file ${file.relPath}:`, e);
        }
      }
      await Promise.all(promises);
      
      // Yield to event loop to allow agent calls to sneak through
      await new Promise(r => setTimeout(r, 15));
    }

    // Reconcile graph edges (BM-3)
    // Create a map of names to their canonical symbol IDs
    const nameToId = new Map<string, string>();
    for (const item of itemsToInsert) {
       nameToId.set(item.sym.name, item.sym.id);
    }

    // 2. Execute synchronous SQLite transaction (Problem 10 - Atomic Commits)
    const transaction = this.db.transaction(() => {
      // Clear old entries for all processed files
      for (const file of filesToProcess) {
        const oldSymbols = this.db.prepare('SELECT hash_id FROM symbols WHERE file_path = ?').all(file.relPath) as any[];
        for (const oldSym of oldSymbols) {
           if (oldSym.hash_id) {
               this.db.prepare('DELETE FROM vec_symbols WHERE rowid = ?').run(oldSym.hash_id);
           }
        }
        this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(file.relPath);
        this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(file.relPath);
      }
      
      for (const meta of filesMetaToInsert) {
         insertFileMeta.run(meta.relPath, meta.mtime, meta.size);
      }

      for (const item of itemsToInsert) {
        insertSymbol.run(item.sym.id, item.rowId, item.sym.filePath, item.sym.name, item.sym.kind, item.sym.lineStart, item.sym.lineEnd, item.content);
        if (item.embedding) {
           insertVec.run(item.rowId, new Float32Array(item.embedding).buffer);
        }
        for (let edge of item.edges) {
          // Reconcile 'unresolved:name'
          let targetId = edge.targetId;
          if (targetId.startsWith('unresolved:')) {
             const targetName = targetId.split(':')[1];
             if (nameToId.has(targetName)) {
                targetId = nameToId.get(targetName)!;
             }
          }
          
          // Reconcile relative edge paths
          const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
          const relSourceId = edge.sourceId.replace(rootPath + path.sep, '');
          const relTargetId = targetId.replace(rootPath + path.sep, '');
          
          insertEdge.run(relSourceId, relTargetId, edge.relationType, item.sym.filePath);
        }
      }
    });

    try {
       transaction();
       this.worldVersion++;
    } catch (e) {
       console.error("Brain index transaction failed:", e);
    }
    
    // Check if more files trickled in during processing
    if (this.dirtyFiles.size === 0) {
      this.setSyncing(false);
    } else {
      this.flushDirtyQueue();
    }
  }

  // --- PHASE 4: BRAIN QUERY API ---

  public async impactAnalysis(entityName: string): Promise<any[]> {
     // Traverses the graph to find entities impacted by the target entity (max depth 3, capped at 200 items)
     const results: any[] = [];
     try {
       let currentNodes = this.db.prepare('SELECT id, name, file_path, content FROM symbols WHERE name = ? LIMIT 10').all(entityName) as any[];
       const visited = new Set<string>();
       
       for (let depth = 0; depth < 3; depth++) {
          if (currentNodes.length === 0 || results.length >= 200) { break; }
          const nextNodes = [];
          
          for (const node of currentNodes) {
             if (visited.has(node.id) || results.length >= 200) { continue; }
             visited.add(node.id);
             results.push(node);
             
             // Yield to event loop to keep UI smooth (Phase 2)
             await new Promise(r => setImmediate(r));
             
             // Find who calls this node
             const callers = this.db.prepare(`
               SELECT s.id, s.name, s.file_path, s.content 
               FROM edges e
               JOIN symbols s ON e.source_id = s.id
               WHERE e.target_id = ?
             `).all(node.id) as any[];
             
             nextNodes.push(...callers);
          }
          currentNodes = nextNodes;
       }
     } catch (e) {
       console.error('Impact analysis error:', e);
     }
     return results;
  }

  public async smartSearch(userQuery: string): Promise<any[]> {
    const results: any[] = [];
    try {
       // 1. Exact match fallback
       const words = userQuery.split(/[\W_]+/).filter(w => w.length > 3);
       if (words.length > 0) {
          const placeholders = words.map(() => 'name LIKE ?').join(' OR ');
          const likeArgs = words.map(w => `%${w}%`);
          const graphSymbols = this.db.prepare(`SELECT id, name, content, file_path FROM symbols WHERE ${placeholders} LIMIT 5`).all(...likeArgs) as any[];
          results.push(...graphSymbols);
       }
       
       // 2. Semantic hybrid
       const embedding = await this.getEmbedding(userQuery);
       if (embedding) {
          const search = this.db.prepare(`
            SELECT v.rowid, v.distance, s.id, s.content, s.name, s.file_path
            FROM vec_symbols v
            JOIN symbols s ON v.rowid = s.hash_id
            WHERE v.embedding MATCH ?
            ORDER BY v.distance
            LIMIT 10
          `).all(new Float32Array(embedding).buffer) as any[];
          
          for (const res of search) {
             if (!results.find(r => r.id === res.id)) {
                results.push(res);
             }
          }
       }
    } catch (e) {
       console.error('Smart search error:', e);
    }
    return results.slice(0, 10);
  }

  public recentChanges(sinceMs: number): any[] {
     try {
       const rows = this.db.prepare(`
         SELECT hash, timestamp, symbol_ids 
         FROM commits 
         WHERE branch_name = ? AND timestamp >= datetime('now', ?)
         ORDER BY timestamp DESC LIMIT 5
       `).all(this.currentBranch, `-${Math.round(sinceMs/1000)} seconds`) as any[];
       return rows;
     } catch(e) {
       return [];
     }
  }

  public async contextCard(query: string): Promise<string> {
    // Return cached result if world hasn't changed
    const cached = this.contextCache.get(query);
    if (cached && cached.version === this.worldVersion) {
       return cached.result;
    }
    
    // Generate context
    const impactPromise = this.impactAnalysis(query);
    const searchPromise = this.smartSearch(query);
    const recentPromise = this.recentChanges(86400000); // last 24h
    
    const [impact, search, recent] = await Promise.all([impactPromise, searchPromise, recentPromise]);
    
    const payload: any = {
       query: query,
       semanticMatches: search.map((res: any) => ({
          symbol: res.name,
          file: res.file_path,
          contentSnippet: res.content.substring(0, 500) // truncate for token limits
       })),
       impactAnalysis: impact.map((i: any) => i.name),
       recentCommits: recent.map((c: any) => ({
          hash: c.hash,
          timestamp: c.timestamp,
          symbols: c.symbol_ids
       }))
    };
    
    let context = JSON.stringify(payload, null, 2);
    
    // Evict cache if > 50
    while (this.contextCache.size > 50) {
       const firstKey = this.contextCache.keys().next().value;
       if (firstKey !== undefined) { this.contextCache.delete(firstKey); }
    }
    
    // Save to LRU cache
    this.contextCache.set(query, { result: context, version: this.worldVersion });
    
    return context;
  }

  public async forceFlushNow() {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    // Only force flush if it's a small change. Don't block the Agent for thousands of files!
    if (this.dirtyFiles.size > 0 && this.dirtyFiles.size <= 20) {
      console.log('BrainCoordinator: Force flushed dirty queue to disk before agent call.');
      await this.flushDirtyQueue();
    }
  }

  public getGraphForFile(filePath: string): any[] {
    const elements: any[] = [];
    try {
      // DB stores relative paths now, so convert incoming absolute path
      const relPath = vscode.workspace.asRelativePath(filePath, false);
      
      // Get all symbols in this file
      const symbols = this.db.prepare('SELECT id, name, kind FROM symbols WHERE file_path = ?').all(relPath) as any[];
      
      // Node Elements
      for (const sym of symbols) {
        elements.push({
          data: {
            id: sym.id,
            label: sym.name,
            type: sym.kind
          }
        });
      }

      // We only want edges where source or target is in this file
      const symbolIds = symbols.map(s => s.id);
      if (symbolIds.length > 0) {
        const edges = this.db.prepare(`
          SELECT source_id, target_id, relation_type 
          FROM edges 
          WHERE file_path = ?
        `).all(relPath) as any[];
        
        for (const edge of edges) {
          // If target is missing, add a phantom node for the unresolved target
          if (!elements.find(e => e.data.id === edge.target_id)) {
            elements.push({
              data: {
                id: edge.target_id,
                label: edge.target_id.split(':').pop(),
                type: 'function' // guess
              }
            });
          }
          
          elements.push({
            data: {
              id: `${edge.source_id}-${edge.target_id}`,
              source: edge.source_id,
              target: edge.target_id,
              type: edge.relation_type
            }
          });
        }
      }
    } catch (e) {
      console.error('getGraphForFile error:', e);
    }
    return elements;
  }

  public getGovernorStatus(): GovernorStatus {
    let nodeCount = 0;
    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
      nodeCount = result.count;
    } catch (e) {
      console.error(e);
    }
    
    // Get precise RSS memory footprint of the extension host process (which includes all worker_threads)
    const totalMem = os.totalmem();
    const allocatedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    
    return {
      cpuThreads: os.cpus().length,
      allocatedMb,
      totalMemMb: Math.round(totalMem / 1024 / 1024),
      nodeCount,
      engine: this.isWorkerReady ? 'sqlite-vec (Local Disk-Backed)' : 'Graph Only Mode (No Vector Embeddings)',
      pruningGuardrails: this.workers.length > 0 ? 'Active (5% Mem Cap)' : 'Offline'
    };
  }

  // --- CHAT PERSISTENCE METHODS ---
  public getChatThreads(): { id: string; title: string; updated_at: number; message_count?: number; preview?: string }[] {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      return this.db.prepare(`
        SELECT 
          ct.id, 
          ct.title, 
          ct.updated_at,
          (SELECT COUNT(*) FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome') as message_count,
          (SELECT text FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome' AND cm.text IS NOT NULL AND TRIM(cm.text) != '' ORDER BY cm.timestamp DESC, cm.id DESC LIMIT 1) as preview
        FROM chat_threads ct 
        WHERE ct.workspace_path = ? 
        ORDER BY ct.updated_at DESC
      `).all(workspaceRoot) as any[];
    } catch (e) {
      console.error('getChatThreads error:', e);
      return [];
    }
  }

  public getChatMessages(threadId: string): any[] {
    try {
      return this.db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY rowid ASC').all(threadId) as any[];
    } catch (e) {
      console.error('getChatMessages error:', e);
      return [];
    }
  }

  public createNewThread(): string {
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    try {
      this.db.prepare('INSERT INTO chat_threads (id, title, created_at, updated_at, workspace_path) VALUES (?, ?, ?, ?, ?)').run(
        threadId, 'New Chat', Date.now(), Date.now(), workspaceRoot
      );
    } catch (e) {
      console.error('createNewThread error:', e);
    }
    return threadId;
  }

  public renameChatThread(threadId: string, title: string): void {
    try {
      const trimmed = title.trim();
      if (!trimmed) return;
      this.db.prepare('UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?').run(
        trimmed, Date.now(), threadId
      );
    } catch (e) {
      console.error('renameChatThread error:', e);
    }
  }

  public deleteChatThread(threadId: string): void {
    try {
      this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(threadId);
      this.db.prepare('DELETE FROM chat_threads WHERE id = ?').run(threadId);
    } catch (e) {
      console.error('deleteChatThread error:', e);
    }
  }

  public clearAllChatThreads(): void {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const threads = this.db.prepare('SELECT id FROM chat_threads WHERE workspace_path = ?').all(workspaceRoot) as { id: string }[];
      for (const t of threads) {
        this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(t.id);
      }
      this.db.prepare('DELETE FROM chat_threads WHERE workspace_path = ?').run(workspaceRoot);
    } catch (e) {
      console.error('clearAllChatThreads error:', e);
    }
  }

  public saveChatMessage(threadId: string, message: any) {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO chat_messages 
        (id, thread_id, sender, text, reasoning, timestamp, plan_steps, tool_calls, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        threadId,
        message.sender,
        message.text,
        message.reasoning || null,
        message.timestamp,
        message.planSteps ? JSON.stringify(message.planSteps) : null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        JSON.stringify({
          startTime: message.startTime,
          endTime: message.endTime,
          isPlanReview: message.isPlanReview,
          planMarkdown: message.planMarkdown,
          isCommandApproval: message.isCommandApproval,
          isFileApproval: message.isFileApproval,
          fileChangeType: message.fileChangeType,
          commandToApprove: message.commandToApprove,
          filePathToApprove: message.filePathToApprove,
          approvalId: message.approvalId,
          timeline: message.timeline,
          images: message.images,
          metrics: message.metrics,
          checkpointId: message.checkpointId,
          checkpoint: message.checkpoint,
          promptTokens: message.promptTokens,
          promptProcessed: message.promptProcessed
        })
      );
      
      // Update thread title and timestamp
      let cleanText = (message.text || '')
        .replace(/^\[IDE WORKSPACE ACTIVE CONTEXT\][\s\S]*?\[\/IDE WORKSPACE ACTIVE CONTEXT\]/, '')
        .replace(/^Developer Action Request:\s*"?/, '')
        .replace(/^[#*`\s]+/, '')
        .trim();
      const title = cleanText ? cleanText.substring(0, 45) + (cleanText.length > 45 ? '...' : '') : 'Exovon Chat';
      // Only update title if it's a user message and not the first message
      if (message.sender === 'user') {
         this.db.prepare('UPDATE chat_threads SET updated_at = ?, title = CASE WHEN title = \'New Chat\' THEN ? ELSE title END WHERE id = ?').run(
           Date.now(), title, threadId
         );
      } else {
         this.db.prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(Date.now(), threadId);
      }
    } catch (e) {
      console.error('saveChatMessage error:', e);
    }
  }

  public deleteChatMessage(threadId: string, messageId: string) {
    try {
      this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ? AND id = ?').run(threadId, messageId);
    } catch (e) {
      console.error('deleteChatMessage error:', e);
    }
  }

  public loadChatThread(threadId: string): any[] {
    try {
      const rows = this.db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY rowid ASC').all(threadId) as any[];
      return rows.map(r => {
        const meta = r.meta ? JSON.parse(r.meta) : {};
        return {
          id: r.id,
          sender: r.sender,
          text: r.text,
          reasoning: r.reasoning,
          timestamp: r.timestamp,
          planSteps: r.plan_steps ? JSON.parse(r.plan_steps) : undefined,
          toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
          timeline: meta.timeline,
          ...meta
        };
      });
    } catch (e) {
      console.error('loadChatThread error:', e);
      return [];
    }
  }

  public shutdown() {
    for (const worker of this.workers) {
      // Hard kill
      worker.terminate();
    }
    this.db.close();
  }

  // --- GIT INTEGRATION ---
  public async differentialBranchSwitch(oldBranch: string, newBranch: string, oldCommit: string, newCommit: string) {
    console.log(`[BrainCoordinator] Branch switch detected: ${oldBranch} -> ${newBranch}.`);
    
    if (!oldCommit || !newCommit) {
      console.log(`[BrainCoordinator] Missing commits for diff, falling back to full clear.`);
      this.db.exec('DELETE FROM symbols');
      this.db.exec('DELETE FROM edges');
      this.db.exec('DELETE FROM vec_symbols');
      this.worldVersion++;
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { return; }

    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      const { stdout } = await execAsync(`git diff --name-status ${oldCommit} ${newCommit}`, { cwd: workspaceRoot });
      
      const lines = stdout.trim().split('\n');
      let filesProcessed = 0;

      for (const line of lines) {
        if (!line.trim()) { continue; }
        const [status, relPath] = line.split('\t');
        const absPath = path.join(workspaceRoot, relPath);

        if (status === 'D') {
          // File deleted, remove from DB
          this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(relPath);
          this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(relPath);
        } else if (status === 'M' || status === 'A' || status.startsWith('R')) {
          // Modified or Added, re-index
          try {
            const content = await fs.promises.readFile(absPath, 'utf8');
            this.indexFile(absPath, content);
            filesProcessed++;
          } catch (err) {
            // Ignore if file was quickly deleted or is unreadable
          }
        }
      }

      this.worldVersion++;
      console.log(`[BrainCoordinator] Differential switch complete. Re-indexed ${filesProcessed} files.`);
    } catch (e) {
      console.error('Failed to execute differential branch switch:', e);
    }
  }

  public async recordCommit(branch: string, hash: string) {
     if (this.isSyncing || this.dirtyFiles.size > 0) {
        await this.forceFlushNow();
     }
     
     try {
       const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
       let diffFiles: string[] = [];
       if (workspaceRoot) {
          const childProcess = require('child_process');
          const util = require('util');
          const exec = util.promisify(childProcess.exec);
          try {
             const { stdout } = await exec(`git diff HEAD~1 HEAD --name-only`, { cwd: workspaceRoot });
             diffFiles = stdout.trim().split('\n').filter(Boolean);
          } catch(err) {}
       }
       
       this.db.prepare('INSERT INTO commits (hash, branch_name, symbol_ids) VALUES (?, ?, ?)').run(
         hash, branch, JSON.stringify(diffFiles)
       );
       
       // Prune commits if > 200 for this branch
        this.db.prepare(`
          DELETE FROM commits 
          WHERE rowid NOT IN (
            SELECT rowid FROM commits 
            WHERE branch_name = ? 
            ORDER BY created_at DESC 
            LIMIT 200
          ) AND branch_name = ?
        `).run(branch, branch);
     } catch (e) {
       console.error('Failed to record commit:', e);
     }
  }

  public removeFile(filePath: string): void {
    try {
      this.dirtyFiles.delete(filePath);
      this.db.prepare('DELETE FROM file_hashes WHERE file_path = ?').run(filePath);
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
      this.db.prepare('DELETE FROM symbol_links WHERE caller_file = ? OR callee_file = ?').run(filePath, filePath);
      console.log(`[BrainCoordinator] Evicted file from brain: ${filePath}`);
    } catch (e) {
      console.error('[BrainCoordinator] Failed to remove file from brain:', e);
    }
  }

  public renameFile(oldPath: string, newPath: string): void {
    try {
      if (this.dirtyFiles.has(oldPath)) {
        const hash = this.dirtyFiles.get(oldPath) || '';
        this.dirtyFiles.delete(oldPath);
        this.dirtyFiles.set(newPath, hash);
      }
      this.db.prepare('UPDATE file_hashes SET file_path = ? WHERE file_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE symbols SET file_path = ? WHERE file_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE symbol_links SET caller_file = ? WHERE caller_file = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE symbol_links SET callee_file = ? WHERE callee_file = ?').run(newPath, oldPath);
      console.log(`[BrainCoordinator] Renamed file in brain: ${oldPath} -> ${newPath}`);
    } catch (e) {
      console.error('[BrainCoordinator] Failed to rename file in brain:', e);
    }
  }

  public findR3FCanvasFiles(): string[] {
    try {
      const rows = this.db.prepare(
        "SELECT DISTINCT file_path FROM symbols WHERE name LIKE '%Canvas%' OR docstring LIKE '%@react-three/fiber%' OR file_path LIKE '%.tsx'"
      ).all() as { file_path: string }[];
      return rows.map(r => r.file_path).filter(f => f.endsWith('.tsx') || f.endsWith('.jsx'));
    } catch (e) {
      console.error('[BrainCoordinator] Error querying R3F canvas files:', e);
      return [];
    }
  }
}
