"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsClient = void 0;
class AnalyticsClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Retrieves the aggregated global edge network metrics for a specific project.
     * Powered by the Cloudflare GraphQL API.
     * @param projectId The unique ID of the project
     * @param options Time range options
     */
    async get(projectId, options) {
        const range = options?.range || '24h';
        return await this.client.request(`/projects/${projectId}/analytics?range=${range}`, {
            method: 'GET'
        });
    }
}
exports.AnalyticsClient = AnalyticsClient;
