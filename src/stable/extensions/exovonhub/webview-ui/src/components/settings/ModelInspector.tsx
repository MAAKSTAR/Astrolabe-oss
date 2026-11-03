import React, { useState, useMemo } from 'react';
import { extractModelMetadata, type ModelMetadata } from './modelUtils';
import { ModelOrgAvatar } from './ModelOrgAvatar';
import { ModelCapabilityBadges } from './ModelCapabilityIcons';

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

  const meta: ModelMetadata = useMemo(() => {
    return extractModelMetadata(model?.id, model);
  }, [model]);

  const maxContextSupported = useMemo(() => {
    return meta.maxContextLength || 131072;
  }, [meta.maxContextLength]);

  const totalModelLayers = useMemo(() => {
    return meta.totalLayers || 33;
  }, [meta.totalLayers]);

  // Tuning Parameters State
  const [ctxSize, setCtxSize] = useState<number>(() => {
    if (daemonHealth?.ctx_size && (daemonHealth?.active_model === model?.id || activeLocalModel === model?.id)) {
      return daemonHealth.ctx_size;
    }
    return Math.min(8192, maxContextSupported);
  });
  const [nGPULayers, setNGPULayers] = useState<number>(() => totalModelLayers);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [nThreads, setNThreads] = useState<number>(4);
  const [nBatch, setNBatch] = useState<number>(2048);
  const [nUbatch, setNUbatch] = useState<number>(512);
  const [flashAttn, setFlashAttn] = useState<boolean>(true);
  const [useMmap, setUseMmap] = useState<boolean>(true);
  const [cacheTypeK, setCacheTypeK] = useState<'f16' | 'q8_0' | 'q4_0'>('f16');
  const [cacheTypeV, setCacheTypeV] = useState<'f16' | 'q8_0' | 'q4_0'>('f16');

  // Hardware memory limits (available system RAM & available GPU VRAM)
  const totalRamGb = daemonHealth?.hardware?.memory_gb || 14.7;
  const usedRamGb = daemonHealth?.hardware?.used_memory_gb || 5.4;
  const availRamGb = Math.max(0, totalRamGb - usedRamGb);

  const totalVramGb = daemonHealth?.hardware?.vram_total_mb ? daemonHealth.hardware.vram_total_mb / 1024 : 16.0;
  const availVramGb = daemonHealth?.hardware?.vram_free_mb ? daemonHealth.hardware.vram_free_mb / 1024 : 14.8;
  void totalVramGb;

  // Live estimated memory calculation (LM Studio style)
  const { estGpuGb, estTotalGb } = useMemo(() => {
    const rawSizeBytes = model?.size_bytes || meta.sizeBytes || 4.5 * 1024 * 1024 * 1024;
    const sizeGb = rawSizeBytes / (1024 * 1024 * 1024);
    const layers = totalModelLayers || 33;

    // 1. Model Weights
    const gpuRatio = Math.min(1, Math.max(0, nGPULayers / layers));
    const gpuWeights = sizeGb * gpuRatio;
    const ramWeights = sizeGb * (1 - gpuRatio);
    void ramWeights;

    // 2. KV Cache Quantization Multipliers (q8_0 = 50% memory, q4_0 = 25% memory / 75% savings)
    const kMult = cacheTypeK === 'q4_0' ? 0.25 : (cacheTypeK === 'q8_0' ? 0.50 : 1.0);
    const vMult = cacheTypeV === 'q4_0' ? 0.25 : (cacheTypeV === 'q8_0' ? 0.50 : 1.0);
    const avgKvMult = (kMult + vMult) / 2;

    // 3. Architecture-Aware KV Cache (2 * layers * d_kv * sizeof(elem))
    // Baseline GQA: ~0.125 GB per 1024 tokens for 32 layers
    const isDeepSeekMla = /deepseek/i.test(meta.architecture || '') || /deepseek/i.test(meta.displayName || '');
    const mlaMultiplier = isDeepSeekMla ? 0.18 : 1.0;

    const baseKvGb = (ctxSize / 1024) * (layers / 32) * 0.125 * avgKvMult * mlaMultiplier;
    // Flash Attention avoids unrolled KV buffer copies, saving ~15% working memory
    const workingKvGb = baseKvGb * (flashAttn ? 0.85 : 1.0);
    const gpuKv = gpuRatio > 0 ? workingKvGb * gpuRatio : 0;

    // 4. Compute / Activation Scratch Buffer
    // Flash Attention slashes the O(N^2) attention matrix from multiple GBs down to ~0.40 GB constant SRAM tiling
    const computeBufferGb = flashAttn
      ? 0.25 + (nBatch / 2048) * 0.15
      : 0.50 + (ctxSize / 8192) * 0.60 + (nBatch / 2048) * 0.30;
    const gpuCompute = gpuRatio > 0 ? computeBufferGb : 0.10;

    // 5. Vulkan Runtime Driver Overhead (~0.30 GB)
    const gpuDriverOverhead = gpuRatio > 0 ? 0.30 : 0;
    const hostOverhead = 0.35;

    // Total GPU VRAM required
    const estGpu = (gpuWeights + gpuKv + gpuCompute + gpuDriverOverhead).toFixed(2);

    // Total System Memory required
    const estTotal = (sizeGb + workingKvGb + computeBufferGb + gpuDriverOverhead + hostOverhead).toFixed(2);

    void useMmap;

    return { estGpuGb: estGpu, estTotalGb: estTotal };
  }, [model?.size_bytes, meta.sizeBytes, meta.architecture, meta.displayName, totalModelLayers, nGPULayers, ctxSize, flashAttn, nBatch, cacheTypeK, cacheTypeV, useMmap]);

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
      nBatch,
      nUbatch,
      flashAttn,
      useMmap,
      temperature,
      cacheTypeK,
      cacheTypeV
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

  const ALL_CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
  const contextPresets = useMemo(() => {
    return ALL_CONTEXT_PRESETS.filter(val => val <= maxContextSupported || val <= 8192);
  }, [maxContextSupported]);

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

                {/* SVG Capability Badges */}
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
                  <span className="text-xs font-medium text-zinc-400 block">Max Context</span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">
                    {maxContextSupported >= 1048576
                      ? `${(maxContextSupported / 1048576).toFixed(0)}M tokens`
                      : maxContextSupported >= 1024
                        ? `${maxContextSupported.toLocaleString()} tokens (${Math.round(maxContextSupported / 1024)}K)`
                        : `${maxContextSupported} tokens`}
                  </div>
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

            {/* Estimated Memory Usage Bar [Beta] (LM Studio style) */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-100">Estimated Memory Usage</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-semibold">
                    Beta
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400 mt-0.5 block">
                  Estimated VRAM and system memory required to run this model with selected settings.
                </span>
              </div>
              <div className="flex items-center gap-2.5 font-mono text-xs shrink-0 flex-wrap">
                <div
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold ${
                    parseFloat(estGpuGb) > availVramGb
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  <span>GPU: {estGpuGb} / {availVramGb.toFixed(1)} GB VRAM</span>
                  {parseFloat(estGpuGb) > availVramGb && (
                    <span className="text-[10px] font-semibold ml-1">⚠️ Exceeds VRAM</span>
                  )}
                </div>
                <div
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold ${
                    parseFloat(estTotalGb) > availRamGb
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  <span>Total: {estTotalGb} / {totalRamGb.toFixed(1)} GB RAM</span>
                </div>
              </div>
            </div>

            {/* 1. Context Length */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Context Length</label>
                  <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                    Maximum token window for prompt & code context
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2048}
                    max={maxContextSupported}
                    step={1024}
                    value={ctxSize}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setCtxSize(Math.max(2048, Math.min(maxContextSupported, val)));
                      }
                    }}
                    className="w-24 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right focus:outline-none focus:border-white/40"
                  />
                  <span className="text-xs text-zinc-400 font-mono">tokens</span>
                </div>
              </div>

              {/* Presets Row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {contextPresets.map((val) => (
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
                    {val >= 1048576 ? `${val / 1048576}M` : `${Math.round(val / 1024)}K`} ({val.toLocaleString()})
                  </button>
                ))}
              </div>

              {/* Slider */}
              <input
                type="range"
                min="2048"
                max={maxContextSupported}
                step="1024"
                value={ctxSize}
                onChange={(e) => setCtxSize(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
              <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                <span>2,048 (Minimal)</span>
                <span>{ctxSize.toLocaleString()} tokens active</span>
                <span>{maxContextSupported.toLocaleString()} (Max Ceiling)</span>
              </div>
            </div>

            {/* 2. GPU Offload Layers */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">GPU Offload Layers</label>
                  <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                    Layers pushed to VRAM ({nGPULayers >= totalModelLayers ? 'Full GPU Acceleration' : nGPULayers === 0 ? 'CPU Only' : 'Partial Offload'})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={totalModelLayers}
                    step={1}
                    value={nGPULayers}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setNGPULayers(Math.max(0, Math.min(totalModelLayers, val)));
                      }
                    }}
                    className="w-16 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right focus:outline-none focus:border-white/40"
                  />
                  <span className="text-xs text-zinc-400 font-mono">/ {totalModelLayers}</span>
                </div>
              </div>

              <input
                type="range"
                min="0"
                max={totalModelLayers}
                step="1"
                value={nGPULayers}
                onChange={(e) => setNGPULayers(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
              <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                <span>0 (CPU Only)</span>
                <span>{nGPULayers} of {totalModelLayers} layers</span>
                <span>{totalModelLayers} (Full GPU)</span>
              </div>
            </div>

            {/* 3. Evaluation & Physical Batch Sizes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Evaluation Batch Size */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                <label className="text-xs font-semibold text-zinc-100 block">Evaluation Batch Size (n_batch)</label>
                <span className="text-[11px] text-zinc-400 block">Prompt processing evaluation chunk size</span>
                <div className="flex items-center gap-1.5 pt-1">
                  {[512, 1024, 2048, 4096].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setNBatch(b)}
                      className={`flex-1 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                        nBatch === b
                          ? 'bg-white text-zinc-950 font-bold'
                          : 'bg-zinc-800 text-zinc-300 hover:text-white border border-white/10'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Physical Batch Size */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                <label className="text-xs font-semibold text-zinc-100 block">Physical Batch Size (n_ubatch)</label>
                <span className="text-[11px] text-zinc-400 block">Physical micro-batch size for GPU execution</span>
                <div className="flex items-center gap-1.5 pt-1">
                  {[128, 256, 512, 1024].map((ub) => (
                    <button
                      key={ub}
                      type="button"
                      onClick={() => setNUbatch(ub)}
                      className={`flex-1 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                        nUbatch === ub
                          ? 'bg-white text-zinc-950 font-bold'
                          : 'bg-zinc-800 text-zinc-300 hover:text-white border border-white/10'
                      }`}
                    >
                      {ub}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. CPU Thread Count */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">CPU Thread Pool Size</label>
                  <span className="text-xs text-zinc-400 mt-0.5 font-normal">Compute threads for CPU layers and matrix operations</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={16}
                    step={1}
                    value={nThreads}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) setNThreads(Math.max(1, Math.min(16, val)));
                    }}
                    className="w-16 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right focus:outline-none focus:border-white/40"
                  />
                  <span className="text-xs text-zinc-400 font-mono">threads</span>
                </div>
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

            {/* 5. Kernel Toggles: Flash Attention & Try mmap */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Flash Attention */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Flash Attention (FA2)</label>
                  <span className="text-[11px] text-zinc-400 mt-0.5 block">
                    Tiled on-chip attention (2-3x speedup, lower VRAM)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFlashAttn(!flashAttn)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
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

              {/* Try mmap() */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Memory Mapping (mmap)</label>
                  <span className="text-[11px] text-zinc-400 mt-0.5 block">
                    Zero-copy disk memory-mapping (fast startup)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseMmap(!useMmap)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
                    useMmap ? 'bg-white' : 'bg-zinc-800'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                      useMmap ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 6. KV Cache Quantization Type [Experimental] */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* K Cache Quantization Type [Experimental] */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-100 block">K Cache Quantization Type</label>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                    Experimental
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400 block">
                  Quantize Key tensor cache to compress memory footprint
                </span>
                <select
                  value={cacheTypeK}
                  onChange={(e) => setCacheTypeK(e.target.value as 'f16' | 'q8_0' | 'q4_0')}
                  className="w-full mt-1 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-white/40 cursor-pointer"
                >
                  <option value="f16">f16 (Default - FP16 Unquantized)</option>
                  <option value="q8_0">q8_0 (8-bit Quantized - ~50% VRAM Savings)</option>
                  <option value="q4_0">q4_0 (4-bit Quantized - ~75% VRAM Savings)</option>
                </select>
              </div>

              {/* V Cache Quantization Type [Experimental] */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-100 block">V Cache Quantization Type</label>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                    Experimental
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400 block">
                  Quantize Value tensor cache to compress memory footprint
                </span>
                <select
                  value={cacheTypeV}
                  onChange={(e) => setCacheTypeV(e.target.value as 'f16' | 'q8_0' | 'q4_0')}
                  className="w-full mt-1 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-white/40 cursor-pointer"
                >
                  <option value="f16">f16 (Default - FP16 Unquantized)</option>
                  <option value="q8_0">q8_0 (8-bit Quantized - ~50% VRAM Savings)</option>
                  <option value="q4_0">q4_0 (4-bit Quantized - ~75% VRAM Savings)</option>
                </select>
              </div>
            </div>

            {/* 7. Sampling Temperature */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-zinc-100 block">Sampling Temperature</label>
                  <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
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

            {/* 8. Commit Button */}
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
