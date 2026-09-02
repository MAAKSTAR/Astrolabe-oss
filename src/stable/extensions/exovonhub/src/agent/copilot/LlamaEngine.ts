import * as vscode from 'vscode';
import { FimIntentAnalyzer } from './FimIntentAnalyzer';

export interface FimResult {
  text: string;
  replacePrefixChars: number;
}

export class LlamaEngine {
  private ready = false;
  private lastLatencyMs = 0;
  private activeGhostModel: string | null = null;

  constructor(private storageUri?: vscode.Uri) {}

  public async initialize(): Promise<void> {
    try {
      await this.checkHealth();
      console.log('Daemon Ghost Engine initialized successfully.');
    } catch (e) {
      console.error('Failed to initialize Daemon Ghost Engine:', e);
    }
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; activeModel: string | null; enabled: boolean }> {
    const config = vscode.workspace.getConfiguration('exovonhub');
    const enabled = config.get<boolean>('enableGhostText', true);
    const assignedGhostModel = config.get<string>('inlineGhostModel') || null;

    try {
      const fetch = (await import('node-fetch')).default;
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const res = await fetch('http://127.0.0.1:47990/v1/health', {
        signal: controller.signal as any
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as any;
        const active = assignedGhostModel || data.active_ghost_model || data.active_model || null;
        this.activeGhostModel = active;
        this.ready = Boolean(active);
        this.lastLatencyMs = Date.now() - start;
      } else {
        this.ready = false;
        this.activeGhostModel = null;
      }
    } catch {
      this.ready = false;
      this.activeGhostModel = null;
    }

    return {
      healthy: this.ready,
      latencyMs: this.lastLatencyMs,
      activeModel: this.activeGhostModel,
      enabled
    };
  }

  public async getFimCompletion(
    prefix: string,
    suffix: string,
    token: vscode.CancellationToken,
    languageId = 'plaintext'
  ): Promise<FimResult | null> {
    const config = vscode.workspace.getConfiguration('exovonhub');
    const enabled = config.get<boolean>('enableGhostText', true);
    if (!enabled || !this.ready || !this.activeGhostModel) return null;

    const ghostModel = config.get<string>('inlineGhostModel') || undefined;
    const startTime = Date.now();

    try {
      const fetch = (await import('node-fetch')).default;
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());

      // Analyze intent: directive comments, fuzzy spelling fixes, structural skeletons, or native FIM
      const intent = FimIntentAnalyzer.analyze(prefix, suffix, languageId);

      // If an immediate high-confidence spelling fix is found at cursor, return it instantly
      if (intent.immediateSuggestion && intent.correction) {
        this.lastLatencyMs = Date.now() - startTime;
        return {
          text: intent.correction.replacement,
          replacePrefixChars: intent.correction.replacePrefixChars
        };
      }

      // Context sizing
      const maxPrefixLen = intent.type === 'directive_boilerplate' ? 3000 : 1500;
      const prefixContext = prefix.length > maxPrefixLen ? prefix.slice(-maxPrefixLen) : prefix;
      const suffixContext = suffix.length > 500 ? suffix.slice(0, 500) : suffix;

      const payload = {
        model: ghostModel,
        purpose: 'ghost',
        messages: [
          {
            role: 'user',
            content: intent.promptText
          }
        ],
        max_tokens: intent.maxTokens,
        temperature: intent.temperature,
        stream: false
      };

      const res = await fetch('http://127.0.0.1:47990/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal as any
      });

      if (!res.ok) {
        this.ready = false;
        return null;
      }

      let accumulated = '';
      const textResponse = await res.text();
      this.lastLatencyMs = Date.now() - startTime;
      this.ready = true;

      // Parse SSE lines or raw JSON
      const lines = textResponse.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || '';
            if (delta) {
              accumulated += delta;
            }
          } catch {}
        }
      }

      if (!accumulated && textResponse.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(textResponse);
          accumulated = parsed.choices?.[0]?.message?.content || '';
        } catch {}
      }

      let text = accumulated;

      // 1. Strip any leaked FIM / Special tokenizer control tags
      text = text.replace(/<\|?(?:fim_prefix|fim_suffix|fim_middle|endoftext|file_sep|im_start|im_end|start_of_turn|end_of_turn|eot_id|turn_end)\|?>/gi, '');
      text = text.replace(/\[(?:PREFIX|SUFFIX|MID)\]/g, '');

      // 2. Strip markdown code fences if output by chat model
      text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/\r?\n?```$/, '');

      // 3. Remove accidental duplicate prefix line
      const lastLine = prefixContext.trim().split('\n').pop() || '';
      if (lastLine && text.startsWith(lastLine)) {
        text = text.slice(lastLine.length);
      }

      // 4. Intelligent Suffix De-duplication: Prevent repeating lines that already exist below cursor
      const suffixLines = suffixContext.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      if (suffixLines.length > 0 && text.includes('\n')) {
        const textLines = text.split('\n');
        const cleanLines: string[] = [];
        for (const tl of textLines) {
          if (cleanLines.length > 0 && suffixLines.includes(tl.trim())) {
            break; // Stop at first duplicated suffix line!
          }
          cleanLines.push(tl);
        }
        text = cleanLines.join('\n');
      }

      // 5. If text is empty or purely whitespace after stripping tags, return null
      if (text.trim().length === 0) {
        return null;
      }

      return {
        text,
        replacePrefixChars: intent.correction?.replacePrefixChars || 0
      };
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        this.ready = false;
      }
      return null;
    }
  }

  public getLatency(): number {
    return this.lastLatencyMs;
  }

  public getActiveGhostModel(): string | null {
    return this.activeGhostModel;
  }
}
