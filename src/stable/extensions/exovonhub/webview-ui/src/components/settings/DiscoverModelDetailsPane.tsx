import { ModelOrgAvatar } from './ModelOrgAvatar';
import { TrustedBadge, isTrustedPublisher } from './TrustedBadge';
import { ModelReadmeViewer } from './ModelReadmeViewer';
import {
  type HfModelDetails,
  type LiveQuantOption,
  formatRelativeTime,
  getModelSpecGrid
} from './discoverHelpers';

interface ActiveDownloadItem {
  model_name: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  percent: number;
  status: string;
}

interface DiscoverModelDetailsPaneProps {
  details: HfModelDetails;
  modelReadme: string;
  availableQuants: LiveQuantOption[];
  selectedQuantIndex: number;
  onSelectQuantIndex: (idx: number) => void;
  copiedRepoId: boolean;
  onCopyRepoId: (repoId: string) => void;
  localModels: Array<{ id: string }>;
  activeDownloads: ActiveDownloadItem[];
  getSpeedAndEta: (item: any) => { speed: string; eta: string };
  onLoadInEngine: (matchedModelId: string) => void;
  onControlDownload: (filename: string, action: 'pause' | 'resume') => void;
  onRequestCancelDownload: (item: any) => void;
  onStartDownload: (quant: LiveQuantOption, details: HfModelDetails) => void;
}

