import * as vscode from 'vscode';

export class ApiService {
  // Core AI Backend (handles Quota, Tokens, and Proxying Model API Keys)
  private static readonly BASE_URL = 'https://exovon.in';

  public static async getQuota(token: string | undefined): Promise<number | string> {
    if (!token) { return '...'; }
    try {
      const response = await fetch(`${this.BASE_URL}/api/user/quota?check_only=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: any = await response.json();
        return data.remaining || 0;
      }
      return 'Err';
    } catch (e) {
      return 'Offline';
    }
  }

  public static async getUserProfile(token: string | undefined): Promise<{ remaining: number | string; profilePic: string | undefined; membershipType: string | undefined; displayName: string | undefined; email: string | undefined; modelRates: any[] | undefined; usedPercentage?: number; dailyLimit?: number; tokensUsed?: number; resetsIn?: string }> {
    if (!token) { return { remaining: '...', profilePic: undefined, membershipType: undefined, displayName: undefined, email: undefined, modelRates: undefined }; }
    try {
      // By default we check quota, but if your backend provides a /profile endpoint, change this URL.
      const response = await fetch(`${this.BASE_URL}/api/user/quota?check_only=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: any = await response.json();
        return {
           remaining: data.remaining || 0,
           profilePic: data.profilePic || undefined,
           membershipType: data.membershipType || undefined,
           displayName: data.displayName || data.name || undefined,
           email: data.email || undefined,
           modelRates: data.modelRates || undefined,
           usedPercentage: data.usedPercentage,
           dailyLimit: data.dailyLimit,
           tokensUsed: data.tokensUsed,
           resetsIn: data.resetsIn
        };
      }
      return { remaining: 'Err', profilePic: undefined, membershipType: undefined, displayName: undefined, email: undefined, modelRates: undefined };
    } catch (e) {
      return { remaining: 'Offline', profilePic: undefined, membershipType: undefined, displayName: undefined, email: undefined, modelRates: undefined };
    }
  }

  public static async createSubscriptionLink(token: string | undefined, tier: string = 'pro'): Promise<any> {
    if (!token) { return null; }
    try {
      // Point directly to the Next.js Unified Orchestrator instead of bloating a separate Cloud Run instance
      const response = await fetch(`${this.BASE_URL}/api/payments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tier, clientBaseUrl: this.BASE_URL })
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (e) {
      console.error('ApiService createSubscriptionLink Error:', e);
      return null;
    }
  }

  /**
   * Pings the Exovon Web API to deduct a token and check if the user has quota remaining.
   * If false is returned, the extension should refuse to run the LLM request.
   */
  public static async checkAndDeductQuota(token: string | undefined, model: string): Promise<{ allowed: boolean; remaining: number; percentageUsed?: number; maxQuota?: number; error?: string }> {
    if (!token) {
      return { allowed: false, remaining: 0, error: 'No authentication token found. Please login.' };
    }

    try {
      const response = await fetch(`${this.BASE_URL}/api/user/quota`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'deduct', model: model, tokens: 1000000 }) // Assuming 1M tokens for the percentage math
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
           return { allowed: false, remaining: 0, error: 'Authentication expired or invalid. Please login again.' };
        }
        return { allowed: false, remaining: 0, error: `API Error: ${response.statusText}` };
      }

      const data: any = await response.json();
      return {
        allowed: data.allowed === true,
        remaining: data.remaining || 0,
        percentageUsed: data.percentageUsed,
        maxQuota: data.maxQuota,
        error: data.error
      };

    } catch (err: any) {
      console.error('ApiService Error:', err);
      return { allowed: false, remaining: 0, error: `Network Error: Could not reach Exovon Cloud API. ${err.message}` };
    }
  }
}
