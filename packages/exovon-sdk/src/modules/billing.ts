import type { ExovonClient } from '../client';

export class BillingClient {
  constructor(private client: ExovonClient) {}

  /**
   * Fetches the current API token usage or monthly cloud spend.
   * Safety guardrail for AI Agents to check before executing expensive operations.
   */
  public async getUsage(): Promise<{ remainingTokens: number; currentSpendUsd: number; limitsReached: boolean }> {
    return await this.client.request(`/billing/usage`, {
      method: 'GET'
    });
  }
}
