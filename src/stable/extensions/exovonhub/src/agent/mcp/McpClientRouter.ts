import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class McpClientRouter {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();
  private availableTools: Map<string, { serverId: string; tool: any }> = new Map();

  constructor() {}

  public async initialize() {
    const config = vscode.workspace.getConfiguration('exovonhub.mcp');
    const servers = config.get<Record<string, { command: string; args: string[]; env?: Record<string, string> }>>('servers') || {};

    for (const [serverId, serverConfig] of Object.entries(servers)) {
      try {
        console.log(`[MCP] Connecting to server ${serverId}...`);
        await this.connectServer(serverId, serverConfig);
        console.log(`[MCP] Connected to server ${serverId}.`);
      } catch (e) {
        console.error(`[MCP] Failed to connect to server ${serverId}:`, e);
      }
    }
  }

  private async connectServer(serverId: string, config: { command: string; args: string[]; env?: Record<string, string> }) {
    if (this.clients.has(serverId)) return;

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env || (process.env as Record<string, string>)
    });

    const client = new Client({
      name: 'exovonhub-mcp-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    
    this.clients.set(serverId, client);
    this.transports.set(serverId, transport);

    // Fetch and cache tools
    const toolsResponse = await client.listTools();
    for (const tool of toolsResponse.tools) {
      this.availableTools.set(tool.name, { serverId, tool });
    }
  }

  public getTools() {
    return Array.from(this.availableTools.values()).map(entry => entry.tool);
  }

  public hasTool(toolName: string): boolean {
    return this.availableTools.has(toolName);
  }

  public async callTool(toolName: string, args: any): Promise<any> {
    const entry = this.availableTools.get(toolName);
    if (!entry) {
      throw new Error(`MCP Tool ${toolName} not found.`);
    }

    const client = this.clients.get(entry.serverId);
    if (!client) {
      throw new Error(`MCP Server ${entry.serverId} is disconnected.`);
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args
    });

    if (result.isError) {
      throw new Error(`MCP Tool Error: ${(result.content as any[]).map((c: any) => c.text).join('\n')}`);
    }

    return (result.content as any[]).map((c: any) => c.text).join('\n');
  }

  public async dispose() {
    for (const [serverId, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch (e) {
        console.error(`[MCP] Error closing transport for ${serverId}`, e);
      }
    }
    this.clients.clear();
    this.transports.clear();
    this.availableTools.clear();
  }
}
