import { describe, it, expect } from 'vitest';
import { computeThreadTokenStats } from '../threadTokenStats';
import type { Message } from '../../types';

describe('computeThreadTokenStats', () => {
  it('tracks active KV tokens, cumulative session tokens, and manual compaction savings', () => {
    const msgs: Message[] = [
      { id: 'welcome', sender: 'agent', text: 'Welcome', timestamp: '10:00' },
      { id: 'u1', sender: 'user', text: 'Inspect files', timestamp: '10:01' },
      {
        id: 'a1',
        sender: 'agent',
        text: 'Done',
        timestamp: '10:02',
        metrics: { prompt_tokens: 1800, completion_tokens: 200, total_tokens: 2000 },
      },
      { id: 'u2', sender: 'user', text: 'Fix bug', timestamp: '10:03' },
      {
        id: 'a2',
        sender: 'agent',
        text: 'Fixed',
        timestamp: '10:04',
        metrics: { prompt_tokens: 4600, completion_tokens: 400, total_tokens: 5000 },
      },
      {
        id: 'c1',
        sender: 'agent',
        text: 'Brief summary',
        timestamp: '10:05',
        contextMarkerType: 'compacted',
        beforeTokens: 4600,
        afterTokens: 320,
      },
    ];

    const stats = computeThreadTokenStats(msgs);
    expect(stats.activeContextTokens).toBe(320);
    expect(stats.sessionTotalTokens).toBe(7000);
    expect(stats.totalSavedTokens).toBe(4280);
    expect(stats.compactionCount).toBe(1);
    expect(stats.lastCompaction).toEqual({
      beforeTokens: 4600,
      afterTokens: 320,
      savedTokens: 4280,
      source: 'manual',
      timestamp: '10:05',
    });
  });

  it('tracks automatic agent compaction and subsequent turn growth plus clear reset', () => {
    const msgs: Message[] = [
      { id: 'u1', sender: 'user', text: 'Refactor project', timestamp: '11:00' },
      {
        id: 'a1',
        sender: 'agent',
        text: 'Refactored',
        timestamp: '11:02',
        autoCompaction: { beforeTokens: 98000, afterTokens: 28000, savedTokens: 70000 },
        metrics: { prompt_tokens: 31000, completion_tokens: 500, total_tokens: 31500 },
      },
    ];

    const midStats = computeThreadTokenStats(msgs);
    expect(midStats.activeContextTokens).toBe(31000);
    expect(midStats.sessionTotalTokens).toBe(31500);
    expect(midStats.totalSavedTokens).toBe(70000);
    expect(midStats.lastCompaction?.source).toBe('agent');

    const clearedStats = computeThreadTokenStats([
      ...msgs,
      { id: 'clr', sender: 'agent', text: 'Cleared', timestamp: '11:05', contextMarkerType: 'cleared' },
    ]);
    expect(clearedStats.activeContextTokens).toBe(0);
    expect(clearedStats.sessionTotalTokens).toBe(31500);
    expect(clearedStats.totalSavedTokens).toBe(70000);
  });
});
