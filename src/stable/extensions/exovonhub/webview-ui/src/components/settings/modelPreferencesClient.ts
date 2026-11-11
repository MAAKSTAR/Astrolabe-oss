export interface ModelTuningPreference {
  modelId?: string;
  modality?: string;
  modelFamily?: string;
  backendPreference?: string;
  ctxSize?: number;
  nGPULayers?: number;
  temperature?: number;
  topP?: number;
  nThreads?: number;
  nBatch?: number;
  nUbatch?: number;
  flashAttn?: boolean;
  useMmap?: boolean;
  offloadContextToCpu?: boolean;
  noKvOffload?: boolean;
  kvQuant?: string;
  cacheTypeK?: string;
  cacheTypeV?: string;
  steps?: number;
  cfgScale?: number;
  resolution?: string;
  sampler?: string;
  vaeTiling?: boolean;
  offloadToCpu?: boolean;
  diffusionFlashAttn?: boolean | 'auto' | 'on' | 'off';
  vaePath?: string;
  clipPath?: string;
  t5Path?: string;
  loraPath?: string;
  loraScale?: number;
  videoFrames?: number;
  videoFps?: number;
  flowShift?: number;
  temporalTiling?: boolean;
  updatedAt?: string;
}

export type ModelPreferencesMap = Record<string, ModelTuningPreference>;

const MODALITY_PREFIX_RE = /^(local|diffusion|vision|video|music|audio):/i;
const GENERIC_FILENAMES = new Set([
  'model.gguf',
  'model.safetensors',
  'model.bin',
  'diffusion_pytorch_model.safetensors',
  'diffusion_pytorch_model.bin',
]);

function stripModelPrefix(value: string): string {
  return String(value || '').trim().replace(MODALITY_PREFIX_RE, '').trim();
}

function basenamePosix(filePath: string): string {
  const clean = filePath.replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function dirnameBasename(filePath: string): string {
  const clean = filePath.replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return basenamePosix(clean);
}

/**
 * Mirrors backend key resolution so saved tuning preferences hydrate accurately
 * whether a model is keyed by full filesystem path, prefixed id, or filename.
 */
export function resolveSavedModelPreference(
  prefs: ModelPreferencesMap | undefined,
  ...candidates: Array<string | undefined>
): ModelTuningPreference | undefined {
  if (!prefs) {
    return undefined;
  }
  const cleanCandidates = candidates
    .map((c) => stripModelPrefix(c || ''))
    .filter(Boolean);

  for (const candidate of cleanCandidates) {
    const base = basenamePosix(candidate);
    const parentAndBase = dirnameBasename(candidate);
    for (const direct of [parentAndBase, base, candidate]) {
      if (prefs[direct]) {
        return prefs[direct];
      }
    }
  }

  const entries = Object.entries(prefs);
  for (const candidate of cleanCandidates) {
    const baseLower = basenamePosix(candidate).toLowerCase();
    const candLower = candidate.toLowerCase();
    for (const [key, pref] of entries) {
      const keyLower = key.toLowerCase();
      if (keyLower === candLower || keyLower === baseLower) {
        return pref;
      }
      if (!GENERIC_FILENAMES.has(baseLower) && basenamePosix(keyLower) === baseLower) {
        return pref;
      }
    }
  }
  return undefined;
}

export interface InspectorTuningState {
  ctxSize: number;
  nGPULayers: number;
  temperature: number;
  nThreads: number;
  nBatch: number;
  nUbatch: number;
  flashAttn: boolean;
  useMmap: boolean;
  offloadContextToCpu: boolean;
  cacheTypeK: 'f16' | 'q8_0' | 'q4_0';
  cacheTypeV: 'f16' | 'q8_0' | 'q4_0';
  diffSteps: number;
  diffCfg: number;
  diffResolution: string;
  diffSampler: string;
  diffVaeTiling: boolean;
  diffOffloadRam: boolean;
  diffGpuLayers: number;
  diffFlashAttn: 'auto' | 'on' | 'off';
  videoFrames: number;
  videoFps: number;
  videoFlowShift: number;
  videoTemporalTiling: boolean;
  selectedVae: string;
  selectedClip: string;
  selectedT5: string;
  selectedLora: string;
  loraScale: number;
  arGridResolution: string;
  arVisualTemp: number;
  arVisualTopP: number;
  arLogitCfg: number;
  arTokenContext: number;
}

export interface InspectorModelMeta {
  isMusic?: boolean;
  isVideo?: boolean;
  modality?: string;
  modelFamily?: string;
}

/**
 * Produces the canonical tuning payload shared by both "Save Preference" and
 * "Load Model with Settings" so saved profiles and live loads never drift.
 */
export function buildModelTuningRequest(
  meta: InspectorModelMeta,
  state: InspectorTuningState,
  options: { includeTarget?: boolean } = {},
): ModelTuningPreference & { target?: string } {
  const { includeTarget = true } = options;
  if (meta.isMusic || meta.modality === 'music') {
    return {
      ...(includeTarget ? { target: 'music' } : {}),
      modality: 'music',
      nGPULayers: state.diffGpuLayers,
    };
  }

  if (meta.modelFamily === 'diffusion_flow') {
    return {
      ...(includeTarget ? { target: meta.isVideo ? 'video' : 'diffusion' } : {}),
      modality: meta.isVideo ? 'video' : 'image',
      modelFamily: 'diffusion_flow',
      steps: state.diffSteps,
      cfgScale: state.diffCfg,
      resolution: state.diffResolution,
      sampler: state.diffSampler,
      vaeTiling: state.diffVaeTiling,
      offloadContextToCpu: state.diffOffloadRam,
      offloadToCpu: state.diffOffloadRam,
      diffusionFlashAttn: state.diffFlashAttn,
      nGPULayers: state.diffGpuLayers,
      vaePath: state.selectedVae !== 'auto' ? state.selectedVae : undefined,
      clipPath: state.selectedClip !== 'auto' ? state.selectedClip : undefined,
      t5Path: state.selectedT5 !== 'auto' ? state.selectedT5 : undefined,
      loraPath: state.selectedLora !== 'none' ? state.selectedLora : undefined,
      loraScale: state.selectedLora !== 'none' ? state.loraScale : undefined,
      ...(meta.isVideo
        ? {
            videoFrames: state.videoFrames,
            videoFps: state.videoFps,
            flowShift: state.videoFlowShift,
            temporalTiling: state.videoTemporalTiling,
          }
        : {}),
    };
  }

  if (meta.modelFamily === 'autoregressive_image') {
    return {
      modality: 'image',
      modelFamily: 'autoregressive_image',
      resolution: state.arGridResolution,
      temperature: state.arVisualTemp,
      topP: state.arVisualTopP,
      cfgScale: state.arLogitCfg,
      ctxSize: state.arTokenContext,
      nGPULayers: state.nGPULayers,
      flashAttn: state.flashAttn,
      useMmap: state.useMmap,
    };
  }

  if (meta.modelFamily === 'pipeline_component') {
    return {
      modality: 'component',
      modelFamily: 'pipeline_component',
    };
  }

  return {
    modality: 'llm',
    modelFamily: 'text_llm',
    ctxSize: state.ctxSize,
    nGPULayers: state.nGPULayers,
    nThreads: state.nThreads,
    nBatch: state.nBatch,
    nUbatch: state.nUbatch,
    flashAttn: state.flashAttn,
    useMmap: state.useMmap,
    offloadContextToCpu: state.offloadContextToCpu,
    temperature: state.temperature,
    cacheTypeK: state.cacheTypeK,
    cacheTypeV: state.cacheTypeV,
  };
}

