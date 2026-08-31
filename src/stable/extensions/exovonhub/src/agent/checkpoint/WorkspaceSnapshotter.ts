import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface FileSnapshotManifest {
  id: string;
  timestamp: number;
  files: Record<string, string>; // relativePath -> sha256 blob hash
  createdFiles?: string[];       // files created in this step
  deletedFiles?: string[];       // files deleted in this step
}

export class WorkspaceSnapshotter {
  private workspaceRoot: string;
  private checkpointDir: string;
  private blobsDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.checkpointDir = path.join(workspaceRoot, '.exovon', 'checkpoints');
    this.blobsDir = path.join(this.checkpointDir, 'blobs');
    this.ensureDirs();
  }

  private ensureDirs() {
    try {
      if (!fs.existsSync(this.blobsDir)) {
        fs.mkdirSync(this.blobsDir, { recursive: true });
      }
    } catch (e) {
      console.error('[WorkspaceSnapshotter] Failed to create blob directory:', e);
    }
  }

  /**
   * Computes SHA-256 hash of a buffer or string.
   */
  private hashContent(content: Buffer | string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Stores content in the blob cache if not already present.
   */
  private storeBlob(content: Buffer | string): string {
    const hash = this.hashContent(content);
    const blobPath = path.join(this.blobsDir, `${hash}.blob`);
    if (!fs.existsSync(blobPath)) {
      fs.writeFileSync(blobPath, content);
    }
    return hash;
  }

  /**
   * Reads content from the blob cache by hash.
   */
  private readBlob(hash: string): Buffer | null {
    const blobPath = path.join(this.blobsDir, `${hash}.blob`);
    if (fs.existsSync(blobPath)) {
      return fs.readFileSync(blobPath);
    }
    return null;
  }

  /**
   * Takes a snapshot of specific files or all currently modified files in the workspace.
   */
  public async snapshotFiles(
    snapshotId: string,
    relativePaths: string[],
    createdFiles: string[] = [],
    deletedFiles: string[] = []
  ): Promise<FileSnapshotManifest> {
    this.ensureDirs();
    const manifest: FileSnapshotManifest = {
      id: snapshotId,
      timestamp: Date.now(),
      files: {},
      createdFiles: [...createdFiles],
      deletedFiles: [...deletedFiles]
    };

    for (const relPath of relativePaths) {
      const normalizedRel = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
      const fullPath = path.resolve(this.workspaceRoot, normalizedRel);
      const shadowPath = path.resolve(this.workspaceRoot, '.exovon-shadow', normalizedRel);

      try {
        let pathToRead = fullPath;
        // If file exists in shadow sandbox, read latest version from shadow
        if (fs.existsSync(shadowPath) && fs.statSync(shadowPath).isFile()) {
          pathToRead = shadowPath;
        }

        if (fs.existsSync(pathToRead) && fs.statSync(pathToRead).isFile()) {
          const content = fs.readFileSync(pathToRead);
          const hash = this.storeBlob(content);
          manifest.files[normalizedRel] = hash;
        }
      } catch (err) {
        console.warn(`[WorkspaceSnapshotter] Could not snapshot file ${relPath}:`, err);
      }
    }

    return manifest;
  }

  /**
   * Restores the physical workspace files to match the given snapshot manifest.
   * Uses VS Code WorkspaceEdit where possible so open editor tabs update live.
   */
  public async restoreSnapshot(manifest: FileSnapshotManifest): Promise<{ success: boolean; restored: string[]; error?: string }> {
    const restored: string[] = [];

    try {
      // 1. Restore all files recorded in the snapshot manifest
      for (const [relPath, blobHash] of Object.entries(manifest.files)) {
        const fullPath = path.resolve(this.workspaceRoot, relPath);
        const shadowPath = path.resolve(this.workspaceRoot, '.exovon-shadow', relPath);
        const blobContent = this.readBlob(blobHash);

        if (blobContent !== null) {
          // Restore to real workspace
          const parentDir = path.dirname(fullPath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }
          const fileUri = vscode.Uri.file(fullPath);
          await vscode.workspace.fs.writeFile(fileUri, blobContent);

          // If shadow directory exists, also keep shadow in sync
          if (fs.existsSync(path.join(this.workspaceRoot, '.exovon-shadow'))) {
            const shadowParentDir = path.dirname(shadowPath);
            if (!fs.existsSync(shadowParentDir)) {
              fs.mkdirSync(shadowParentDir, { recursive: true });
            }
            fs.writeFileSync(shadowPath, blobContent);
          }

          restored.push(relPath);
        }
      }

      // 2. Remove files that were created *after* this snapshot
      if (manifest.createdFiles && manifest.createdFiles.length > 0) {
        for (const createdRel of manifest.createdFiles) {
          if (!manifest.files[createdRel]) {
            const fullPath = path.resolve(this.workspaceRoot, createdRel);
            const shadowPath = path.resolve(this.workspaceRoot, '.exovon-shadow', createdRel);
            if (fs.existsSync(fullPath)) {
              const fileUri = vscode.Uri.file(fullPath);
              await vscode.workspace.fs.delete(fileUri, { recursive: true, useTrash: false });
            }
            if (fs.existsSync(shadowPath)) {
              try { fs.unlinkSync(shadowPath); } catch {}
            }
          }
        }
      }

      return { success: true, restored };
    } catch (e: any) {
      console.error('[WorkspaceSnapshotter] Restore error:', e);
      return { success: false, restored, error: e.message };
    }
  }

  /**
   * Garbage collection: removes unreferenced blobs.
   */
  public pruneOldBlobs(activeHashes: Set<string>) {
    try {
      if (!fs.existsSync(this.blobsDir)) return;
      const files = fs.readdirSync(this.blobsDir);
      for (const file of files) {
        if (file.endsWith('.blob')) {
          const hash = file.replace('.blob', '');
          if (!activeHashes.has(hash)) {
            const blobPath = path.join(this.blobsDir, file);
            fs.unlinkSync(blobPath);
          }
        }
      }
    } catch (e) {
      console.warn('[WorkspaceSnapshotter] Blob pruning error:', e);
    }
  }
}
