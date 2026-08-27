import type { ExovonClient } from '../client';

export class ProjectsClient {
  constructor(private client: ExovonClient) {}

  /**
   * Permanently deletes a project and tears down all associated Edge Nodes,
   * DNS records, GCS artifacts, and Secret Manager versions.
   * WARNING: This is irreversible.
   * @param projectId The unique ID of the project
   */
  public async delete(projectId: string): Promise<{ success: boolean }> {
    return await this.client.request(`/projects/${projectId}`, {
      method: 'DELETE'
    });
  }
  /**
   * Returns the health status, uptime, custom domains, and active SSL certs for a project.
   */
  public async status(projectId: string): Promise<{ status: string; url: string; domains: string[]; ssl: string }> {
    return await this.client.request(`/projects/${projectId}/status`, {
      method: 'GET'
    });
  }

  /**
   * Automatically binds a custom domain to the project.
   */
  public async addDomain(projectId: string, domain: string): Promise<{ success: boolean; domain: string }> {
    return await this.client.request(`/projects/${projectId}/domains`, {
      method: 'POST',
      body: JSON.stringify({ domain })
    });
  }

  /**
   * Returns the required DNS CNAME/TXT records for the bound domains.
   */
  public async getDnsRecords(projectId: string): Promise<{ records: Array<{ type: string; name: string; value: string }> }> {
    return await this.client.request(`/projects/${projectId}/dns`, {
      method: 'GET'
    });
  }
}
