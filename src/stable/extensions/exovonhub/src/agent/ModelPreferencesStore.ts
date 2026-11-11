import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

export function getDefaultModelPreferencesPath(): string {
    return path.join(os.homedir(), '.exovon', 'model_preferences.json');
}

export function stripModelPrefix(modelId: string): string {
    return String(modelId || '').trim().replace(MODALITY_PREFIX_RE, '').trim();
}

/**
 * Normalizes a model identifier or file path to a stable cross-webview key
 * so Settings (often full path) and Chat Sidebar (often prefixed basename)
 * resolve to the same preference entry.
 */
export function getModelPreferenceKey(modelId: string): string {
    const clean = stripModelPrefix(modelId);
    if (!clean) {
        return '';
    }
    const normalized = clean.replace(/\\/g, '/');
    const base = path.posix.basename(normalized);
    if (GENERIC_FILENAMES.has(base.toLowerCase())) {
        const parent = path.posix.basename(path.posix.dirname(normalized));
        if (parent && parent !== '.' && parent !== '/') {
            return `${parent}/${base}`;
        }
    }
    return base || normalized;
}

export function resolveModelPreferenceFromMap(
    prefs: ModelPreferencesMap | undefined,
    modelId: string,
): ModelTuningPreference | undefined {
    if (!prefs || !modelId) {
        return undefined;
    }
    const stripped = stripModelPrefix(modelId);
    const key = getModelPreferenceKey(modelId);

    const directCandidates = [key, stripped, modelId.trim()].filter(Boolean);
    for (const candidate of directCandidates) {
        if (prefs[candidate]) {
            return prefs[candidate];
        }
    }

    const lowerCandidates = new Set(directCandidates.map((c) => c.toLowerCase()));
    const baseLower = path.posix.basename(stripped.replace(/\\/g, '/')).toLowerCase();
    for (const [entryKey, value] of Object.entries(prefs)) {
        const entryLower = entryKey.toLowerCase();
        if (lowerCandidates.has(entryLower)) {
            return value;
        }
        if (baseLower && !GENERIC_FILENAMES.has(baseLower) && path.posix.basename(entryLower) === baseLower) {
            return value;
        }
    }
    return undefined;
}

export function loadAllModelPreferences(storePath = getDefaultModelPreferencesPath()): ModelPreferencesMap {
    try {
        if (!fs.existsSync(storePath)) {
            return {};
        }
        const raw = fs.readFileSync(storePath, 'utf8');
        if (!raw.trim()) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed as ModelPreferencesMap;
    } catch {
        return {};
    }
}

export function getModelPreference(
    modelId: string,
    storePath = getDefaultModelPreferencesPath(),
): ModelTuningPreference | undefined {
    const prefs = loadAllModelPreferences(storePath);
    return resolveModelPreferenceFromMap(prefs, modelId);
}

