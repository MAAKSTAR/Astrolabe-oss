import type { ExovonClient } from '../client';

export interface AnalyticsOptions {
  range?: '24h' | '7d' | '30d';
}

export class AnalyticsClient {
  constructor(private client: ExovonClient) {}

  /**
   * Retrieves the aggregated global edge network metrics for a specific project.
   * Powered by the Cloudflare GraphQL API.
   * @param projectId The unique ID of the project
   * @param options Time range options
   */
  public async get(projectId: string, options?: AnalyticsOptions): Promise<any> {
    const range = options?.range || '24h';
    return await this.client.request(`/projects/${projectId}/analytics?range=${range}`, {
      method: 'GET'
    });
  }
}
