import type { ExovonClient } from '../client';
export declare class SecretsClient {
    private client;
    constructor(client: ExovonClient);
    /**
     * Programmatically updates the environment variables for a project.
     * Note: Variables must be a flat JSON object. Maximum 50 keys, 4KB total size.
     * @param projectId The unique ID of the project
     * @param secrets Key-value object of environment variables
     */
    update(projectId: string, secrets: Record<string, string>): Promise<{
        success: boolean;
        version: string;
    }>;
    /**
     * Introspects the environment to see what keys are configured (without exposing values).
     * Vital for AI Agents to check if a database URL or API key is missing.
     */
    listKeys(projectId: string): Promise<{
        keys: string[];
    }>;
    /**
     * Pulls the full environment variable dictionary for a project (values included).
     * Vital for synchronizing local development environments (.env.local) with production.
     */
    pull(projectId: string): Promise<{
        secrets: Record<string, string>;
    }>;
    /**
     * Deletes a specific secret key from the project's environment.
     */
    delete(projectId: string, key: string): Promise<{
        success: boolean;
    }>;
}
