export interface PlanStep {
  id: string;
  text: string;
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'success' | 'failed';
}

export interface TimelineEvent {
  id: string;
  type: 'think' | 'tool' | 'log';
  status: 'running' | 'success' | 'failed' | 'pending';
  title?: string;
  content?: string;
  toolName?: string;
  output?: string;
  checkpointId?: string;
}

export interface InferenceMetrics {
  prompt_tokens?: number;
  prompt_time_ms?: number;
  prompt_tps?: number;
  completion_tokens?: number;
  completion_time_ms?: number;
  completion_tps?: number;
  total_time_ms?: number;
}

export interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  reasoning?: string; // Legacy
  timestamp: string;
  planSteps?: PlanStep[];
  toolCalls?: ToolCall[]; // Legacy
  rawStream?: string;
  logs?: { text: string; logType?: string }[]; // Legacy
  timeline?: TimelineEvent[]; // New unified timeline
  checkpointId?: string;
  checkpoint?: any;

  isCommandApproval?: boolean;
  isFileApproval?: boolean;
  approvalId?: string;
  commandToApprove?: string;
  fileChangeType?: 'modify' | 'create' | 'delete';
  filePathToApprove?: string;
  fileDetailsToApprove?: string;
  isHistory?: boolean;
  isPlanReview?: boolean;
  planMarkdown?: string;
  startTime?: number;
  endTime?: number;
  images?: string[]; // Array of base64 data URLs
  promptTokens?: number;
  promptProcessed?: number;
  metrics?: InferenceMetrics;
}

export interface Deployment {
  id: string;
  subdomain: string;
  url: string;
  status: 'active' | 'building' | 'failed';
  date: string;
  buildTime: string;
}

export interface ChatThread {
  id: string;
  title: string;
  updated_at: number;
  message_count?: number;
  preview?: string;
}

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