/** Right-hand details pane for Hugging Face Discover Models (metadata specs, weights download, README card). */
export function DiscoverModelDetailsPane({
  details,
  modelReadme,
  availableQuants,
  selectedQuantIndex,
  onSelectQuantIndex,
  copiedRepoId,
  onCopyRepoId,
  localModels,
  activeDownloads,
  getSpeedAndEta,
  onLoadInEngine,
  onControlDownload,
  onRequestCancelDownload,
  onStartDownload
}: DiscoverModelDetailsPaneProps) {
  const selectedQuant = availableQuants[selectedQuantIndex] || availableQuants[0];
  const isDownloaded = Boolean(
    selectedQuant && localModels.some((m) => m.id.toLowerCase().includes(selectedQuant.filename.toLowerCase()))
  );
  const activeDownloadItem = selectedQuant
    ? activeDownloads.find((d) => d.model_name.toLowerCase().includes(selectedQuant.filename.toLowerCase()))
    : undefined;
  const speedInfo = activeDownloadItem ? getSpeedAndEta(activeDownloadItem) : { speed: '', eta: '' };
  const specCards = getModelSpecGrid(details, availableQuants, selectedQuant);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">
      {/* Header Bar */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3.5 min-w-0">
          <ModelOrgAvatar modelId={details.id} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-base font-bold text-white tracking-tight truncate font-sans">
                {details.id}
              </h2>
              {isTrustedPublisher(details.author || details.id.split('/')[0], details.id) && (
                <TrustedBadge className="w-4 h-4 shrink-0" title="Trusted Publisher" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => onCopyRepoId(details.id)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/10 text-[11px] font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Copy Model ID"
              >
                <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copiedRepoId ? 'Copied' : 'Copy ID'}
              </button>
              <a
                href={`https://huggingface.co/${details.id}`}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/10 text-[11px] font-mono transition-colors flex items-center gap-1.5"
              >
                <span>Hugging Face</span>
                <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stats & Tags Row */}
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-zinc-300 font-mono">
        <span className="flex items-center gap-1.5 bg-zinc-900/90 px-3 py-1.5 rounded-xl border border-white/10">
          <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{(details.downloads || 0).toLocaleString()} downloads</span>
        </span>

        <span className="flex items-center gap-1.5 bg-zinc-900/90 px-3 py-1.5 rounded-xl border border-white/10">
          <svg className="w-3.5 h-3.5 text-zinc-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
          <span>{details.likes || 0} likes</span>
        </span>

        <span className="bg-zinc-900/90 px-3 py-1.5 rounded-xl border border-white/10 text-zinc-400">
          Updated {formatRelativeTime(details.lastModified, details.createdAt)}
        </span>

        {details.pipeline_tag && (
          <span className="bg-zinc-900/90 px-3 py-1.5 rounded-xl border border-white/10 text-zinc-300 font-mono">
            {details.pipeline_tag}
          </span>
        )}
      </div>

      {/* Specifications Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {specCards.map((card) => (
          <div key={card.label} className="bg-zinc-900/70 border border-white/10 rounded-xl p-3.5">
            <span className="text-[10px] text-zinc-400 uppercase tracking-widest block mb-1 font-mono">
              {card.label}
            </span>
            <span className="text-xs font-mono font-semibold text-white truncate block" title={card.value}>
              {card.value}
            </span>
          </div>
        ))}
      </div>

      {/* Download Box */}
      <div className="bg-zinc-900/90 border border-white/15 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              {availableQuants.length > 0
                ? `Download Weights (${availableQuants.length} ${availableQuants.length === 1 ? 'file' : 'files'} available)`
                : 'Repository Files'}
            </h4>
          </div>
          {availableQuants.length > 0 && (
            <span className="text-[10px] font-mono text-zinc-400">16-Stream Parallel Acceleration</span>
          )}
        </div>

        {availableQuants.length > 0 ? (
          <>
            <div className="relative">
              <select
                value={selectedQuantIndex}
                onChange={(e) => onSelectQuantIndex(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white font-mono appearance-none focus:outline-none focus:border-white/40 cursor-pointer shadow-inner"
              >
                {availableQuants.map((q, idx) => (
                  <option key={idx} value={idx}>
                    [{q.quant}] {q.filename} - {q.sizeDisplay}
                  </option>
                ))}
              </select>
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </div>
            </div>

            {activeDownloadItem && (
              <div className="bg-zinc-950/80 border border-white/10 rounded-xl p-3.5 space-y-2 font-mono">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                    Downloading {activeDownloadItem.model_name}
                  </span>
                  <span className="text-white font-bold">{activeDownloadItem.percent.toFixed(1)}%</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-300 rounded-full"
                    style={{ width: `${activeDownloadItem.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1">
                  <span>
                    {((activeDownloadItem.downloaded_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB /{' '}
                    {((activeDownloadItem.total_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB
                  </span>
                  <span>{speedInfo.speed ? `${speedInfo.speed} • ETA: ${speedInfo.eta || '--'}` : 'Connecting...'}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs font-mono text-zinc-400 truncate">
                {selectedQuant
                  ? `${selectedQuant.quant} • ${selectedQuant.sizeDisplay}`
                  : ''}
              </span>

              {isDownloaded ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Downloaded</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedQuant) return;
                      const match = localModels.find((m) =>
                        m.id.toLowerCase().includes(selectedQuant.filename.toLowerCase())
                      );
                      if (match) onLoadInEngine(match.id);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-950 bg-white hover:bg-zinc-200 transition-all shadow-md cursor-pointer"
                  >
                    Load in Engine →
                  </button>
                </div>
              ) : activeDownloadItem ? (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onControlDownload(
                        activeDownloadItem.model_name,
                        activeDownloadItem.status === 'paused' ? 'resume' : 'pause'
                      )
                    }
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 transition-colors cursor-pointer"
                  >
                    {activeDownloadItem.status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestCancelDownload(activeDownloadItem)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => selectedQuant && onStartDownload(selectedQuant, details)}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-zinc-950 bg-white hover:bg-zinc-200 active:scale-[0.98] shadow-lg flex items-center gap-2 transition-all cursor-pointer shrink-0"
                >
                  <svg className="w-4 h-4 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download {selectedQuant?.sizeDisplay || ''}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 py-2">
            <span className="text-xs text-zinc-400">
              No standalone GGUF, Safetensors, or ONNX weights published in this repository.
            </span>
            <a
              href={`https://huggingface.co/${details.id}/tree/main`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-white/10 transition-colors shrink-0"
            >
              Browse Files ↗
            </a>
          </div>
        )}
      </div>

      {/* Repository Documentation / README */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 font-mono">
            <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Repository Model Card</span>
          </h4>
        </div>

        <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-6 md:p-7 text-sm text-zinc-200 leading-relaxed font-sans">
          {modelReadme ? (
            <ModelReadmeViewer content={modelReadme} modelId={details.id} />
          ) : (
            <span className="text-zinc-500 italic text-sm">No README content available for this model repository.</span>
          )}
        </div>
      </div>
    </div>
  );
}
