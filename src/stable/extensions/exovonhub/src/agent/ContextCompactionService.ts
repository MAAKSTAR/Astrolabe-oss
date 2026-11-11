import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { buildOpenAiPayload } from './modelMapper';
import { classifyDiffusionModel } from './DiffusionChatService';
import { sanitizeMemoryText } from './ProjectMemoryService';

const MAX_COMPACTION_INPUT_CHARS = 28000;
const MAX_SINGLE_TURN_CHARS = 3500;

export interface CompactableMessage {
  id?: string;
  sender?: string;
  role?: string;
  text?: string;
  contextFiles?: string[];
  contextMarkerType?: 'compacted' | 'cleared';
  timeline?: Array<{
    type?: string;
    toolName?: string;
    title?: string;
    status?: string;
    output?: string;
  }>;
}

export interface CompactContextParams {
  model: string;
  messages: CompactableMessage[];
  context?: vscode.ExtensionContext;
  maxContextTokens?: number;
  reportedContextTokens?: number;
  customLlmCall?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export interface CompactContextResult {
  success: boolean;
  compactedSummary: string;
  beforeTokens: number;
  afterTokens: number;
  anchorMessageId?: string;
  modelUsed: string;
  error?: string;
}

/** Rough BPE token estimate calibrated to local/OpenAI tokenizers. */
export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.round(text.length / 3.8));
}

/** Strip raw base64 images/videos while preserving file paths and technical context. */
export function stripMediaPayloadsForCompaction(raw: string): string {
  return sanitizeMemoryText(raw || '');
}

/** Remove internal chain-of-thought tags so only the clean compacted memory remains. */
export function cleanCompactedOutput(raw: string): string {
  if (!raw) {
    return '';
  }
  return raw
    .replace(/<\|?thought[^>]*>[\s\S]*?<\/thought>/gi, '')
    .replace(/<\|?think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|?channel[^>]*>[\s\S]*?<\/channel>/gi, '')
    .replace(/<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

/** Build a dense transcript from only the active un-cleared context slice. */
export function formatMessagesForCompaction(
  messages: CompactableMessage[],
  maxChars: number = MAX_COMPACTION_INPUT_CHARS,
): { transcript: string; beforeTokens: number; anchorMessageId?: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { transcript: '', beforeTokens: 0 };
  }

  let startIdx = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.contextMarkerType === 'cleared' || messages[i]?.contextMarkerType === 'compacted') {
      startIdx = i;
      break;
    }
  }

  const activeSlice = messages.slice(startIdx).filter((m) => m?.contextMarkerType !== 'cleared');
  const lastMsg = messages[messages.length - 1];
  const anchorMessageId = lastMsg?.id;

  const lines: string[] = [];
  for (const msg of activeSlice) {
    const roleLabel = msg.contextMarkerType === 'compacted'
      ? 'PRIOR COMPACTED BRIEF'
      : String(msg.sender || msg.role || 'user').toUpperCase();

    const body = stripMediaPayloadsForCompaction(msg.text || '');
    const clippedBody = body.length > MAX_SINGLE_TURN_CHARS
      ? `${body.slice(0, MAX_SINGLE_TURN_CHARS)}\n...[turn trimmed]`
      : body;

    const filesNote = Array.isArray(msg.contextFiles) && msg.contextFiles.length > 0
      ? ` [Attached files: ${msg.contextFiles.join(', ')}]`
      : '';

    const toolNotes = Array.isArray(msg.timeline)
      ? msg.timeline
          .filter((ev) => ev?.type === 'tool' && ev.toolName)
          .slice(-8)
          .map((ev) => `${ev.toolName}(${ev.status || 'done'})`)
      : [];
    const toolsSuffix = toolNotes.length > 0 ? `\n[Tools run: ${toolNotes.join(', ')}]` : '';

    if (clippedBody || toolsSuffix || filesNote) {
      lines.push(`${roleLabel}${filesNote}:\n${clippedBody}${toolsSuffix}`);
    }
  }

  let transcript = lines.join('\n\n---\n\n').trim();
  const beforeTokens = estimateTokenCount(transcript);
  if (transcript.length > maxChars) {
    transcript = `...[earlier segment truncated]\n\n${transcript.slice(-maxChars)}`;
  }
  return { transcript, beforeTokens, anchorMessageId };
}

