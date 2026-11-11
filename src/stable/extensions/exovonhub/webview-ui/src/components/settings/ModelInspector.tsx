import React, { useState, useMemo, useEffect } from 'react';
import { extractModelMetadata, type ModelMetadata, type ModelModality, type ComponentRole } from './modelUtils';
import { ModelOrgAvatar } from './ModelOrgAvatar';
import { ModelCapabilityBadges } from './ModelCapabilityIcons';
import { MemoryPoolRings } from './MemoryPoolRings';
import { DiffusionFlashAttnControl, type DiffusionFlashAttnMode } from './DiffusionFlashAttnControl';

const parseDimensions = (res: string): [number, number] => {
  const parts = String(res || '').toLowerCase().split('x');
  const w = parseInt(parts[0] || '512', 10);
  const h = parseInt(parts[1] || '512', 10);
  return [Number.isFinite(w) && w > 0 ? w : 512, Number.isFinite(h) && h > 0 ? h : 512];
};

const getModelFileName = (m: any): string => {
  if (!m) return '';
  return String(m.name || m.id || m.path || '').split(/[\\/]/).pop() || String(m.id || '');
};

const resolveAutoCompanion = (
  targetMeta: ModelMetadata,
  candidates: any[],
  slot: 'vae' | 'encoder1' | 'encoder2'
): any | null => {
  if (!candidates || candidates.length === 0) return null;
  const targetText = `${targetMeta.basename} ${targetMeta.displayName} ${targetMeta.architecture} ${targetMeta.relativePath}`.toLowerCase();
  const isTargetVideo = targetMeta.isVideo || targetMeta.modality === 'video';
  const targetTokens = Array.from(new Set(
    targetText.split(/[^a-z0-9.]+/).filter((t) => t.length >= 2 && !['gguf', 'safetensors', 'sft', 'bin', 'model', 'bf16', 'fp16', 'fp8', 'q4', 'q8', 'com'].includes(t))
  ));

  let best: any | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const cName = getModelFileName(cand).toLowerCase();
    const cRel = String(cand.relative_path || cand.path || cand.id || '').toLowerCase();
    const cFull = `${cName} ${cRel} ${String(cand.architecture || '').toLowerCase()}`;
    let score = 1;

    for (const tok of targetTokens) {
      if (cFull.includes(tok)) score += 10;
    }

    if (slot === 'vae') {
      if (isTargetVideo && cFull.includes('wan') && targetText.includes('wan')) score += 25;
      if (targetText.includes('flux') && (cName === 'ae.safetensors' || cFull.includes('flux'))) score += 20;
      if (targetText.includes('qwen') && cFull.includes('qwen')) score += 20;
    } else if (slot === 'encoder1') {
      if (targetText.includes('wan') && cFull.includes('umt5')) score += 30;
      else if (targetText.includes('flux') && cFull.includes('clip')) score += 25;
      else if (targetText.includes('qwen') && cFull.includes('qwen')) score += 25;
      if (cFull.includes('t5') && !cFull.includes('umt5') && !targetText.includes('wan') && targetText.includes('flux')) {
        score -= 5; // prefer clip for slot 1 when t5 fits slot 2
      }
    } else if (slot === 'encoder2') {
      // Optional secondary encoder (e.g. T5 alongside CLIP); avoid duplicating CLIP-only picks
      if (cFull.includes('t5') && !cFull.includes('umt5') && !targetText.includes('qwen') && !targetText.includes('wan')) score += 25;
      else if (cFull.includes('umt5') && targetText.includes('wan')) score -= 10; // usually slot 1
      else if (cFull.includes('clip_g') && targetText.includes('sdxl')) score += 20;
      else if (targetText.includes('qwen')) score = -1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return bestScore > 0 ? best : null;
};

export interface ModelInspectorProps {
  model: any; // local model object: { id, name, size, modified, quant, params, architecture, path, etc. }
  availableLocalModels?: any[];
  vscodeApi: any;
  daemonHealth: any; // { active_model, active_ghost_model, active_diffusion_model, active_video_model, ctx_size, hardware }
  activeLocalModel: string | null;
  activeGhostModel: string | null;
  isModelLoading: boolean;
  modelLoadProgress?: { percent: number; message: string };
  onStartLoading?: (modelId: string) => void;
  onClose?: () => void;
}

export const ModelInspector: React.FC<ModelInspectorProps> = ({
  model,
  availableLocalModels,
  vscodeApi,
  daemonHealth,
  activeLocalModel,
  activeGhostModel,
  isModelLoading,
  modelLoadProgress,
  onStartLoading,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'tuning' | 'roles'>('overview');
  const [copiedPath, setCopiedPath] = useState(false);

  const meta: ModelMetadata = useMemo(() => {
    return extractModelMetadata(model?.id, model);
  }, [model]);

  const maxContextSupported = meta.maxContextLength;
  const totalModelLayers = meta.totalLayers;
  const maxCpuThreads = useMemo(() => {
    const hwThreads = Number(daemonHealth?.hardware?.cpu_threads || 0);
    const navThreads = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency || 0) : 0;
    return Math.max(1, hwThreads || navThreads || 4);
  }, [daemonHealth?.hardware?.cpu_threads]);

  // Manual folder / modality reclassification state
  const [targetModality, setTargetModality] = useState<ModelModality>(() => meta.modality);
  const [targetComponentRole, setTargetComponentRole] = useState<ComponentRole>(() => meta.componentRole || 'encoders');
  const [moveSubmitted, setMoveSubmitted] = useState(false);

  // Tuning Parameters State
  const [ctxSize, setCtxSize] = useState<number>(() => {
    if (daemonHealth?.ctx_size && (daemonHealth?.active_model === model?.id || activeLocalModel === model?.id)) {
      return daemonHealth.ctx_size;
    }
    return maxContextSupported ? Math.min(8192, maxContextSupported) : 8192;
  });
  const [nGPULayers, setNGPULayers] = useState<number>(() => totalModelLayers ?? 999);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [nThreads, setNThreads] = useState<number>(() => maxCpuThreads);
  const [nBatch, setNBatch] = useState<number>(2048);
  const [nUbatch, setNUbatch] = useState<number>(512);
  const [flashAttn, setFlashAttn] = useState<boolean>(true);
  const [useMmap, setUseMmap] = useState<boolean>(true);
  const [offloadContextToCpu, setOffloadContextToCpu] = useState<boolean>(false);
  const [cacheTypeK, setCacheTypeK] = useState<'f16' | 'q8_0' | 'q4_0'>('f16');
  const [cacheTypeV, setCacheTypeV] = useState<'f16' | 'q8_0' | 'q4_0'>('f16');

  // Diffusion, Video & Flow State (no model-specific hardcoded presets)
  const [diffSteps, setDiffSteps] = useState<number>(20);
  const [diffCfg, setDiffCfg] = useState<number>(3.5);
  const storageResKey = `astrolabe_diff_res_${meta.cleanId || meta.displayName}`;
  const [diffResolution, setDiffResolution] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(`astrolabe_diff_res_${meta.cleanId || meta.displayName}`);
      if (saved) return saved;
    } catch {}
    return meta.isVideo ? '480x272' : '768x768';
  });
  const [diffSampler, setDiffSampler] = useState<string>('FlowMatch Euler');
  const [diffVaeTiling, setDiffVaeTiling] = useState<boolean>(() => Boolean(meta.isVideo));
  const [diffOffloadRam, setDiffOffloadRam] = useState<boolean>(false);
  const [diffGpuLayers, setDiffGpuLayers] = useState<number>(() => totalModelLayers ?? 999);
  const storageFaKey = `astrolabe_diff_fa_${meta.cleanId || meta.displayName}`;
  const [diffFlashAttn, setDiffFlashAttn] = useState<DiffusionFlashAttnMode>(() => {
    try {
      const saved = localStorage.getItem(storageFaKey);
      if (saved === 'auto' || saved === 'on' || saved === 'off') return saved;
    } catch {}
    return 'auto';
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageFaKey);
      if (saved === 'auto' || saved === 'on' || saved === 'off') {
        setDiffFlashAttn(saved);
        return;
      }
    } catch {}
    setDiffFlashAttn('auto');
  }, [storageFaKey]);

  // Video Generation Tuning State
  const [videoFrames, setVideoFrames] = useState<number>(17);
  const [videoFps, setVideoFps] = useState<number>(16);
  const [videoFlowShift, setVideoFlowShift] = useState<number>(5.0);
  const [videoTemporalTiling, setVideoTemporalTiling] = useState<boolean>(true);

  // Available LoRA Adapters
  const availableLoras = useMemo(() => {
    if (!availableLocalModels || !Array.isArray(availableLocalModels)) return [];
    return availableLocalModels.filter(m => {
      if (m.id === model?.id) return false;
      const mMeta = extractModelMetadata(m.id, m);
      return mMeta.componentRole === 'loras';
    });
  }, [availableLocalModels, model?.id]);

  const [selectedLora, setSelectedLora] = useState<string>('none');
  const [loraScale, setLoraScale] = useState<number>(1.0);

  // Companion VAEs & Encoders (driven by backend component_role / relative_path with safe filename fallback)
  const availableVaes = useMemo(() => {
    if (!availableLocalModels || !Array.isArray(availableLocalModels)) return [];
    return availableLocalModels.filter(m => {
      if (m.id === model?.id) return false;
      const mMeta = extractModelMetadata(m.id, m);
      return mMeta.componentRole === 'vae';
    });
  }, [availableLocalModels, model?.id]);

  const availableEncoders = useMemo(() => {
    if (!availableLocalModels || !Array.isArray(availableLocalModels)) return [];
    return availableLocalModels.filter(m => {
      if (m.id === model?.id) return false;
      const mMeta = extractModelMetadata(m.id, m);
      return mMeta.componentRole === 'encoders';
    });
  }, [availableLocalModels, model?.id]);

  const [selectedVae, setSelectedVae] = useState<string>('auto');
  const [selectedClip, setSelectedClip] = useState<string>('auto');
  const [selectedT5, setSelectedT5] = useState<string>('auto');

  const autoResolvedVae = useMemo(() => resolveAutoCompanion(meta, availableVaes, 'vae'), [meta, availableVaes]);
  const autoResolvedEnc1 = useMemo(() => resolveAutoCompanion(meta, availableEncoders, 'encoder1'), [meta, availableEncoders]);
  const autoResolvedEnc2 = useMemo(() => {
    const remaining = autoResolvedEnc1
      ? availableEncoders.filter(c => (c.id || c.path) !== (autoResolvedEnc1.id || autoResolvedEnc1.path))
      : availableEncoders;
    return resolveAutoCompanion(meta, remaining, 'encoder2');
  }, [meta, availableEncoders, autoResolvedEnc1]);

  const [selectedLoraModel, resolvedVaeModel, resolvedEnc1Model, resolvedEnc2Model] = useMemo(() => {
    const findByKey = (list: any[], sel: string) =>
      list.find(c => c.id === sel || c.path === sel) || null;

    const loraObj = selectedLora !== 'none' ? findByKey(availableLoras, selectedLora) : null;
    const vaeObj = selectedVae === 'none' ? null : selectedVae === 'auto' ? autoResolvedVae : findByKey(availableVaes, selectedVae);
    const enc1Obj = selectedClip === 'none' ? null : selectedClip === 'auto' ? autoResolvedEnc1 : findByKey(availableEncoders, selectedClip);
    const enc2Obj = selectedT5 === 'none' ? null : selectedT5 === 'auto' ? autoResolvedEnc2 : findByKey(availableEncoders, selectedT5);

    return [loraObj, vaeObj, enc1Obj, enc2Obj];
  }, [
    selectedLora, selectedVae, selectedClip, selectedT5,
    availableLoras, availableVaes, availableEncoders,
    autoResolvedVae, autoResolvedEnc1, autoResolvedEnc2
  ]);

  // Autoregressive Visual State
  const [arGridResolution, setArGridResolution] = useState<string>('384x384');
  const [arVisualTemp, setArVisualTemp] = useState<number>(0.8);
  const [arVisualTopP, setArVisualTopP] = useState<number>(0.95);
  const [arLogitCfg, setArLogitCfg] = useState<number>(5.0);
  const [arTokenContext, setArTokenContext] = useState<number>(2048);

  // Real Hardware Pool Capacities (zero hardcoded fallback VRAM/RAM numbers)
  const hw = daemonHealth?.hardware;
  const hasHardwareInfo = Boolean(hw && (typeof hw.memory_gb === 'number' || typeof hw.vram_total_mb === 'number'));
  const isUnifiedMemory = Boolean(hw?.unified_memory);

  const gpuTotalGb = typeof hw?.vram_total_mb === 'number' && hw.vram_total_mb > 0
    ? hw.vram_total_mb / 1024
    : 0;
  const gpuFreeGb = gpuTotalGb > 0
    ? (typeof hw?.vram_free_mb === 'number'
        ? Math.max(0, hw.vram_free_mb / 1024)
        : typeof hw?.vram_used_mb === 'number'
          ? Math.max(0, gpuTotalGb - hw.vram_used_mb / 1024)
          : undefined)
    : undefined;

  const cpuTotalGb = typeof hw?.memory_gb === 'number' && hw.memory_gb > 0
    ? hw.memory_gb
    : 0;
  const cpuAvailGb = cpuTotalGb > 0
    ? (typeof hw?.available_memory_gb === 'number'
        ? Math.max(0, hw.available_memory_gb)
        : typeof hw?.used_memory_gb === 'number'
          ? Math.max(0, cpuTotalGb - hw.used_memory_gb)
          : undefined)
    : undefined;

  // Live independent GPU & CPU pool calculations for Diffusion / Video Models
  const { diffGpuGb, diffCpuGb, diffGpuDetail, diffCpuDetail } = useMemo(() => {
    const coreGb = (model?.size_bytes || meta.sizeBytes || 0) / (1024 * 1024 * 1024);
    const vaeGb = resolvedVaeModel?.size_bytes ? resolvedVaeModel.size_bytes / (1024 * 1024 * 1024) : 0;
    const enc1Gb = resolvedEnc1Model?.size_bytes ? resolvedEnc1Model.size_bytes / (1024 * 1024 * 1024) : 0;
    const enc2Gb = resolvedEnc2Model?.size_bytes ? resolvedEnc2Model.size_bytes / (1024 * 1024 * 1024) : 0;
    const encodersGb = enc1Gb + enc2Gb;
    const loraGb = selectedLoraModel?.size_bytes ? selectedLoraModel.size_bytes / (1024 * 1024 * 1024) : 0;

    const [w, h] = parseDimensions(diffResolution);
    const pixels = w * h;
    const activationGb = meta.isVideo
      ? (pixels / 400000) * Math.max(1, videoFrames / 16) * 0.45 * (diffVaeTiling || videoTemporalTiling ? 0.5 : 1.0) + 0.30
      : (pixels / 1048576) * (diffVaeTiling ? 0.35 : 0.75) + 0.20;

    const gpuRatio = totalModelLayers
      ? Math.min(1, Math.max(0, diffGpuLayers / totalModelLayers))
      : (diffGpuLayers > 0 ? 1 : 0);

    const gpuCore = coreGb * gpuRatio;
    const cpuCore = coreGb * (1 - gpuRatio);

    const gpuEnc = diffOffloadRam ? 0 : encodersGb * gpuRatio;
    const cpuEnc = diffOffloadRam ? encodersGb : encodersGb * (1 - gpuRatio);

    const gpuComp = (vaeGb + loraGb) * (gpuRatio > 0 ? 1 : 0);
    const cpuComp = (vaeGb + loraGb) * (gpuRatio > 0 ? 0 : 1);

    const gpuAct = gpuRatio > 0 ? activationGb : 0;
    const cpuAct = gpuRatio > 0 ? 0.25 : activationGb + 0.25;

    const gpuDriver = gpuRatio > 0 ? 0.25 : 0;

    const estGpu = gpuCore + gpuEnc + gpuComp + gpuAct + gpuDriver;
    const estCpu = cpuCore + cpuEnc + cpuComp + cpuAct;

    return {
      diffGpuGb: estGpu,
      diffCpuGb: estCpu,
      diffGpuDetail: `Weights ${gpuCore.toFixed(1)}G • Enc ${gpuEnc.toFixed(1)}G • Latent/VAE ${(gpuComp + gpuAct).toFixed(1)}G`,
      diffCpuDetail: diffOffloadRam
        ? `Offloaded encoders ${cpuEnc.toFixed(1)}G • Host ${(estCpu - cpuEnc).toFixed(1)}G`
        : `Host weights/staging ${estCpu.toFixed(1)}G`
    };
  }, [
    model?.size_bytes, meta.sizeBytes, meta.isVideo,
    resolvedVaeModel, resolvedEnc1Model, resolvedEnc2Model, selectedLoraModel,
    diffResolution, videoFrames, diffVaeTiling, videoTemporalTiling,
    totalModelLayers, diffGpuLayers, diffOffloadRam
  ]);

  // Live independent GPU & CPU pool calculations for Autoregressive Visual Models
  const { arGpuGb, arCpuGb } = useMemo(() => {
    const sizeGb = (model?.size_bytes || meta.sizeBytes || 0) / (1024 * 1024 * 1024);
    const gpuRatio = totalModelLayers
      ? Math.min(1, Math.max(0, nGPULayers / totalModelLayers))
      : (nGPULayers > 0 ? 1 : 0);

    const gpuWeights = sizeGb * gpuRatio;
    const cpuWeights = sizeGb * (1 - gpuRatio);
    const kvGb = (arTokenContext / 1024) * 0.12 * (flashAttn ? 0.85 : 1.0);
    const tokenizerBuffer = 0.50;

    const gpuKv = !offloadContextToCpu && gpuRatio > 0 ? kvGb * gpuRatio : 0;
    const cpuKv = kvGb - gpuKv;

    const estGpu = gpuRatio > 0 ? gpuWeights + gpuKv + tokenizerBuffer + 0.25 : 0;
    const estCpu = cpuWeights + cpuKv + (useMmap ? 0.20 : 0.40) + (gpuRatio === 0 ? tokenizerBuffer : 0);

    return { arGpuGb: estGpu, arCpuGb: estCpu };
  }, [model?.size_bytes, meta.sizeBytes, totalModelLayers, nGPULayers, arTokenContext, flashAttn, offloadContextToCpu, useMmap]);

  // Live independent GPU & CPU pool calculations for Text LLM Models
  const { llmGpuGb, llmCpuGb, llmGpuDetail, llmCpuDetail } = useMemo(() => {
    const sizeGb = (model?.size_bytes || meta.sizeBytes || 0) / (1024 * 1024 * 1024);
    const gpuRatio = totalModelLayers
      ? Math.min(1, Math.max(0, nGPULayers / totalModelLayers))
      : (nGPULayers > 0 ? 1 : 0);

    const gpuWeights = sizeGb * gpuRatio;
    const cpuWeights = sizeGb * (1 - gpuRatio);

    const kMult = cacheTypeK === 'q4_0' ? 0.25 : cacheTypeK === 'q8_0' ? 0.50 : 1.0;
    const vMult = cacheTypeV === 'q4_0' ? 0.25 : cacheTypeV === 'q8_0' ? 0.50 : 1.0;
    const avgKvMult = (kMult + vMult) / 2;

    const isDeepSeekMla = /deepseek/i.test(meta.architecture || '') || /deepseek/i.test(meta.displayName || '');
    const mlaMultiplier = isDeepSeekMla ? 0.18 : 1.0;
    const kvLayerNorm = (totalModelLayers || 32) / 32;

    const workingKvGb = (ctxSize / 1024) * kvLayerNorm * 0.125 * avgKvMult * mlaMultiplier * (flashAttn ? 0.85 : 1.0);
    const gpuKv = !offloadContextToCpu && gpuRatio > 0 ? workingKvGb * gpuRatio : 0;
    const cpuKv = workingKvGb - gpuKv;

    const computeBufferGb = flashAttn
      ? 0.25 + (nBatch / 2048) * 0.15
      : 0.45 + (ctxSize / 8192) * 0.55 + (nBatch / 2048) * 0.25;
    const gpuCompute = gpuRatio > 0 ? computeBufferGb : 0;
    const cpuCompute = gpuRatio > 0 ? 0 : computeBufferGb;

    const gpuDriverOverhead = gpuRatio > 0 ? 0.25 : 0;
    const hostStaging = useMmap ? 0.15 : 0.25 + sizeGb * 0.25;

    const estGpu = gpuWeights + gpuKv + gpuCompute + gpuDriverOverhead;
    const estCpu = cpuWeights + cpuKv + cpuCompute + hostStaging;

    return {
      llmGpuGb: estGpu,
      llmCpuGb: estCpu,
      llmGpuDetail: `Weights ${gpuWeights.toFixed(1)}G • KV ${gpuKv.toFixed(1)}G • Compute ${(gpuCompute + gpuDriverOverhead).toFixed(1)}G`,
      llmCpuDetail: `Weights ${cpuWeights.toFixed(1)}G • KV ${cpuKv.toFixed(1)}G • Host ${(cpuCompute + hostStaging).toFixed(1)}G`
    };
  }, [
    model?.size_bytes, meta.sizeBytes, meta.architecture, meta.displayName,
    totalModelLayers, nGPULayers, ctxSize, flashAttn, nBatch,
    cacheTypeK, cacheTypeV, useMmap, offloadContextToCpu
  ]);

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
    return daemonHealth?.active_diffusion_model === model.id || daemonHealth?.active_video_model === model.id;
  }, [daemonHealth?.active_diffusion_model, daemonHealth?.active_video_model, model?.id]);

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

  const handleMoveModality = () => {
    if (!model?.id) return;
    setMoveSubmitted(true);
    vscodeApi?.postMessage({
      command: 'moveLocalModel',
      modelId: model.id,
      targetModality,
      componentRole: targetModality === 'component' ? targetComponentRole : undefined
    });
    setTimeout(() => setMoveSubmitted(false), 2000);
  };

  const handleUnload = () => {
    vscodeApi?.postMessage({
      command: 'unloadLocalModel'
    });
  };

  const handleLoadWithTuning = () => {
    onStartLoading?.(model.id);
    try {
      localStorage.setItem(storageResKey, diffResolution);
      localStorage.setItem(storageFaKey, diffFlashAttn);
    } catch {}
    if (meta.isMusic || meta.modality === 'music') {
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: model.id,
        target: 'music',
        modality: 'music',
        nGPULayers: diffGpuLayers
      });
    } else if (meta.modelFamily === 'diffusion_flow') {
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: model.id,
        target: meta.isVideo ? 'video' : 'diffusion',
        modality: meta.isVideo ? 'video' : 'image',
        modelFamily: 'diffusion_flow',
        steps: diffSteps,
        cfgScale: diffCfg,
        resolution: diffResolution,
        sampler: diffSampler,
        vaeTiling: diffVaeTiling,
        offloadContextToCpu: diffOffloadRam,
        offloadToCpu: diffOffloadRam,
        diffusionFlashAttn: diffFlashAttn,
        nGPULayers: diffGpuLayers,
        vaePath: selectedVae !== 'auto' ? selectedVae : undefined,
        clipPath: selectedClip !== 'auto' ? selectedClip : undefined,
        t5Path: selectedT5 !== 'auto' ? selectedT5 : undefined,
        loraPath: selectedLora !== 'none' ? selectedLora : undefined,
        loraScale: selectedLora !== 'none' ? loraScale : undefined,
        ...(meta.isVideo
          ? {
              videoFrames,
              videoFps,
              flowShift: videoFlowShift,
              temporalTiling: videoTemporalTiling
            }
          : {})
      });
    } else if (meta.modelFamily === 'autoregressive_image') {
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: model.id,
        modelFamily: 'autoregressive_image',
        resolution: arGridResolution,
        temperature: arVisualTemp,
        cfgScale: arLogitCfg,
        ctxSize: arTokenContext,
        nGPULayers,
        flashAttn,
        useMmap,
      });
    } else if (meta.modelFamily === 'pipeline_component') {
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: model.id,
        modelFamily: 'pipeline_component',
      });
    } else {
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: model.id,
        modelFamily: 'text_llm',
        ctxSize,
        nGPULayers,
        nThreads,
        nBatch,
        nUbatch,
        flashAttn,
        useMmap,
        offloadContextToCpu,
        temperature,
        cacheTypeK,
        cacheTypeV
      });
    }
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
    const cap = maxContextSupported || 131072;
    return ALL_CONTEXT_PRESETS.filter(val => val <= cap || val <= 8192);
  }, [maxContextSupported]);
  const sliderMaxContext = maxContextSupported || 131072;

  const renderPrimaryActionButton = (idleLabel: string) => {
    const pct = Math.min(100, Math.max(0, Math.round(modelLoadProgress?.percent ?? 0)));
    const stageText = modelLoadProgress?.message || 'Loading into memory...';

    if (isModelLoading) {
      return (
        <div
          className="relative w-full h-10 rounded-xl bg-zinc-900 border border-sky-500/30 overflow-hidden flex items-center justify-between px-4 select-none shadow-md"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500/25 via-emerald-400/25 to-emerald-400/35 transition-all duration-200 ease-out"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
          <span className="relative z-10 text-xs font-medium text-zinc-100 truncate pr-3">
            {stageText}
          </span>
          <span className="relative z-10 text-xs font-mono font-bold text-sky-300 tabular-nums shrink-0">
            {pct}%
          </span>
        </div>
      );
    }

    if (isLoadedInMemory) {
      return (
        <button
          type="button"
          onClick={handleUnload}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 transition-colors shadow-md cursor-pointer flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19h14M12 5l-7 7h14l-7-7z" />
          </svg>
          <span>Unload from Memory</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={handleLoadWithTuning}
        className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 bg-white hover:bg-zinc-200 transition-colors shadow-md cursor-pointer flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>{idleLabel}</span>
      </button>
    );
  };

  const renderGpuOffloadControl = (
    layersValue: number,
    setLayersValue: (val: number) => void,
    description: string
  ) => {
    if (typeof totalModelLayers === 'number' && totalModelLayers > 0) {
      const clampedVal = Math.min(totalModelLayers, Math.max(0, layersValue));
      return (
        <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-semibold text-zinc-100 block">GPU Offload Layers</label>
              <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                {description} ({clampedVal >= totalModelLayers ? 'Full GPU' : clampedVal === 0 ? 'CPU Only' : 'Partial Offload'})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={totalModelLayers}
                step={1}
                value={clampedVal}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setLayersValue(Math.max(0, Math.min(totalModelLayers, val)));
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
            value={clampedVal}
            onChange={(e) => setLayersValue(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
            <span>0 (CPU Only)</span>
            <span>{clampedVal} of {totalModelLayers} layers</span>
            <span>{totalModelLayers} (Full GPU)</span>
          </div>
        </div>
      );
    }

    const gpuEnabled = layersValue > 0;
    return (
      <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <label className="text-xs font-semibold text-zinc-100 block">GPU Acceleration Offload</label>
          <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
            {description} ({gpuEnabled ? 'Full GPU Offload' : 'CPU Execution Only'})
          </span>
        </div>
        <button
          type="button"
          onClick={() => setLayersValue(gpuEnabled ? 0 : 999)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
            gpuEnabled ? 'bg-white' : 'bg-zinc-800'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
              gpuEnabled ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
            }`}
          />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl">
      {/* 1. Header Section */}
      <div className="p-4 border-b border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent">
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
                    isImageGen: meta.isDiffusion && !meta.isVideo,
                    isVideo: meta.isVideo,
                    isMusic: meta.isMusic,
                    isComponent: meta.isComponent,
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
                    {meta.isVideo ? 'Video Worker' : 'Diffusion Worker'}
                  </span>
                )}
              </div>

              {/* Path on disk & Reveal button */}
              <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-300 flex-wrap">
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
                  <span className="text-xs font-medium text-zinc-400 block">
                    {meta.isDiffusion || meta.isVideo || meta.isMusic || meta.isComponent ? 'Modality' : 'Max Context'}
                  </span>
                  <div className="text-xs font-semibold text-zinc-100 font-mono mt-1">
                    {meta.isDiffusion || meta.isVideo || meta.isMusic || meta.isComponent
                      ? `${meta.modality.toUpperCase()}${meta.componentRole ? ` (${meta.componentRole})` : ''}`
                      : typeof maxContextSupported === 'number' && maxContextSupported > 0
                        ? maxContextSupported >= 1048576
                          ? `${(maxContextSupported / 1048576).toFixed(0)}M tokens`
                          : maxContextSupported >= 1024
                            ? `${Math.round(maxContextSupported / 1024)}K tokens`
                            : `${maxContextSupported} tokens`
                        : '--'}
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

            {/* Manual Modality & Folder Classification Card */}
            <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Folder & Modality Classification</span>
                  <span className="text-[11px] text-zinc-400">
                    Move file into the matching library folder ({meta.relativePath || meta.modality})
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={targetModality}
                  onChange={(e) => setTargetModality(e.target.value as ModelModality)}
                  className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/25 cursor-pointer"
                >
                  <option value="llm">llm / Chat</option>
                  <option value="image">image / Diffusion</option>
                  <option value="video">video / Generation</option>
                  <option value="music">music / Audio</option>
                  <option value="component">components / Auxiliary</option>
                </select>
                {targetModality === 'component' && (
                  <select
                    value={targetComponentRole}
                    onChange={(e) => setTargetComponentRole(e.target.value as ComponentRole)}
                    className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-white/25 cursor-pointer"
                  >
                    <option value="vae">vae</option>
                    <option value="encoders">encoders</option>
                    <option value="mmproj">mmproj</option>
                    <option value="loras">loras</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleMoveModality}
                  disabled={
                    targetModality === meta.modality &&
                    (targetModality !== 'component' || targetComponentRole === meta.componentRole)
                  }
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {moveSubmitted ? 'Moving...' : 'Move to Folder'}
                </button>
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
                {meta.isDiffusion && !meta.isVideo && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    Diffusion / Image Synthesis
                  </span>
                )}
                {meta.isVideo && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    Video Synthesis
                  </span>
                )}
                {meta.isMusic && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-sky-500/10 text-sky-300 border border-sky-500/20">
                    Music & Audio Synthesis
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
                {gpuFreeGb !== undefined && (
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span className="text-zinc-400">Available Free VRAM:</span>
                    <span className="font-mono text-zinc-100 font-semibold">
                      {gpuFreeGb.toFixed(1)} GB
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: INFERENCE & VRAM TUNING ================= */}
        {activeTab === 'tuning' && (
          meta.isMusic || meta.modality === 'music' ? (
            /* ---------------- MUSIC & AUDIO SYNTHESIS TUNING ---------------- */
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">Music & Audio Inference Tuning</h3>
                <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Configure GPU acceleration and memory allocation for audio synthesis.
                </p>
              </div>

              <MemoryPoolRings
                gpuProjectedGb={diffGpuGb}
                gpuTotalGb={gpuTotalGb}
                gpuFreeGb={gpuFreeGb}
                cpuProjectedGb={diffCpuGb}
                cpuTotalGb={cpuTotalGb}
                cpuAvailableGb={cpuAvailGb}
                hasHardwareInfo={hasHardwareInfo}
                isUnifiedMemory={isUnifiedMemory}
                gpuDetail={diffGpuDetail}
                cpuDetail={diffCpuDetail}
              />

              {renderGpuOffloadControl(
                diffGpuLayers,
                setDiffGpuLayers,
                'Audio synthesis backbone layers executed on GPU'
              )}

              <div className="pt-2">
                {renderPrimaryActionButton('Load Model with Settings')}
              </div>
            </div>
          ) : meta.modelFamily === 'diffusion_flow' ? (
            /* ---------------- DIFFUSION & VIDEO FLOW INFERENCE TUNING ---------------- */
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">
                  {meta.isVideo ? 'Video Flow Inference Tuning' : 'Diffusion & Flow Inference Tuning'}
                </h3>
                <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Configure sampling dynamics, resolution, companion modules, and GPU/CPU memory pools.
                </p>
              </div>

              <MemoryPoolRings
                gpuProjectedGb={diffGpuGb}
                gpuTotalGb={gpuTotalGb}
                gpuFreeGb={gpuFreeGb}
                cpuProjectedGb={diffCpuGb}
                cpuTotalGb={cpuTotalGb}
                cpuAvailableGb={cpuAvailGb}
                hasHardwareInfo={hasHardwareInfo}
                isUnifiedMemory={isUnifiedMemory}
                gpuDetail={diffGpuDetail}
                cpuDetail={diffCpuDetail}
              />

              {/* Section 1: Sampling & Generation Dynamics */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Sampling & Generation Dynamics
                </div>

                {/* 1.1 Denoising Steps */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Denoising Steps</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Number of integration steps across the latent flow trajectory
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right tabular-nums">
                        {diffSteps}
                      </span>
                    </div>
                  </div>

                  {/* Clean Numeric Presets Row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[4, 8, 20, 30, 50].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDiffSteps(val)}
                        className={`px-3 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                          diffSteps === val
                            ? 'bg-white text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5 font-medium'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={diffSteps}
                    onChange={(e) => setDiffSteps(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* 1.2 Guidance Scale (CFG) */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Guidance Scale (CFG)</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Conditioning prompt adherence scale
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right tabular-nums">
                        {diffCfg.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  {/* Clean Numeric Presets Row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[1.0, 3.5, 5.0, 7.0, 9.0].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDiffCfg(val)}
                        className={`px-3 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                          Math.abs(diffCfg - val) < 0.05
                            ? 'bg-white text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5 font-medium'
                        }`}
                      >
                        {val.toFixed(1)}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min="1.0"
                    max="15.0"
                    step="0.1"
                    value={diffCfg}
                    onChange={(e) => setDiffCfg(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* 1.3 Sampler / Scheduler */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-100 block">Sampler / ODE Solver</label>
                    <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                      Numerical integrator for flow trajectory denoise steps
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { id: 'FlowMatch Euler', desc: 'Rectified flow Euler solver' },
                      { id: 'Euler', desc: 'Deterministic first-order solver' },
                      { id: 'Euler A', desc: 'Stochastic ancestral solver' },
                      { id: 'DPM++ 2M Karras', desc: 'Multi-step predictor-corrector solver' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setDiffSampler(s.id)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer ${
                          diffSampler === s.id
                            ? 'bg-white text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                        }`}
                      >
                        <div className="font-semibold">{s.id}</div>
                        <div className={`text-[10px] ${diffSampler === s.id ? 'text-zinc-700' : 'text-zinc-400'}`}>
                          {s.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 2: Canvas & Resolution Presets */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  {meta.isVideo ? 'Frame Resolution' : 'Canvas & Resolution'}
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-100 block">Resolution Presets</label>
                    <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                      Target pixel dimensions for latent synthesis
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(meta.isVideo
                      ? [
                          { res: '480x272', label: '480×272', ratio: '16:9 Draft' },
                          { res: '832x480', label: '832×480', ratio: '16:9 Wide' },
                          { res: '480x832', label: '480×832', ratio: '9:16 Portrait' },
                          { res: '1280x720', label: '1280×720', ratio: '16:9 HD' },
                        ]
                      : [
                          { res: '512x512', label: '512×512', ratio: '1:1 Square' },
                          { res: '768x768', label: '768×768', ratio: '1:1 Balanced' },
                          { res: '1024x1024', label: '1024×1024', ratio: '1:1 HD' },
                          { res: '1280x720', label: '1280×720', ratio: '16:9 Wide' },
                        ]
                    ).map(({ res, label, ratio }) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() => {
                          setDiffResolution(res);
                          try {
                            localStorage.setItem(storageResKey, res);
                          } catch {}
                        }}
                        className={`p-3 rounded-lg text-left transition-colors cursor-pointer ${
                          diffResolution === res
                            ? 'bg-white text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold">{label}</div>
                        <div className={`text-[10px] mt-0.5 ${diffResolution === res ? 'text-zinc-800' : 'text-zinc-400'}`}>
                          {ratio}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 2b: Video Generation Tuning */}
              {meta.isVideo && (
                <div className="space-y-4">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Video Generation Tuning
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Video Frames */}
                    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-semibold text-zinc-100 block">Video Frames</label>
                          <span className="text-[11px] text-zinc-400 mt-0.5 block">Total frames synthesized per clip</span>
                        </div>
                        <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white tabular-nums">
                          {videoFrames}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[17, 33, 49, 81, 121].map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setVideoFrames(f)}
                            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                              videoFrames === f
                                ? 'bg-white text-zinc-950 font-bold'
                                : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <input
                        type="range"
                        min="9"
                        max="121"
                        step="4"
                        value={videoFrames}
                        onChange={(e) => setVideoFrames(parseInt(e.target.value, 10))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>

                    {/* FPS */}
                    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-semibold text-zinc-100 block">FPS</label>
                          <span className="text-[11px] text-zinc-400 mt-0.5 block">Playback frame rate</span>
                        </div>
                        <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white tabular-nums">
                          {videoFps} fps
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[16, 24, 30].map((fps) => (
                          <button
                            key={fps}
                            type="button"
                            onClick={() => setVideoFps(fps)}
                            className={`px-3 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                              videoFps === fps
                                ? 'bg-white text-zinc-950 font-bold'
                                : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                            }`}
                          >
                            {fps}
                          </button>
                        ))}
                      </div>
                      <input
                        type="range"
                        min="8"
                        max="30"
                        step="1"
                        value={videoFps}
                        onChange={(e) => setVideoFps(parseInt(e.target.value, 10))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>

                    {/* Flow Shift */}
                    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-semibold text-zinc-100 block">Flow Shift</label>
                          <span className="text-[11px] text-zinc-400 mt-0.5 block">Noise schedule shift factor</span>
                        </div>
                        <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white tabular-nums">
                          {videoFlowShift.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="12.0"
                        step="0.5"
                        value={videoFlowShift}
                        onChange={(e) => setVideoFlowShift(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>

                    {/* Temporal Tiling */}
                    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <label className="text-xs font-semibold text-zinc-100 block">Temporal Tiling</label>
                        <span className="text-[11px] text-zinc-400 mt-0.5 block max-w-[240px]">
                          Chunks 3D VAE decoding across temporal windows to lower peak memory
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVideoTemporalTiling(!videoTemporalTiling)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
                          videoTemporalTiling ? 'bg-white' : 'bg-zinc-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                            videoTemporalTiling ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 3: VRAM Optimization & Latent Acceleration */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Memory & Offload Controls
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* VAE Tiling */}
                  <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">VAE Tiling</label>
                      <span className="text-[11px] text-zinc-400 mt-0.5 block max-w-[240px]">
                        Decodes latents in overlapping tiles to prevent high-res VRAM spikes
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDiffVaeTiling(!diffVaeTiling)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
                        diffVaeTiling ? 'bg-white' : 'bg-zinc-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                          diffVaeTiling ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Offload Text Encoders to System RAM */}
                  <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Offload Encoders to RAM</label>
                      <span className="text-[11px] text-zinc-400 mt-0.5 block max-w-[240px]">
                        Keeps text conditioning encoders in host RAM, freeing GPU pool for DiT weights
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDiffOffloadRam(!diffOffloadRam)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
                        diffOffloadRam ? 'bg-amber-400' : 'bg-zinc-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                          diffOffloadRam ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <DiffusionFlashAttnControl
                  value={diffFlashAttn}
                  onChange={(mode) => {
                    setDiffFlashAttn(mode);
                    try {
                      localStorage.setItem(storageFaKey, mode);
                    } catch {}
                  }}
                />

                {renderGpuOffloadControl(
                  diffGpuLayers,
                  setDiffGpuLayers,
                  'Diffusion transformer weights allocated to GPU VRAM'
                )}
              </div>

              {/* Section 4: Companion Encoders & VAE Decoder */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Companion Encoders & VAE Decoder
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-4 shadow-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* VAE Latent Decoder Selector */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-200 block flex items-center justify-between">
                        <span>VAE Decoder</span>
                        <span className="text-[10px] text-zinc-500 font-mono">--vae</span>
                      </label>
                      <select
                        value={selectedVae}
                        onChange={(e) => setSelectedVae(e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2.5 text-xs text-zinc-100 font-sans focus:outline-none focus:border-white/20 transition-colors cursor-pointer"
                      >
                        <option value="auto">
                          Auto ({autoResolvedVae ? getModelFileName(autoResolvedVae) : 'None detected'})
                        </option>
                        {availableVaes.map((vae) => {
                          const name = getModelFileName(vae);
                          return (
                            <option key={vae.id || vae.path} value={vae.path || vae.id}>
                              {name} {vae.size_display ? `(${vae.size_display})` : ''}
                            </option>
                          );
                        })}
                        <option value="none">None / Embedded in Model</option>
                      </select>
                    </div>

                    {/* Text Encoder 1 */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-200 block flex items-center justify-between">
                        <span>Text Encoder 1</span>
                        <span className="text-[10px] text-zinc-500 font-mono">primary</span>
                      </label>
                      <select
                        value={selectedClip}
                        onChange={(e) => setSelectedClip(e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2.5 text-xs text-zinc-100 font-sans focus:outline-none focus:border-white/20 transition-colors cursor-pointer"
                      >
                        <option value="auto">
                          Auto ({autoResolvedEnc1 ? getModelFileName(autoResolvedEnc1) : 'None detected'})
                        </option>
                        {availableEncoders.map((enc) => {
                          const name = getModelFileName(enc);
                          return (
                            <option key={enc.id || enc.path} value={enc.path || enc.id}>
                              {name} {enc.size_display ? `(${enc.size_display})` : ''}
                            </option>
                          );
                        })}
                        <option value="none">None</option>
                      </select>
                    </div>

                    {/* Text Encoder 2 (Optional) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-200 block flex items-center justify-between">
                        <span>Text Encoder 2</span>
                        <span className="text-[10px] text-zinc-500 font-mono">optional</span>
                      </label>
                      <select
                        value={selectedT5}
                        onChange={(e) => setSelectedT5(e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2.5 text-xs text-zinc-100 font-sans focus:outline-none focus:border-white/20 transition-colors cursor-pointer"
                      >
                        <option value="auto">
                          Auto ({autoResolvedEnc2 ? getModelFileName(autoResolvedEnc2) : 'None detected'})
                        </option>
                        {availableEncoders.map((enc) => {
                          const name = getModelFileName(enc);
                          return (
                            <option key={enc.id || enc.path} value={enc.path || enc.id}>
                              {name} {enc.size_display ? `(${enc.size_display})` : ''}
                            </option>
                          );
                        })}
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 5: LoRA Adapter */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    LoRA Adapter
                  </div>
                  {availableLoras.length > 0 && (
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {availableLoras.length} adapter{availableLoras.length > 1 ? 's' : ''} detected
                    </span>
                  )}
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-4 shadow-sm">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-200 block">
                      Active LoRA Fine-Tune
                    </label>
                    <select
                      value={selectedLora}
                      onChange={(e) => setSelectedLora(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2.5 text-xs text-zinc-100 font-sans focus:outline-none focus:border-white/20 transition-colors cursor-pointer"
                    >
                      <option value="none">None (Pure Base Model)</option>
                      {availableLoras.map((lora) => {
                        const loraName = getModelFileName(lora);
                        return (
                          <option key={lora.id} value={lora.id}>
                            {loraName} {lora.size_display ? `(${lora.size_display})` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-[11px] text-zinc-400">
                      {availableLoras.length === 0
                        ? 'Place .safetensors LoRA adapters inside components/loras/ to attach them here.'
                        : 'Applies low-rank adapter weights onto the backbone at inference time.'}
                    </p>
                  </div>

                  {selectedLora !== 'none' && (
                    <div className="space-y-1.5 pt-1 border-t border-white/5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-zinc-200">LoRA Weight Multiplier</span>
                        <span className="font-mono text-zinc-100 bg-zinc-800/80 px-2 py-0.5 rounded text-[11px] font-semibold border border-white/10">
                          {loraScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.5"
                        step="0.05"
                        value={loraScale}
                        onChange={(e) => setLoraScale(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Commit / Morphing Progress / Unload Action Button */}
              <div className="pt-2">
                {renderPrimaryActionButton('Load Model with Settings')}
              </div>
            </div>
          ) : meta.modelFamily === 'autoregressive_image' ? (
            /* ---------------- AUTOREGRESSIVE VISUAL GENERATION TUNING ---------------- */
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">Autoregressive Visual Generation Tuning</h3>
                <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Configure visual token grid resolution, next-token sampling logits, and KV context allocation.
                </p>
              </div>

              <MemoryPoolRings
                gpuProjectedGb={arGpuGb}
                gpuTotalGb={gpuTotalGb}
                gpuFreeGb={gpuFreeGb}
                cpuProjectedGb={arCpuGb}
                cpuTotalGb={cpuTotalGb}
                cpuAvailableGb={cpuAvailGb}
                hasHardwareInfo={hasHardwareInfo}
                isUnifiedMemory={isUnifiedMemory}
              />

              {/* Section 1: Canvas & Image Token Grid */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Canvas & Token Grid
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-100 block">Image Token Grid / Resolution</label>
                    <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                      Number of discrete 2D spatial codebook tokens synthesized sequentially
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { res: '256x256', label: '256×256', tokens: '256 Tokens', desc: 'Fast Grid' },
                      { res: '384x384', label: '384×384', tokens: '576 Tokens', desc: 'Balanced Grid' },
                      { res: '512x512', label: '512×512', tokens: '1024 Tokens', desc: 'Fine Grid' },
                    ].map(({ res, label, tokens, desc }) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() => setArGridResolution(res)}
                        className={`p-3 rounded-lg text-left transition-colors cursor-pointer ${
                          arGridResolution === res
                            ? 'bg-white text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold">{label}</div>
                        <div className={`text-[10px] mt-0.5 ${arGridResolution === res ? 'text-zinc-800' : 'text-zinc-400'}`}>
                          {tokens}
                        </div>
                        <div className={`text-[9px] ${arGridResolution === res ? 'text-zinc-700' : 'text-zinc-400'}`}>
                          {desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 2: Visual Sampling Dynamics */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Visual Sampling Dynamics
                </div>

                {/* Temperature */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Visual Sampling Temperature</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Softens or sharpens next visual token logit distributions
                      </span>
                    </div>
                    <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right">
                      {arVisualTemp.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.5"
                    step="0.05"
                    value={arVisualTemp}
                    onChange={(e) => setArVisualTemp(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                  <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                    <span>0.1 (Precise)</span>
                    <span>0.8 (Recommended)</span>
                    <span>1.5 (High Entropy)</span>
                  </div>
                </div>

                {/* Top-P */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Visual Nucleus Sampling (Top-P)</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Cumulative probability threshold for spatial codebook tokens
                      </span>
                    </div>
                    <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right">
                      {arVisualTopP.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={arVisualTopP}
                    onChange={(e) => setArVisualTopP(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* Logit CFG Scale */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Visual Logit CFG Scale</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Unconditional vs conditional logit divergence multiplier
                      </span>
                    </div>
                    <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right">
                      {arLogitCfg.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="10.0"
                    step="0.5"
                    value={arLogitCfg}
                    onChange={(e) => setArLogitCfg(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>
              </div>

              {/* Section 3: Visual Context & KV Cache Allocation */}
              <div className="space-y-4">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Visual Context & KV Cache Allocation
                </div>

                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-zinc-100 block">Image Token Context & KV Cache</label>
                      <span className="text-xs text-zinc-400 mt-0.5 font-normal block">
                        Total context sequence length reserved for text prompt + 2D visual tokens
                      </span>
                    </div>
                    <span className="bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right">
                      {arTokenContext.toLocaleString()} tokens
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1024"
                    max="8192"
                    step="512"
                    value={arTokenContext}
                    onChange={(e) => setArTokenContext(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {renderGpuOffloadControl(
                  nGPULayers,
                  setNGPULayers,
                  'Visual transformer weights allocated to GPU VRAM'
                )}
              </div>

              {/* Commit Button */}
              <div className="pt-2">
                {renderPrimaryActionButton('Load Model with Settings')}
              </div>
            </div>
          ) : meta.modelFamily === 'pipeline_component' ? (
            /* ---------------- PIPELINE COMPONENT & ENCODER MODULE ---------------- */
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">Pipeline Component & Encoder Module</h3>
                <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Dedicated neural module for latent autoencoding, text conditioning, or multimodal vision projection.
                </p>
              </div>

              {/* Component Role Card */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">Component Role</span>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                        {meta.isMmproj
                          ? 'Multimodal Vision Projector (mmproj)'
                          : meta.architecture.toLowerCase().includes('clip') || meta.basename.toLowerCase().includes('clip')
                          ? 'Text Conditioning Encoder (CLIP)'
                          : meta.architecture.toLowerCase().includes('t5') || meta.basename.toLowerCase().includes('t5')
                          ? 'Text Conditioning Encoder (T5)'
                          : meta.architecture.toLowerCase().includes('vae') || meta.basename.toLowerCase().includes('vae') || meta.basename.toLowerCase().includes('ae.')
                          ? 'Latent Autoencoder (VAE / AE)'
                          : 'Pipeline Auxiliary Encoder'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-white/5">
                        {meta.format}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1 border-t border-white/5 text-xs">
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Component Footprint</span>
                    <span className="font-mono text-zinc-100 font-semibold">{meta.sizeDisplay}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Architecture</span>
                    <span className="font-mono text-zinc-100 font-semibold">{meta.architecture}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Quantization</span>
                    <span className="font-mono text-zinc-100 font-semibold">{meta.quant}</span>
                  </div>
                </div>
              </div>

              {/* Pairing Guide Card */}
              <div className="bg-[#141416] border border-white/10 rounded-xl p-5 space-y-3">
                <span className="text-xs font-bold text-zinc-200 block">Memory Footprint & Pairing Guide</span>
                <p className="text-xs text-zinc-300 leading-relaxed font-normal">
                  This file is a standalone component module rather than an independent generative engine. When executing visual generation or multimodal chat, the Astrolabe daemon automatically pairs this component with the active primary diffusion or LLM backbone.
                </p>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/5 space-y-1 text-xs text-zinc-400">
                  <div className="font-semibold text-zinc-200">Recommended Pairing:</div>
                  <div>• For VAE / AE files: Auto-selected for latent decoding in Diffusion & Flow models.</div>
                  <div>• For CLIP / T5 files: Auto-selected for text prompt conditioning in DiT architectures.</div>
                  <div>• For mmproj files: Auto-selected for image visual comprehension in multimodal vision LLMs.</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-zinc-400 flex items-center gap-2">
                  <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Generative hyperparameters (context tokens, sampling temperature, guidance scale) are disabled for encoder components.</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                {renderPrimaryActionButton('Register Component in Pipeline')}
              </div>
            </div>
          ) : (
            /* ---------------- TEXT LLM INFERENCE & VRAM TUNING ---------------- */
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">Runtime & Hardware Parameters</h3>
                <p className="text-xs text-zinc-300 mt-0.5 font-normal">
                  Tune memory limits, offload layers, and sampling hyperparameters for local inference.
                </p>
              </div>

              <MemoryPoolRings
                gpuProjectedGb={llmGpuGb}
                gpuTotalGb={gpuTotalGb}
                gpuFreeGb={gpuFreeGb}
                cpuProjectedGb={llmCpuGb}
                cpuTotalGb={cpuTotalGb}
                cpuAvailableGb={cpuAvailGb}
                hasHardwareInfo={hasHardwareInfo}
                isUnifiedMemory={isUnifiedMemory}
                gpuDetail={llmGpuDetail}
                cpuDetail={llmCpuDetail}
              />

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
                      max={sliderMaxContext}
                      step={1024}
                      value={ctxSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          setCtxSize(Math.max(2048, Math.min(sliderMaxContext, val)));
                        }
                      }}
                      className="w-24 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right focus:outline-none focus:border-white/40"
                    />
                    <span className="text-xs text-zinc-400 font-mono">tokens</span>
                  </div>
                </div>

                {/* Clean Context Presets Row (2K..256K only) */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {contextPresets.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setCtxSize(val)}
                      className={`px-3 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                        ctxSize === val
                          ? 'bg-white text-zinc-950 font-bold shadow-sm'
                          : 'bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 border border-white/10 font-medium'
                      }`}
                    >
                      {val >= 1048576 ? `${val / 1048576}M` : `${Math.round(val / 1024)}K`}
                    </button>
                  ))}
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min="2048"
                  max={sliderMaxContext}
                  step="1024"
                  value={ctxSize}
                  onChange={(e) => setCtxSize(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
                <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                  <span>2K</span>
                  <span>{ctxSize.toLocaleString()} tokens active</span>
                  <span>
                    {typeof maxContextSupported === 'number' && maxContextSupported > 0
                      ? `${Math.round(maxContextSupported / 1024)}K`
                      : `${Math.round(sliderMaxContext / 1024)}K`}
                  </span>
                </div>
              </div>

              {/* 2. GPU Offload Layers */}
              {renderGpuOffloadControl(
                nGPULayers,
                setNGPULayers,
                'Transformer layers allocated to GPU VRAM'
              )}

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
                      max={Math.max(maxCpuThreads, nThreads)}
                      step={1}
                      value={nThreads}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) setNThreads(Math.max(1, Math.min(Math.max(maxCpuThreads, nThreads), val)));
                      }}
                      className="w-16 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1 font-mono text-xs text-white text-right focus:outline-none focus:border-white/40"
                    />
                    <span className="text-xs text-zinc-400 font-mono">threads</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="1"
                  max={Math.max(maxCpuThreads, nThreads)}
                  step="1"
                  value={nThreads}
                  onChange={(e) => setNThreads(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>

              {/* 5. Kernel Toggles: Flash Attention, Try mmap & Context Offload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Flash Attention */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-zinc-100 block">Flash Attention (FA2)</label>
                    <span className="text-[11px] text-zinc-400 mt-0.5 block">
                      Tiled on-chip attention (lower VRAM footprint)
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

                {/* Offload Context to CPU Memory (KV in RAM) */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-zinc-100 block">Offload Context to CPU</label>
                    <span className="text-[11px] text-zinc-400 mt-0.5 block">
                      Keeps KV cache in system RAM instead of GPU VRAM
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOffloadContextToCpu(!offloadContextToCpu)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border border-white/10 shrink-0 ${
                      offloadContextToCpu ? 'bg-amber-400' : 'bg-zinc-800'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        offloadContextToCpu ? 'translate-x-6 bg-zinc-950' : 'translate-x-1 bg-zinc-400'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 6. KV Cache Quantization Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* K Cache Quantization Type */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                  <label className="text-xs font-semibold text-zinc-100 block">K Cache Quantization Type</label>
                  <span className="text-[11px] text-zinc-400 block">
                    Quantize Key tensor cache to compress memory footprint
                  </span>
                  <select
                    value={cacheTypeK}
                    onChange={(e) => setCacheTypeK(e.target.value as 'f16' | 'q8_0' | 'q4_0')}
                    className="w-full mt-1 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-white/40 cursor-pointer"
                  >
                    <option value="f16">f16 (FP16 Unquantized)</option>
                    <option value="q8_0">q8_0 (8-bit Quantized)</option>
                    <option value="q4_0">q4_0 (4-bit Quantized)</option>
                  </select>
                </div>

                {/* V Cache Quantization Type */}
                <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-2">
                  <label className="text-xs font-semibold text-zinc-100 block">V Cache Quantization Type</label>
                  <span className="text-[11px] text-zinc-400 block">
                    Quantize Value tensor cache to compress memory footprint
                  </span>
                  <select
                    value={cacheTypeV}
                    onChange={(e) => setCacheTypeV(e.target.value as 'f16' | 'q8_0' | 'q4_0')}
                    className="w-full mt-1 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-white/40 cursor-pointer"
                  >
                    <option value="f16">f16 (FP16 Unquantized)</option>
                    <option value="q8_0">q8_0 (8-bit Quantized)</option>
                    <option value="q4_0">q4_0 (4-bit Quantized)</option>
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
                  <span>0.0 (Precise)</span>
                  <span>0.7 (Balanced)</span>
                  <span>1.5 (Creative)</span>
                </div>
              </div>

              {/* 8. Unified Morphing Load / Progress / Unload Action Button */}
              <div className="pt-2">
                {renderPrimaryActionButton('Load Model with Settings')}
              </div>
            </div>
          )
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
                        High-resolution image and video synthesis engine.
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
