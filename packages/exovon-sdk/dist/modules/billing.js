"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingClient = void 0;
class BillingClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Fetches the current API token usage or monthly cloud spend.
     * Safety guardrail for AI Agents to check before executing expensive operations.
     */
    async getUsage() {
        return await this.client.request(`/billing/usage`, {
            method: 'GET'
        });
    }
}
exports.BillingClient = BillingClient;
