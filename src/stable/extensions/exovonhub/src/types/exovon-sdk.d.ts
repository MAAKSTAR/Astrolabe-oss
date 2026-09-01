declare module '@exovon/sdk' {
  export class ExovonClient {
    constructor(options: { apiKey: string; baseUrl?: string });
    deployments: {
      deploy(config: any, onProgress?: (step: any) => void): Promise<{ deployId: string }>;
      pollLogs(deployId: string, onLog?: (logLine: any) => void): Promise<{ success: boolean; finalStatus?: string; error?: string }>;
    };
  }
}
