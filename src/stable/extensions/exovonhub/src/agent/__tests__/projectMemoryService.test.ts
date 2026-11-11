import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  sanitizeMemoryText,
  loadProjectMemoryStore,
  buildProjectMemoryIndex,
  queryProjectMemory,
  buildSanitizedMemoryTranscript,
  saveProjectMemorySession,
} from '../ProjectMemoryService';

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exovon-memory-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('ProjectMemoryService', () => {
  it('strips markdown/HTML/raw base64 image and video payloads while preserving file path references', () => {
    const raw = [
      '![Generated Art](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ)',
      '<video src="data:video/mp4;base64,AAAAIGZ0eXBpc29t"></video>',
      'Inline dump: data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
      '*Saved to: `assets/generated_scene.png`*',
      '*Saved video to: `assets/generated_clip.mp4`*',
    ].join('\n');

    const cleaned = sanitizeMemoryText(raw);
    expect(cleaned).not.toContain('base64,');
    expect(cleaned).toContain('[Media Reference: Generated Art]');
    expect(cleaned).toContain('[Media Reference]');
    expect(cleaned).toContain('[Media Reference (base64 omitted)]');
    expect(cleaned).toContain('*Saved to: `assets/generated_scene.png`*');
    expect(cleaned).toContain('*Saved video to: `assets/generated_clip.mp4`*');
  });

  it('auto-heals bloated legacy project_memory.json on load and writes compact clean storage', async () => {
    const ws = makeTempWorkspace();
    const memoryDir = path.join(ws, '.vscode');
    const memoryFile = path.join(memoryDir, 'project_memory.json');
    fs.mkdirSync(memoryDir, { recursive: true });

    const bigBase64 = 'A'.repeat(20000);
    fs.writeFileSync(memoryFile, JSON.stringify({
      lastUpdated: '2026-11-09T10:00:00.000Z',
      summary: 'Giant redundant summary blob ' + bigBase64,
      sessions: [
        `[Session on 11/9/2026, 1:00:00 PM]\n![Generated Art](data:image/png;base64,${bigBase64})\n*Saved to: \`assets/art1.png\`*`,
        `[Session on 11/10/2026, 2:00:00 PM]\nRefactored AuthService.ts cleanly.`,
      ],
    }, null, 2));

    const store = await loadProjectMemoryStore(ws);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0]).not.toContain('base64,');
    expect(store.sessions[0]).toContain('assets/art1.png');

    const rewritten = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    expect(rewritten.summary).toBeUndefined();
    expect(rewritten.file).toBe('.vscode/project_memory.json');
    expect(typeof rewritten.description).toBe('string');
    expect(rewritten.sessions).toHaveLength(2);
  });

  it('builds a lightweight index instead of dumping full memory contents', async () => {
    const ws = makeTempWorkspace();
    const memoryDir = path.join(ws, '.vscode');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'project_memory.json'), JSON.stringify({
      lastUpdated: '2026-11-10T12:00:00.000Z',
      sessions: [
        '[Session on 11/9/2026, 10:00:00 AM]\nSECRET_DETAIL_SESSION_1',
        '[Session on 11/10/2026, 11:00:00 AM]\nSECRET_DETAIL_SESSION_2',
      ],
    }));

    const index = await buildProjectMemoryIndex(ws);
    expect(index).toContain('<|PROJECT_MEMORY_INDEX|>');
    expect(index).toContain('File: .vscode/project_memory.json');
    expect(index).toContain('Sessions Stored: 2');
    expect(index).toContain('queryProjectMemory(mode="last")');
    expect(index).not.toContain('SECRET_DETAIL_SESSION_1');
    expect(index).not.toContain('SECRET_DETAIL_SESSION_2');
  });

  it('supports count, list, last, recent, specific, and out-of-range queries via queryProjectMemory', async () => {
    const ws = makeTempWorkspace();
    const memoryDir = path.join(ws, '.vscode');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'project_memory.json'), JSON.stringify({
      lastUpdated: '2026-11-11T09:00:00.000Z',
      sessions: [
        '[Session on 11/9/2026, 1:00:00 PM]\nFirst session summary.',
        '[Session on 11/10/2026, 2:00:00 PM]\nSecond session summary.',
        '[Session on 11/11/2026, 3:00:00 PM]\nThird session summary.',
      ],
    }));

    const countRes = JSON.parse(await queryProjectMemory(ws, { mode: 'count' }));
    expect(countRes.totalSessions).toBe(3);
    expect(countRes.validRange).toBe('1..3');

    const listRes = JSON.parse(await queryProjectMemory(ws, { mode: 'list' }));
    expect(listRes.sessions.map((s: any) => s.index)).toEqual([1, 2, 3]);
    expect(listRes.sessions[1].preview).toBe('Second session summary.');

    const lastRes = JSON.parse(await queryProjectMemory(ws, { mode: 'last' }));
    expect(lastRes.session.index).toBe(3);
    expect(lastRes.session.content).toBe('Third session summary.');

    const recentRes = JSON.parse(await queryProjectMemory(ws, { mode: 'recent', count: 2 }));
    expect(recentRes.returnedCount).toBe(2);
    expect(recentRes.sessions.map((s: any) => s.index)).toEqual([2, 3]);

    const specificRes = JSON.parse(await queryProjectMemory(ws, { mode: 'specific', index: 2 }));
    expect(specificRes.session.content).toBe('Second session summary.');

    const badRes = JSON.parse(await queryProjectMemory(ws, { mode: 'specific', index: 99 }));
    expect(badRes.error).toContain('Invalid session index "99"');
  });

  it('skips diffusion models and strips inline media binaries when saving LLM session memory', async () => {
    const ws = makeTempWorkspace();
    const summarizeMock = vi.fn(async () => '- Built UI panel with image ![x](data:image/png;base64,AAAA) saved at assets/panel.png');

    const skipped = await saveProjectMemorySession(
      ws,
      'flux1-schnell',
      [{ role: 'user', parts: [{ text: 'draw a cat' }] }],
      summarizeMock,
    );
    expect(skipped).toBe(false);
    expect(summarizeMock).not.toHaveBeenCalled();

    const transcript = buildSanitizedMemoryTranscript([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: 'RAW_BASE64_BYTES' } },
          { text: 'Check this screenshot please' },
        ],
      },
    ]);
    expect(transcript).not.toContain('RAW_BASE64_BYTES');
    expect(transcript).toContain('[Media Attachment Reference (image/png)]');

    const saved = await saveProjectMemorySession(
      ws,
      'local:Xing4.0-29B',
      [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'RAW' } }, { text: 'Summarize UI work' }] }],
      summarizeMock,
    );
    expect(saved).toBe(true);
    expect(summarizeMock).toHaveBeenCalledTimes(1);

    const disk = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'project_memory.json'), 'utf8'));
    expect(disk.summary).toBeUndefined();
    expect(disk.sessions).toHaveLength(1);
    expect(disk.sessions[0]).not.toContain('base64,');
    expect(disk.sessions[0]).toContain('assets/panel.png');
  });
});
