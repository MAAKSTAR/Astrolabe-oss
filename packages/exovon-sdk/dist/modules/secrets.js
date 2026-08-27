"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretsClient = void 0;
const errors_1 = require("../errors");
class SecretsClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Programmatically updates the environment variables for a project.
     * Note: Variables must be a flat JSON object. Maximum 50 keys, 4KB total size.
     * @param projectId The unique ID of the project
     * @param secrets Key-value object of environment variables
     */
    async update(projectId, secrets) {
        // Client-side validation to prevent API spam
        const keys = Object.keys(secrets);
        if (keys.length > 50) {
            throw new errors_1.ExovonError('Maximum 50 environment variables allowed per project.', 400, 'SECRETS_LIMIT_EXCEEDED');
        }
        const payloadString = JSON.stringify(secrets);
        if (Buffer.byteLength(payloadString, 'utf8') > 4096) {
            throw new errors_1.ExovonError('Secrets payload exceeds the 4KB limit.', 400, 'SECRETS_PAYLOAD_TOO_LARGE');
        }
        for (const key of keys) {
            if (!/^[A-Z0-9_]+$/.test(key)) {
                throw new errors_1.ExovonError(`Invalid secret key: ${key}. Only uppercase alphanumeric and underscores allowed.`, 400, 'INVALID_SECRET_KEY');
            }
        }
        return await this.client.request('/secrets/update', {
            method: 'POST',
            body: JSON.stringify({ projectId, secrets })
        });
    }
    /**
     * Introspects the environment to see what keys are configured (without exposing values).
     * Vital for AI Agents to check if a database URL or API key is missing.
     */
    async listKeys(projectId) {
        return await this.client.request(`/secrets/${projectId}/keys`, {
            method: 'GET'
        });
    }
    /**
     * Pulls the full environment variable dictionary for a project (values included).
     * Vital for synchronizing local development environments (.env.local) with production.
     */
    async pull(projectId) {
        return await this.client.request(`/secrets/${projectId}/pull`, {
            method: 'GET'
        });
    }
    /**
     * Deletes a specific secret key from the project's environment.
     */
    async delete(projectId, key) {
        return await this.client.request(`/secrets/${projectId}/${key}`, {
            method: 'DELETE'
        });
    }
}
exports.SecretsClient = SecretsClient;
