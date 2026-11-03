import React, { useState, useEffect, useMemo, useRef } from 'react';
import { extractModelMetadata } from './modelUtils';
import { ModelInspector } from './ModelInspector';
import { ModelOrgAvatar } from './ModelOrgAvatar';
import { ModelCapabilityBadges } from './ModelCapabilityIcons';

export interface LocalModelsViewProps {
  localModels: any[];
  vscodeApi: any;
  daemonHealth: any;
  daemonRunning: boolean;
  activeLocalModel: string | null;
  activeGhostModel: string | null;
  localModelsDir: string;
  isGhostEnabled?: boolean;
}

export const LocalModelsView: React.FC<LocalModelsViewProps> = ({
  localModels,
  vscodeApi,
  daemonHealth,
  daemonRunning,
  activeLocalModel,
  activeGhostModel,
  localModelsDir,
  isGhostEnabled = true
}) => {
  // Selected model ID for master-detail view
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (activeLocalModel && localModels.some(m => m.id === activeLocalModel)) {
      return activeLocalModel;
    }
    return localModels[0]?.id || null;
  });

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPill, setFilterPill] = useState<'all' | 'llm' | 'vision' | 'image' | 'ghost'>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ghost text autocompletion toggle
  const [ghostEnabled, setGhostEnabled] = useState(isGhostEnabled);

  // Loading state tracking
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [modelLoadProgress, setModelLoadProgress] = useState<{ percent: number; message: string } | undefined>(undefined);

  // Sync ghost status
  useEffect(() => {
    setGhostEnabled(isGhostEnabled);
  }, [isGhostEnabled]);

  // Listen to window messages for model load progress
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'modelLoadProgress') {
        setLoadingModelId(data.modelId);
        setModelLoadProgress({
          percent: data.percent ?? 0,
          message: data.message || 'Loading neural tensors...'
        });
      } else if (data.type === 'modelLoaded') {
        setLoadingModelId(null);
        setModelLoadProgress(undefined);
      } else if (data.type === 'modelLoadError') {
        setLoadingModelId(null);
        setModelLoadProgress(undefined);
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, []);

  // Filtered models computation
  const filteredModels = useMemo(() => {
    return localModels.filter((m) => {
      const meta = extractModelMetadata(m.id, m);

      // 1. Modality pill filtering
      if (filterPill === 'llm' && (meta.isDiffusion || meta.isMmproj)) return false;
      if (filterPill === 'vision' && (!meta.isVision && !meta.isMmproj)) return false;
      if (filterPill === 'image' && !meta.isDiffusion) return false;
      if (filterPill === 'ghost' && activeGhostModel !== m.id && !m.id.toLowerCase().includes('ghost') && !m.id.toLowerCase().includes('fim')) {
        return false;
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
  }, [localModels, filterPill, searchQuery, activeGhostModel]);

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

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full w-full min-h-[640px]">
      {/* ================= LEFT PANE: MODEL LIBRARY (~40% width / min-w-[340px]) ================= */}
      <div className="w-full lg:w-[42%] lg:min-w-[360px] flex flex-col bg-[#141416] border border-white/10 rounded-2xl shadow-xl overflow-hidden shrink-0">
        {/* Header Bar */}
        <div className="p-4 border-b border-white/5 bg-[#18181b]/60 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100 tracking-wide">
                My Models
              </h3>
              <span className="text-xs text-zinc-300 font-mono px-2 py-0.5 bg-zinc-800/80 rounded-full border border-white/10">
                {filteredModels.length}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border ${
                  daemonRunning
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-zinc-800 text-zinc-400 border-white/5'
                }`}
                title={daemonRunning ? 'Local Engine daemon online on port 47990' : 'Local Engine daemon offline'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${daemonRunning ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                <span>{daemonRunning ? 'Daemon Online' : 'Daemon Offline'}</span>
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
          <div className="flex items-center gap-1 mt-2.5 overflow-x-auto pb-0.5">
            {[
              { id: 'all', label: 'All' },
              { id: 'llm', label: 'Chat / LLM' },
              { id: 'vision', label: 'Vision' },
              { id: 'image', label: 'Image Gen' },
              { id: 'ghost', label: 'Ghost' }
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFilterPill(pill.id as any)}
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

              const isPrimary = daemonHealth?.active_model === m.id || activeLocalModel === m.id;
              const isGhost = daemonHealth?.active_ghost_model === m.id || activeGhostModel === m.id;
              const isDiffusion = daemonHealth?.active_diffusion_model === m.id;
              const isLoaded = isPrimary || isGhost || isDiffusion || Boolean(m.loaded);

              const isLoadingThis = loadingModelId === m.id;

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
                          isImageGen: meta.isDiffusion,
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
                      {isDiffusion && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                          Diffusion
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

                  {/* Right: Quick Action Button */}
                  <div className="shrink-0 flex items-center">
                    {isLoadingThis ? (
                      <span className="text-[10px] font-mono text-sky-400 animate-pulse px-2 py-1 bg-sky-500/10 rounded border border-sky-500/20">
                        {modelLoadProgress?.percent || 0}%
                      </span>
                    ) : isLoaded ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vscodeApi?.postMessage({ command: 'unloadLocalModel' });
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 rounded-lg transition-colors cursor-pointer"
                        title="Unload from memory"
                      >
                        Unload
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vscodeApi?.postMessage({
                            command: 'loadLocalModel',
                            modelId: m.id,
                            ctxSize: 8192,
                            nGPULayers: 99,
                            nThreads: 4,
                            temperature: 0.7,
                            flashAttn: true
                          });
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg transition-colors cursor-pointer"
                        title="Load into memory"
                      >
                        Load
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= RIGHT PANE: MODEL INSPECTOR (~60% width) ================= */}
      <div className="w-full lg:w-[58%] flex-1 h-full min-h-[500px]">
        {selectedModel ? (
          <ModelInspector
            model={selectedModel}
            vscodeApi={vscodeApi}
            daemonHealth={daemonHealth}
            activeLocalModel={activeLocalModel}
            activeGhostModel={activeGhostModel}
            isModelLoading={loadingModelId === selectedModel.id}
            modelLoadProgress={loadingModelId === selectedModel.id ? modelLoadProgress : undefined}
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
    </div>
  );
};
