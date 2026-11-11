import type { Message } from '../types';

export interface CompactionSnapshot {
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  source: 'manual' | 'agent';
  timestamp?: string;
}

export interface ThreadTokenStats {
  activeContextTokens: number;
  sessionTotalTokens: number;
  totalSavedTokens: number;
  compactionCount: number;
  lastCompaction: CompactionSnapshot | null;
}

function estimateTextTokens(text?: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 3.8));
}

/**
 * Compute active KV window tokens, cumulative session tokens, and compaction savings
 * across all messages in a thread (used on live updates, compaction, and reload).
 */
export function computeThreadTokenStats(messages: Message[]): ThreadTokenStats {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      activeContextTokens: 0,
      sessionTotalTokens: 0,
      totalSavedTokens: 0,
      compactionCount: 0,
      lastCompaction: null,
    };
  }

  let sessionTotalTokens = 0;
  let totalSavedTokens = 0;
  let compactionCount = 0;
  let lastCompaction: CompactionSnapshot | null = null;
  let activeContextTokens = 0;

  for (const msg of messages) {
    if (!msg || msg.id === 'welcome') continue;

    if (msg.contextMarkerType === 'cleared') {
      activeContextTokens = 0;
      continue;
    }

    if (msg.contextMarkerType === 'compacted') {
      const after = typeof msg.afterTokens === 'number'
        ? msg.afterTokens
        : estimateTextTokens(msg.text);
      const before = typeof msg.beforeTokens === 'number'
        ? msg.beforeTokens
        : Math.max(activeContextTokens, after);
      const saved = Math.max(0, before - after);
      totalSavedTokens += saved;
      compactionCount += 1;
      lastCompaction = {
        beforeTokens: before,
        afterTokens: after,
        savedTokens: saved,
        source: 'manual',
        timestamp: msg.timestamp,
      };
      activeContextTokens = after;
      continue;
    }

    if (msg.sender === 'agent') {
      const prompt = msg.metrics?.prompt_tokens ?? msg.promptTokens ?? 0;
      const completion = msg.metrics?.completion_tokens ?? 0;
      const turnTotal = msg.metrics?.total_tokens ?? (prompt + completion);
      if (turnTotal > 0) {
        sessionTotalTokens += turnTotal;
      }

      if (msg.autoCompaction) {
        const saved = Math.max(0, msg.autoCompaction.beforeTokens - msg.autoCompaction.afterTokens);
        totalSavedTokens += saved;
        compactionCount += 1;
        lastCompaction = {
          beforeTokens: msg.autoCompaction.beforeTokens,
          afterTokens: msg.autoCompaction.afterTokens,
          savedTokens: saved,
          source: 'agent',
          timestamp: msg.timestamp,
        };
        activeContextTokens = msg.metrics?.prompt_tokens ?? msg.promptTokens ?? msg.autoCompaction.afterTokens;
      } else if (prompt > 0) {
        activeContextTokens = prompt;
      }
    }
  }

  return {
    activeContextTokens,
    sessionTotalTokens,
    totalSavedTokens,
    compactionCount,
    lastCompaction,
  };
}
