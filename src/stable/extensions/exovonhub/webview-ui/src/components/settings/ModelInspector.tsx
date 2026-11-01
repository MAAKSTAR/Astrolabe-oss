import React, { useState, useMemo } from 'react';
import { extractModelMetadata, type ModelMetadata } from './modelUtils';
import { ModelOrgAvatar } from './ModelOrgAvatar';

export interface ModelInspectorProps {
  model: any; // local model object: { id, name, size, modified, quant, params, architecture, path, etc. }
  vscodeApi: any;
  daemonHealth: any; // { active_model, active_ghost_model, active_diffusion_model, ctx_size, hardware }
  activeLocalModel: string | null;
  activeGhostModel: string | null;
  isModelLoading: boolean;
  modelLoadProgress?: { percent: number; message: string };
  onClose?: () => void;
}

export const ModelInspector: React.FC<ModelInspectorProps> = ({
  model,
  vscodeApi,
  daemonHealth,
  activeLocalModel,
  activeGhostModel,
  isModelLoading,
  modelLoadProgress,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'tuning' | 'roles'>('overview');
  const [copiedPath, setCopiedPath] = useState(false);

  // Tuning Parameters State
  const [ctxSize, setCtxSize] = useState<number>(() => {
    if (daemonHealth?.ctx_size && (daemonHealth?.active_model === model?.id || activeLocalModel === model?.id)) {
      return daemonHealth.ctx_size;
    }
    return 8192;
  });
  const [nGPULayers, setNGPULayers] = useState<number>(99);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [nThreads, setNThreads] = useState<number>(4);
  const [flashAttn, setFlashAttn] = useState<boolean>(true);

  const meta: ModelMetadata = useMemo(() => {
    return extractModelMetadata(model?.id, model);
  }, [model]);

  // Determine current active status
  const isPrimary = useMemo(() => {
    if (!model?.id) return false;
    return daemonHealth?.active_model === model.id || activeLocalModel === model.id;
  }, [daemonHealth?.active_model, activeLocalModel, model?.id]);

  const isGhost = useMemo(() => {
    if (!model?.id) return false;
    return daemonHealth?.active_ghost_model === model.id || activeGhostModel === model.id;
  }, [daemonHealth?.active_ghost_model, activeGhostModel, model?.id]);

  const isDiffusion = useMemo(() => {
    if (!model?.id) return false;
    return daemonHealth?.active_diffusion_model === model.id;
  }, [daemonHealth?.active_diffusion_model, model?.id]);

  const isLoadedInMemory = isPrimary || isGhost || isDiffusion || Boolean(model?.loaded);

  // Copy file path helper
  const handleCopyPath = () => {
    const fullPath = model?.path || meta.filePath || meta.cleanId;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(fullPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  // Quick Action Handlers
  const handleRevealInOS = () => {
    const targetPath = model?.path || model?.id || meta.cleanId;
    vscodeApi?.postMessage({
      command: 'revealInOS',
      path: targetPath
    });
  };

  const handleUseInChat = () => {
    vscodeApi?.postMessage({
      command: 'setActiveModel',
      model: model.id,
      openChat: true
    });
  };

  const handleUnload = () => {
    vscodeApi?.postMessage({
      command: 'unloadLocalModel'
    });
  };

  const handleLoadWithTuning = () => {
    vscodeApi?.postMessage({
      command: 'loadLocalModel',
      modelId: model.id,
      ctxSize,
      nGPULayers,
      nThreads,
      temperature,
      flashAttn
    });
  };

  const handleAssignPrimary = () => {
    vscodeApi?.postMessage({
      command: 'setActiveModel',
      model: model.id,
      openChat: false
    });
  };

  const handleAssignGhost = () => {
    vscodeApi?.postMessage({
      command: 'setInlineGhostModel',
      model: model.id
    });
  };

  const CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768];

  return (
    <div className="flex flex-col h-full bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl">
      {/* 1. Header Section */}
      <div className="p-5 border-b border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            <ModelOrgAvatar modelId={model?.id || ''} className="w-10 h-10 shrink-0 rounded-xl mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2
                  className="text-base font-bold text-white tracking-tight truncate max-w-md"
                  title={meta.cleanId}
                >
                  {meta.displayName}
                </h2>

                {/* Status Badges */}
                {isPrimary && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Primary
                  </span>
                )}
                {isGhost && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                    Inline Ghost
                  </span>
                )}
                {isDiffusion && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    Diffusion Worker
                  </span>
                )}
              </div>

              {/* Path on disk & Reveal button */}
              <div className="flex items-center gap-2 mt-2 text-xs text-zinc-300 flex-wrap">
                <span className="font-mono text-[11px] text-zinc-300 truncate max-w-sm" title={meta.filePath}>
                  {meta.filePath}
                </span>
                <button
                  type="button"
                  onClick={handleRevealInOS}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors cursor-pointer shrink-0"
                  title="Reveal file in operating system file manager"
                >
                  <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>Reveal</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors cursor-pointer shrink-0"
                  title="Copy path to clipboard"
                >
                  <span>{copiedPath ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Close button if onClose prop provided */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Close Inspector"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Quick Action Buttons Row */}
        <div className="flex items-center gap-2.5 mt-4 pt-3.5 border-t border-white/5 flex-wrap">
          {/* 1. Use in Chat */}
          <button
            type="button"
            onClick={handleUseInChat}
            className="inline-flex items-center gap-1.5 bg-white hover:bg-zinc-200 text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
            title="Set as active chat model and open Astrolabe sidebar"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>Use in Chat</span>
          </button>

          {/* 2. Load or Unload Toggle */}
          {isLoadedInMemory ? (
            <button
              type="button"
              onClick={handleUnload}
              className="inline-flex items-center gap-1.5 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 font-bold px-4 py-2 rounded-xl text-xs transition-colors cursor-pointer"
              title="Unload model from RAM/VRAM"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19h14M12 5l-7 7h14l-7-7z" />
              </svg>
              <span>Unload from Memory</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLoadWithTuning}
              disabled={isModelLoading}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-white border border-white/15 font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              title="Load model into memory with configured parameters"
            >
              <svg className="w-3.5 h-3.5 text-zinc-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{isModelLoading ? 'Loading...' : 'Load Model'}</span>
            </button>
          )}

          {/* Progress Indicator if Loading */}
          {isModelLoading && (
            <div className="flex-1 min-w-[160px] max-w-xs ml-auto">
              <div className="flex justify-between text-[10px] text-sky-400 font-mono mb-1">
                <span className="truncate">{modelLoadProgress?.message || 'Loading model weights...'}</span>
                <span>{modelLoadProgress?.percent || 0}%</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden border border-white/5">
                <div
                  className="bg-sky-400 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, modelLoadProgress?.percent || 0)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Tabs Navigation Header */}
      <div className="flex items-center border-b border-white/10 bg-[#141416] px-5 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'overview'
              ? 'text-white border-white'
              : 'text-zinc-400 border-transparent hover:text-zinc-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tuning')}
          className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'tuning'
              ? 'text-white border-white'
              : 'text-zinc-400 border-transparent hover:text-zinc-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span>Inference & VRAM Tuning</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('roles')}
          className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'roles'
              ? 'text-white border-white'
              : 'text-zinc-400 border-transparent hover:text-zinc-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Role Assignment</span>
        </button>
      </div>

      {/* 3. Tab Contents */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar text-zinc-300">
        {/* ================= TAB 1: OVERVIEW ================= */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Grid of Key Technical Specs */}
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide mb-3">Model Specifications</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">File Format</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.format}</div>
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">Architecture</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.architecture}</div>
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">Parameters</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.params}</div>
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">Quantization</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.quant}</div>
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">Size on Disk</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.sizeDisplay}</div>
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-3">
                  <span className="text-xs font-medium text-zinc-400 block">Last Modified</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">{meta.modified}</div>
                </div>
              </div>
            </div>

            {/* Storage Details Card */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">Storage Location</span>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {copiedPath ? '✓ Copied' : 'Copy Full Path'}
                </button>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-white/10 font-mono text-xs text-zinc-200 select-all break-all">
                {meta.filePath}
              </div>
            </div>

            {/* Capabilities and Tags */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-semibold text-zinc-200">Detected Model Capabilities</span>
              <div className="flex flex-wrap gap-1.5">
                {meta.isReasoning && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-200 border border-white/10">
                    Reasoning / Thinking Model
                  </span>
                )}
                {meta.isToolUse && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-200 border border-white/10">
                    Function Calling / Tools
                  </span>
                )}
                {meta.isVision && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    Multimodal Vision (VL)
                  </span>
                )}
                {meta.isDiffusion && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    Diffusion / Image Synthesis
                  </span>
                )}
                {meta.isMmproj && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                    Vision Projector (mmproj)
                  </span>
                )}
                {meta.isEmbedding && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    Text Embeddings
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 border border-white/10">
                  Publisher: {meta.publisher}
                </span>
              </div>
            </div>

            {/* Hardware Assessment Card */}
            {daemonHealth?.hardware && (
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                <span className="text-xs font-semibold text-zinc-200">Hardware & VRAM Compatibility</span>
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="text-zinc-400">Detected Accelerator:</span>
                  <span className="font-mono text-zinc-100 font-semibold">{daemonHealth.hardware.gpu || 'CPU Native'}</span>
                </div>
                {daemonHealth.hardware.vram_free_mb !== undefined && (
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span className="text-zinc-400">Available Free VRAM:</span>
                    <span className="font-mono text-zinc-100 font-semibold">
                      {(daemonHealth.hardware.vram_free_mb / 1024).toFixed(1)} GB
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: INFERENCE & VRAM TUNING ================= */}
        {activeTab === 'tuning' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Runtime & Hardware Parameters</h3>
              <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                Tune memory limits, offload layers, and sampling hyperparameters for local inference.
              </p>
            </div>

            {/* 1. Context Length */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Context Length</label>
                  <span className="text-xs text-zinc-300 mt-0.5 font-normal">Maximum token window for prompt & code context</span>
                </div>
                <span className="bg-zinc-800/90 text-white font-mono text-xs font-bold px-2 py-0.5 rounded border border-white/10">
                  {ctxSize.toLocaleString()} tokens ({Math.round(ctxSize / 1024)}K)
                </span>
              </div>

              {/* Presets Row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {CONTEXT_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setCtxSize(val)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                      ctxSize === val
                        ? 'bg-white text-zinc-950 font-bold shadow-sm'
                        : 'bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 border border-white/10 font-medium'
                    }`}
                  >
                    {Math.round(val / 1024)}K ({val})
                  </button>
                ))}
              </div>

              {/* Slider */}
              <input
                type="range"
                min="2048"
                max="32768"
                step="1024"
                value={ctxSize}
                onChange={(e) => setCtxSize(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* 2. GPU Offload Layers */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">GPU Offload Layers</label>
                  <span className="text-xs text-zinc-300 mt-0.5 font-normal">
                    Layers pushed to VRAM (99 = Full GPU Acceleration)
                  </span>
                </div>
                <span className="bg-zinc-800/90 text-white font-mono text-xs font-bold px-2 py-0.5 rounded border border-white/10">
                  {nGPULayers >= 99 ? '99 (Full GPU)' : nGPULayers === 0 ? '0 (CPU Only)' : `${nGPULayers} layers`}
                </span>
              </div>

              <input
                type="range"
                min="0"
                max="99"
                step="1"
                value={nGPULayers}
                onChange={(e) => setNGPULayers(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
              <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                <span>0 (CPU)</span>
                <span>Partial Offload</span>
                <span>99 (Max VRAM)</span>
              </div>
            </div>

            {/* 3. Temperature */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Sampling Temperature</label>
                  <span className="text-xs text-zinc-300 mt-0.5 font-normal">
                    Lower values produce more deterministic code; higher values are more creative
                  </span>
                </div>
                <span className="bg-zinc-800/90 text-white font-mono text-xs font-bold px-2 py-0.5 rounded border border-white/10">
                  {temperature.toFixed(2)}
                </span>
              </div>

              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
              <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                <span>0.0 (Precise / Code)</span>
                <span>0.7 (Balanced)</span>
                <span>1.5 (Creative)</span>
              </div>
            </div>

            {/* 4. CPU Thread Count */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">CPU Thread Count</label>
                  <span className="text-xs text-zinc-300 mt-0.5 font-normal">Compute threads for CPU layers and matrix operations</span>
                </div>
                <span className="bg-zinc-800/90 text-white font-mono text-xs font-bold px-2 py-0.5 rounded border border-white/10">
                  {nThreads} threads
                </span>
              </div>

              <input
                type="range"
                min="1"
                max="16"
                step="1"
                value={nThreads}
                onChange={(e) => setNThreads(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* 5. Flash Attention Toggle */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-zinc-100 block">Flash Attention (FA2)</label>
                <span className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Saves memory & accelerates prompt processing on modern GPUs
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFlashAttn(!flashAttn)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 ${
                  flashAttn ? 'bg-white' : 'bg-zinc-800'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    flashAttn ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                  }`}
                />
              </button>
            </div>

            {/* 6. Commit Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleLoadWithTuning}
                disabled={isModelLoading}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 bg-white hover:bg-zinc-200 transition-colors shadow-md cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>{isModelLoading ? 'Applying & Loading Model...' : 'Load Model with Settings'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ================= TAB 3: ROLE ASSIGNMENT ================= */}
        {activeTab === 'roles' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Model Role Assignments</h3>
              <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                Assign this model to dedicated engine slots for chat assistance, ghost completions, or diffusion.
              </p>
            </div>

            {/* Card 1: Primary Chat Agent */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-zinc-800 text-zinc-100 border border-white/10">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                      Primary Chat Agent
                    </h4>
                    <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                      Powers conversation, code reasoning, and autonomous tool calling in the chat sidebar.
                    </p>
                  </div>
                </div>

                {isPrimary && (
                  <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    ● Active Primary
                  </span>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleAssignPrimary}
                  disabled={isPrimary}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isPrimary
                      ? 'bg-zinc-800/60 text-zinc-400 cursor-not-allowed border border-white/5'
                      : 'bg-white hover:bg-zinc-200 text-zinc-950 shadow-sm'
                  }`}
                >
                  {isPrimary ? 'Already Assigned' : 'Assign as Primary Agent'}
                </button>
              </div>
            </div>

            {/* Card 2: Inline Ghost Autocompleter */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-zinc-800 text-zinc-100 border border-white/10">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                      Inline Ghost Autocompleter
                    </h4>
                    <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                      Runs in background to provide instant multi-token autocompletions as you type in code editors.
                    </p>
                  </div>
                </div>

                {isGhost && (
                  <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                    ● Active Ghost
                  </span>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleAssignGhost}
                  disabled={isGhost}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isGhost
                      ? 'bg-zinc-800/60 text-zinc-400 cursor-not-allowed border border-white/5'
                      : 'bg-white hover:bg-zinc-200 text-zinc-950 shadow-sm'
                  }`}
                >
                  {isGhost ? 'Already Assigned' : 'Assign as Inline Ghost'}
                </button>
              </div>
            </div>

            {/* Optional Card 3: Diffusion Worker if applicable */}
            {meta.isDiffusion && (
              <div className="bg-[#141416] border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-zinc-800 text-zinc-100 border border-white/10">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                        Vision & Diffusion Worker
                      </h4>
                      <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                        High-resolution visual synthesis engine on dedicated port 47992.
                      </p>
                    </div>
                  </div>

                  {isDiffusion && (
                    <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      ● Active Worker
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