export function saveModelPreference(
    modelId: string,
    preference: ModelTuningPreference,
    storePath = getDefaultModelPreferencesPath(),
): ModelPreferencesMap {
    const key = getModelPreferenceKey(modelId);
    if (!key) {
        return loadAllModelPreferences(storePath);
    }

    const current = loadAllModelPreferences(storePath);
    const cleanedPref: ModelTuningPreference = {
        ...Object.fromEntries(
            Object.entries(preference).filter(([, value]) => value !== undefined && value !== ''),
        ),
        modelId: stripModelPrefix(modelId),
        updatedAt: new Date().toISOString(),
    };

    const next: ModelPreferencesMap = {
        ...current,
        [key]: cleanedPref,
    };

    const dir = path.dirname(storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${storePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmpPath, storePath);
    return next;
}

function pickDefined<T>(...values: Array<T | undefined>): T | undefined {
    for (const value of values) {
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function pickNonEmptyString(...values: Array<string | undefined>): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}

/**
 * Merges saved per-model tuning preferences with explicit request fields into
 * the daemon `/v1/models/load` snake_case payload so loading from either Settings
 * or the Chat Model Selector honors the user's saved tuning profile.
 */
export function buildDaemonLoadPayload(
    modelId: string,
    incomingData: Record<string, any> = {},
    savedPref?: ModelTuningPreference,
): Record<string, any> {
    const cleanModelId = stripModelPrefix(modelId);
    const cacheTypeK = pickNonEmptyString(incomingData.cacheTypeK, incomingData.cache_type_k, savedPref?.cacheTypeK);
    const cacheTypeV = pickNonEmptyString(incomingData.cacheTypeV, incomingData.cache_type_v, savedPref?.cacheTypeV);
    const offloadToCpu = pickDefined(
        incomingData.offloadToCpu,
        incomingData.offload_to_cpu,
        incomingData.offloadContextToCpu,
        incomingData.offload_context_to_cpu,
        savedPref?.offloadToCpu,
        savedPref?.offloadContextToCpu,
    );
    const offloadContextToCpu = pickDefined(
        incomingData.offloadContextToCpu,
        incomingData.offload_context_to_cpu,
        savedPref?.offloadContextToCpu,
    );

    const payload: Record<string, any> = {
        model_path: cleanModelId,
        target: pickNonEmptyString(incomingData.target) ?? cleanModelId,
        modality: pickNonEmptyString(incomingData.modality, savedPref?.modality),
        model_family: pickNonEmptyString(incomingData.modelFamily, incomingData.model_family, savedPref?.modelFamily),
        ctx_size: pickDefined(incomingData.ctxSize, incomingData.ctx_size, savedPref?.ctxSize),
        n_gpu_layers: pickDefined(incomingData.nGPULayers, incomingData.n_gpu_layers, savedPref?.nGPULayers),
        n_threads: pickDefined(incomingData.nThreads, incomingData.n_threads, savedPref?.nThreads),
        n_batch: pickDefined(incomingData.nBatch, incomingData.n_batch, savedPref?.nBatch),
        n_ubatch: pickDefined(incomingData.nUbatch, incomingData.n_ubatch, savedPref?.nUbatch),
        backend_preference: pickNonEmptyString(
            incomingData.backendPreference,
            incomingData.backend_preference,
            savedPref?.backendPreference,
        ),
        use_mmap: pickDefined(incomingData.useMmap, incomingData.use_mmap, savedPref?.useMmap),
        flash_attn: pickDefined(incomingData.flashAttn, incomingData.flash_attn, savedPref?.flashAttn),
        offload_context_to_cpu: offloadContextToCpu,
        no_kv_offload: pickDefined(
            incomingData.noKvOffload,
            incomingData.no_kv_offload,
            offloadContextToCpu,
            savedPref?.noKvOffload,
        ),
        kv_quant: pickNonEmptyString(incomingData.kvQuant, incomingData.kv_quant, savedPref?.kvQuant)
            ?? (cacheTypeK && cacheTypeK !== 'f16' ? cacheTypeK : undefined),
        cache_type_k: cacheTypeK,
        cache_type_v: cacheTypeV,
        temperature: pickDefined(incomingData.temperature, savedPref?.temperature),
        top_p: pickDefined(incomingData.topP, incomingData.top_p, savedPref?.topP),
        steps: pickDefined(incomingData.steps, savedPref?.steps),
        cfg_scale: pickDefined(incomingData.cfgScale, incomingData.cfg_scale, savedPref?.cfgScale),
        resolution: pickNonEmptyString(incomingData.resolution, savedPref?.resolution),
        sampler: pickNonEmptyString(incomingData.sampler, savedPref?.sampler),
        vae_tiling: pickDefined(incomingData.vaeTiling, incomingData.vae_tiling, savedPref?.vaeTiling),
        vae_path: pickNonEmptyString(incomingData.vaePath, incomingData.vae_path, savedPref?.vaePath),
        clip_path: pickNonEmptyString(incomingData.clipPath, incomingData.clip_path, savedPref?.clipPath),
        t5_path: pickNonEmptyString(incomingData.t5Path, incomingData.t5_path, savedPref?.t5Path),
        lora_path: pickNonEmptyString(incomingData.loraPath, incomingData.lora_path, savedPref?.loraPath),
        lora_scale: pickDefined(incomingData.loraScale, incomingData.lora_scale, savedPref?.loraScale),
        video_frames: pickDefined(incomingData.videoFrames, incomingData.video_frames, savedPref?.videoFrames),
        fps: pickDefined(incomingData.videoFps, incomingData.fps, savedPref?.videoFps),
        flow_shift: pickDefined(incomingData.flowShift, incomingData.flow_shift, savedPref?.flowShift),
        temporal_tiling: pickDefined(
            incomingData.temporalTiling,
            incomingData.temporal_tiling,
            savedPref?.temporalTiling,
        ),
        offload_to_cpu: offloadToCpu,
        diffusion_flash_attn: pickDefined(
            incomingData.diffusionFlashAttn,
            incomingData.diffusion_flash_attn,
            savedPref?.diffusionFlashAttn,
        ),
    };

    return Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined),
    );
}
