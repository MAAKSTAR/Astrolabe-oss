import type { ExovonClient } from '../client';
export declare class BillingClient {
    private client;
    constructor(client: ExovonClient);
    /**
     * Fetches the current API token usage or monthly cloud spend.
     * Safety guardrail for AI Agents to check before executing expensive operations.
     */
    getUsage(): Promise<{
        remainingTokens: number;
        currentSpendUsd: number;
        limitsReached: boolean;
    }>;
}
