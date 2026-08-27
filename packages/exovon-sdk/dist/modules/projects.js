"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectsClient = void 0;
class ProjectsClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Permanently deletes a project and tears down all associated Edge Nodes,
     * DNS records, GCS artifacts, and Secret Manager versions.
     * WARNING: This is irreversible.
     * @param projectId The unique ID of the project
     */
    async delete(projectId) {
        return await this.client.request(`/projects/${projectId}`, {
            method: 'DELETE'
        });
    }
    /**
     * Returns the health status, uptime, custom domains, and active SSL certs for a project.
     */
    async status(projectId) {
        return await this.client.request(`/projects/${projectId}/status`, {
            method: 'GET'
        });
    }
    /**
     * Automatically binds a custom domain to the project.
     */
    async addDomain(projectId, domain) {
        return await this.client.request(`/projects/${projectId}/domains`, {
            method: 'POST',
            body: JSON.stringify({ domain })
        });
    }
    /**
     * Returns the required DNS CNAME/TXT records for the bound domains.
     */
    async getDnsRecords(projectId) {
        return await this.client.request(`/projects/${projectId}/dns`, {
            method: 'GET'
        });
    }
}
exports.ProjectsClient = ProjectsClient;
