import * as vscode from 'vscode';
import { AgentOrchestrator } from '../AgentOrchestrator';

/**
 * Fetches deployment build logs from the Exovon Cloud API.
 * Currently uses a simulated response for testing the agentic pipeline.
 */
export async function fetchCloudLogs(orchestrator: AgentOrchestrator, deployId: string): Promise<string> {
    try {
        orchestrator.sendChatUpdate(`Fetching cloud logs for deployment ${deployId}...`);

        // Simulated HTTP request delay
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Simulated Exovon Backend Response for a failed build
        const mockLogResponse = `
[Exovon Builder] Starting build for deployment ${deployId}
[Exovon Builder] Pulling node:18-alpine base image...
[Exovon Builder] Running npm install...
added 145 packages, and audited 146 packages in 3s
[Exovon Builder] Running npm run build...
> build
> tsc && vite build

src/main.ts(5,45): error TS2304: Cannot find name 'UnknownComponent'.
src/App.tsx(12,10): error TS2322: Type 'string' is not assignable to type 'number'.
npm error Lifecycle script \`build\` failed with error: 
npm error   code 2
npm error   path /workspace
[Exovon Builder] ERROR: Build failed with exit code 2.
`;

        orchestrator.sendChatUpdate('Logs retrieved successfully. Analyzing stack trace...');

        return JSON.stringify({
            status: 'success',
            deployId: deployId,
            logs: mockLogResponse,
            message: 'Logs successfully retrieved from Exovon Cloud.'
        });

    } catch (error: any) {
        return JSON.stringify({ error: `Failed to fetch cloud logs: ${error.message}` });
    }
}
