import React, { useState, useEffect, useMemo, useRef } from 'react';
import { extractModelMetadata } from './modelUtils';
import { ModelInspector } from './ModelInspector';
import { ModelOrgAvatar } from './ModelOrgAvatar';
import { ModelCapabilityBadges } from './ModelCapabilityIcons';

type FilterPillType = 'all' | 'llm' | 'vision' | 'image' | 'video' | 'music' | 'ghost' | 'components';

interface OrganizeMoveItem {
  id?: string;
  from: string;
  to: string;
  modality?: string;
  componentRole?: string | null;
}

const getBasename = (idOrPath?: string | null): string => {
  if (!idOrPath) return '';
  const parts = String(idOrPath).split(/[\\/]/);
  return parts[parts.length - 1] || String(idOrPath);
};

const matchesModelIdentifier = (model: any, targetId?: string | null): boolean => {
  if (!model || !targetId) return false;
  if (model.id === targetId || model.path === targetId) return true;
  const targetBase = getBasename(targetId).toLowerCase();
  if (!targetBase) return false;
  return (
    getBasename(model.id).toLowerCase() === targetBase ||
    getBasename(model.path).toLowerCase() === targetBase
  );
};

export interface LocalModelsViewProps {
  localModels: any[];
  vscodeApi: any;
  daemonHealth: any;
  daemonRunning?: boolean;
  activeLocalModel: string | null;
  activeGhostModel: string | null;
  localModelsDir: string;
  isGhostEnabled?: boolean;
}

