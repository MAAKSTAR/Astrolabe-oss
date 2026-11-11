import * as vscode from 'vscode';

export interface LlamaVersionStatus {
  installed: boolean;
  binary_path: string | null;
  current_version_raw: string | null;
  current_build: number | null;
  latest_tag: string | null;
  latest_build: number | null;
  update_available: boolean;
  platform_backend: string;
  asset_name: string | null;
  download_url: string | null;
  asset_size_bytes: number | null;
  release_url: string | null;
  release_notes: string | null;
  active_model_will_unload: boolean;
  rate_limited: boolean;
  error: string | null;
}

export interface LlamaUpdateResult {
  success: boolean;
  previous_build: number | null;
  new_build: number | null;
  new_version_raw: string | null;
  latest_tag: string | null;
  asset_name: string | null;
  target_dir: string | null;
  unloaded_active_model: boolean;
  message: string;
}

export interface LlamaUpdateUiState {
  status: LlamaVersionStatus | null;
  checking: boolean;
  updating: boolean;
  lastMessage: string | null;
  skippedBuild: number | null;
}

type StatusListener = (state: LlamaUpdateUiState) => void;

const DAEMON_BASE_URL = 'http://127.0.0.1:47990';
const CHECK_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'astrolabe.llamaUpdater.lastCheckAt';
const SKIPPED_BUILD_KEY = 'astrolabe.llamaUpdater.skippedBuild';

/**
 * Monitors upstream ggml-org/llama.cpp releases, prompts with an actionable toast
 * when newer builds exist, and orchestrates in-place updates via exovon-daemon.
 */
export class LlamaUpdateService implements vscode.Disposable {
  private static instance: LlamaUpdateService | undefined;

  private readonly context: vscode.ExtensionContext;
  private readonly listeners = new Set<StatusListener>();
  private intervalTimer: NodeJS.Timeout | undefined;
  private inFlightCheck: Promise<LlamaVersionStatus | null> | null = null;
  private promptedBuildThisSession: number | null = null;
  private disposed = false;

