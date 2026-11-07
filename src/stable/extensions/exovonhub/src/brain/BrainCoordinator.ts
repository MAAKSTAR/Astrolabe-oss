import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import os from 'os';
import * as crypto from 'crypto';
import { GraphIndexer } from './GraphIndexer';
import { IBrainCoordinator, GovernorStatus } from '../types/shared';

let DatabaseConstructor: any = null;
let sqliteVecModule: any = null;

// 1. Prefer Node.js 22.5+ / Node 24 native built-in SQLite engine (DatabaseSync)
// Zero external native C++ compilation, zero NODE_MODULE_VERSION mismatches across Electron
try {
  const nodeSqlite = require('node:sqlite');
  if (nodeSqlite && nodeSqlite.DatabaseSync) {
    DatabaseConstructor = class extends nodeSqlite.DatabaseSync {
      constructor(filename: string, options?: any) {
        super(filename, options || {});
        if (!(this as any).pragma) {
          (this as any).pragma = (str: string) => this.exec(`PRAGMA ${str}`);
        }
        if (!(this as any).transaction) {
          (this as any).transaction = (fn: any) => {
            return (...args: any[]) => {
              this.exec('BEGIN IMMEDIATE');
              try {
                const res = fn(...args);
                this.exec('COMMIT');
                return res;
              } catch (e) {
                try { this.exec('ROLLBACK'); } catch (_) {}
                throw e;
              }
            };
          };
        }
      }
    };
    console.log('[Astrolabe Brain] Successfully initialized native node:sqlite engine.');
  }
} catch (e: any) {
  // Not available
}

// 2. Fallback to better-sqlite3 if node:sqlite is unavailable
if (!DatabaseConstructor) {
  try {
    DatabaseConstructor = require('better-sqlite3');
    console.log('[Astrolabe Brain] Loaded better-sqlite3 native driver.');
  } catch (e: any) {
    console.warn('[Astrolabe Brain] Native SQLite drivers unavailable:', e?.message || e);
  }
}

try {
  sqliteVecModule = require('sqlite-vec');
} catch (e: any) {
  // Vector search optional
}

class PersistentJsonDb {
  private threads: Map<string, any> = new Map();
  private messages: Map<string, any[]> = new Map();
  private symbols: Map<string, any> = new Map();
  private metadata: Map<string, string> = new Map();
  private backupFile: string;
  private saveDebounce: any = null;

