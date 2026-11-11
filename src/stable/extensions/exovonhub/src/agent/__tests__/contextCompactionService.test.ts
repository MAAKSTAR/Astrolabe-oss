import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';

const findFilesMock = vi.fn(async (..._args: any[]) => []);

vi.mock('vscode', () => ({
  workspace: {
    findFiles: (...args: any[]) => findFilesMock(...args),
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

import {
  formatMessagesForCompaction,
  buildCompactionPrompts,
  cleanCompactedOutput,
  compactConversationWithLlm,
} from '../ContextCompactionService';
import { resolveContextFilesContent } from '../ContextFileResolver';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exovon-compact-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  findFilesMock.mockReset();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('ContextCompactionService', () => {
  it('slices messages at latest cleared/compacted boundary and strips base64 payloads', () => {
    const formatted = formatMessagesForCompaction([
      { id: '1', sender: 'user', text: 'STALE_BEFORE_CLEAR' },
      { id: '2', sender: 'agent', text: 'STALE_ANSWER_BEFORE_CLEAR' },
      { id: '3', sender: 'agent', contextMarkerType: 'cleared', text: 'Context cleared' },
      { id: '4', sender: 'user', text: 'Inspect ![shot](data:image/png;base64,AAAA)', contextFiles: ['src/App.tsx'] },
      {
        id: '5',
        sender: 'agent',
        text: 'Found bug in App.tsx. *Saved to: `assets/fixed.png`*',
        timeline: [{ type: 'tool', toolName: 'viewFile', status: 'success' }],
      },
    ]);

    expect(formatted.transcript).not.toContain('STALE_BEFORE_CLEAR');
    expect(formatted.transcript).not.toContain('base64,');
    expect(formatted.transcript).toContain('[Attached files: src/App.tsx]');
    expect(formatted.transcript).toContain('assets/fixed.png');
    expect(formatted.transcript).toContain('[Tools run: viewFile(success)]');
    expect(formatted.anchorMessageId).toBe('5');
    expect(formatted.beforeTokens).toBeGreaterThan(0);
  });

  it('prompts the LLM to keep essentials and forget stale noise, stripping thought tags', async () => {
    const { systemPrompt, userPrompt } = buildCompactionPrompts('USER: Fix auth bug');
    expect(systemPrompt).toContain('KEEP everything necessary');
    expect(systemPrompt).toContain('FORGET everything unnecessary');
    expect(userPrompt).toContain('<CONVERSATION>');

    expect(cleanCompactedOutput('<thought>internal scratchpad</thought>## Active Goal\n- Fix bug')).toBe(
      '## Active Goal\n- Fix bug',
    );

    const mockLlm = vi.fn(async () => '<think>thinking...</think>## Active Goal\n- Fix App.tsx line 10');
    const res = await compactConversationWithLlm({
      model: 'local:Xing4.0-29B',
      messages: [
        { id: 'm1', sender: 'user', text: 'Please read App.tsx and fix the bug and write tests' },
        { id: 'm2', sender: 'agent', text: 'Lots of verbose exploration output '.repeat(20) },
      ],
      reportedContextTokens: 4800,
      customLlmCall: mockLlm,
    });

    expect(mockLlm).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.compactedSummary).toBe('## Active Goal\n- Fix App.tsx line 10');
    expect(res.compactedSummary).not.toContain('<think>');
    expect(res.beforeTokens).toBe(4800);
    expect(res.beforeTokens).toBeGreaterThan(res.afterTokens);
  });

  it('rejects diffusion models and empty histories cleanly', async () => {
    const diffRes = await compactConversationWithLlm({
      model: 'diffusion:flux1-schnell',
      messages: [{ id: '1', sender: 'user', text: 'hi' }],
    });
    expect(diffRes.success).toBe(false);
    expect(diffRes.error).toContain('text LLM');

    const emptyRes = await compactConversationWithLlm({
      model: 'local:Xing4.0',
      messages: [],
    });
    expect(emptyRes.success).toBe(false);
  });

  it('resolves dropped absolute, file:// URL, relative, and duplicate context files cleanly', async () => {
    const ws = makeTempDir();
    const nestedDir = path.join(ws, 'src');
    fs.mkdirSync(nestedDir, { recursive: true });
    const fileA = path.join(nestedDir, 'My File.ts');
    const fileB = path.join(ws, 'notes.md');
    fs.writeFileSync(fileA, 'export const answer = 42;');
    fs.writeFileSync(fileB, '# Design Notes');

    const outsideDir = makeTempDir();
    const externalFile = path.join(outsideDir, 'external.py');
    fs.writeFileSync(externalFile, 'print("hello from outside workspace")');

    const content = await resolveContextFilesContent(ws, [
      `file://${encodeURI(fileA)}`,
      'src/My File.ts', // duplicate after resolution
      'notes.md',
      externalFile,
    ]);

    expect(content).toContain('[Context File: src/My File.ts]');
    expect(content).toContain('export const answer = 42;');
    expect(content).toContain('[Context File: notes.md]');
    expect(content).toContain('# Design Notes');
    expect(content).toContain(`[Context File: ${externalFile}]`);
    expect(content).toContain('print("hello from outside workspace")');
    expect(content.match(/\[Context File: src\/My File\.ts\]/g)?.length).toBe(1);
  });
});
