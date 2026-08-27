import type { ExovonClient } from '../client';
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
export declare class DeploymentsClient {
    private client;
    constructor(client: ExovonClient);
    /**
     * Step 1: Request a new deployment, generating a deployId and an optional GCS upload URL.
     */
    request(options: DeployRequestOptions): Promise<DeployRequestResult>;
    /**
     * Step 2: Uploads a ZIP buffer or stream to the provided GCS pre-signed URL.
     * Includes a client-side 100MB safety limit if buffer is passed.
     */
    upload(zipData: Buffer | NodeJS.ReadableStream, uploadUrl: string, sizeMB?: number): Promise<void>;
    /**
     * Step 3: Trigger the build pipeline or Fast-Path instant promotion.
     * @param deployId - The deployment ID from step 1
     * @param fastPath - If true, server executes Fast-Path (0s Cloud Build) instead of full build
     */
    start(deployId: string, fastPath?: boolean): Promise<{
        success: boolean;
        deployId: string;
        buildId?: string;
        url?: string;
    }>;
    /**
     * Helper: Zips a local directory to a temp file on disk, applying security exclusions.
     * Returns the path to the temporary zip file.
     */
    private zipDirectory;
    /**
     * Helper: Determines if a local project directory is a pure static / pre-built workspace.
     * Used for auto-detection when --static/--dynamic is not explicitly specified.
     */
    isPrebuiltProject(sourceDir: string): boolean;
    /**
     * Orchestrates the entire deployment lifecycle locally:
     * 1. Detects Fast-Path vs Build-Path (or uses explicit override)
     * 2. Zips the directory
     * 3. Requests upload URL
     * 4. Uploads zip safely
     * 5. Promotes instantly (Fast-Path) or triggers Cloud Build (Build-Path)
     */
    deploy(options: LocalDeployOptions, onProgress?: (step: string) => void): Promise<{
        deployId: string;
        buildId?: string;
        url?: string;
        fastPath?: boolean;
    }>;
    /**
     * Polls the deployment status and streams logs via offset pagination.
     */
    pollLogs(deployId: string, onLogUpdate?: (log: string) => void): Promise<{
        success: boolean;
        finalStatus: string;
    }>;
    /**
     * Triggers a zero-downtime restart for a dynamic Edge Node project.
     */
    restart(projectId: string): Promise<{
        success: boolean;
        revision: string;
    }>;
    /**
     * Promotes or rolls back a specific deployment to 100% traffic.
     */
    promote(deployId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Fetches the actual runtime crash logs for a project to help AI Agents debug 500 errors.
     */
    getCrashLogs(projectId: string, timeframeMinutes?: number): Promise<{
        logs: string;
    }>;
    /**
     * Lists historical deployment revisions so an AI Agent can decide what to roll back to.
     */
    listRevisions(projectId: string): Promise<{
        revisions: Array<{
            deployId: string;
            status: string;
            createdAt: string;
        }>;
    }>;
    /**
     * Immediately rolls back a project to the last known successful revision.
     * Useful for autonomous AI self-healing.
     */
    rollback(projectId: string): Promise<{
        success: boolean;
        deployId: string;
        message: string;
    }>;
}