  constructor(filePath: string) {
    this.backupFile = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.backupFile)) {
        const raw = fs.readFileSync(this.backupFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.threads)) {
          for (const t of data.threads) this.threads.set(t.id, t);
        }
        if (data.messages && typeof data.messages === 'object') {
          for (const [tid, list] of Object.entries(data.messages)) {
            if (Array.isArray(list)) this.messages.set(tid, list);
          }
        }
        console.log(`[Astrolabe Brain] Loaded ${this.threads.size} threads from fallback JSON store.`);
      }
    } catch (e) {
      console.warn('[Astrolabe Brain] Failed to load JSON fallback:', e);
    }
  }

  private persist() {
    if (this.saveDebounce) clearTimeout(this.saveDebounce);
    this.saveDebounce = setTimeout(() => {
      try {
        const data = {
          threads: Array.from(this.threads.values()),
          messages: Object.fromEntries(this.messages.entries())
        };
        const dir = path.dirname(this.backupFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = this.backupFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this.backupFile);
      } catch (e) {
        console.warn('[Astrolabe Brain] Failed to write JSON backup:', e);
      }
    }, 150);
  }

  exec(_sql: string) {}
  pragma(_sql: string) {}
  transaction(fn: any) { return fn; }

  prepare(sql: string) {
    const s = sql.toLowerCase();
    return {
      get: (...args: any[]) => {
        if (s.includes('count(*)')) return { c: this.symbols.size };
        if (s.includes('from brain_metadata')) return { value: this.metadata.get(args[0]) || '1.0.0' };
        if (s.includes('from chat_threads')) {
          return this.threads.get(args[0]) || null;
        }
        if (s.includes('from chat_messages')) {
          if (s.includes('order by timestamp asc')) {
            const list = this.messages.get(args[0]) || [];
            return list.find(m => m.sender === 'user' && m.text && m.text.trim().length > 3) || list[0] || null;
          }
          const list = this.messages.get(args[0]) || [];
          return list[0] || null;
        }
        return null;
      },
      all: (...args: any[]) => {
        if (s.includes('from chat_threads')) {
          return Array.from(this.threads.values()).map(t => {
            const list = this.messages.get(t.id) || [];
            const nonWelcome = list.filter(m => m.id !== 'welcome');
            const previewMsg = [...nonWelcome].reverse().find(m => m.text && m.text.trim().length > 0);
            return {
              ...t,
              message_count: nonWelcome.length,
              preview: previewMsg?.text || ''
            };
          }).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        }
        if (s.includes('from chat_messages')) {
          return this.messages.get(args[0]) || [];
        }
        if (s.includes('from symbols')) {
          return Array.from(this.symbols.values());
        }
        return [];
      },
      run: (...args: any[]) => {
        if (s.includes('insert into chat_threads') || s.includes('replace into chat_threads') || s.includes('insert or ignore into chat_threads')) {
          const [id, title, created_at, updated_at, workspace_path] = args;
          if (!this.threads.has(id) || !s.includes('ignore')) {
            const existing = this.threads.get(id);
            this.threads.set(id, {
              id,
              title: title || existing?.title || 'New Chat',
              created_at: created_at || existing?.created_at || Date.now(),
              updated_at: updated_at || Date.now(),
              workspace_path: workspace_path || existing?.workspace_path || ''
            });
            this.persist();
          }
        } else if (s.includes('update chat_threads set')) {
          if (s.includes('title = ?, updated_at = ?')) {
            const [title, updated_at, id] = args;
            const t = this.threads.get(id);
            if (t) { t.title = title; t.updated_at = updated_at; this.persist(); }
          } else if (s.includes('updated_at = ?, title = ?')) {
            const [updated_at, title, id] = args;
            const t = this.threads.get(id);
            if (t) { t.title = title; t.updated_at = updated_at; this.persist(); }
          } else if (s.includes('title = ? where id = ?')) {
            const [title, id] = args;
            const t = this.threads.get(id);
            if (t) { t.title = title; this.persist(); }
          } else if (s.includes('updated_at = ? where id = ?')) {
            const [updated_at, id] = args;
            const t = this.threads.get(id);
            if (t) { t.updated_at = updated_at; this.persist(); }
          }
        } else if (s.includes('delete from chat_threads')) {
          this.threads.delete(args[0]);
          this.messages.delete(args[0]);
          this.persist();
        } else if (s.includes('insert into chat_messages') || s.includes('insert or replace into chat_messages')) {
          const [id, thread_id, sender, text, reasoning, timestamp, plan_steps, tool_calls, meta] = args;
          const list = this.messages.get(thread_id) || [];
          const idx = list.findIndex(m => m.id === id);
          const msgObj = {
            id,
            thread_id,
            sender,
            text,
            reasoning,
            timestamp,
            plan_steps,
            tool_calls,
            meta
          };
          if (idx >= 0) {
            list[idx] = msgObj;
          } else {
            list.push(msgObj);
          }
          this.messages.set(thread_id, list);
          this.persist();
        } else if (s.includes('delete from chat_messages')) {
          if (args.length === 2) {
            const [thread_id, id] = args;
            const list = (this.messages.get(thread_id) || []).filter(m => m.id !== id);
            this.messages.set(thread_id, list);
          } else if (args.length === 1) {
            this.messages.delete(args[0]);
          } else {
            this.messages.clear();
          }
          this.persist();
        }
        return { changes: 1 };
      }
    };
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
  public db: any;
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
    const globalStorage = context.globalStorageUri.fsPath;
    this.dbPath = path.join(globalStorage, '.astrolabe_unified.db');
    const jsonBackupPath = path.join(globalStorage, 'astrolabe_chat_history.json');
    
    // Ensure global directory exists
    try {
      if (!fs.existsSync(globalStorage)) {
        fs.mkdirSync(globalStorage, { recursive: true });
      }
    } catch (e) {
      console.warn('[Astrolabe Brain] Failed creating globalStorage dir:', e);
    }

    if (!DatabaseConstructor) {
      this.lastError = null;
      this.status = 'ready';
      this.db = new PersistentJsonDb(jsonBackupPath);
      return;
    }

    try {
      this.db = new DatabaseConstructor(this.dbPath);
      if (sqliteVecModule && typeof sqliteVecModule.load === 'function') {
        try {
          sqliteVecModule.load(this.db);
        } catch (vecErr) {
          console.warn('[Astrolabe Brain] sqlite-vec load skipped:', vecErr);
        }
      }

      // Concurrency optimization
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      this.status = 'ready';
    } catch (err: any) {
      console.warn('[Astrolabe Brain] Falling back to Persistent JSON Store:', err?.message || err);
      this.lastError = null;
      this.status = 'ready';
      this.db = new PersistentJsonDb(jsonBackupPath);
    }

    // Delta Cache Version Control
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
    try {
      this.db.exec('ALTER TABLE indexed_files ADD COLUMN workspace_path TEXT');
    } catch (e) {}
    try {
      this.db.exec('ALTER TABLE symbols ADD COLUMN workspace_path TEXT');
    } catch (e) {}
    try {
      this.db.exec('ALTER TABLE edges ADD COLUMN workspace_path TEXT');
    } catch (e) {}

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_edges_file ON edges(file_path);
      CREATE INDEX IF NOT EXISTS idx_chat_threads_workspace ON chat_threads(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_ws ON symbols(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_edges_ws ON edges(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_indexed_files_ws ON indexed_files(workspace_path);
    `);

    // Clean legacy bloated checkpoints from meta to keep database slim
    try {
      const hasCheckpointBloat = this.db.prepare("SELECT 1 FROM chat_messages WHERE json_extract(meta, '$.checkpoint') IS NOT NULL LIMIT 1").get();
      if (hasCheckpointBloat) {
        this.db.exec(`
          UPDATE chat_messages 
          SET meta = json_remove(meta, '$.checkpoint') 
          WHERE json_extract(meta, '$.checkpoint') IS NOT NULL;
          VACUUM;
        `);
      }
    } catch (e) {}

    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_symbols USING vec0(embedding float[384])`);
    } catch (e) {
      // vec0 might already exist
    }

    // Seamlessly import all legacy chat history from old workspace databases into the unified DB
    this.migrateLegacyDatabases();

    this.initializeWorkers();
  }

  private migrateLegacyDatabases() {
    try {
      const globalStorage = this.context.globalStorageUri.fsPath;
      const userDir = path.resolve(globalStorage, '../..'); // ~/.config/Astrolabe/User
      const workspaceStorageDir = path.join(userDir, 'workspaceStorage');
      
      if (!fs.existsSync(workspaceStorageDir)) return;
      
      const entries = fs.readdirSync(workspaceStorageDir);
      let totalMigratedThreads = 0;
      let totalMigratedMessages = 0;

      for (const entry of entries) {
        const oldDbPath = path.join(workspaceStorageDir, entry, 'exovon.exovonhub', '.exovon_brain.db');
        if (fs.existsSync(oldDbPath) && oldDbPath !== this.dbPath) {
          try {
            const oldDb = new DatabaseConstructor(oldDbPath);
            if (!oldDb.pragma) oldDb.pragma = (s: string) => oldDb.exec(`PRAGMA ${s}`);
            
            const oldThreads = oldDb.prepare('SELECT * FROM chat_threads').all() as any[];
            const insertThread = this.db.prepare(`
              INSERT OR IGNORE INTO chat_threads (id, title, created_at, updated_at, workspace_path)
              VALUES (?, ?, ?, ?, ?)
            `);
            for (const t of oldThreads) {
              insertThread.run(t.id, t.title || 'Chat', t.created_at || Date.now(), t.updated_at || Date.now(), t.workspace_path || '');
              totalMigratedThreads++;
            }

            const oldMessages = oldDb.prepare('SELECT * FROM chat_messages').all() as any[];
            const insertMsg = this.db.prepare(`
              INSERT OR IGNORE INTO chat_messages (id, thread_id, sender, text, reasoning, timestamp, plan_steps, tool_calls, meta)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const m of oldMessages) {
              insertMsg.run(
                m.id,
                m.thread_id,
                m.sender,
                m.text,
                m.reasoning || null,
                m.timestamp,
                m.plan_steps || null,
                m.tool_calls || null,
                m.meta || null
              );
              totalMigratedMessages++;
            }
            if (typeof oldDb.close === 'function') {
              oldDb.close();
            }
          } catch (migrateErr) {
            // Ignore corrupted or incompatible legacy DB
          }
        }
      }

      // Also migrate from legacy global database if present
      const legacyGlobalDbPath = path.join(globalStorage, '.exovon_brain.db');
      if (fs.existsSync(legacyGlobalDbPath) && legacyGlobalDbPath !== this.dbPath) {
        try {
          const oldDb = new DatabaseConstructor(legacyGlobalDbPath);
          const oldThreads = oldDb.prepare('SELECT * FROM chat_threads').all() as any[];
          const insertThread = this.db.prepare(`
            INSERT OR IGNORE INTO chat_threads (id, title, created_at, updated_at, workspace_path)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const t of oldThreads) {
            insertThread.run(t.id, t.title || 'Chat', t.created_at || Date.now(), t.updated_at || Date.now(), t.workspace_path || '');
            totalMigratedThreads++;
          }
          const oldMessages = oldDb.prepare('SELECT * FROM chat_messages').all() as any[];
          const insertMsg = this.db.prepare(`
            INSERT OR IGNORE INTO chat_messages (id, thread_id, sender, text, reasoning, timestamp, plan_steps, tool_calls, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const m of oldMessages) {
            insertMsg.run(
              m.id,
              m.thread_id,
              m.sender,
              m.text,
              m.reasoning || null,
              m.timestamp,
              m.plan_steps || null,
              m.tool_calls || null,
              m.meta || null
            );
            totalMigratedMessages++;
          }
          if (typeof oldDb.close === 'function') {
            oldDb.close();
          }
        } catch (e) {}
      }

      if (totalMigratedThreads > 0 || totalMigratedMessages > 0) {
        console.log(`[Astrolabe Brain] Successfully migrated ${totalMigratedThreads} threads and ${totalMigratedMessages} messages into unified database.`);
      }
    } catch (e) {
      console.warn('[Astrolabe Brain] Legacy chat migration notice:', e);
    }
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
      
      // Timeout after 2.5s to prevent stalling batch indexing
      pending.timer = setTimeout(() => {
        if (this.pendingEmbeddings.has(id)) {
          this.pendingEmbeddings.delete(id);
          resolve(null); // Fail gracefully
        }
      }, 2500);
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
      
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      let entities = 0;
      if (workspaceRoot) {
        const row = this.db.prepare('SELECT COUNT(*) as c FROM symbols WHERE workspace_path = ?').get(workspaceRoot) as { c: number } | undefined;
        entities = row?.c ?? 0;
      } else {
        const row = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number } | undefined;
        entities = row?.c ?? 0;
      }

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

  // Wipe and rebuild the Brain database for the current workspace
  public async rebuildBrain(): Promise<void> {
    try {
      this.setSyncing(true);
      this.status = 'indexing';
      this.lastError = null;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      if (workspaceRoot) {
        const oldSymbols = this.db.prepare('SELECT hash_id FROM symbols WHERE workspace_path = ?').all(workspaceRoot) as any[];
        for (const oldSym of oldSymbols) {
          if (oldSym.hash_id) {
            try { this.db.prepare('DELETE FROM vec_symbols WHERE rowid = ?').run(oldSym.hash_id); } catch (e) {}
          }
        }
        this.db.prepare('DELETE FROM symbols WHERE workspace_path = ?').run(workspaceRoot);
        this.db.prepare('DELETE FROM edges WHERE workspace_path = ?').run(workspaceRoot);
        this.db.prepare('DELETE FROM indexed_files WHERE workspace_path = ?').run(workspaceRoot);
      } else {
        this.db.exec('DELETE FROM symbols; DELETE FROM edges; DELETE FROM indexed_files; DELETE FROM vec_symbols;');
      }
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
    
    const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootUri) {
      this.setSyncing(false);
      this.status = 'ready';
      return;
    }
    const workspaceRoot = rootUri.fsPath;

    // 1. Dynamic Privacy Engine (Phase 1): Parse .gitignore and .exovonignore
    const ignorePatterns: RegExp[] = [];
    try {
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
    
    // 2. Live Scan: Strictly Code Files Only (TS/JS/Py/Rust/Go/C/C++/Java/etc.)
    // User Directive: "BRAIN SHOULDNT INDEX ANYTHING OTHER THEN CODE"
    // Exclude all docs, markdown, configs, binaries, node_modules, and hidden directories
    const CODE_EXTENSIONS_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,java,c,cpp,cc,cxx,h,hpp,cs,rb,php,swift,kt,scala,lua,zig}';
    const EXCLUDE_FOLDERS_GLOB = '**/{node_modules,.git,.svn,.hg,dist,build,out,coverage,.next,.nuxt,.turbo,.exovon*,.vscode,.astrolabe,target,vendor,venv,.venv,env,__pycache__}/**';

    const files = await vscode.workspace.findFiles(CODE_EXTENSIONS_GLOB, EXCLUDE_FOLDERS_GLOB);
    
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

    // 2. Database Diff: Fetch all previously cached files for THIS workspace
    const cachedFiles = this.db.prepare('SELECT relative_path, mtime, size FROM indexed_files WHERE workspace_path = ?').all(workspaceRoot) as any[];
    
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
             const oldSymbols = this.db.prepare('SELECT hash_id FROM symbols WHERE file_path = ? AND workspace_path = ?').all(relPath, workspaceRoot) as any[];
             for (const oldSym of oldSymbols) {
                if (oldSym.hash_id) {
                    try { this.db.prepare('DELETE FROM vec_symbols WHERE rowid = ?').run(oldSym.hash_id); } catch (e) {}
                }
             }
             this.db.prepare('DELETE FROM symbols WHERE file_path = ? AND workspace_path = ?').run(relPath, workspaceRoot);
             this.db.prepare('DELETE FROM edges WHERE file_path = ? AND workspace_path = ?').run(relPath, workspaceRoot);
             this.db.prepare('DELETE FROM indexed_files WHERE relative_path = ? AND workspace_path = ?').run(relPath, workspaceRoot);
          }
       });
       gcTx();
    }

    // If there are no new/modified files, mark ready immediately!
    if (toIndex.length === 0) {
      console.log(`✅ Delta Cache sync complete (0 code files to index).`);
      if (this.dirtyFiles.size === 0) {
        this.setSyncing(false);
        this.status = 'ready';
      }
      return;
    }

    // 4. Yielding Queue: Push valid files to be parsed
    const BATCH_SIZE = 50;
    let processed = 0;

    const processBatch = async () => {
      const batch = toIndex.slice(processed, processed + BATCH_SIZE);
      if (batch.length === 0) {
        console.log(`✅ Delta Cache sync complete.`);
        if (this.dirtyFiles.size === 0) {
          this.setSyncing(false);
          this.status = 'ready';
        }
        return;
      }

      for (const relPath of batch) {
        try {
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
      this.status = 'ready';
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    // Capture current snapshot of dirty files (keys are already relative paths)
    const filesToProcess = Array.from(this.dirtyFiles.entries()).map(([relPath, content]) => ({ relPath, content }));
    this.dirtyFiles.clear();

    const insertSymbol = this.db.prepare('INSERT OR REPLACE INTO symbols (id, hash_id, file_path, name, kind, line_start, line_end, content, workspace_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertEdge = this.db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, file_path, workspace_path) VALUES (?, ?, ?, ?, ?)');
    const insertVec = this.db.prepare('INSERT INTO vec_symbols(rowid, embedding) VALUES(?, ?)');
    const insertFileMeta = this.db.prepare('INSERT OR REPLACE INTO indexed_files (relative_path, mtime, size, workspace_path) VALUES (?, ?, ?, ?)');

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
      // Clear old entries for all processed files for THIS workspace
      for (const file of filesToProcess) {
        const oldSymbols = this.db.prepare('SELECT hash_id FROM symbols WHERE file_path = ? AND workspace_path = ?').all(file.relPath, workspaceRoot) as any[];
        for (const oldSym of oldSymbols) {
           if (oldSym.hash_id) {
               try { this.db.prepare('DELETE FROM vec_symbols WHERE rowid = ?').run(oldSym.hash_id); } catch (e) {}
           }
        }
        this.db.prepare('DELETE FROM symbols WHERE file_path = ? AND workspace_path = ?').run(file.relPath, workspaceRoot);
        this.db.prepare('DELETE FROM edges WHERE file_path = ? AND workspace_path = ?').run(file.relPath, workspaceRoot);
      }
      
      for (const meta of filesMetaToInsert) {
         insertFileMeta.run(meta.relPath, meta.mtime, meta.size, workspaceRoot);
      }

      for (const item of itemsToInsert) {
        insertSymbol.run(item.sym.id, item.rowId, item.sym.filePath, item.sym.name, item.sym.kind, item.sym.lineStart, item.sym.lineEnd, item.content, workspaceRoot);
        if (item.embedding) {
           try { insertVec.run(item.rowId, new Float32Array(item.embedding).buffer); } catch (e) {}
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
          
          insertEdge.run(relSourceId, relTargetId, edge.relationType, item.sym.filePath, workspaceRoot);
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
      this.status = 'ready';
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
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      if (workspaceRoot) {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM symbols WHERE workspace_path = ?').get(workspaceRoot) as { count: number };
        nodeCount = result?.count ?? 0;
      } else {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
        nodeCount = result?.count ?? 0;
      }
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
  public getChatThreads(workspacePath?: string): { id: string; title: string; updated_at: number; message_count?: number; preview?: string; workspace_path?: string }[] {
    try {
      const currentWorkspace = workspacePath !== undefined 
        ? workspacePath 
        : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');

      const threads = currentWorkspace
        ? this.db.prepare(`
            SELECT 
              ct.id, 
              ct.title, 
              ct.updated_at,
              ct.workspace_path,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome') as message_count,
              (SELECT text FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome' AND cm.text IS NOT NULL AND TRIM(cm.text) != '' ORDER BY cm.timestamp DESC, cm.id DESC LIMIT 1) as preview
            FROM chat_threads ct 
            WHERE ct.workspace_path = ?
            ORDER BY ct.updated_at DESC
            LIMIT 200
          `).all(currentWorkspace) as any[]
        : this.db.prepare(`
            SELECT 
              ct.id, 
              ct.title, 
              ct.updated_at,
              ct.workspace_path,
              (SELECT COUNT(*) FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome') as message_count,
              (SELECT text FROM chat_messages cm WHERE cm.thread_id = ct.id AND cm.id != 'welcome' AND cm.text IS NOT NULL AND TRIM(cm.text) != '' ORDER BY cm.timestamp DESC, cm.id DESC LIMIT 1) as preview
            FROM chat_threads ct 
            WHERE ct.workspace_path IS NULL OR ct.workspace_path = ''
            ORDER BY ct.updated_at DESC
            LIMIT 200
          `).all() as any[];

      // Auto-repair stale generic titles (e.g. 'HI', 'hi', 'hello', 'New Chat')
      for (const t of threads) {
        const lower = (t.title || '').toLowerCase().trim();
        if (!lower || lower === 'new chat' || ['hi', 'hello', 'hey', 'yo', 'sup', 'test'].includes(lower) || lower.length <= 3) {
          const firstMeaningful: any = this.db.prepare(`
            SELECT text FROM chat_messages 
            WHERE thread_id = ? AND sender = 'user' AND text IS NOT NULL AND LENGTH(TRIM(text)) > 3
            ORDER BY timestamp ASC LIMIT 1
          `).get(t.id);
          if (firstMeaningful?.text) {
            let clean = firstMeaningful.text
              .replace(/^\[IDE WORKSPACE ACTIVE CONTEXT\][\s\S]*?\[\/IDE WORKSPACE ACTIVE CONTEXT\]/, '')
              .replace(/^Developer Action Request:\s*"?/, '')
              .replace(/^[#*`\s]+/, '')
              .replace(/^(?:hi|hello|hey|yo|sup|greeting|greetings|please|can you|could you|help me)\s*[,.:;!-]?\s*/i, '')
              .trim();
            if (clean.length > 2) {
              const newTitle = clean.substring(0, 45) + (clean.length > 45 ? '...' : '');
              t.title = newTitle;
              this.db.prepare('UPDATE chat_threads SET title = ? WHERE id = ?').run(newTitle, t.id);
            }
          }
        }
      }

      return threads;
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

  public createNewThread(workspacePath?: string): string {
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspaceRoot = workspacePath !== undefined ? workspacePath : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
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

  public clearAllChatThreads(workspacePath?: string): void {
    try {
      const workspaceRoot = workspacePath !== undefined ? workspacePath : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
      if (workspaceRoot) {
        const threads = this.db.prepare('SELECT id FROM chat_threads WHERE workspace_path = ?').all(workspaceRoot) as any[];
        const delMsg = this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ?');
        for (const t of threads) {
          delMsg.run(t.id);
        }
        this.db.prepare('DELETE FROM chat_threads WHERE workspace_path = ?').run(workspaceRoot);
      } else {
        const threads = this.db.prepare('SELECT id FROM chat_threads WHERE workspace_path IS NULL OR workspace_path = ""').all() as any[];
        const delMsg = this.db.prepare('DELETE FROM chat_messages WHERE thread_id = ?');
        for (const t of threads) {
          delMsg.run(t.id);
        }
        this.db.prepare('DELETE FROM chat_threads WHERE workspace_path IS NULL OR workspace_path = ""').run();
      }
    } catch (e) {
      console.error('clearAllChatThreads error:', e);
    }
  }

  public saveChatMessage(threadId: string, message: any) {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      // Ensure parent thread exists (satisfies foreign key constraint unconditionally)
      this.db.prepare(`
        INSERT OR IGNORE INTO chat_threads (id, title, created_at, updated_at, workspace_path)
        VALUES (?, 'New Chat', ?, ?, ?)
      `).run(threadId, Date.now(), Date.now(), workspaceRoot);

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
          // CRITICAL: NEVER store full message.checkpoint object in SQLite; checkpointId references it on disk.
          promptTokens: message.promptTokens,
          promptProcessed: message.promptProcessed
        })
      );
      
      // Update thread title and timestamp intelligently
      let cleanText = (message.text || '')
        .replace(/^\[IDE WORKSPACE ACTIVE CONTEXT\][\s\S]*?\[\/IDE WORKSPACE ACTIVE CONTEXT\]/, '')
        .replace(/^Developer Action Request:\s*"?/, '')
        .replace(/^[#*`\s]+/, '')
        .trim();

      if (message.sender === 'user' && cleanText) {
        // Strip common greetings to find actual intent
        let titleCandidate = cleanText
          .replace(/^(?:hi|hello|hey|yo|sup|greeting|greetings|please|can you|could you|help me)\s*[,.:;!-]?\s*/i, '')
          .trim();
        if (!titleCandidate || titleCandidate.length < 3) {
          titleCandidate = cleanText;
        }
        const title = titleCandidate.substring(0, 45) + (titleCandidate.length > 45 ? '...' : '');

        // Fetch current thread title
        const currentThread: any = this.db.prepare('SELECT title FROM chat_threads WHERE id = ?').get(threadId);
        const currentTitle = (currentThread?.title || '').toLowerCase().trim();
        const isGeneric = !currentTitle ||
                          currentTitle === 'new chat' ||
                          currentTitle === 'exovon chat' ||
                          ['hi', 'hello', 'hey', 'yo', 'sup', 'test', 'greeting', 'greetings'].includes(currentTitle) ||
                          (currentTitle.length <= 4 && titleCandidate.length > 4);

        if (isGeneric) {
          this.db.prepare('UPDATE chat_threads SET updated_at = ?, title = ? WHERE id = ?').run(
            Date.now(), title, threadId
          );
        } else {
          this.db.prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(Date.now(), threadId);
        }
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
