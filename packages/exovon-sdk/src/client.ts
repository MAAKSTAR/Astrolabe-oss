import { ExovonError, ExovonAuthError, ExovonRateLimitError } from './errors';
import { DeploymentsClient } from './modules/deployments';
import { AnalyticsClient } from './modules/analytics';
import { SecretsClient } from './modules/secrets';
import { ProjectsClient } from './modules/projects';
import { InfrastructureClient } from './modules/infrastructure';
import { BillingClient } from './modules/billing';

export interface ExovonClientOptions {
  apiKey: string;
  region?: 'global' | string;
  baseUrl?: string; // Allow overriding for local testing
}

export class ExovonClient {
  private apiKey: string;
  private baseUrl: string;
  
  public deployments: DeploymentsClient;
  public analytics: AnalyticsClient;
  public secrets: SecretsClient;
  public projects: ProjectsClient;
  public infrastructure: InfrastructureClient;
  public billing: BillingClient;

  constructor(options: ExovonClientOptions) {
    if (!options.apiKey) {
      throw new ExovonError("ExovonClient requires an 'apiKey' property.", 400, 'MISSING_API_KEY');
    }
    
    this.apiKey = options.apiKey;

    // Abstract the GCP routing. Default to production custom domain.
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    } else if (process.env.EXOVON_API_URL) {
      this.baseUrl = process.env.EXOVON_API_URL;
    } else {
      this.baseUrl = process.env.EXOVON_ORCHESTRATOR_URL || 'https://exovon-orchestrator-915509129865.asia-south1.run.app/api';
    }

    this.deployments = new DeploymentsClient(this);
    this.analytics = new AnalyticsClient(this);
    this.secrets = new SecretsClient(this);
    this.projects = new ProjectsClient(this);
    this.infrastructure = new InfrastructureClient(this);
    this.billing = new BillingClient(this);
  }

  /**
   * Internal wrapper for fetch that throws typed errors on non-2xx responses.
   */
  public async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('Content-Type', 'application/json');

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle specific HTTP error codes
      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorBody = await response.text();
          if (errorBody) errorMessage = errorBody;
        } catch (e) {
          // Ignore body parsing errors
        }

        if (response.status === 401 || response.status === 403) {
          throw new ExovonAuthError(errorMessage);
        } else if (response.status === 429) {
          throw new ExovonRateLimitError(errorMessage);
        } else {
          throw new ExovonError(errorMessage, response.status);
        }
      }

      // Handle raw text responses (e.g. streaming logs string)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return (await response.text()) as unknown as T;
      }
    } catch (error: any) {
      // Re-throw ExovonErrors, wrap native fetch NetworkErrors
      if (error instanceof ExovonError) {
        throw error;
      }
      throw new ExovonError(`Network Error: ${error.message}`, 0, 'NETWORK_ERROR');
    }
  }

  /**
   * Validates the API key against the Exovon Orchestrator.
   * A simple lightweight ping to verify authentication.
   */
  public async connect(): Promise<{ success: boolean; userId: string }> {
    // We hit an authenticated endpoint to verify the key
    return await this.request('/github/repos'); // This requires auth, acts as a ping
  }
}
