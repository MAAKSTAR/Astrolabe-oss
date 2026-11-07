export interface GovernorStatus {
  cpuThreads: number;
  allocatedMb: number;
  totalMemMb: number;
  nodeCount: number;
  engine: string;
  pruningGuardrails: string;
}

export interface IBrainCoordinator {
  worldVersion: number;
  isSyncing: boolean;
  getGovernorStatus(): GovernorStatus;
  forceFlushNow(): Promise<void>;
  contextCard(prompt: string): Promise<string>;
  getGraphForFile(filePath: string): any[];
  getChatThreads(workspacePath?: string): Array<{ id: string; title: string; updated_at: number; message_count?: number; preview?: string; workspace_path?: string }>;
  getChatMessages(threadId: string): any[];
  createNewThread(workspacePath?: string): string;
  renameChatThread(threadId: string, title: string): void;
  deleteChatThread(threadId: string): void;
  clearAllChatThreads(workspacePath?: string): void;
  saveChatMessage(threadId: string, message: any): void;
  deleteChatMessage(threadId: string, messageId: string): void;
  recordCommit(branch: string, hash: string): Promise<void>;
  loadChatThread(threadId: string): any[];
  impactAnalysis(entityName: string): Promise<any[]>;
  smartSearch(userQuery: string): Promise<any[]>;
}

export interface IAgentOrchestrator {
  execute(prompt: string, model: string, previousMessages?: any[]): Promise<void>;
  cancel(): void;
  getFsTools(): any;
  sendChatUpdate(text: string): void;
}
