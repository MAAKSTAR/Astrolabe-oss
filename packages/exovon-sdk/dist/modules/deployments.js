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
exports.DeploymentsClient = void 0;
const errors_1 = require("../errors");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DeploymentsClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Step 1: Request a new deployment, generating a deployId and an optional GCS upload URL.
     */
    async request(options) {
        return await this.client.request('/deploy/request', {
            method: 'POST',
            body: JSON.stringify(options)
        });
    }
    /**
     * Step 2: Uploads a ZIP buffer or stream to the provided GCS pre-signed URL.
     * Includes a client-side 100MB safety limit if buffer is passed.
     */
    async upload(zipData, uploadUrl, sizeMB) {
        const MAX_SIZE_MB = 100;
        if (Buffer.isBuffer(zipData)) {
            sizeMB = zipData.length / (1024 * 1024);
        }
        if (sizeMB && sizeMB > MAX_SIZE_MB) {
            throw new errors_1.ExovonError(`Upload exceeds ${MAX_SIZE_MB}MB safety limit. Size: ${sizeMB.toFixed(2)}MB`, 400, 'PAYLOAD_TOO_LARGE');
        }
        const headers = {
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
            throw new errors_1.ExovonError(`Failed to upload to GCS: ${response.statusText}`, response.status, 'UPLOAD_FAILED');
        }
    }
    /**
     * Step 3: Trigger the build pipeline or Fast-Path instant promotion.
     * @param deployId - The deployment ID from step 1
     * @param fastPath - If true, server executes Fast-Path (0s Cloud Build) instead of full build
     */
    async start(deployId, fastPath = false) {
        return await this.client.request('/deploy/start', {
            method: 'POST',
            body: JSON.stringify({ deployId, fastPath })
        });
    }
    /**
     * Helper: Zips a local directory to a temp file on disk, applying security exclusions.
     * Returns the path to the temporary zip file.
     */
    async zipDirectory(sourceDir) {
        if (!fs_1.default.existsSync(sourceDir)) {
            throw new errors_1.ExovonError(`Source directory not found: ${sourceDir}`, 404, 'DIR_NOT_FOUND');
        }
        const os = require('os');
        const tmpZipPath = path_1.default.join(os.tmpdir(), `exovon-deploy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.zip`);
        const output = fs_1.default.createWriteStream(tmpZipPath);
        let mod;
        try {
            mod = await Promise.resolve().then(() => __importStar(require('archiver')));
        }
        catch {
            mod = require('archiver');
        }
        const options = { zlib: { level: 9 } };
        let archive;
        if (mod.ZipArchive) {
            archive = new mod.ZipArchive(options);
        }
        else if (typeof mod === 'function') {
            archive = mod('zip', options);
        }
        else if (mod.default && typeof mod.default === 'function') {
            archive = mod.default('zip', options);
        }
        else if (mod.default && mod.default.ZipArchive) {
            archive = new mod.default.ZipArchive(options);
        }
        else {
            throw new errors_1.ExovonError('Failed to initialize archiver module', 500, 'ZIP_INIT_ERROR');
        }
        return new Promise((resolve, reject) => {
            output.on('close', () => resolve(tmpZipPath));
            archive.on('error', (err) => reject(new errors_1.ExovonError(`Zipping failed: ${err.message}`, 500, 'ZIP_ERROR')));
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
            const ignorePath = path_1.default.join(sourceDir, '.exovonignore');
            if (fs_1.default.existsSync(ignorePath)) {
                const lines = fs_1.default.readFileSync(ignorePath, 'utf8').split('\n');
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
    isPrebuiltProject(sourceDir) {
        const pkgPath = path_1.default.join(sourceDir, 'package.json');
        const indexHtmlPath = path_1.default.join(sourceDir, 'index.html');
        const hasIndexHtml = fs_1.default.existsSync(indexHtmlPath);
        if (!fs_1.default.existsSync(pkgPath)) {
            return hasIndexHtml;
        }
        try {
            const pkgContent = fs_1.default.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgContent);
            const hasBuildScript = pkg.scripts && (pkg.scripts.build || pkg.scripts['build:prod']);
            const hasFrameworkDeps = pkg.dependencies && (pkg.dependencies.next ||
                pkg.dependencies.vite ||
                pkg.dependencies.astro ||
                pkg.dependencies.nuxt ||
                pkg.dependencies['@remix-run/react']);
            if (hasBuildScript || hasFrameworkDeps || fs_1.default.existsSync(path_1.default.join(sourceDir, 'Dockerfile'))) {
                return false;
            }
        }
        catch (e) {
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
    async deploy(options, onProgress) {
        // Resolve isPrebuilt: explicit override from CLI flags takes priority over auto-detection
        const isPrebuilt = options.isPrebuilt !== undefined ? options.isPrebuilt : this.isPrebuiltProject(options.sourceDir);
        const deployOpts = { ...options, isPrebuilt };
        if (options.githubRepoFullName) {
            if (onProgress)
                onProgress('Requesting GitHub deployment...');
            const reqRes = await this.request(deployOpts);
            if (onProgress)
                onProgress('Triggering Cloud Build pipeline...');
            const startRes = await this.start(reqRes.deployId, false);
            return { deployId: reqRes.deployId, buildId: startRes.buildId };
        }
        if (isPrebuilt) {
            if (onProgress)
                onProgress('⚡ FAST-PATH DETECTED: Pre-built static project (0s Cloud Build overhead)...');
        }
        else {
            if (onProgress)
                onProgress('Compressing workspace (applying security exclusions)...');
        }
        const tmpZipPath = await this.zipDirectory(options.sourceDir);
        try {
            const stats = fs_1.default.statSync(tmpZipPath);
            const sizeMb = stats.size / (1024 * 1024);
            if (onProgress)
                onProgress(`Requesting signed URL for ${sizeMb.toFixed(2)}MB payload...`);
            const reqRes = await this.request(deployOpts);
            if (reqRes.requiresUpload && reqRes.gcsUploadUrl) {
                if (onProgress)
                    onProgress('Uploading payload to Edge Storage...');
                const stream = fs_1.default.createReadStream(tmpZipPath);
                await this.upload(stream, reqRes.gcsUploadUrl, sizeMb);
            }
            if (isPrebuilt) {
                if (onProgress)
                    onProgress('⚡ Promoting domain instantly to Edge CDN (0s build wait)...');
                const startRes = await this.start(reqRes.deployId, true);
                return { deployId: reqRes.deployId, url: startRes.url, fastPath: true };
            }
            else {
                if (onProgress)
                    onProgress('Triggering Cloud Build pipeline...');
                const startRes = await this.start(reqRes.deployId, false);
                return { deployId: reqRes.deployId, buildId: startRes.buildId, fastPath: false };
            }
        }
        finally {
            if (fs_1.default.existsSync(tmpZipPath)) {
                fs_1.default.unlinkSync(tmpZipPath);
            }
        }
    }
    /**
     * Polls the deployment status and streams logs via offset pagination.
     */
    async pollLogs(deployId, onLogUpdate) {
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
                const res = await this.client.request(`/deploy/${deployId}/logs?offset=${offset}`, {
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
                }
                else if (statusUpper === 'FAILED' || statusUpper === 'TIMEOUT') {
                    return { success: false, finalStatus: statusUpper };
                }
            }
            catch (err) {
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
    async restart(projectId) {
        return await this.client.request('/deploy/restart', {
            method: 'POST',
            body: JSON.stringify({ projectId })
        });
    }
    /**
     * Promotes or rolls back a specific deployment to 100% traffic.
     */
    async promote(deployId) {
        return await this.client.request(`/deploy/${deployId}/promote`, {
            method: 'POST'
        });
    }
    /**
     * Fetches the actual runtime crash logs for a project to help AI Agents debug 500 errors.
     */
    async getCrashLogs(projectId, timeframeMinutes = 60) {
        return await this.client.request(`/deploy/${projectId}/crash-logs?timeframe=${timeframeMinutes}`, {
            method: 'GET'
        });
    }
    /**
     * Lists historical deployment revisions so an AI Agent can decide what to roll back to.
     */
    async listRevisions(projectId) {
        return await this.client.request(`/deploy/${projectId}/revisions`, {
            method: 'GET'
        });
    }
    /**
     * Immediately rolls back a project to the last known successful revision.
     * Useful for autonomous AI self-healing.
     */
    async rollback(projectId) {
        return await this.client.request(`/deploy/${projectId}/rollback`, {
            method: 'POST'
        });
    }
}
exports.DeploymentsClient = DeploymentsClient;
