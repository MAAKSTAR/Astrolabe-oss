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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainCoordinator = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const sqliteVec = __importStar(require("sqlite-vec"));
const worker_threads_1 = require("worker_threads");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os_1 = __importDefault(require("os"));
const GraphIndexer_1 = require("./GraphIndexer");
class BrainCoordinator {
    context;
    db;
    workers = [];
    workerRoundRobin = 0;
    pendingEmbeddings = new Map();
    constructor(context) {
        this.context = context;
        const dbPath = path.join(context.globalStorageUri.fsPath, '.exovon_brain.db');
        // Ensure directory exists
        if (!fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
        }
        this.db = new better_sqlite3_1.default(dbPath);
        sqliteVec.load(this.db);
        // Concurrency optimization
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        // Setup Schema
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
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
        PRIMARY KEY(source_id, target_id, relation_type)
      );
      CREATE TABLE IF NOT EXISTS commits (
        hash TEXT,
        branch_name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        symbol_ids JSON
      );
    `);
        // Create virtual vector table (384 dims for all-MiniLM-L6-v2)
        try {
            this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_symbols USING vec0(embedding float[384])`);
        }
        catch (e) {
            // vec0 might already exist
        }
        this.initializeWorkers();
    }
    initializeWorkers() {
        const totalMemGB = os_1.default.totalmem() / 1024 / 1024 / 1024;
        const cpuCount = os_1.default.cpus().length;
        let workerCount = 1;
        if (totalMemGB > 16 && cpuCount > 8) {
            workerCount = 3;
        }
        else if (totalMemGB < 4) {
            workerCount = 0; // Graph only mode
        }
        const workerPath = path.join(__dirname, 'VectorWorker.js');
        for (let i = 0; i < workerCount; i++) {
            this.spawnWorker(workerPath);
        }
    }
    spawnWorker(workerPath) {
        if (!fs.existsSync(workerPath)) {
            console.warn('VectorWorker.js not found, embeddings disabled.');
            return;
        }
        const worker = new worker_threads_1.Worker(workerPath);
        worker.on('message', (msg) => {
            if (msg.type === 'embed_result') {
                const pending = this.pendingEmbeddings.get(msg.id);
                if (pending) {
                    pending.resolve(msg.embedding);
                    this.pendingEmbeddings.delete(msg.id);
                }
            }
            else if (msg.type === 'embed_error') {
                const pending = this.pendingEmbeddings.get(msg.id);
                if (pending) {
                    pending.reject(new Error(msg.error));
                    this.pendingEmbeddings.delete(msg.id);
                }
            }
            else if (msg.type === 'memory_exceeded') {
                // Worker is voluntarily dying, spawn a new one to replace it
                worker.terminate();
                this.spawnWorker(workerPath);
            }
        });
        worker.on('exit', () => {
            // Remove from pool
            this.workers = this.workers.filter(w => w !== worker);
            // Heartbeat watchdog handles restarting if needed, but we can do it here for crashes
            setTimeout(() => this.spawnWorker(workerPath), 1000);
        });
        // Heartbeat
        setInterval(() => {
            worker.postMessage({ type: 'ping' });
        }, 10000);
        this.workers.push(worker);
    }
    async getEmbedding(text) {
        if (this.workers.length === 0)
            return null;
        const worker = this.workers[this.workerRoundRobin];
        this.workerRoundRobin = (this.workerRoundRobin + 1) % this.workers.length;
        return new Promise((resolve, reject) => {
            const id = Date.now().toString() + Math.random().toString();
            this.pendingEmbeddings.set(id, { resolve, reject });
            worker.postMessage({ type: 'embed', text, id });
            // Timeout after 10s
            setTimeout(() => {
                if (this.pendingEmbeddings.has(id)) {
                    this.pendingEmbeddings.delete(id);
                    resolve(null); // Fail gracefully
                }
            }, 10000);
        });
    }
    async indexFile(filePath, fileContent) {
        const { symbols, edges } = GraphIndexer_1.GraphIndexer.parseFile(filePath, fileContent);
        const insertSymbol = this.db.prepare('INSERT OR REPLACE INTO symbols (id, file_path, name, kind, line_start, line_end, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertEdge = this.db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, relation_type) VALUES (?, ?, ?)');
        const insertVec = this.db.prepare('INSERT INTO vec_symbols(rowid, embedding) VALUES(?, ?)');
        // We use a transaction for speed and atomicity
        const transaction = this.db.transaction(async () => {
            // Clear old symbols for this file to avoid orphaned records
            this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
            for (let i = 0; i < symbols.length; i++) {
                const sym = symbols[i];
                // Hack: Use an integer ID for the vector table rowid, mapping to the UUID
                const rowId = Buffer.from(sym.id).reduce((acc, val) => acc + val, 0);
                // Get actual source content slice
                const lines = fileContent.split('\n');
                const content = lines.slice(sym.lineStart - 1, sym.lineEnd).join('\n');
                insertSymbol.run(sym.id, sym.filePath, sym.name, sym.kind, sym.lineStart, sym.lineEnd, content);
                const embedding = await this.getEmbedding(content);
                if (embedding) {
                    insertVec.run(rowId, new Float32Array(embedding).buffer);
                }
            }
            for (const edge of edges) {
                insertEdge.run(edge.sourceId, edge.targetId, edge.relationType);
            }
        });
        try {
            await transaction();
        }
        catch (e) {
            console.error("Brain index transaction failed:", e);
        }
    }
    async query(prompt) {
        const embedding = await this.getEmbedding(prompt);
        let context = 'Exovon Brain Context:\n\n';
        if (embedding) {
            // Semantic Search
            const search = this.db.prepare(`
        SELECT rowid, distance
        FROM vec_symbols
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT 5
      `).all(new Float32Array(embedding).buffer);
            // In MVP, we just append matching content loosely. Proper mapping from rowid -> symbol text needs a junction table.
            context += `Found ${search.length} semantically related chunks.\n`;
        }
        else {
            context += "Semantic search offline (Graph only mode).\n";
        }
        // In a real scenario, we would also query the graph here using LIKE or exact match on symbols
        return context;
    }
    forceFlushNow() {
        // Synchronous flush of any dirty buffers to disk
        // For now, indexFile directly handles atomic writes, so we just log.
        console.log('BrainCoordinator: Force flushed to disk before agent call.');
    }
    shutdown() {
        for (const worker of this.workers) {
            // Hard kill
            process.kill(worker.threadId, 'SIGKILL');
        }
        this.db.close();
    }
}
exports.BrainCoordinator = BrainCoordinator;
//# sourceMappingURL=BrainCoordinator.js.map