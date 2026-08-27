import type { ExovonClient } from '../client';
import { ExovonError } from '../errors';
import fs from 'fs';
import path from 'path';

export interface DeployRequestOptions {
  projectId: string;
  framework?: string;
  buildCommand?: string;
  outputDir?: string;
  rootDir?: string;
  githubRepoFullName?: string;
  isPrebuilt?: boolean;
}

export interface DeployRequestResult {
  deployId: string;
  requiresUpload: boolean;
  gcsUploadUrl?: string;
  expiresAt?: string;
}

export interface LocalDeployOptions extends DeployRequestOptions {
  sourceDir: string;
}

export class DeploymentsClient {
  constructor(private client: ExovonClient) {}

  /**
   * Step 1: Request a new deployment, generating a deployId and an optional GCS upload URL.
   */
  public async request(options: DeployRequestOptions): Promise<DeployRequestResult> {
    return await this.client.request('/deploy/request', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Step 2: Uploads a ZIP buffer or stream to the provided GCS pre-signed URL.
   * Includes a client-side 100MB safety limit if buffer is passed.
   */
  public async upload(zipData: Buffer | NodeJS.ReadableStream, uploadUrl: string, sizeMB?: number): Promise<void> {
    const MAX_SIZE_MB = 100;
    
    if (Buffer.isBuffer(zipData)) {
      sizeMB = zipData.length / (1024 * 1024);
    }
    
    if (sizeMB && sizeMB > MAX_SIZE_MB) {
      throw new ExovonError(`Upload exceeds ${MAX_SIZE_MB}MB safety limit. Size: ${sizeMB.toFixed(2)}MB`, 400, 'PAYLOAD_TOO_LARGE');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/zip'
    };

    if (Buffer.isBuffer(zipData)) {
      headers['Content-Length'] = zipData.length.toString();
    }

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers,
      // @ts-ignore - Node.js fetch accepts Streams with duplex half
      body: zipData,
      duplex: 'half'
    });

    if (!response.ok) {
      throw new ExovonError(`Failed to upload to GCS: ${response.statusText}`, response.status, 'UPLOAD_FAILED');
    }
  }

  /**
   * Step 3: Trigger the build pipeline or Fast-Path instant promotion.
   * @param deployId - The deployment ID from step 1
   * @param fastPath - If true, server executes Fast-Path (0s Cloud Build) instead of full build
   */
  public async start(deployId: string, fastPath: boolean = false): Promise<{ success: boolean; deployId: string; buildId?: string; url?: string }> {
    return await this.client.request('/deploy/start', {
      method: 'POST',
      body: JSON.stringify({ deployId, fastPath })
    });
  }

  /**
   * Helper: Zips a local directory to a temp file on disk, applying security exclusions.
   * Returns the path to the temporary zip file.
   */
  private async zipDirectory(sourceDir: string): Promise<string> {
    if (!fs.existsSync(sourceDir)) {
      throw new ExovonError(`Source directory not found: ${sourceDir}`, 404, 'DIR_NOT_FOUND');
    }

    const os = require('os');
    const tmpZipPath = path.join(os.tmpdir(), `exovon-deploy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.zip`);
    const output = fs.createWriteStream(tmpZipPath);

    let mod: any;
    try {
      mod = await import('archiver');
    } catch {
      mod = require('archiver');
    }

    const options = { zlib: { level: 9 } };
    let archive: any;
    if (mod.ZipArchive) {
      archive = new mod.ZipArchive(options);
    } else if (typeof mod === 'function') {
      archive = mod('zip', options);
    } else if (mod.default && typeof mod.default === 'function') {
      archive = mod.default('zip', options);
    } else if (mod.default && mod.default.ZipArchive) {
      archive = new mod.default.ZipArchive(options);
    } else {
      throw new ExovonError('Failed to initialize archiver module', 500, 'ZIP_INIT_ERROR');
    }

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve(tmpZipPath));
      archive.on('error', (err: any) => reject(new ExovonError(`Zipping failed: ${err.message}`, 500, 'ZIP_ERROR')));

      archive.pipe(output);

