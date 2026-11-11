import { useState } from 'react';
import { LlamaEngineUpdaterCard } from './LlamaEngineUpdaterCard';

export interface SystemEngineViewProps {
  daemonRunning: boolean;
  daemonHealth: any;
  localModelsDir: string;
  vscodeApi: any;
  huggingFaceToken: string;
  setHuggingFaceToken: (token: string) => void;
  isHfTokenSaved: boolean;
  setIsHfTokenSaved: (saved: boolean) => void;
  useHfMirror: boolean;
  setUseHfMirror: (mirror: boolean) => void;
  systemUpdateInfo: any;
  isCheckingUpdates: boolean;
  setIsCheckingUpdates: (checking: boolean) => void;
}

export function SystemEngineView({
  daemonRunning,
  daemonHealth,
  localModelsDir,
  vscodeApi,
  huggingFaceToken,
  setHuggingFaceToken,
  isHfTokenSaved,
  setIsHfTokenSaved,
  useHfMirror,
  setUseHfMirror,
  systemUpdateInfo,
  isCheckingUpdates,
  setIsCheckingUpdates,
}: SystemEngineViewProps) {
  const [showHfToken, setShowHfToken] = useState(false);

  // Compute memory values
  const memoryGb = daemonHealth?.hardware?.memory_gb || 0;
  const usedMemoryGb = daemonHealth?.hardware?.used_memory_gb || 0;
  const memoryPercent = memoryGb > 0 ? Math.min(100, Math.round((usedMemoryGb / memoryGb) * 100)) : 0;

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Card 1: Local Inference Server */}
      <div className="bg-[#141416] border border-white/5 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                daemonRunning ? 'bg-emerald-500' : 'bg-zinc-600'
              }`}
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">Local Inference Server (Port 47990)</h3>
                <span className="text-zinc-500 text-xs">•</span>
                <span className={`text-xs font-mono font-medium ${daemonRunning ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {daemonRunning ? 'Active' : 'Stopped'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Local orchestration service routing completions, context windows, and model weights.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!daemonRunning ? (
              <button
                type="button"
                onClick={() => vscodeApi?.postMessage({ command: 'startDaemon' })}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 transition-colors cursor-pointer shadow-sm"
              >
                Start Engine
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    vscodeApi?.postMessage({ command: 'stopDaemon' });
                    setTimeout(() => vscodeApi?.postMessage({ command: 'startDaemon' }), 1000);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/5 transition-colors cursor-pointer"
                >
                  Restart Engine
                </button>
                <button
                  type="button"
                  onClick={() => vscodeApi?.postMessage({ command: 'stopDaemon' })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors cursor-pointer"
                >
                  Stop Engine
                </button>
              </>
            )}
          </div>
        </div>

        {/* Models Directory Configuration Row */}
        <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <div className="min-w-0">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">Models Directory</span>
              <span className="text-xs font-mono text-zinc-200 truncate block" title={localModelsDir}>
                {localModelsDir || 'Not configured'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => vscodeApi?.postMessage({ command: 'browseLocalModelsDirectory' })}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-700 border border-white/5 transition-colors cursor-pointer"
            >
              Change Directory
            </button>
            <button
              type="button"
              onClick={() => vscodeApi?.postMessage({ command: 'openFolder', path: localModelsDir })}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-700 border border-white/5 transition-colors cursor-pointer"
            >
              Open in File Manager
            </button>
          </div>
        </div>
      </div>

      {/* Card 2: Hardware Acceleration & Telemetry */}
      <div className="bg-[#141416] border border-white/5 rounded-2xl p-5 sm:p-6">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Hardware Acceleration & Telemetry
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* CPU Model */}
          <div className="bg-[#18181b] border border-white/5 p-3.5 rounded-xl">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-mono">CPU Architecture</p>
            <p className="text-xs text-zinc-200 font-mono truncate" title={daemonHealth?.hardware?.cpu || 'Standard CPU'}>
              {daemonHealth?.hardware?.cpu || 'Standard CPU'}
            </p>
          </div>

          {/* GPU / Accelerator (Clean text, NO neon green or cyan) */}
          <div className="bg-[#18181b] border border-white/5 p-3.5 rounded-xl">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-mono">Accelerator</p>
            <p className="text-xs text-zinc-200 font-mono font-medium truncate" title={daemonHealth?.hardware?.gpu || 'CPU Mode'}>
              {daemonHealth?.hardware?.gpu || 'CPU Mode'}
            </p>
          </div>

          {/* Unified Memory / VRAM Display with subtle slate progress bar */}
          <div className="bg-[#18181b] border border-white/5 p-3.5 rounded-xl">
            <div className="flex items-center justify-between mb-1 font-mono text-[10px]">
              <span className="text-zinc-500 uppercase tracking-wider">Unified Memory / VRAM</span>
              {memoryGb > 0 && <span className="text-zinc-400">{memoryPercent}%</span>}
            </div>
            <p className="text-xs text-zinc-200 font-mono">
              {usedMemoryGb > 0 ? `${usedMemoryGb.toFixed(1)} GB / ` : ''}
              {memoryGb > 0 ? `${memoryGb.toFixed(1)} GB` : 'System Managed'}
            </p>
            {memoryGb > 0 && (
              <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
                <div
                  className="bg-zinc-400 h-full rounded-full transition-all duration-300"
                  style={{ width: `${memoryPercent}%` }}
                />
              </div>
            )}
          </div>

          {/* Thermal Telemetry */}
          <div className="bg-[#18181b] border border-white/5 p-3.5 rounded-xl">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-mono">Thermal Status</p>
            <p className="text-xs text-zinc-200 font-mono">
              {daemonHealth?.hardware?.max_temp ? `${daemonHealth.hardware.max_temp.toFixed(1)}°C` : 'Optimal'}
            </p>
          </div>
        </div>
      </div>

      {/* Card 3: Hugging Face & Network */}
      <div className="bg-[#141416] border border-white/5 rounded-2xl p-5 sm:p-6">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
          Hugging Face & Network
        </h3>
        <p className="text-xs text-zinc-400 mb-4">
          Authenticate model downloads and configure mirror endpoints.
        </p>

        {/* HF Access Token Input */}
        <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 mb-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
            <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
              <span>Hugging Face Access Token</span>
              <span className="text-[10px] text-zinc-500 font-normal">(User Read Token)</span>
            </label>
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 underline underline-offset-2"
            >
              <span>Get token on Hugging Face</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showHfToken ? 'text' : 'password'}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={huggingFaceToken}
                onChange={(e) => {
                  setHuggingFaceToken(e.target.value);
                  setIsHfTokenSaved(false);
                }}
                className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowHfToken(!showHfToken)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
              >
                {showHfToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                vscodeApi?.postMessage({ command: 'updateHfToken', token: huggingFaceToken.trim() });
                setIsHfTokenSaved(true);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isHfTokenSaved
                  ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/20'
                  : 'bg-zinc-200 hover:bg-white text-zinc-950 font-semibold'
              }`}
            >
              {isHfTokenSaved ? 'Saved ✓' : 'Save'}
            </button>
            {huggingFaceToken && (
              <button
                type="button"
                onClick={() => {
                  setHuggingFaceToken('');
                  vscodeApi?.postMessage({ command: 'updateHfToken', token: '' });
                  setIsHfTokenSaved(true);
                }}
                className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* High-Speed Regional Mirror Toggle */}
        <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-zinc-200">High-Speed Regional Mirror (hf-mirror.com)</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed max-w-xl">
              Proxies LFS downloads through global mirror caches. Useful if experiencing CDN throttling or high network latency.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={useHfMirror}
            onClick={() => {
              const next = !useHfMirror;
              setUseHfMirror(next);
              vscodeApi?.postMessage({ command: 'toggleHfMirror', useMirror: next });
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer border ${
              useHfMirror
                ? 'bg-zinc-200 text-zinc-950 border-white'
                : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 border-white/5'
            }`}
          >
            {useHfMirror ? 'Mirror Enabled' : 'Enable Mirror'}
          </button>
        </div>
      </div>

      {/* Card 4: Astrolabe Runtime & Updater */}
      <div className="bg-[#141416] border border-white/5 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Astrolabe Runtime & Updater
            </h3>
            <p className="text-xs text-zinc-300 font-mono">
              Version <span className="font-semibold text-white">v0.1.4</span> • exovon-daemon v0.1.0
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isCheckingUpdates}
              onClick={() => {
                setIsCheckingUpdates(true);
                vscodeApi?.postMessage({ command: 'checkSystemUpdates' });
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isCheckingUpdates ? (
                <>
                  <span className="animate-spin w-3 h-3 border-2 border-t-white border-zinc-600 rounded-full" />
                  <span>Checking...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Check for Updates</span>
                </>
              )}
            </button>
          </div>
        </div>

        {systemUpdateInfo && (
          <div
            className={`mt-4 p-3.5 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 border ${
              systemUpdateInfo.hasUpdate
                ? 'bg-zinc-800/80 border-white/10 text-zinc-200'
                : 'bg-zinc-900/50 border-white/5 text-zinc-400'
            }`}
          >
            <div className="flex items-center gap-2.5 font-mono">
              <svg className="w-4 h-4 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{systemUpdateInfo.message || 'Runtime components are up to date.'}</span>
            </div>
            {systemUpdateInfo.hasUpdate && systemUpdateInfo.downloadUrl && (
              <button
                type="button"
                onClick={() => {
                  vscodeApi?.postMessage({
                    command: 'installSystemUpdate',
                    downloadUrl: systemUpdateInfo.downloadUrl,
                  });
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 transition-colors shadow-sm shrink-0 cursor-pointer"
              >
                Update to {systemUpdateInfo.latestVersion}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Card 5: llama.cpp Inference Runtime Updater */}
      <LlamaEngineUpdaterCard vscodeApi={vscodeApi} daemonRunning={daemonRunning} />
    </div>
  );
}

export default SystemEngineView;
