import * as vscode from 'vscode';

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
        this.ready = true;
        this.lastLatencyMs = Date.now() - start;
        this.activeGhostModel = assignedGhostModel || data.active_model || null;
      } else {
        this.ready = false;
      }
    } catch {
      this.ready = false;
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
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration('exovonhub');
    const enabled = config.get<boolean>('enableGhostText', true);
    if (!enabled) return '';

    const ghostModel = config.get<string>('inlineGhostModel') || undefined;
    const startTime = Date.now();

    try {
      const fetch = (await import('node-fetch')).default;
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());

      // Trim context for ultra-low latency completion
      const prefixContext = prefix.length > 1500 ? prefix.slice(-1500) : prefix;
      const suffixContext = suffix.length > 400 ? suffix.slice(0, 400) : suffix;

      const payload = {
        model: ghostModel,
        messages: [
          {
            role: 'system',
            content: 'You are an ultra-fast code completion engine. Continue the code directly at the cursor. Output ONLY the raw completion code without markdown backticks, explanations, comments, or repeating the prefix.'
          },
          {
            role: 'user',
            content: `Language: ${languageId}\n\nExisting Code Before Cursor:\n${prefixContext}\n\nExisting Code After Cursor:\n${suffixContext}\n\nInline Completion:`
          }
        ],
        max_tokens: 48,
        temperature: 0.1,
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
        return '';
      }

      const data = (await res.json()) as any;
      this.lastLatencyMs = Date.now() - startTime;
      this.ready = true;

      let text = data.choices?.[0]?.message?.content || '';
      // Strip markdown code fences if output by chat model
      text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/\r?\n?```$/, '');

      // Remove accidental duplicate prefix line
      const lastLine = prefixContext.trim().split('\n').pop() || '';
      if (lastLine && text.startsWith(lastLine)) {
        text = text.slice(lastLine.length);
      }

      return text;
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        this.ready = false;
      }
      return '';
    }
  }

  public getLatency(): number {
    return this.lastLatencyMs;
  }

  public getActiveGhostModel(): string | null {
    return this.activeGhostModel;
  }
}