      // Default security exclusions
      const ignore = [
        '.env*',
        '*.log',
        '.DS_Store',
        'node_modules/**',
        'dist/**',
        'out/**',
        '.git/**',
        '.exovon-shadow/**'
      ];

      // Parse .exovonignore if it exists
      const ignorePath = path.join(sourceDir, '.exovonignore');
      if (fs.existsSync(ignorePath)) {
        const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            ignore.push(trimmed);
            if (trimmed.endsWith('/')) {
              ignore.push(`${trimmed}**`);
            }
          }
        }
      }

      archive.glob('**/*', {
        cwd: sourceDir,
        ignore: ignore,
        dot: true
      });

      archive.finalize();
    });
  }

  /**
   * Helper: Determines if a local project directory is a pure static / pre-built workspace.
   * Used for auto-detection when --static/--dynamic is not explicitly specified.
   */
  public isPrebuiltProject(sourceDir: string): boolean {
    const pkgPath = path.join(sourceDir, 'package.json');
    const indexHtmlPath = path.join(sourceDir, 'index.html');
    const hasIndexHtml = fs.existsSync(indexHtmlPath);

    if (!fs.existsSync(pkgPath)) {
      return hasIndexHtml;
    }

    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);
      
      const hasBuildScript = pkg.scripts && (pkg.scripts.build || pkg.scripts['build:prod']);
      const hasFrameworkDeps = pkg.dependencies && (
        pkg.dependencies.next || 
        pkg.dependencies.vite || 
        pkg.dependencies.astro ||
        pkg.dependencies.nuxt ||
        pkg.dependencies['@remix-run/react']
      );

      if (hasBuildScript || hasFrameworkDeps || fs.existsSync(path.join(sourceDir, 'Dockerfile'))) {
        return false;
      }
    } catch (e) {
      // Ignored
    }

    return hasIndexHtml;
  }

  /**
   * Orchestrates the entire deployment lifecycle locally:
   * 1. Detects Fast-Path vs Build-Path (or uses explicit override)
   * 2. Zips the directory
   * 3. Requests upload URL
   * 4. Uploads zip safely
   * 5. Promotes instantly (Fast-Path) or triggers Cloud Build (Build-Path)
   */
  public async deploy(
    options: LocalDeployOptions,
    onProgress?: (step: string) => void
  ): Promise<{ deployId: string; buildId?: string; url?: string; fastPath?: boolean }> {
    // Resolve isPrebuilt: explicit override from CLI flags takes priority over auto-detection
    const isPrebuilt = options.isPrebuilt !== undefined ? options.isPrebuilt : this.isPrebuiltProject(options.sourceDir);
    const deployOpts: DeployRequestOptions = { ...options, isPrebuilt };

    if (options.githubRepoFullName) {
      if (onProgress) onProgress('Requesting GitHub deployment...');
      const reqRes = await this.request(deployOpts);
      if (onProgress) onProgress('Triggering Cloud Build pipeline...');
      const startRes = await this.start(reqRes.deployId, false);
      return { deployId: reqRes.deployId, buildId: startRes.buildId };
    }

    if (isPrebuilt) {
      if (onProgress) onProgress('⚡ FAST-PATH DETECTED: Pre-built static project (0s Cloud Build overhead)...');
    } else {
      if (onProgress) onProgress('Compressing workspace (applying security exclusions)...');
    }

    const tmpZipPath = await this.zipDirectory(options.sourceDir);
    
    try {
      const stats = fs.statSync(tmpZipPath);
      const sizeMb = stats.size / (1024 * 1024);
      
      if (onProgress) onProgress(`Requesting signed URL for ${sizeMb.toFixed(2)}MB payload...`);
      const reqRes = await this.request(deployOpts);
      
      if (reqRes.requiresUpload && reqRes.gcsUploadUrl) {
        if (onProgress) onProgress('Uploading payload to Edge Storage...');
        const stream = fs.createReadStream(tmpZipPath);
        await this.upload(stream, reqRes.gcsUploadUrl, sizeMb);
      }
      
      if (isPrebuilt) {
        if (onProgress) onProgress('⚡ Promoting domain instantly to Edge CDN (0s build wait)...');
        const startRes = await this.start(reqRes.deployId, true);
        return { deployId: reqRes.deployId, url: startRes.url, fastPath: true };
      } else {
        if (onProgress) onProgress('Triggering Cloud Build pipeline...');
        const startRes = await this.start(reqRes.deployId, false);
        return { deployId: reqRes.deployId, buildId: startRes.buildId, fastPath: false };
      }
    } finally {
      if (fs.existsSync(tmpZipPath)) {
        fs.unlinkSync(tmpZipPath);
      }
    }
  }

  /**
   * Polls the deployment status and streams logs via offset pagination.
   */
  public async pollLogs(
    deployId: string,
    onLogUpdate?: (log: string) => void
  ): Promise<{ success: boolean; finalStatus: string }> {
    let offset = 0;
    const startTime = Date.now();
    const BUILD_TIMEOUT = 720 * 1000; // 12 minutes
    const AWAITING_BUILD_TIMEOUT = 120 * 1000; // 2 minutes
    let isBuilding = false;

    while (true) {
      const elapsed = Date.now() - startTime;
      
      if (!isBuilding && elapsed > AWAITING_BUILD_TIMEOUT) {
        return { success: false, finalStatus: 'TIMEOUT_AWAITING_BUILD' };
      }
      if (isBuilding && elapsed > BUILD_TIMEOUT) {
        return { success: false, finalStatus: 'TIMEOUT_BUILDING' };
      }

      try {
        const res = await this.client.request<{ status: string; newContent: string; nextOffset: number }>(`/deploy/${deployId}/logs?offset=${offset}`, {
          method: 'GET'
        });

        if (res.newContent && onLogUpdate) {
          onLogUpdate(res.newContent);
        }
        offset = res.nextOffset || offset;

        const statusUpper = res.status ? res.status.toUpperCase() : '';

        if (statusUpper === 'BUILDING' || statusUpper === 'PROVISIONING' || statusUpper === 'AWAITING_START') {
          isBuilding = true;
        }

        if (statusUpper === 'SUCCESS' || statusUpper === 'READY') {
          return { success: true, finalStatus: statusUpper };
        } else if (statusUpper === 'FAILED' || statusUpper === 'TIMEOUT') {
          return { success: false, finalStatus: statusUpper };
        }

      } catch (err: any) {
        if (err.status !== 404) {
          // Ignore 404s temporarily if Cloud Build hasn't flushed logs yet
          console.error('Polling error:', err.message);
        }
      }

      // 3s interval
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  /**
   * Triggers a zero-downtime restart for a dynamic Edge Node project.
   */
  public async restart(projectId: string): Promise<{ success: boolean; revision: string }> {
    return await this.client.request('/deploy/restart', {
      method: 'POST',
      body: JSON.stringify({ projectId })
    });
  }

  /**
   * Promotes or rolls back a specific deployment to 100% traffic.
   */
  public async promote(deployId: string): Promise<{ success: boolean; message: string }> {
    return await this.client.request(`/deploy/${deployId}/promote`, {
      method: 'POST'
    });
  }

  /**
   * Fetches the actual runtime crash logs for a project to help AI Agents debug 500 errors.
   */
  public async getCrashLogs(projectId: string, timeframeMinutes: number = 60): Promise<{ logs: string }> {
    return await this.client.request(`/deploy/${projectId}/crash-logs?timeframe=${timeframeMinutes}`, {
      method: 'GET'
    });
  }

  /**
   * Lists historical deployment revisions so an AI Agent can decide what to roll back to.
   */
  public async listRevisions(projectId: string): Promise<{ revisions: Array<{ deployId: string, status: string, createdAt: string }> }> {
    return await this.client.request(`/deploy/${projectId}/revisions`, {
      method: 'GET'
    });
  }

  /**
   * Immediately rolls back a project to the last known successful revision.
   * Useful for autonomous AI self-healing.
   */
  public async rollback(projectId: string): Promise<{ success: boolean; deployId: string; message: string }> {
    return await this.client.request(`/deploy/${projectId}/rollback`, {
      method: 'POST'
    });
  }
}
