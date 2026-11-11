import * as fs from 'fs';
import * as path from 'path';
import { classifyDiffusionModel } from './DiffusionChatService';

const MEMORY_REL_PATH = '.vscode/project_memory.json';
const MEMORY_DESCRIPTION = 'Persistent workspace memory storing past session summaries, architectural rules, user preferences, and generated media file path references (no raw image/video bytes).';
const MAX_STORED_SESSIONS = 20;
const MAX_SESSION_CHARS = 4000;

export interface ParsedMemorySession {
  index: number;
  timestamp: string;
  preview: string;
  content: string;
}

export interface ProjectMemoryStore {
  sessions: string[];
  lastUpdated?: string;
}

export interface ProjectMemoryQueryArgs {
  mode?: string;
  count?: number | string;
  n?: number | string;
  limit?: number | string;
  index?: number | string;
  sessionIndex?: number | string;
}

/** Strip raw base64 media payloads from text while keeping saved file path references intact. */
export function sanitizeMemoryText(raw: string): string {
  if (!raw) {
    return '';
  }
  let cleaned = raw
    .replace(/!\[([^\]]*)\]\(data:(?:image|video)\/[^;)]+;base64,[A-Za-z0-9+/=\s]+\)/gi, (_m, alt) => {
      const label = String(alt || '').trim();
      return label ? `[Media Reference: ${label}]` : '[Media Reference]';
    })
    .replace(/<(?:img|video)\b[^>]*\bsrc=["']data:(?:image|video)\/[^"']+["'][^>]*>(?:<\/video>)?/gi, '[Media Reference]')
    .replace(/data:(?:image|video)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi, '[Media Reference (base64 omitted)]')
    .trim();

  if (cleaned.length > MAX_SESSION_CHARS) {
    cleaned = `${cleaned.slice(0, MAX_SESSION_CHARS)}\n...[session entry trimmed for memory budget]`;
  }
  return cleaned;
}

function parseSessionEntry(raw: string, oneBasedIndex: number): ParsedMemorySession {
  const clean = sanitizeMemoryText(raw);
  const tsMatch = clean.match(/^\[Session on ([^\]]+)\]\s*/i);
  const timestamp = tsMatch ? tsMatch[1].trim() : 'Unknown';
  const body = tsMatch ? clean.slice(tsMatch[0].length).trim() : clean;
  const firstNonEmpty = body.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const preview = firstNonEmpty.length > 140 ? `${firstNonEmpty.slice(0, 140)}...` : firstNonEmpty;
  return { index: oneBasedIndex, timestamp, preview, content: body };
}

/** Load .vscode/project_memory.json and auto-heal legacy entries that stored raw base64 or redundant mega-blobs. */
export async function loadProjectMemoryStore(workspaceRoot: string): Promise<ProjectMemoryStore> {
  const memoryFile = path.join(workspaceRoot, MEMORY_REL_PATH);
  if (!fs.existsSync(memoryFile)) {
    return { sessions: [] };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(await fs.promises.readFile(memoryFile, 'utf8'));
  } catch {
    return { sessions: [] };
  }

  const rawSessions: string[] = Array.isArray(parsed?.sessions)
    ? parsed.sessions.filter((s: unknown): s is string => typeof s === 'string')
    : (typeof parsed?.summary === 'string' && parsed.summary.trim() ? [parsed.summary] : []);

  let needsRewrite = Boolean(parsed?.summary && String(parsed.summary).length > 0);
  const cleanedSessions: string[] = [];
  for (const entry of rawSessions) {
    const clean = sanitizeMemoryText(entry);
    if (clean !== entry.trim()) {
      needsRewrite = true;
    }
    if (clean) {
      cleanedSessions.push(clean);
    }
  }

  const bounded = cleanedSessions.slice(-MAX_STORED_SESSIONS);
  if (bounded.length !== rawSessions.length) {
    needsRewrite = true;
  }

  const store: ProjectMemoryStore = {
    sessions: bounded,
    lastUpdated: parsed?.lastUpdated || undefined,
  };

  if (needsRewrite) {
    try {
      await fs.promises.writeFile(
        memoryFile,
        JSON.stringify({
          file: MEMORY_REL_PATH,
          description: MEMORY_DESCRIPTION,
          lastUpdated: store.lastUpdated || new Date().toISOString(),
          sessions: store.sessions,
        }, null, 2),
      );
    } catch {
      // Non-fatal if workspace is read-only
    }
  }

  return store;
}

/** Build a lightweight index header (~120 tokens) instead of dumping full project memory into every system prompt. */
export async function buildProjectMemoryIndex(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot) {
    return '';
  }
  const store = await loadProjectMemoryStore(workspaceRoot);
  if (store.sessions.length === 0) {
    return '';
  }

  const updatedLabel = store.lastUpdated || 'Unknown';
  return `

<|PROJECT_MEMORY_INDEX|>
File: ${MEMORY_REL_PATH}
Description: ${MEMORY_DESCRIPTION}
Sessions Stored: ${store.sessions.length} (Last updated: ${updatedLabel})
Do NOT assume past session notes are preloaded. Invoke \`queryProjectMemory\` ONLY when prior session history is needed:
- queryProjectMemory(mode="count") — return total stored session count and metadata
- queryProjectMemory(mode="list") — list all sessions (1-based index, timestamp, 1-line preview)
- queryProjectMemory(mode="last") — return the latest session summary
- queryProjectMemory(mode="recent", count=N) — return the last N session summaries
- queryProjectMemory(mode="specific", index=K) — return session #K (1-based index: 1..${store.sessions.length})
</|PROJECT_MEMORY_INDEX|>
`;
}

