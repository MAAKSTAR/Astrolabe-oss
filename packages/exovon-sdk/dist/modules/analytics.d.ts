import type { ExovonClient } from '../client';
export interface AnalyticsOptions {
    range?: '24h' | '7d' | '30d';
}
export declare class AnalyticsClient {
    private client;
    constructor(client: ExovonClient);
    /**
     * Retrieves the aggregated global edge network metrics for a specific project.
     * Powered by the Cloudflare GraphQL API.
     * @param projectId The unique ID of the project
     * @param options Time range options
     */
    get(projectId: string, options?: AnalyticsOptions): Promise<any>;
}
