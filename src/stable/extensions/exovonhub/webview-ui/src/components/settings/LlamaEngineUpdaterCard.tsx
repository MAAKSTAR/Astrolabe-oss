import { useEffect, useState } from 'react';

export interface LlamaVersionStatusDto {
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

export interface LlamaEngineUpdaterCardProps {
  vscodeApi?: { postMessage: (msg: unknown) => void } | null;
  daemonRunning: boolean;
}

export function LlamaEngineUpdaterCard({ vscodeApi, daemonRunning }: LlamaEngineUpdaterCardProps) {
  const [status, setStatus] = useState<LlamaVersionStatusDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [skippedBuild, setSkippedBuild] = useState<number | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'llamaUpdateStatus') {
        if ('status' in msg) setStatus(msg.status ?? null);
        if (typeof msg.checking === 'boolean') setChecking(msg.checking);
        if (typeof msg.updating === 'boolean') setUpdating(msg.updating);
        if ('lastMessage' in msg) setLastMessage(msg.lastMessage ?? null);
        if ('skippedBuild' in msg) setSkippedBuild(msg.skippedBuild ?? null);
      }
    };
    window.addEventListener('message', onMessage);
    if (daemonRunning && vscodeApi) {
      vscodeApi.postMessage({ command: 'checkLlamaUpdate', silent: true });
    }
    return () => window.removeEventListener('message', onMessage);
  }, [daemonRunning, vscodeApi]);

  const sizeLabel =
    status?.asset_size_bytes != null
      ? `${(status.asset_size_bytes / (1024 * 1024)).toFixed(1)} MB`
      : null;
  const isSkipped =
    status?.latest_build != null && skippedBuild !== null && status.latest_build === skippedBuild;
  const canInstall =
    Boolean(status?.download_url) && (Boolean(status?.update_available) || status?.installed === false);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-medium text-white">llama.cpp Inference Runtime</h2>
            {status?.update_available && !isSkipped && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Update Available
              </span>
            )}
            {status && !status.update_available && status.installed && !status.error && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/70">
                Up to Date
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400">
            Track upstream ggml-org/llama.cpp builds matched to your detected OS and GPU backend.
          </p>
        </div>

        <button
          type="button"
          disabled={!daemonRunning || checking || updating}
          onClick={() => {
            setChecking(true);
            vscodeApi?.postMessage({ command: 'checkLlamaUpdate', silent: false });
          }}
          className="px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700/80 transition-colors cursor-pointer shrink-0 flex items-center gap-2"
        >
          <svg
            className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          <span>{checking ? 'Checking...' : 'Check llama.cpp'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-3.5 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Installed Build</div>
          <div className="text-sm font-mono text-zinc-100 mt-0.5">
            {!daemonRunning
              ? 'Daemon offline'
              : status === null
                ? 'Checking...'
                : !status.installed
                  ? 'Not installed'
                  : status.current_build !== null
                    ? `b${status.current_build}`
                    : 'Unknown build'}
          </div>
        </div>

        <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-3.5 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Upstream Latest</div>
          <div className="text-sm font-mono text-zinc-100 mt-0.5">
            {status?.latest_tag ? (
              <span>
                {status.latest_tag}
                {sizeLabel ? <span className="text-xs text-zinc-400"> ({sizeLabel})</span> : null}
              </span>
            ) : status?.rate_limited ? (
              <span className="text-amber-300">Rate limited</span>
            ) : (
              '—'
            )}
          </div>
        </div>

        <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-3.5 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Backend Target</div>
          <div className="text-sm font-mono text-zinc-200 mt-0.5 truncate" title={status?.asset_name || undefined}>
            {status?.platform_backend || 'auto'}
          </div>
        </div>
      </div>

      {status?.binary_path && (
        <div className="text-[11px] font-mono text-zinc-400 bg-zinc-950/50 border border-zinc-800/60 rounded-lg px-3 py-2 truncate" title={status.binary_path}>
          {status.binary_path}
        </div>
      )}

      {status?.error && (
        <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3.5 py-2.5">
          {status.error}
        </div>
      )}

      {lastMessage && (
        <div className="text-xs text-zinc-300 bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-3.5 py-2.5">
          {lastMessage}
        </div>
      )}

      {canInstall && (
        <div className="pt-1 flex flex-col gap-3">
          {status?.active_model_will_unload && (
            <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3.5 py-2">
              A local model is currently active in llama-server. Updating will cleanly unload it first.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={updating || !daemonRunning}
              onClick={() => {
                setUpdating(true);
                vscodeApi?.postMessage({
                  command: 'installLlamaUpdate',
                  expectedTag: status?.latest_tag,
                  downloadUrl: status?.download_url,
                });
              }}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              {updating
                ? 'Updating llama.cpp...'
                : `${status?.installed ? 'Update to' : 'Install'} ${status?.latest_tag || 'Latest'}`}
            </button>

            {status?.release_url && (
              <button
                type="button"
                onClick={() => vscodeApi?.postMessage({ command: 'openExternalUrl', url: status.release_url })}
                className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/80 transition-colors cursor-pointer"
              >
                Release Notes
              </button>
            )}

            {isSkipped && (
              <button
                type="button"
                onClick={() => vscodeApi?.postMessage({ command: 'clearSkippedLlamaBuild' })}
                className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Re-enable Toast for {status?.latest_tag}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LlamaEngineUpdaterCard;
