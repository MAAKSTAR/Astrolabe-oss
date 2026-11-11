import { describe, it, expect } from 'vitest';
import {
  normalizeDroppedPath,
  extractDroppedPathsFromDataTransfer,
  buildEffectiveHistory,
  parseExternalDropMessage,
} from '../dragDropContext';

function createMockDataTransfer(map: Record<string, string>): Pick<DataTransfer, 'types' | 'getData'> {
  return {
    types: Object.keys(map),
    getData: (type: string) => map[type] ?? '',
  };
}

describe('dragDropContext', () => {
  it('extracts dragged open editor tabs (CodeEditors) and Explorer resources cleanly', () => {
    const dtEditor = createMockDataTransfer({
      codeeditors: JSON.stringify([
        {
          resource: {
            scheme: 'file',
            path: '/workspace/app/src/index.ts',
            external: 'file:///workspace/app/src/index.ts',
          },
        },
      ]),
      'text/plain': 'file:///workspace/app/src/index.ts',
    });

    const parsedEditor = extractDroppedPathsFromDataTransfer(dtEditor);
    expect(parsedEditor.filePaths).toEqual(['/workspace/app/src/index.ts']);
    expect(parsedEditor.snippetText).toBeNull();

    const norm = normalizeDroppedPath('/workspace/app/src/index.ts', '/workspace/app');
    expect(norm.relPath).toBe('src/index.ts');
    expect(norm.cleanPath).toBe('/workspace/app/src/index.ts');
    expect(norm.isImage).toBe(false);
  });

  it('handles multi-line URI lists vs multi-line code snippet drops', () => {
    const dtUris = createMockDataTransfer({
      'text/uri-list': 'file:///proj/a.ts\r\nfile:///proj/b%20c.png\r\n# comment',
    });
    const parsedUris = extractDroppedPathsFromDataTransfer(dtUris);
    expect(parsedUris.filePaths).toEqual(['file:///proj/a.ts', 'file:///proj/b%20c.png']);
    expect(normalizeDroppedPath('file:///proj/b%20c.png').isImage).toBe(true);
    expect(normalizeDroppedPath('file:///proj/b%20c.png').cleanPath).toBe('/proj/b c.png');

    const dtCode = createMockDataTransfer({
      'text/plain': 'function hello() {\n  return 123;\n}',
    });
    const parsedCode = extractDroppedPathsFromDataTransfer(dtCode);
    expect(parsedCode.filePaths).toEqual([]);
    expect(parsedCode.snippetText).toContain('function hello()');
  });

  it('respects compacted and cleared boundaries when building model history', () => {
    const fresh = buildEffectiveHistory([
      { id: 'welcome', sender: 'agent', text: 'Welcome!', timestamp: '10:00' },
    ]);
    expect(fresh.previousMessages).toEqual([]);
    expect(fresh.hasCompactableContent).toBe(false);

    const compacted = buildEffectiveHistory([
      { id: 'welcome', sender: 'agent', text: 'Welcome!', timestamp: '10:00' },
      { id: 'u1', sender: 'user', text: 'Old noisy turn', timestamp: '10:01' },
      { id: 'a1', sender: 'agent', text: 'Old giant answer', timestamp: '10:02' },
      {
        id: 'c1',
        sender: 'agent',
        contextMarkerType: 'compacted',
        text: '## Active Goal\n- Keep only essentials',
        timestamp: '10:03',
      },
    ]);
    expect(compacted.isCompacted).toBe(true);
    expect(compacted.hasCompactableContent).toBe(false);
    expect(compacted.previousMessages).toHaveLength(2);
    expect(compacted.previousMessages[0].text).toContain('Keep only essentials');

    const afterCompacted = buildEffectiveHistory([
      { id: 'u1', sender: 'user', text: 'Old turn', timestamp: '10:01' },
      {
        id: 'c1',
        sender: 'agent',
        contextMarkerType: 'compacted',
        text: '## Brief\n- Essential note',
        timestamp: '10:03',
      },
      { id: 'u2', sender: 'user', text: 'New question', timestamp: '10:04' },
    ]);
    expect(afterCompacted.hasCompactableContent).toBe(true);
    expect(afterCompacted.previousMessages.map((m) => m.text)).toEqual([
      '[COMPACTED CONVERSATION CONTEXT — KEEP EVERYTHING ESSENTIAL]\n## Brief\n- Essential note',
      'Understood. Continuing from compacted working context.',
      'New question',
    ]);

    const cleared = buildEffectiveHistory([
      { id: 'u1', sender: 'user', text: 'Old turn', timestamp: '10:01' },
      { id: 'clr', sender: 'agent', contextMarkerType: 'cleared', text: 'Cleared', timestamp: '10:05' },
    ]);
    expect(cleared.hasClearedBoundary).toBe(true);
    expect(cleared.previousMessages).toEqual([]);
    expect(cleared.hasCompactableContent).toBe(false);
  });

  it('parses external workbench drop messages for files, URIs, and code snippets', () => {
    expect(parseExternalDropMessage(null)).toBeNull();
    expect(parseExternalDropMessage({ type: 'other', paths: ['/a.ts'] })).toBeNull();

    expect(
      parseExternalDropMessage({
        type: 'externalDropFiles',
        paths: [' /home/user/task.md ', '/home/user/task.md', '', '/home/user/test.cpp'],
      }),
    ).toEqual({
      filePaths: ['/home/user/task.md', '/home/user/test.cpp'],
      snippetText: null,
    });

    expect(
      parseExternalDropMessage({
        type: 'externalDropFiles',
        paths: [],
        snippetText: 'file:///proj/readme.md',
      }),
    ).toEqual({
      filePaths: ['file:///proj/readme.md'],
      snippetText: null,
    });

    expect(
      parseExternalDropMessage({
        type: 'externalDropFiles',
        paths: [],
        snippetText: 'printf("hello\\n");',
      }),
    ).toEqual({
      filePaths: [],
      snippetText: 'printf("hello\\n");',
    });
  });
});