/** Construct prompts instructing the LLM to retain vital facts and drop noise. */
export function buildCompactionPrompts(transcript: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are a KV-cache and working-memory compaction engine for an AI coding assistant.',
    'Rewrite the conversation into a compact, self-contained Working Memory Brief so older raw turns can be dropped from model KV memory.',
    'KEEP everything necessary:',
    '- Active user goals, requirements, preferences, and explicit constraints',
    '- Exact file paths, symbols/functions, settings, URLs, and line numbers modified or inspected',
    '- Verified build/test results, root causes, and unresolved bugs or errors',
    '- Design decisions made and the exact remaining next steps',
    '- File/media path references (never include base64 image/video data)',
    'FORGET everything unnecessary:',
    '- Conversational chatter, greetings, apologies, and redundant repetition',
    '- Verbose raw tool outputs or long directory listings once key facts are extracted',
    '- Superseded false starts and obsolete intermediate debugging noise',
    'Format strictly as dense markdown bullets under concise headings under 700 words. Do not output <thought> commentary or preamble.',
  ].join('\n');

  const userPrompt = `Compact the following conversation context now. Preserve every necessary fact to continue working without re-reading old turns, and discard everything unnecessary:\n\n<CONVERSATION>\n${transcript}\n</CONVERSATION>`;

  return { systemPrompt, userPrompt };
}

/** Parse SSE streams OR standard OpenAI JSON completion payloads cleanly. */
function parseOpenAiCompletionResponse(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return '';
  }

  if (!trimmed.startsWith('data:')) {
    try {
      const json = JSON.parse(trimmed);
      const choiceText = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? '';
      if (typeof choiceText === 'string' && choiceText.trim()) {
        return choiceText;
      }
    } catch {
      // Fall through to SSE parser in case leading comments exist
    }
  }

  let collected = '';
  for (const line of trimmed.split(/\r?\n/)) {
    const cleanLine = line.trim();
    if (!cleanLine.startsWith('data:')) {
      continue;
    }
    const payload = cleanLine.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    try {
      const chunk = JSON.parse(payload);
      const piece = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content ?? '';
      if (typeof piece === 'string') {
        collected += piece;
      }
    } catch {
      // Skip malformed partial chunk
    }
  }
  return collected;
}

async function resolveOpenAiEndpoint(
  model: string,
  config: vscode.WorkspaceConfiguration,
  context?: vscode.ExtensionContext,
): Promise<{ isHttps: boolean; hostname: string; port: number; path: string; apiKey: string; targetModel: string }> {
  if (model === 'local-custom-model' || model.startsWith('local:')) {
    let daemonAlive = false;
    try {
      const { DaemonManager } = require('./DaemonManager');
      daemonAlive = await DaemonManager.getInstance().isAlive();
    } catch {
      daemonAlive = false;
    }

    const targetModel = model.startsWith('local:')
      ? model.slice('local:'.length)
      : (config.get<string>('localLlmModelName') || 'local-model');

    if (daemonAlive) {
      return {
        isHttps: false,
        hostname: '127.0.0.1',
        port: 47990,
        path: '/v1/chat/completions',
        apiKey: 'local',
        targetModel,
      };
    }

    const localUrlStr = config.get<string>('localLlmBaseUrl') || 'http://localhost:11434/v1';
    try {
      const parsed = new URL(localUrlStr);
      const isHttps = parsed.protocol === 'https:';
      const basePath = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
      return {
        isHttps,
        hostname: parsed.hostname,
        port: parseInt(parsed.port, 10) || (isHttps ? 443 : 80),
        path: `${basePath}/chat/completions`,
        apiKey: 'local',
        targetModel,
      };
    } catch {
      return { isHttps: false, hostname: 'localhost', port: 11434, path: '/v1/chat/completions', apiKey: 'local', targetModel };
    }
  }

  let secretKey = '';
  if (context) {
    secretKey = (await context.secrets.get('EXOVON_PAT')) || '';
  }
  const gatewayUrlString = config.get<string>('apiGatewayUrl') || 'https://exovon.in';
  const parsed = new URL(gatewayUrlString);
  const isHttps = parsed.protocol === 'https:';
  return {
    isHttps,
    hostname: parsed.hostname,
    port: parseInt(parsed.port, 10) || (isHttps ? 443 : 80),
    path: '/api/ai/openai',
    apiKey: secretKey || 'missing-pat',
    targetModel: model,
  };
}