export const LocalModelsView: React.FC<LocalModelsViewProps> = ({
  localModels,
  vscodeApi,
  daemonHealth,
  daemonRunning: _daemonRunning,
  activeLocalModel,
  activeGhostModel,
  localModelsDir,
  isGhostEnabled = true
}) => {
  // Selected model ID for master-detail view (prefer active or first runnable model)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (activeLocalModel && localModels.some(m => m.id === activeLocalModel)) {
      return activeLocalModel;
    }
    const firstRunnable = localModels.find((m) => {
      const meta = extractModelMetadata(m.id, m);
      return !meta.isComponent && meta.modelFamily !== 'pipeline_component';
    });
    return firstRunnable?.id || localModels[0]?.id || null;
  });

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPill, setFilterPill] = useState<FilterPillType>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ghost text autocompletion toggle
  const [ghostEnabled, setGhostEnabled] = useState(isGhostEnabled);

  // Loading state tracking
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [modelLoadProgress, setModelLoadProgress] = useState<{ percent: number; message: string } | undefined>(undefined);

  // Organize Folder preview modal state
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeApplying, setOrganizeApplying] = useState(false);
  const [organizeMoves, setOrganizeMoves] = useState<OrganizeMoveItem[]>([]);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [organizeNotice, setOrganizeNotice] = useState<string | null>(null);

  // Sync ghost status
  useEffect(() => {
    setGhostEnabled(isGhostEnabled);
  }, [isGhostEnabled]);

  // Listen to window messages for model load progress and folder organization results
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'modelLoadProgress') {
        setLoadingModelId(data.modelId || data.model_id || null);
        setModelLoadProgress({
          percent: typeof data.percent === 'number' ? data.percent : 0,
          message: data.message || 'Loading neural tensors...'
        });
      } else if (data.type === 'modelLoaded') {
        setLoadingModelId(null);
        setModelLoadProgress(undefined);
      } else if (data.type === 'modelLoadError') {
        setLoadingModelId(null);
        setModelLoadProgress(undefined);
      } else if (
        data.type === 'organizeLocalModelsResult' ||
        data.type === 'organizeResult' ||
        data.type === 'localModelsOrganized'
      ) {
        const isDryRun = Boolean(data.dryRun ?? data.dry_run ?? (organizeLoading && !organizeApplying));
        setOrganizeLoading(false);
        setOrganizeApplying(false);
        if (data.error) {
          setOrganizeError(String(data.error));
          return;
        }
        const rawMoves = data.moves || data.plan || data.items || data.changes || data.preview || data.moved || [];
        const normalizedMoves: OrganizeMoveItem[] = Array.isArray(rawMoves)
          ? rawMoves.map((item: any) => ({
              id: item.id || item.model_id,
              from: item.from || item.source || item.current_path || item.relative_path || item.name || item.id || '',
              to: item.to || item.destination || item.target_path || item.target_relative_path || item.target || '',
              modality: item.modality || item.target_modality,
              componentRole: item.component_role ?? item.componentRole ?? null
            }))
          : [];

        if (isDryRun) {
          setOrganizeMoves(normalizedMoves);
          setOrganizeError(null);
          setOrganizeNotice(null);
        } else {
          setOrganizeMoves([]);
          setOrganizeError(null);
          setOrganizeNotice(
            normalizedMoves.length > 0
              ? `Organized ${normalizedMoves.length} file${normalizedMoves.length === 1 ? '' : 's'} into modality folders.`
              : 'Library folder organization applied.'
          );
          vscodeApi?.postMessage({ command: 'getLocalModels' });
        }
      } else if (data.type === 'organizeLocalModelsError') {
        setOrganizeLoading(false);
        setOrganizeApplying(false);
        setOrganizeError(String(data.error || 'Failed to organize models directory.'));
      } else if (data.type === 'moveLocalModelResult' || data.type === 'localModelMoved') {
        if (!data.error) {
          vscodeApi?.postMessage({ command: 'getLocalModels' });
        }
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [organizeLoading, organizeApplying, vscodeApi]);

  const effectiveLoadingModelId =
    loadingModelId || daemonHealth?.loading_model?.model_id || daemonHealth?.loading_model?.modelId || null;
  const effectiveLoadProgress = modelLoadProgress || (
    daemonHealth?.loading_model
      ? {
          percent: Number(daemonHealth.loading_model.percent ?? 0),
          message: String(daemonHealth.loading_model.stage || daemonHealth.loading_model.message || 'Loading...')
        }
      : undefined
  );

  // Filtered models computation
  const filteredModels = useMemo(() => {
    return localModels.filter((m) => {
      const meta = extractModelMetadata(m.id, m);
      const isComp = meta.isComponent || meta.modality === 'component' || meta.modelFamily === 'pipeline_component';

      // 1. Modality pill filtering — keep pipeline components out of runnable tabs
      if (filterPill === 'components') {
        if (!isComp) return false;
      } else {
        if (isComp) return false;
        if (filterPill === 'llm' && (meta.modality !== 'llm' || meta.isDiffusion || meta.isVideo || meta.isMusic)) return false;
        if (filterPill === 'vision' && !meta.isVision) return false;
        if (filterPill === 'image' && meta.modality !== 'image' && (meta.isVideo || meta.isMusic || (!meta.isDiffusion && meta.modelFamily !== 'autoregressive_image'))) return false;
        if (filterPill === 'video' && !meta.isVideo && meta.modality !== 'video') return false;
        if (filterPill === 'music' && !meta.isMusic && meta.modality !== 'music') return false;
        if (filterPill === 'ghost' && activeGhostModel !== m.id && daemonHealth?.active_ghost_model !== m.id && !m.id.toLowerCase().includes('ghost') && !m.id.toLowerCase().includes('fim')) {
          return false;
        }
      }

      // 2. Search query filtering
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const rawId = (m.id || '').toLowerCase();
      const name = (m.name || meta.displayName).toLowerCase();
      const arch = meta.architecture.toLowerCase();
      const quant = meta.quant.toLowerCase();
      const params = meta.params.toLowerCase();
      const pub = meta.publisher.toLowerCase();

      return (
        rawId.includes(q) ||
        name.includes(q) ||
        arch.includes(q) ||
        quant.includes(q) ||
        params.includes(q) ||
        pub.includes(q)
      );
    });
  }, [localModels, filterPill, searchQuery, activeGhostModel, daemonHealth?.active_ghost_model]);

  // Currently selected model object
  const selectedModel = useMemo(() => {
    if (!selectedModelId) return null;
    return localModels.find((m) => m.id === selectedModelId) || { id: selectedModelId };
  }, [selectedModelId, localModels]);

  const handleBrowseDir = () => {
    vscodeApi?.postMessage({ command: 'browseLocalModelsDirectory' });
  };

  const handleToggleGhost = () => {
    const next = !ghostEnabled;
    setGhostEnabled(next);
    vscodeApi?.postMessage({ command: 'toggleGhostText', enabled: next });
  };

  const handleRefresh = () => {
    vscodeApi?.postMessage({ command: 'getLocalModels' });
    vscodeApi?.postMessage({ command: 'getDaemonHealth' });
  };

  const handlePreviewOrganize = () => {
    setOrganizeOpen(true);
    setOrganizeLoading(true);
    setOrganizeApplying(false);
    setOrganizeMoves([]);
    setOrganizeError(null);
    setOrganizeNotice(null);
    vscodeApi?.postMessage({ command: 'organizeLocalModels', dryRun: true });
  };

  const handleConfirmOrganize = () => {
    setOrganizeApplying(true);
    setOrganizeError(null);
    vscodeApi?.postMessage({ command: 'organizeLocalModels', dryRun: false });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full w-full min-h-[640px] relative">
      {/* ================= LEFT PANE: MODEL LIBRARY (~40% width / min-w-[340px]) ================= */}
      <div className="w-full lg:w-[40%] lg:min-w-[340px] flex flex-col bg-[#141416] border border-white/10 rounded-2xl shadow-xl overflow-hidden shrink-0">
        {/* Header Bar */}
        <div className="p-3.5 border-b border-white/5 bg-[#18181b]/60 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100 tracking-wide">
                My Models
              </h3>
              <span className="text-xs text-zinc-300 font-mono px-2 py-0.5 bg-zinc-800/80 rounded-full border border-white/10">
                {filteredModels.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Ghost Toggle Button */}
              <button
                type="button"
                onClick={handleToggleGhost}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border cursor-pointer ${
                  ghostEnabled
                    ? 'bg-zinc-800 text-zinc-100 border-white/20'
                    : 'bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200'
                }`}
                title={ghostEnabled ? 'Ghost Autocompletion ON' : 'Ghost Autocompletion OFF'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${ghostEnabled ? 'bg-sky-400' : 'bg-zinc-500'}`} />
                <span>Ghost {ghostEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={handleRefresh}
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors border border-white/10 cursor-pointer"
                title="Refresh Model List"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Directory Path Display & Change Button */}
          <div className="flex items-center justify-between gap-2 bg-[#121214] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-zinc-300">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate font-mono text-[11px] text-zinc-200" title={localModelsDir}>
                {localModelsDir || 'No directory selected'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handlePreviewOrganize}
                className="px-2 py-0.5 rounded text-[11px] font-semibold text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors shrink-0 cursor-pointer"
                title="Preview moving loose files into llm/, image/, video/, music/, and components/ folders"
              >
                Organize Folder
              </button>
              <button
                type="button"
                onClick={handleBrowseDir}
                className="px-2 py-0.5 rounded text-[11px] font-semibold text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors shrink-0 cursor-pointer"
                title="Change models folder location"
              >
                Change
              </button>
            </div>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="p-3 border-b border-white/5 bg-[#161618]">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter local models..."
              className="bg-zinc-900 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-500 w-full transition-colors font-sans"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer p-0.5"
              >
                ×
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 mt-2.5 overflow-x-auto pb-0.5 custom-scrollbar">
            {[
              { id: 'all', label: 'All' },
              { id: 'llm', label: 'Chat / LLM' },
              { id: 'vision', label: 'Vision' },
              { id: 'image', label: 'Image Gen' },
              { id: 'video', label: 'Video' },
              { id: 'music', label: 'Music' },
              { id: 'ghost', label: 'Ghost' },
              { id: 'components', label: 'Components' }
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFilterPill(pill.id as FilterPillType)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  filterPill === pill.id
                    ? 'bg-white text-zinc-950 font-bold shadow-sm'
                    : 'text-zinc-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Model Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] custom-scrollbar">
          {filteredModels.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-xs text-zinc-400">
                {localModels.length === 0
                  ? 'No local models found in the directory.'
                  : 'No models match your search or filter.'}
              </p>
              {localModels.length === 0 && (
                <button
                  type="button"
                  onClick={handleBrowseDir}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors cursor-pointer"
                >
                  Change Directory
                </button>
              )}
            </div>
          ) : (
            filteredModels.map((m) => {
              const meta = extractModelMetadata(m.id, m);
              const isSelected = selectedModelId === m.id;

              const isPrimary = matchesModelIdentifier(m, daemonHealth?.active_model) || matchesModelIdentifier(m, activeLocalModel);
              const isGhost = matchesModelIdentifier(m, daemonHealth?.active_ghost_model) || matchesModelIdentifier(m, activeGhostModel);
              const isVideoActive = matchesModelIdentifier(m, daemonHealth?.active_video_model);
              const isDiffusionActive = matchesModelIdentifier(m, daemonHealth?.active_diffusion_model) || isVideoActive;

              const isLoadingThis = matchesModelIdentifier(m, effectiveLoadingModelId);

              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedModelId(m.id)}
                  className={`p-3 transition-all cursor-pointer group flex items-center gap-3 relative ${
                    isSelected
                      ? 'bg-[#222226] border-l-2 border-white text-white shadow-sm'
                      : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                  }`}
                >
                  {/* Left: Model Org Avatar */}
                  <ModelOrgAvatar modelId={m.id} className="w-8 h-8 shrink-0 rounded-lg" />

                  {/* Center: Title & Metadata */}
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[13px] font-semibold text-zinc-100 group-hover:text-white truncate"
                        title={m.id}
                      >
                        {meta.displayName}
                      </span>
                      <ModelCapabilityBadges
                        capabilities={{
                          isVision: meta.isVision,
                          isToolUse: meta.isToolUse,
                          isReasoning: meta.isReasoning,
                          isImageGen: meta.isDiffusion && !meta.isVideo,
                          isVideo: meta.isVideo,
                          isMusic: meta.isMusic,
                          isComponent: meta.isComponent,
                          isAudio: false
                        }}
                        showLlmFallback={false}
                      />
                      {isPrimary && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Primary
                        </span>
                      )}
                      {isGhost && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                          Ghost
                        </span>
                      )}
                      {isDiffusionActive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                          {meta.isVideo || isVideoActive ? 'Video' : 'Diffusion'}
                        </span>
                      )}
                    </div>

                    {/* Metadata Row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {meta.quant && (
                        <span className="bg-zinc-800 text-zinc-200 border border-white/10 font-mono text-[11px] px-1.5 py-0.5 rounded font-medium">
                          {meta.quant}
                        </span>
                      )}
                      {meta.params && meta.params !== 'N/A' && (
                        <span className="text-zinc-300 font-mono text-xs">
                          {meta.params}
                        </span>
                      )}
                      <span className="text-zinc-300 font-mono text-xs">
                        {meta.sizeDisplay}
                      </span>
                    </div>
                  </div>

                  {/* Right: Compact Load Progress Indicator Only (Tuning/Load/Unload happens in Inspector) */}
                  {isLoadingThis && (
                    <div className="shrink-0 flex items-center">
                      <span className="text-[10px] font-mono text-sky-400 animate-pulse px-2 py-1 bg-sky-500/10 rounded border border-sky-500/20 tabular-nums">
                        {Math.round(effectiveLoadProgress?.percent ?? 0)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= RIGHT PANE: MODEL INSPECTOR (~60% width) ================= */}
      <div className="w-full lg:w-[60%] flex-1 h-full min-h-[500px]">
        {selectedModel ? (
          <ModelInspector
            key={selectedModel.id}
            model={selectedModel}
            availableLocalModels={localModels}
            vscodeApi={vscodeApi}
            daemonHealth={daemonHealth}
            activeLocalModel={activeLocalModel}
            activeGhostModel={activeGhostModel}
            isModelLoading={matchesModelIdentifier(selectedModel, effectiveLoadingModelId)}
            modelLoadProgress={matchesModelIdentifier(selectedModel, effectiveLoadingModelId) ? effectiveLoadProgress : undefined}
            onStartLoading={(modelId) => {
              setLoadingModelId(modelId);
              setModelLoadProgress({ percent: 0, message: 'Initializing engine...' });
            }}
            onClose={() => setSelectedModelId(null)}
          />
        ) : (
          /* Empty State Placeholder */
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[#18181b] border border-white/10 rounded-2xl shadow-xl min-h-[500px]">
            <div className="p-4 rounded-2xl bg-zinc-900 border border-white/10 mb-4 text-zinc-300">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-zinc-100">
              Select a Model to Inspect & Tune
            </h3>
            <p className="text-xs text-zinc-300 max-w-sm mt-2 leading-relaxed">
              Choose any local model from the library on the left to configure context length, GPU VRAM offload layers, sampling temperature, and assign it to an Astrolabe agent slot.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={handleBrowseDir}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors cursor-pointer"
              >
                Browse Models Directory
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================= ORGANIZE FOLDER DRY-RUN PREVIEW MODAL ================= */}
      {organizeOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-zinc-100">Organize Models Folder</h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Preview file moves into llm/, image/, video/, music/, and components/ folders.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrganizeOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-3 custom-scrollbar">
              {organizeLoading ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  Scanning models directory...
                </div>
              ) : organizeError ? (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  {organizeError}
                </div>
              ) : organizeNotice ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                  {organizeNotice}
                </div>
              ) : organizeMoves.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-300">
                  All local models are already organized into modality folders.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Planned Moves ({organizeMoves.length})
                  </div>
                  <div className="divide-y divide-white/5 border border-white/10 rounded-xl bg-zinc-950/60 overflow-hidden">
                    {organizeMoves.map((mv, idx) => (
                      <div key={mv.id || idx} className="px-3 py-2 text-xs font-mono space-y-0.5">
                        <div className="text-zinc-400 truncate" title={mv.from}>
                          {mv.from}
                        </div>
                        <div className="text-emerald-300 truncate" title={mv.to}>
                          → {mv.to}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-white/10 bg-[#141416] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOrganizeOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors cursor-pointer"
              >
                {organizeNotice || (!organizeLoading && organizeMoves.length === 0) ? 'Close' : 'Cancel'}
              </button>
              {!organizeLoading && !organizeNotice && organizeMoves.length > 0 && (
                <button
                  type="button"
                  disabled={organizeApplying}
                  onClick={handleConfirmOrganize}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-zinc-950 bg-white hover:bg-zinc-200 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {organizeApplying ? 'Moving Files...' : `Apply ${organizeMoves.length} Move${organizeMoves.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
