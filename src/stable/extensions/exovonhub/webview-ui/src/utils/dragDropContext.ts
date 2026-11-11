import type { Message } from '../types';

export interface ContextFileItem {
  name: string;
  path?: string;
  type: string;
}

export interface HistoryTurnPayload {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
}

export interface EffectiveHistoryResult {
  previousMessages: HistoryTurnPayload[];
  isCompacted: boolean;
  hasClearedBoundary: boolean;
  hasCompactableContent: boolean;
}

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i;
const LIKELY_FILENAME_REGEX = /^[\w\-. /\\()]+\.[a-zA-Z0-9]{1,10}$/;
const KNOWN_EXTENSIONLESS_FILENAMES = new Set([
  'dockerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'procfile',
  'readme',
  'license',
  '.gitignore',
  '.env',
]);

function stripFileScheme(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('file://')) {
    cleaned = cleaned.replace(/^file:\/\//i, '');
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // Keep raw decoded string on malformed escapes
    }
    if (/^\/[a-zA-Z]:[/\\]/.test(cleaned)) {
      cleaned = cleaned.slice(1);
    }
  }
  return cleaned;
}

/** Normalize a dropped path or URI into an exact path + clean workspace display name. */
export function normalizeDroppedPath(
  rawPath: string,
  workspaceRoot?: string,
): { cleanPath: string; relPath: string; isImage: boolean } {
  const cleanPath = stripFileScheme(rawPath);
  const normPath = cleanPath.replace(/\\/g, '/');
  const normWs = (workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');

  let relPath = normPath;
  if (normWs && normPath.startsWith(`${normWs}/`)) {
    relPath = normPath.slice(normWs.length + 1);
  } else if (normWs && normPath.includes('/')) {
    const wsBasename = normWs.split('/').filter(Boolean).pop();
    if (wsBasename && normPath.includes(`/${wsBasename}/`)) {
      relPath = normPath.split(`/${wsBasename}/`).pop() || normPath;
    } else if (normPath.startsWith('/')) {
      const parts = normPath.split('/').filter(Boolean);
      relPath = parts.length > 2 ? parts.slice(-2).join('/') : (parts[parts.length - 1] || normPath);
    }
  }

  return {
    cleanPath,
    relPath: relPath || cleanPath,
    isImage: IMAGE_EXT_REGEX.test(cleanPath),
  };
}

function looksLikePathOrUri(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }
  return (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('/') ||
    /^[a-zA-Z]:[/\\]/.test(trimmed) ||
    LIKELY_FILENAME_REGEX.test(trimmed) ||
    KNOWN_EXTENSIONLESS_FILENAMES.has(trimmed.toLowerCase())
  );
}

function collectPathsFromStructuredPayload(node: unknown, out: string[]): void {
  if (!node) {
    return;
  }
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed.startsWith('file://') || trimmed.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(trimmed)) {
      out.push(trimmed);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPathsFromStructuredPayload(item, out);
    }
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, any>;
    if (obj.editor) {
      collectPathsFromStructuredPayload(obj.editor, out);
    }
    const candidates = [
      obj.fsPath,
      obj.path,
      obj.external,
      typeof obj.resource === 'string' ? obj.resource : (obj.resource?.fsPath || obj.resource?.path || obj.resource?.external),
      obj.resourceUri?.fsPath || obj.resourceUri?.path || obj.resourceUri?.external,
      typeof obj.uri === 'string' ? obj.uri : (obj.uri?.fsPath || obj.uri?.path || obj.uri?.external),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        out.push(candidate.trim());
        break;
      }
    }
    if (Array.isArray(obj.resourceList)) {
      collectPathsFromStructuredPayload(obj.resourceList, out);
    }
    if (Array.isArray(obj.elements)) {
      collectPathsFromStructuredPayload(obj.elements, out);
    }
  }
}