async function callActiveLlmForCompaction(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  context?: vscode.ExtensionContext,
): Promise<string> {
  const config = vscode.workspace.getConfiguration('exovonhub');

  if (model.startsWith('gemini') || model.startsWith('gemma')) {
    const secretKey = context ? ((await context.secrets.get('EXOVON_PAT')) || '') : '';
    const apiKey = secretKey || config.get<string>('googleApiKey') || process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      const gatewayUrl = config.get<string>('apiGatewayUrl') || 'https://exovon.in';
      const ai = secretKey
        ? new GoogleGenAI({
            apiKey: 'exovon-server-managed',
            httpOptions: { baseUrl: `${gatewayUrl}/api/ai/google`, headers: { Authorization: `Bearer ${apiKey}` } },
          })
        : new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model,
        config: { systemInstruction: systemPrompt, maxOutputTokens: 1536, temperature: 0.2 },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      });
      return response.text || '';
    }
  }

  const endpoint = await resolveOpenAiEndpoint(model, config, context);
  const openAiMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const payloadObj = {
    ...buildOpenAiPayload(endpoint.targetModel, openAiMessages, []),
    temperature: 0.2,
    max_tokens: 1536,
  };
  const payload = JSON.stringify(payloadObj);
  const transport = endpoint.isHttps ? https : http;

  const rawBody = await new Promise<string>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${endpoint.apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 90000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Compaction request timed out'));
    });
    req.write(payload);
    req.end();
  });

  return parseOpenAiCompletionResponse(rawBody);
}

/** Prompt the active LLM to distill conversation turns into essential KV working memory. */
export async function compactConversationWithLlm(params: CompactContextParams): Promise<CompactContextResult> {
  const { model, messages, context, maxContextTokens = 131072, customLlmCall } = params;

  if (!model || classifyDiffusionModel(model).isDiffusion) {
    return {
      success: false,
      compactedSummary: '',
      beforeTokens: 0,
      afterTokens: 0,
      modelUsed: model || '',
      error: 'Select a text LLM (local or cloud) to compact chat context.',
    };
  }

  const maxChars = Math.max(8000, Math.min(MAX_COMPACTION_INPUT_CHARS, Math.floor(maxContextTokens * 0.45 * 3.5)));
  const { transcript, beforeTokens: transcriptTokens, anchorMessageId } = formatMessagesForCompaction(messages, maxChars);
  const beforeTokens = Math.max(transcriptTokens, Math.round(params.reportedContextTokens || 0));

  if (!transcript.trim()) {
    return {
      success: false,
      compactedSummary: '',
      beforeTokens: 0,
      afterTokens: 0,
      modelUsed: model,
      error: 'No active conversation history to compact yet.',
    };
  }

  const { systemPrompt, userPrompt } = buildCompactionPrompts(transcript);

  try {
    const rawResponse = customLlmCall
      ? await customLlmCall(systemPrompt, userPrompt)
      : await callActiveLlmForCompaction(model, systemPrompt, userPrompt, context);

    const cleaned = cleanCompactedOutput(rawResponse);
    if (!cleaned) {
      return {
        success: false,
        compactedSummary: '',
        beforeTokens,
        afterTokens: beforeTokens,
        anchorMessageId,
        modelUsed: model,
        error: 'The active LLM returned an empty compaction summary.',
      };
    }

    const sanitized = stripMediaPayloadsForCompaction(cleaned);
    return {
      success: true,
      compactedSummary: sanitized,
      beforeTokens,
      afterTokens: estimateTokenCount(sanitized),
      anchorMessageId,
      modelUsed: model,
    };
  } catch (err: any) {
    return {
      success: false,
      compactedSummary: '',
      beforeTokens,
      afterTokens: beforeTokens,
      anchorMessageId,
      modelUsed: model,
      error: err?.message || String(err),
    };
  }
}
