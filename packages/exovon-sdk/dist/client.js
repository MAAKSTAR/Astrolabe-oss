"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExovonClient = void 0;
const errors_1 = require("./errors");
const deployments_1 = require("./modules/deployments");
const analytics_1 = require("./modules/analytics");
const secrets_1 = require("./modules/secrets");
const projects_1 = require("./modules/projects");
const infrastructure_1 = require("./modules/infrastructure");
const billing_1 = require("./modules/billing");
class ExovonClient {
    apiKey;
    baseUrl;
    deployments;
    analytics;
    secrets;
    projects;
    infrastructure;
    billing;
    constructor(options) {
        if (!options.apiKey) {
            throw new errors_1.ExovonError("ExovonClient requires an 'apiKey' property.", 400, 'MISSING_API_KEY');
        }
        this.apiKey = options.apiKey;
        // Abstract the GCP routing. Default to production custom domain.
        if (options.baseUrl) {
            this.baseUrl = options.baseUrl;
        }
        else if (process.env.EXOVON_API_URL) {
            this.baseUrl = process.env.EXOVON_API_URL;
        }
        else {
            this.baseUrl = process.env.EXOVON_ORCHESTRATOR_URL || 'https://exovon-orchestrator-915509129865.asia-south1.run.app/api';
        }
        this.deployments = new deployments_1.DeploymentsClient(this);
        this.analytics = new analytics_1.AnalyticsClient(this);
        this.secrets = new secrets_1.SecretsClient(this);
        this.projects = new projects_1.ProjectsClient(this);
        this.infrastructure = new infrastructure_1.InfrastructureClient(this);
        this.billing = new billing_1.BillingClient(this);
    }
    /**
     * Internal wrapper for fetch that throws typed errors on non-2xx responses.
     */
    async request(endpoint, options = {}) {
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
                    if (errorBody)
                        errorMessage = errorBody;
                }
                catch (e) {
                    // Ignore body parsing errors
                }
                if (response.status === 401 || response.status === 403) {
                    throw new errors_1.ExovonAuthError(errorMessage);
                }
                else if (response.status === 429) {
                    throw new errors_1.ExovonRateLimitError(errorMessage);
                }
                else {
                    throw new errors_1.ExovonError(errorMessage, response.status);
                }
            }
            // Handle raw text responses (e.g. streaming logs string)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            else {
                return (await response.text());
            }
        }
        catch (error) {
            // Re-throw ExovonErrors, wrap native fetch NetworkErrors
            if (error instanceof errors_1.ExovonError) {
                throw error;
            }
            throw new errors_1.ExovonError(`Network Error: ${error.message}`, 0, 'NETWORK_ERROR');
        }
    }
    /**
     * Validates the API key against the Exovon Orchestrator.
     * A simple lightweight ping to verify authentication.
     */
    async connect() {
        // We hit an authenticated endpoint to verify the key
        return await this.request('/github/repos'); // This requires auth, acts as a ping
    }
}
exports.ExovonClient = ExovonClient;