/** Extract dragged file URIs/paths from VS Code Explorer, Editor Tabs, or OS drops without inserting raw URIs as text. */
export function extractDroppedPathsFromDataTransfer(
  dataTransfer: Pick<DataTransfer, 'types' | 'getData'>,
): { filePaths: string[]; snippetText: string | null } {
  const rawPaths: string[] = [];

  const candidateTypes = [
    'ResourceURLs',
    'resourceurls',
    'CodeEditors',
    'codeeditors',
    'CodeFiles',
    'codefiles',
    'application/vnd.code.uri-list',
    'application/vnd.code.editor',
    'application/vnd.code.resource',
    'application/vnd.code.tree.transfer',
    'codeitems',
    'text/uri-list',
  ];

  for (const mimeType of candidateTypes) {
    const data = dataTransfer.getData(mimeType);
    if (!data) {
      continue;
    }
    try {
      collectPathsFromStructuredPayload(JSON.parse(data), rawPaths);
    } catch {
      const lines = data.split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
      for (const line of lines) {
        if (looksLikePathOrUri(line)) {
          rawPaths.push(line);
        }
      }
    }
  }

  for (const t of Array.from(dataTransfer.types || [])) {
    if (t === 'Files' || t === 'text/plain' || candidateTypes.includes(t)) {
      continue;
    }
    const data = dataTransfer.getData(t);
    if (data && (data.includes('{') || data.includes('['))) {
      try {
        collectPathsFromStructuredPayload(JSON.parse(data), rawPaths);
      } catch {
        // Ignore non-JSON custom payloads
      }
    }
  }

  const deduped = Array.from(new Set(rawPaths.map((p) => p.trim()).filter(Boolean)));
  if (deduped.length > 0) {
    return { filePaths: deduped, snippetText: null };
  }

  const textPlain = dataTransfer.getData('text/plain') || '';
  const trimmedPlain = textPlain.trim();
  if (!trimmedPlain) {
    return { filePaths: [], snippetText: null };
  }

  const lines = trimmedPlain.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => line.startsWith('file://') || line.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(line))) {
    return { filePaths: Array.from(new Set(lines)), snippetText: null };
  }

  if (lines.length === 1 && looksLikePathOrUri(lines[0])) {
    return { filePaths: [lines[0]], snippetText: null };
  }

  return { filePaths: [], snippetText: trimmedPlain };
}

/** Build the effective LLM context window from the latest cleared/compacted boundary while keeping full UI history visible. */
export function buildEffectiveHistory(messages: Message[]): EffectiveHistoryResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      previousMessages: [],
      isCompacted: false,
      hasClearedBoundary: false,
      hasCompactableContent: false,
    };
  }

  let lastMarkerIdx = -1;
  let lastMarkerType: 'compacted' | 'cleared' | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const marker = messages[i]?.contextMarkerType;
    if (marker === 'compacted' || marker === 'cleared') {
      lastMarkerIdx = i;
      lastMarkerType = marker;
      break;
    }
  }

  const previousMessages: HistoryTurnPayload[] = [];
  if (lastMarkerType === 'compacted' && lastMarkerIdx !== -1) {
    const marker = messages[lastMarkerIdx];
    previousMessages.push(
      {
        id: `${marker.id}-ctx-user`,
        sender: 'user',
        text: `[COMPACTED CONVERSATION CONTEXT — KEEP EVERYTHING ESSENTIAL]\n${marker.text}`,
        timestamp: marker.timestamp,
      },
      {
        id: `${marker.id}-ctx-ack`,
        sender: 'agent',
        text: 'Understood. Continuing from compacted working context.',
        timestamp: marker.timestamp,
      },
    );
  }

  const sliceStart = lastMarkerIdx === -1 ? 0 : lastMarkerIdx + 1;
  const tailMessages = messages.slice(sliceStart).filter(
    (m) => m.id !== 'welcome' && !m.contextMarkerType && Boolean(m.text && m.text.trim()),
  );

  for (const m of tailMessages) {
    previousMessages.push({
      id: m.id,
      sender: m.sender,
      text: m.text,
      timestamp: m.timestamp,
    });
  }

  const hasCompactableContent = lastMarkerType === 'compacted'
    ? tailMessages.length > 0
    : previousMessages.length > 0;

  return {
    previousMessages,
    isCompacted: lastMarkerType === 'compacted',
    hasClearedBoundary: lastMarkerType === 'cleared',
    hasCompactableContent,
  };
}

export interface ExternalDropPayload {
  filePaths: string[];
  snippetText: string | null;
}

/**
 * Parses `externalDropFiles` bridge messages posted by the workbench webview
 * container when IDE tabs, Explorer items, OS files, or snippets are dropped
 * across the Electron/Wayland webview boundary.
 */
export function parseExternalDropMessage(raw: unknown): ExternalDropPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const msg = raw as { type?: unknown; paths?: unknown; snippetText?: unknown };
  if (msg.type !== 'externalDropFiles') {
    return null;
  }

  const seen = new Set<string>();
  const filePaths: string[] = [];
  if (Array.isArray(msg.paths)) {
    for (const item of msg.paths) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        filePaths.push(trimmed);
      }
    }
  }

  let snippetText: string | null = null;
  if (filePaths.length === 0 && typeof msg.snippetText === 'string' && msg.snippetText.trim()) {
    const fallback = extractDroppedPathsFromDataTransfer({
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? (msg.snippetText as string) : ''),
    });
    for (const p of fallback.filePaths) {
      if (!seen.has(p)) {
        seen.add(p);
        filePaths.push(p);
      }
    }
    snippetText = fallback.snippetText;
  }

  return filePaths.length > 0 || snippetText ? { filePaths, snippetText } : null;
}
