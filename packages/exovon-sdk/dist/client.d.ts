import { DeploymentsClient } from './modules/deployments';
import { AnalyticsClient } from './modules/analytics';
import { SecretsClient } from './modules/secrets';
import { ProjectsClient } from './modules/projects';
import { InfrastructureClient } from './modules/infrastructure';
import { BillingClient } from './modules/billing';
export interface ExovonClientOptions {
    apiKey: string;
    region?: 'global' | string;
    baseUrl?: string;
}
export declare class ExovonClient {
    private apiKey;
    private baseUrl;
    deployments: DeploymentsClient;
    analytics: AnalyticsClient;
    secrets: SecretsClient;
    projects: ProjectsClient;
    infrastructure: InfrastructureClient;
    billing: BillingClient;
    constructor(options: ExovonClientOptions);
    /**
     * Internal wrapper for fetch that throws typed errors on non-2xx responses.
     */
    request<T = any>(endpoint: string, options?: RequestInit): Promise<T>;
    /**
     * Validates the API key against the Exovon Orchestrator.
     * A simple lightweight ping to verify authentication.
     */
    connect(): Promise<{
        success: boolean;
        userId: string;
    }>;
}