  private state: LlamaUpdateUiState = {
    status: null,
    checking: false,
    updating: false,
    lastMessage: null,
    skippedBuild: null,
  };

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.state.skippedBuild = context.globalState.get<number | null>(SKIPPED_BUILD_KEY, null);
  }

  public static initialize(context: vscode.ExtensionContext): LlamaUpdateService {
    if (!LlamaUpdateService.instance) {
      LlamaUpdateService.instance = new LlamaUpdateService(context);
    }
    return LlamaUpdateService.instance;
  }

  public static getInstance(): LlamaUpdateService | undefined {
    return LlamaUpdateService.instance;
  }

  public onStateChange(listener: StatusListener): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.getState());
    return new vscode.Disposable(() => {
      this.listeners.delete(listener);
    });
  }

  public getState(): LlamaUpdateUiState {
    return { ...this.state };
  }

  private emitState(patch: Partial<LlamaUpdateUiState>): void {
    this.state = {
      ...this.state,
      ...patch,
      skippedBuild: this.context.globalState.get<number | null>(SKIPPED_BUILD_KEY, null),
    };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch {}
    }
  }

  public startBackgroundMonitor(): void {
    if (this.disposed) {return;}

    void (async () => {
      if (!(await this.waitForDaemonReady(30_000)) || this.disposed) {return;}
      await this.checkForUpdates({ interactive: false, respectCooldown: true });
    })();

    if (!this.intervalTimer) {
      this.intervalTimer = setInterval(() => {
        if (!this.disposed) {
          void this.checkForUpdates({ interactive: false, respectCooldown: true });
        }
      }, CHECK_COOLDOWN_MS);
    }
  }

  private async waitForDaemonReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && Date.now() < deadline) {
      try {
        const res = await fetch(`${DAEMON_BASE_URL}/v1/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {return true;}
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  public async checkForUpdates(
    options: { interactive?: boolean; respectCooldown?: boolean } = {}
  ): Promise<LlamaVersionStatus | null> {
    const interactive = options.interactive === true;
    const respectCooldown = options.respectCooldown === true;

    if (respectCooldown && !interactive) {
      const lastCheck = this.context.globalState.get<number>(LAST_CHECK_KEY, 0);
      if (lastCheck > 0 && Date.now() - lastCheck < CHECK_COOLDOWN_MS) {
        return this.state.status;
      }
    }

    if (this.inFlightCheck) {
      const result = await this.inFlightCheck;
      if (interactive && result) {await this.presentInteractiveCheckResult(result);}
      return result;
    }

    this.emitState({ checking: true, lastMessage: null });
    this.inFlightCheck = (async () => {
      try {
        const res = await fetch(`${DAEMON_BASE_URL}/v1/system/llama-version`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {throw new Error(`Daemon returned HTTP ${res.status}`);}
        const status = (await res.json()) as LlamaVersionStatus;
        if (!status.error) {await this.context.globalState.update(LAST_CHECK_KEY, Date.now());}
        this.emitState({ status, checking: false });
        return status;
      } catch (err: any) {
        const message = `Failed to check llama.cpp version: ${err?.message || String(err)}`;
        this.emitState({ checking: false, lastMessage: message });
        return null;
      } finally {
        this.inFlightCheck = null;
      }
    })();

    const status = await this.inFlightCheck;
    if (!status) {
      if (interactive) {
        vscode.window.showWarningMessage(this.state.lastMessage || 'Exovon daemon unavailable for llama.cpp check.');
      }
      return null;
    }

    if (interactive) {
      await this.presentInteractiveCheckResult(status);
    } else if (!status.error && status.update_available && status.latest_build !== null) {
      const skipped = this.context.globalState.get<number | null>(SKIPPED_BUILD_KEY, null);
      if (skipped !== status.latest_build && this.promptedBuildThisSession !== status.latest_build) {
        await this.showUpdateToast(status);
      }
    }
    return status;
  }

  private async presentInteractiveCheckResult(status: LlamaVersionStatus): Promise<void> {
    if (status.error) {
      vscode.window.showWarningMessage(status.error);
      return;
    }
    if (!status.installed) {
      if (status.download_url && status.latest_tag) {
        await this.showUpdateToast(status);
      } else {
        vscode.window.showWarningMessage('llama-server binary was not found locally.');
      }
      return;
    }
    if (status.update_available && status.latest_tag) {
      await this.showUpdateToast(status);
      return;
    }
    const buildLabel = status.current_build !== null ? `build b${status.current_build}` : 'current build';
    vscode.window.showInformationMessage(`llama.cpp engine is up to date (${buildLabel}, ${status.platform_backend}).`);
  }

  private async showUpdateToast(status: LlamaVersionStatus): Promise<void> {
    if (status.latest_build !== null) {this.promptedBuildThisSession = status.latest_build;}

    const sizeMb = status.asset_size_bytes !== null ? `, ${(status.asset_size_bytes / (1024 * 1024)).toFixed(1)} MB` : '';
    const currentLabel = status.current_build !== null ? `current b${status.current_build}` : 'not installed';
    const unloadNote = status.active_model_will_unload ? ' Active local model will unload cleanly during update.' : '';

    const message = status.installed
      ? `llama.cpp ${status.latest_tag} is available (${currentLabel}, ${status.platform_backend}${sizeMb}).${unloadNote}`
      : `Install llama.cpp ${status.latest_tag} (${status.platform_backend}${sizeMb}) to enable llama-server acceleration?`;

    const primaryAction = status.installed ? 'Update Now' : 'Install Now';
    const actions = [primaryAction];
    if (status.release_url) {actions.push('Release Notes');}
    if (status.latest_build !== null && status.installed) {actions.push('Skip Build');}

    const choice = await vscode.window.showInformationMessage(message, ...actions);
    if (choice === primaryAction) {
      await this.installUpdate(status.latest_tag ?? undefined, status.download_url ?? undefined);
    } else if (choice === 'Release Notes' && status.release_url) {
      await vscode.env.openExternal(vscode.Uri.parse(status.release_url));
    } else if (choice === 'Skip Build' && status.latest_build !== null) {
      await this.context.globalState.update(SKIPPED_BUILD_KEY, status.latest_build);
      this.emitState({ lastMessage: `Skipped llama.cpp ${status.latest_tag || `b${status.latest_build}`}.` });
    }
  }

  public async installUpdate(expectedTag?: string, downloadUrl?: string): Promise<LlamaUpdateResult | null> {
    if (this.state.updating) {
      vscode.window.showInformationMessage('A llama.cpp engine update is already in progress.');
      return null;
    }
    this.emitState({ updating: true, lastMessage: `Downloading and installing ${expectedTag || 'latest llama.cpp build'}...` });

    try {
      const result = await vscode.window.withProgress<LlamaUpdateResult>(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Updating llama.cpp engine${expectedTag ? ` to ${expectedTag}` : ''}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Downloading release archive and verifying binaries...' });
          const res = await fetch(`${DAEMON_BASE_URL}/v1/system/llama-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expected_tag: expectedTag ?? null, download_url: downloadUrl ?? null }),
            signal: AbortSignal.timeout(300_000),
          });
          const payload = (await res.json()) as LlamaUpdateResult;
          if (!res.ok || !payload.success) {
            throw new Error(payload?.message || `Daemon returned HTTP ${res.status}`);
          }
          return payload;
        }
      );

      await this.context.globalState.update(SKIPPED_BUILD_KEY, null);
      this.emitState({ updating: false, lastMessage: result.message });

      try {
        const { EngineStatusBarManager } = require('./EngineStatusBarManager');
        EngineStatusBarManager.getInstance()?.checkHealth();
      } catch {}
      await this.checkForUpdates({ interactive: false, respectCooldown: false });

      const buildLabel = result.new_build !== null ? `b${result.new_build}` : result.latest_tag || 'latest';
      const unloadSuffix = result.unloaded_active_model ? ' (active model was unloaded cleanly)' : '';
      vscode.window.showInformationMessage(`llama.cpp updated to ${buildLabel}${unloadSuffix}.`);
      return result;
    } catch (err: any) {
      const errMsg = `llama.cpp update failed: ${err?.message || String(err)}`;
      this.emitState({ updating: false, lastMessage: errMsg });
      vscode.window.showErrorMessage(errMsg);
      return null;
    }
  }

  public async clearSkippedBuild(): Promise<void> {
    await this.context.globalState.update(SKIPPED_BUILD_KEY, null);
    this.promptedBuildThisSession = null;
    this.emitState({ lastMessage: null });
  }

  public dispose(): void {
    this.disposed = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.listeners.clear();
  }
}
