import type { ExovonClient } from '../client';
export declare class InfrastructureClient {
    private client;
    constructor(client: ExovonClient);
    /**
     * Dynamically provisions a managed database instance (e.g. PostgreSQL or Redis).
     * Vital for AI Agents that detect a need for a database and want to self-provision it.
     */
    provisionDatabase(projectId: string, options: {
        type: 'postgres' | 'redis';
        size?: string;
    }): Promise<{
        success: boolean;
        connectionString: string;
    }>;
    /**
     * Provisions a scalable object storage bucket bound to the project.
     */
    provisionStorage(projectId: string, options?: {
        publicRead?: boolean;
    }): Promise<{
        success: boolean;
        bucketName: string;
    }>;
}