/** Execute selective project memory queries on demand without loading everything into chat context. */
export async function queryProjectMemory(workspaceRoot: string, args: ProjectMemoryQueryArgs = {}): Promise<string> {
  if (!workspaceRoot) {
    return JSON.stringify({ status: 'unavailable', reason: 'No workspace folder is currently open.' });
  }

  const store = await loadProjectMemoryStore(workspaceRoot);
  const parsed = store.sessions.map((s, idx) => parseSessionEntry(s, idx + 1));
  const total = parsed.length;

  const rawIndex = args.index ?? args.sessionIndex;
  const rawCount = args.count ?? args.n ?? args.limit;
  let mode = String(args.mode || '').trim().toLowerCase();
  if (!mode) {
    if (rawIndex !== undefined) {
      mode = 'specific';
    } else if (rawCount !== undefined) {
      mode = 'recent';
    } else {
      mode = total <= 1 ? 'last' : 'list';
    }
  }

  if (total === 0) {
    return JSON.stringify({
      file: MEMORY_REL_PATH,
      description: MEMORY_DESCRIPTION,
      totalSessions: 0,
      lastUpdated: store.lastUpdated || null,
      sessions: [],
    }, null, 2);
  }

  if (mode === 'count' || mode === 'meta' || mode === 'info') {
    return JSON.stringify({
      file: MEMORY_REL_PATH,
      description: MEMORY_DESCRIPTION,
      totalSessions: total,
      lastUpdated: store.lastUpdated || null,
      validRange: `1..${total}`,
    }, null, 2);
  }

  if (mode === 'list' || mode === 'toc' || mode === 'all') {
    return JSON.stringify({
      file: MEMORY_REL_PATH,
      totalSessions: total,
      lastUpdated: store.lastUpdated || null,
      sessions: parsed.map((s) => ({
        index: s.index,
        timestamp: s.timestamp,
        preview: s.preview,
      })),
    }, null, 2);
  }

  if (mode === 'specific' || mode === 'index' || mode === 'get' || mode === 'single') {
    const idxNum = Number(rawIndex);
    if (!Number.isInteger(idxNum) || idxNum < 1 || idxNum > total) {
      return JSON.stringify({
        error: `Invalid session index "${rawIndex}". Valid session range is 1..${total}.`,
        totalSessions: total,
      }, null, 2);
    }
    return JSON.stringify({
      file: MEMORY_REL_PATH,
      totalSessions: total,
      session: parsed[idxNum - 1],
    }, null, 2);
  }

  if (mode === 'recent') {
    const countNum = Math.max(1, Math.min(total, Number(rawCount) || 3));
    return JSON.stringify({
      file: MEMORY_REL_PATH,
      totalSessions: total,
      returnedCount: countNum,
      sessions: parsed.slice(-countNum),
    }, null, 2);
  }

  // Default / "last"
  return JSON.stringify({
    file: MEMORY_REL_PATH,
    totalSessions: total,
    session: parsed[total - 1],
  }, null, 2);
}

/** Summarize a completed non-diffusion conversation turn cleanly, stripping raw base64 media payloads. */
export function buildSanitizedMemoryTranscript(messages: any[]): string {
  return messages.map((m) => {
    const partsText = (m.parts || []).map((p: any) => {
      if (p.inlineData) {
        return `[Media Attachment Reference (${p.inlineData.mimeType || 'image'})]`;
      }
      if (p.text) {
        return sanitizeMemoryText(String(p.text));
      }
      if (p.functionCall) {
        return `[Tool Call: ${p.functionCall.name}]`;
      }
      if (p.functionResponse) {
        return `[Tool Result: ${p.functionResponse.name}]`;
      }
      return '';
    }).filter(Boolean).join(' ');
    return `${m.role ? String(m.role).toUpperCase() : 'USER'}: ${partsText}`;
  }).join('\n\n');
}

/** Persist a concise summary session entry to .vscode/project_memory.json without image/video binaries. */
export async function saveProjectMemorySession(
  workspaceRoot: string,
  targetModel: string,
  messages: any[],
  summarizeFn: (summaryPrompt: string) => Promise<string>,
): Promise<boolean> {
  if (!workspaceRoot || classifyDiffusionModel(targetModel).isDiffusion) {
    return false;
  }

  const transcript = buildSanitizedMemoryTranscript(messages);
  if (!transcript.trim()) {
    return false;
  }

  const summaryPrompt = `You are a project memory summarizer.
Review the following transcript of an AI Agent and a Developer working on a codebase.
Extract a concise summary of:
1. Permanent architectural rules established.
2. User preferences noted.
3. New components or significant logic created (save file paths/references only; NEVER output base64 or raw image data).

Format your response as a tight, bulleted list. Do not include markdown preamble or conversational filler.

<TRANSCRIPT>
${transcript.slice(-15000)}
</TRANSCRIPT>`;

  const rawSummaryText = await summarizeFn(summaryPrompt);
  const summaryText = sanitizeMemoryText(rawSummaryText);
  if (!summaryText) {
    return false;
  }

  const memoryDir = path.join(workspaceRoot, '.vscode');
  const memoryFile = path.join(memoryDir, 'project_memory.json');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const store = await loadProjectMemoryStore(workspaceRoot);
  store.sessions.push(`[Session on ${new Date().toLocaleString()}]\n${summaryText}`);
  const bounded = store.sessions.slice(-MAX_STORED_SESSIONS);
  const lastUpdated = new Date().toISOString();

  await fs.promises.writeFile(
    memoryFile,
    JSON.stringify({
      file: MEMORY_REL_PATH,
      description: MEMORY_DESCRIPTION,
      lastUpdated,
      sessions: bounded,
    }, null, 2),
  );
  return true;
}
