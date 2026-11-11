import { describe, it, expect } from 'vitest';
import { resolveToolStepMeta, canonicalizeToolName } from '../toolStepMetadata';

describe('toolStepMetadata', () => {
  it('maps getChatHistory and its aliases to chatHistory icon and readable filter target', () => {
    const emptyArgs = resolveToolStepMeta({
      type: 'tool',
      toolName: 'getChatHistory',
      content: '{}',
    });
    expect(emptyArgs.iconKind).toBe('chatHistory');
    expect(emptyArgs.actionVerb).toBe('Chat History');
    expect(emptyArgs.targetDisplay).toBe('user messages');

    const limitedAll = resolveToolStepMeta({
      type: 'tool',
      toolName: 'get_chat_history',
      content: JSON.stringify({ limit: 8, userOnly: false }),
    });
    expect(limitedAll.iconKind).toBe('chatHistory');
    expect(limitedAll.targetDisplay).toBe('last 8 msgs');

    // Persisted legacy event that previously saved stale "Get Chat History"
    const legacySaved = resolveToolStepMeta({
      type: 'tool',
      toolName: 'getChatHistory',
      actionVerb: 'Get Chat History',
      targetDisplay: '',
      content: JSON.stringify({ limit: 5 }),
    });
    expect(legacySaved.iconKind).toBe('chatHistory');
    expect(legacySaved.actionVerb).toBe('Chat History');
    expect(legacySaved.targetDisplay).toBe('last 5 user');
  });

  it('distinguishes fetchWebPage and browser tools (fetchPage) from searchWeb (webSearch)', () => {
    const fetchMeta = resolveToolStepMeta({
      type: 'tool',
      toolName: 'fetchWebPage',
      content: JSON.stringify({ url: 'https://react.dev/reference/react/useEffect' }),
    });
    expect(fetchMeta.iconKind).toBe('fetchPage');
    expect(fetchMeta.actionVerb).toBe('Fetch');
    expect(fetchMeta.targetDisplay).toBe('react.dev/reference/react/useEffect');
    expect(fetchMeta.rawTarget).toBe('https://react.dev/reference/react/useEffect');

    const previewMeta = resolveToolStepMeta({
      type: 'tool',
      toolName: 'openBrowserPreview',
      content: JSON.stringify({ url: 'http://localhost:3000/dashboard' }),
    });
    expect(previewMeta.iconKind).toBe('fetchPage');
    expect(previewMeta.actionVerb).toBe('Preview');
    expect(previewMeta.targetDisplay).toBe('localhost:3000/dashboard');

    const highlightMeta = resolveToolStepMeta({
      type: 'tool',
      toolName: 'highlightBrowserElement',
      content: JSON.stringify({ selector: 'button.submit' }),
    });
    expect(highlightMeta.iconKind).toBe('fetchPage');
    expect(highlightMeta.actionVerb).toBe('Highlight');
    expect(highlightMeta.targetDisplay).toBe('button.submit');

    const searchMeta = resolveToolStepMeta({
      type: 'tool',
      toolName: 'searchWeb',
      content: JSON.stringify({ query: 'vite 8 changelog' }),
    });
    expect(searchMeta.iconKind).toBe('webSearch');
    expect(searchMeta.actionVerb).toBe('Web');
    expect(searchMeta.targetDisplay).toBe('"vite 8 changelog"');
  });

  it('separates listDir, viewFile, createDoc, code edits, and deleteFile icons cleanly', () => {
    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'listDir', content: JSON.stringify({ relativePath: 'src/utils' }) })
    ).toMatchObject({ iconKind: 'listDir', actionVerb: 'List', targetDisplay: 'src/utils' });

    const viewMeta = resolveToolStepMeta({
      type: 'tool',
      toolName: 'viewFile',
      content: JSON.stringify({ relativePath: 'src/App.tsx', startLine: 10, endLine: 45 }),
    });
    expect(viewMeta).toMatchObject({
      iconKind: 'readFile',
      actionVerb: 'Read',
      targetDisplay: 'App.tsx',
      lineInfo: '10-45',
    });

    expect(
      resolveToolStepMeta({
        type: 'tool',
        toolName: 'createDoc',
        content: JSON.stringify({ title: 'Architecture Spec', fileName: 'docs/arch.md' }),
      })
    ).toMatchObject({ iconKind: 'createDoc', actionVerb: 'Create Doc', targetDisplay: 'arch.md' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'applyPatch', content: JSON.stringify({ relativePath: 'src/a.ts' }) })
    ).toMatchObject({ iconKind: 'codeEdit', actionVerb: 'Edit', targetDisplay: 'a.ts' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'createFile', content: JSON.stringify({ relativePath: 'src/b.ts' }) })
    ).toMatchObject({ iconKind: 'codeEdit', actionVerb: 'Create', targetDisplay: 'b.ts' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'deleteFile', content: JSON.stringify({ relativePath: 'src/old.ts' }) })
    ).toMatchObject({ iconKind: 'deleteFile', actionVerb: 'Delete', targetDisplay: 'old.ts' });
  });

  it('maps planning, constitution, coordination, memory, graph, image, sub-agent, cloud, and terminal tools', () => {
    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'submitPlan', content: JSON.stringify({ title: 'Refactor Auth' }) })
    ).toMatchObject({ iconKind: 'plan', actionVerb: 'Plan', targetDisplay: 'Refactor Auth' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'queryConstitution', content: JSON.stringify({ topic: 'styling' }) })
    ).toMatchObject({ iconKind: 'plan', actionVerb: 'Constitution', targetDisplay: 'styling' });

    expect(
      resolveToolStepMeta({
        type: 'tool',
        toolName: 'updateConstitution',
        content: JSON.stringify({ category: 'UI', rule_description: 'Prefer 15px quotes' }),
      })
    ).toMatchObject({ iconKind: 'plan', actionVerb: 'Save Rule', targetDisplay: 'UI' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'readCoordination', content: '{}' })
    ).toMatchObject({ iconKind: 'plan', actionVerb: 'Read Coordination' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'updateCoordination', content: JSON.stringify({ task: 'Finish OAuth' }) })
    ).toMatchObject({ iconKind: 'plan', actionVerb: 'Log Coordination', targetDisplay: 'Finish OAuth' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'queryProjectMemory', content: JSON.stringify({ mode: 'recent', count: 3 }) })
    ).toMatchObject({ iconKind: 'memoryGraph', actionVerb: 'Memory', targetDisplay: 'recent 3' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'queryGraph', content: JSON.stringify({ symbolName: 'AgentOrchestrator' }) })
    ).toMatchObject({ iconKind: 'memoryGraph', actionVerb: 'Graph', targetDisplay: 'AgentOrchestrator' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'querySemanticVector', content: JSON.stringify({ concept: 'auth middleware' }) })
    ).toMatchObject({ iconKind: 'memoryGraph', actionVerb: 'Vector Search', targetDisplay: '"auth middleware"' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'getWorkspaceHash', content: '{}' })
    ).toMatchObject({ iconKind: 'memoryGraph', actionVerb: 'Workspace Hash' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'generateImage', content: JSON.stringify({ prompt: 'Minimalist UI' }) })
    ).toMatchObject({ iconKind: 'imageGen', actionVerb: 'Generate Image', targetDisplay: '"Minimalist UI"' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'spawnSubAgent', content: JSON.stringify({ taskDescription: 'Audit CSS' }) })
    ).toMatchObject({ iconKind: 'subAgent', actionVerb: 'Sub-Agent', targetDisplay: 'Audit CSS' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'deployToExovonCloud', content: JSON.stringify({ projectId: 'my-app' }) })
    ).toMatchObject({ iconKind: 'cloudDeploy', actionVerb: 'Deploy', targetDisplay: 'my-app' });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'sendTerminalInput', content: JSON.stringify({ processId: 'proc-1', input: 'y' }) })
    ).toMatchObject({ iconKind: 'terminal', actionVerb: 'Terminal Input', targetDisplay: '"y" → proc-1', isCommand: false });

    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'checkTerminalStatus', content: JSON.stringify({ processId: 'proc-1' }) })
    ).toMatchObject({ iconKind: 'terminal', actionVerb: 'Terminal Status', targetDisplay: 'proc-1' });
  });

  it('handles listAvailableTools, dynamic MCP tools, and special non-tool events', () => {
    expect(
      resolveToolStepMeta({ type: 'tool', toolName: 'listAvailableTools', content: JSON.stringify({ category: 'planning' }) })
    ).toMatchObject({ iconKind: 'toolbox', actionVerb: 'List Tools', targetDisplay: 'planning' });

    const mcpUnknown = resolveToolStepMeta({
      type: 'tool',
      toolName: 'mcp_stripe_create_invoice',
      content: JSON.stringify({ query: 'cust_123' }),
    });
    expect(mcpUnknown.iconKind).toBe('codeEdit');
    expect(mcpUnknown.actionVerb).toBe('stripe create invoice');
    expect(mcpUnknown.targetDisplay).toBe('"cust_123"');

    const mcpGeneric = resolveToolStepMeta({
      type: 'tool',
      toolName: 'mcp_weather_forecast',
      content: JSON.stringify({}),
    });
    expect(mcpGeneric.iconKind).toBe('toolbox');
    expect(mcpGeneric.actionVerb).toBe('weather forecast');

    expect(resolveToolStepMeta({ type: 'think', content: 'reasoning' })).toMatchObject({
      iconKind: 'think',
      actionVerb: 'Think',
    });

    expect(
      resolveToolStepMeta({ id: 'auto-compact-msg1', type: 'log', title: 'KV Compacted (50k -> 12k)' })
    ).toMatchObject({ iconKind: 'compact' });

    expect(
      resolveToolStepMeta({ id: 'log-1', type: 'log', title: 'Plan approved. Executing...' })
    ).toMatchObject({ iconKind: 'plan' });

    expect(canonicalizeToolName('fetch_url')).toBe('fetchWebPage');
    expect(canonicalizeToolName('get_chat_history')).toBe('getChatHistory');
  });
});
