import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceSnapshotter, FileSnapshotManifest } from './WorkspaceSnapshotter';

export type GraphNodeType = 
  | 'init' 
  | 'reasoning' 
  | 'tool_start' 
  | 'tool_complete' 
  | 'approval_pending' 
  | 'task_complete' 
  | 'error';

export interface StateGraphCheckpoint {
  id: string;
  threadId: string;
  parentId: string | null;
  node: GraphNodeType;
  timestamp: number;
  title: string;
  stepNumber: number;
  state: {
    messages: any[];
    pendingTools?: any[];
    memoryVariables?: Record<string, any>;
    fileSnapshot?: FileSnapshotManifest;
    filesChangedCount: number;
    activeFile?: string;
  };
  branchName?: string;
}

export interface SessionManifest {
  version: string;
  lastUpdated: number;
  threads: Record<string, {
    activeCheckpointId: string;
    checkpoints: StateGraphCheckpoint[];
  }>;
}

export class StateGraphCheckpointer {
  private workspaceRoot: string;
  private checkpointDir: string;
  private sessionsFile: string;
  private snapshotter: WorkspaceSnapshotter;
  private sessions: SessionManifest = {
    version: '1.0.0',
    lastUpdated: Date.now(),
    threads: {}
  };

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.checkpointDir = path.join(workspaceRoot, '.exovon', 'checkpoints');
    this.sessionsFile = path.join(this.checkpointDir, 'sessions.json');
    this.snapshotter = new WorkspaceSnapshotter(workspaceRoot);
    this.loadSessions();
  }

  public getSnapshotter(): WorkspaceSnapshotter {
    return this.snapshotter;
  }

  private loadSessions() {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const raw = fs.readFileSync(this.sessionsFile, 'utf-8');
        this.sessions = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[StateGraphCheckpointer] Failed to load sessions, initializing fresh:', e);
      this.sessions = {
        version: '1.0.0',
        lastUpdated: Date.now(),
        threads: {}
      };
    }
  }

  private saveSessions() {
    try {
      if (!fs.existsSync(this.checkpointDir)) {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }
      this.sessions.lastUpdated = Date.now();
      fs.writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2), 'utf-8');
    } catch (e) {
      console.error('[StateGraphCheckpointer] Failed to save sessions:', e);
    }
  }

  /**
   * Generates a unique checkpoint ID.
   */
  private generateId(): string {
    return `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Creates and stores a new State Graph checkpoint.
   */
  public async createCheckpoint(
    threadId: string,
    parentId: string | null,
    node: GraphNodeType,
    title: string,
    messages: any[],
    trackedFiles: string[] = [],
    createdFiles: string[] = [],
    deletedFiles: string[] = [],
    pendingTools?: any[],
    memoryVariables?: Record<string, any>,
    activeFile?: string
  ): Promise<StateGraphCheckpoint> {
    const chkId = this.generateId();

    if (!this.sessions.threads[threadId]) {
      this.sessions.threads[threadId] = {
        activeCheckpointId: chkId,
        checkpoints: []
      };
    }

    const thread = this.sessions.threads[threadId];
    const stepNumber = thread.checkpoints.length + 1;

    // Snapshot files if there are tracked files
    let fileSnapshot: FileSnapshotManifest | undefined = undefined;
    if (trackedFiles.length > 0 || createdFiles.length > 0 || deletedFiles.length > 0) {
      fileSnapshot = await this.snapshotter.snapshotFiles(chkId, trackedFiles, createdFiles, deletedFiles);
    } else if (parentId) {
      // Inherit previous snapshot manifest if no new files were touched
      const parent = thread.checkpoints.find(c => c.id === parentId);
      if (parent && parent.state.fileSnapshot) {
        fileSnapshot = parent.state.fileSnapshot;
      }
    }

    // Clone messages safely (strip non-serializable elements)
    const sanitizedMessages = JSON.parse(JSON.stringify(messages || []));

    const checkpoint: StateGraphCheckpoint = {
      id: chkId,
      threadId,
      parentId,
      node,
      timestamp: Date.now(),
      title,
      stepNumber,
      state: {
        messages: sanitizedMessages,
        pendingTools: pendingTools ? JSON.parse(JSON.stringify(pendingTools)) : undefined,
        memoryVariables: memoryVariables ? JSON.parse(JSON.stringify(memoryVariables)) : undefined,
        fileSnapshot,
        filesChangedCount: fileSnapshot ? Object.keys(fileSnapshot.files).length : 0,
        activeFile
      }
    };

    thread.checkpoints.push(checkpoint);
    thread.activeCheckpointId = chkId;

    this.saveSessions();
    return checkpoint;
  }

  /**
   * Retrieves a specific checkpoint by ID. Searches threadId if provided, or all threads as fallback.
   */
  public getCheckpoint(threadId: string | undefined, checkpointId: string): StateGraphCheckpoint | null {
    if (threadId && this.sessions.threads[threadId]) {
      const found = this.sessions.threads[threadId].checkpoints.find(c => c.id === checkpointId);
      if (found) return found;
    }
    // Fallback: Search all session threads
    for (const thread of Object.values(this.sessions.threads)) {
      const found = thread.checkpoints.find(c => c.id === checkpointId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Returns all checkpoints for a thread.
   */
  public getThreadCheckpoints(threadId: string): StateGraphCheckpoint[] {
    const thread = this.sessions.threads[threadId];
    return thread ? thread.checkpoints : [];
  }

  /**
   * Rollback: Restores both the agent memory state and physical workspace files
   * to the exact point of the target checkpoint.
   */
  public async rollback(threadId: string | undefined, checkpointId: string): Promise<{
    success: boolean;
    restoredCheckpoint: StateGraphCheckpoint | null;
    restoredFiles: string[];
    error?: string;
  }> {
    const target = this.getCheckpoint(threadId, checkpointId);
    if (!target) {
      return { success: false, restoredCheckpoint: null, restoredFiles: [], error: `Checkpoint ${checkpointId} not found.` };
    }

    let restoredFiles: string[] = [];

    // 1. Restore physical workspace files
    if (target.state.fileSnapshot) {
      const res = await this.snapshotter.restoreSnapshot(target.state.fileSnapshot);
      if (!res.success) {
        return { success: false, restoredCheckpoint: target, restoredFiles: [], error: `File restoration failed: ${res.error}` };
      }
      restoredFiles = res.restored;
    }

    // 2. Set thread active checkpoint pointer
    const activeThreadId = threadId || target.threadId;
    if (this.sessions.threads[activeThreadId]) {
      this.sessions.threads[activeThreadId].activeCheckpointId = checkpointId;
    }

    this.saveSessions();
    return {
      success: true,
      restoredCheckpoint: target,
      restoredFiles
    };
  }

  /**
   * Branch: Forks a conversation thread from a specific checkpoint into a new thread.
   */
  public branch(sourceThreadId: string, checkpointId: string, newThreadId: string, branchName: string): StateGraphCheckpoint | null {
    const sourceCheckpoint = this.getCheckpoint(sourceThreadId, checkpointId);
    if (!sourceCheckpoint) return null;

    const branchedCheckpoint: StateGraphCheckpoint = {
      ...sourceCheckpoint,
      id: this.generateId(),
      threadId: newThreadId,
      parentId: checkpointId,
      timestamp: Date.now(),
      branchName,
      title: `Branch: ${branchName} (from Step ${sourceCheckpoint.stepNumber})`
    };

    this.sessions.threads[newThreadId] = {
      activeCheckpointId: branchedCheckpoint.id,
      checkpoints: [branchedCheckpoint]
    };

    this.saveSessions();
    return branchedCheckpoint;
  }
}
