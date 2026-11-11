export type ModelModality = 'all' | 'llm' | 'image' | 'video' | 'voice' | 'audio';

export interface HfLiveModel {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  createdAt?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
}

export interface HfModelDetails {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  createdAt?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  gguf?: {
    architecture?: string;
    context_length?: number;
    total?: number;
  };
  config?: {
    max_position_embeddings?: number;
    model_type?: string;
  };
  safetensors?: {
    total?: number;
    parameters?: Record<string, number>;
  };
  cardData?: {
    license?: string;
    language?: string[];
    base_model?: string[];
  };
  siblings?: Array<{ rfilename: string; size?: number; lfs?: { size?: number; sha256?: string } }>;
}

export interface LiveQuantOption {
  filename: string;
  quant: string;
  ext: string;
  sizeBytes: number;
  sizeGB: number;
  sizeDisplay: string;
  directUrl: string;
}

export interface SpecGridCard {
  label: string;
  value: string;
}

const HF_EXPAND_PARAMS = [
  'lastModified',
  'createdAt',
  'downloads',
  'likes',
  'pipeline_tag',
  'tags',
  'author',
  'library_name'
]
  .map((field) => `expand[]=${field}`)
  .join('&');

const METADATA_BIN_PATTERNS = [
  '/analytics/',
  'coremldata.bin',
  'training_args.bin',
  'optimizer.bin',
  'scheduler.bin',
  'rng_state'
];

const QUANT_PRIORITY = ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0', 'Q4_K_S', 'Q5_K_S', 'BF16', 'F16', 'SAFETENSORS', 'ONNX'];

/** Formats an ISO timestamp into relative age text using a fallback creation date when available. */
export function formatRelativeTime(dateStr?: string, fallbackDateStr?: string): string {
  const effective = dateStr || fallbackDateStr;
  if (!effective) return 'Recently';
  try {
    const parsed = new Date(effective).getTime();
    if (!Number.isFinite(parsed)) return 'Recently';
    const diffMs = Math.max(0, Date.now() - parsed);
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return 'Just now';
  } catch {
    return 'Recently';
  }
}

/** Parses Hugging Face HTTP Link headers to extract the cursor pagination next URL. */
export function parseNextLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel=["']?next["']?/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Builds the first-page Hugging Face Hub API URL with real sorting, limit=20, and required expand fields. */
export function buildHfModelsUrl(
  sortMode: 'lastModified' | 'trendingScore' | 'downloads',
  search?: string,
  modality: ModelModality = 'all'
): string {
  const filterParts: string[] = [];
  switch (modality) {
    case 'llm':
      filterParts.push('pipeline_tag=text-generation', 'filter=gguf');
      break;
    case 'image':
      filterParts.push('pipeline_tag=text-to-image');
      break;
    case 'video':
      filterParts.push('pipeline_tag=text-to-video');
      break;
    case 'voice':
      filterParts.push('pipeline_tag=automatic-speech-recognition');
      break;
    case 'audio':
      filterParts.push('pipeline_tag=text-to-audio');
      break;
    case 'all':
    default:
      filterParts.push('filter=gguf');
      break;
  }

  const trimmedSearch = (search || '').trim();
  const queryParts: string[] = [];
  if (trimmedSearch) {
    queryParts.push(`search=${encodeURIComponent(trimmedSearch)}`);
  }
  queryParts.push(...filterParts, `sort=${sortMode}`, 'direction=-1', 'limit=20', HF_EXPAND_PARAMS);
  return `https://huggingface.co/api/models?${queryParts.join('&')}`;
}

export function getModelModalityInfo(m: HfLiveModel): { label: string; color: string } {
  const p = (m.pipeline_tag || '').toLowerCase();
  const id = m.id.toLowerCase();
  const tags = (m.tags || []).map((t) => t.toLowerCase());

  if (p === 'text-to-image' || p === 'image-to-image' || id.includes('flux') || id.includes('sdxl') || id.includes('stable-diffusion') || id.includes('janus') || tags.includes('text-to-image')) {
    return { label: 'IMAGE', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  }
  if (p === 'text-to-video' || p === 'image-to-video' || id.includes('wan') || id.includes('cogvideo') || id.includes('animatediff') || id.includes('svd') || tags.includes('text-to-video')) {
    return { label: 'VIDEO', color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
  }
  if (p === 'text-to-speech' || id.includes('kokoro') || id.includes('piper') || id.includes('bark') || tags.includes('text-to-speech')) {
    return { label: 'TTS', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  }
  if (p === 'automatic-speech-recognition' || id.includes('whisper') || tags.includes('automatic-speech-recognition')) {
    return { label: 'STT', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
  }
  if (p === 'text-to-audio' || p === 'audio-to-audio' || id.includes('musicgen') || id.includes('audiocraft') || tags.includes('text-to-audio')) {
    return { label: 'MUSIC', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
  }
  return { label: 'LLM', color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
}

function formatWeightBytes(rawBytes: number): { sizeGB: number; sizeDisplay: string } {
  if (rawBytes <= 0) return { sizeGB: 0, sizeDisplay: 'Size varies' };
  const sizeGB = Number((rawBytes / (1024 * 1024 * 1024)).toFixed(2));
  if (rawBytes >= 1024 * 1024 * 1024) {
    return { sizeGB, sizeDisplay: `${sizeGB} GB` };
  }
  if (rawBytes >= 1024 * 1024) {
    return { sizeGB, sizeDisplay: `${Math.max(1, Math.round(rawBytes / (1024 * 1024)))} MB` };
  }
  return { sizeGB, sizeDisplay: `${Math.max(1, Math.round(rawBytes / 1024))} KB` };
}

/** Extracts real downloadable weight files from Hugging Face siblings without fabricating sizes or fake GGUFs. */
export function extractQuantOptions(modelId: string, siblings?: HfModelDetails['siblings']): LiveQuantOption[] {
  const candidates = (siblings || []).filter((s) => {
    if (!s.rfilename) return false;
    const fn = s.rfilename.toLowerCase();
    return fn.endsWith('.gguf') || fn.endsWith('.safetensors') || fn.endsWith('.onnx') || fn.endsWith('.bin');
  });

  const nonMeta = candidates.filter((s) => {
    const fn = s.rfilename.toLowerCase();
    const rawBytes = s.lfs?.size || s.size || 0;
    if (METADATA_BIN_PATTERNS.some((pat) => fn.includes(pat))) return false;
    if (fn.endsWith('.bin') && rawBytes > 0 && rawBytes < 1024 * 1024) return false;
    return true;
  });

  const usable = nonMeta.length > 0 ? nonMeta : candidates;
  const formatRank = (ext: string) => (ext === 'GGUF' ? 0 : ext === 'SAFETENSORS' ? 1 : ext === 'ONNX' ? 2 : 3);

  return usable
    .map((f) => {
      const fn = f.rfilename;
      const quantMatch = fn.match(/(Q\d+_[A-Za-z0-9_]+|IQ\d+_[A-Za-z0-9_]+|F16|F32|Q8_0|Q4_0|Q4_1|Q5_0|Q5_1|BF16|NVFP4|FP8|FP4)/i);
      const extMatch = fn.match(/\.(safetensors|onnx|bin|gguf)$/i);
      const ext = extMatch ? extMatch[1].toUpperCase() : 'WEIGHTS';
      const quant = quantMatch ? quantMatch[1].toUpperCase() : ext;
      const rawBytes = f.lfs?.size || f.size || 0;
      const { sizeGB, sizeDisplay } = formatWeightBytes(rawBytes);
      return {
        filename: fn,
        quant,
        ext,
        sizeBytes: rawBytes,
        sizeGB,
        sizeDisplay,
        directUrl: `https://huggingface.co/${modelId}/resolve/main/${fn}`
      };
    })
    .sort((a, b) => formatRank(a.ext) - formatRank(b.ext) || b.sizeBytes - a.sizeBytes);
}

export function pickPreferredQuantIndex(quants: LiveQuantOption[]): number {
  if (quants.length === 0) return 0;
  for (const target of QUANT_PRIORITY) {
    const idx = quants.findIndex((q) => q.quant === target && (q.sizeBytes === 0 || q.sizeBytes >= 1024 * 1024));
    if (idx !== -1) return idx;
  }
  const substantial = quants.findIndex((q) => q.sizeBytes >= 1024 * 1024);
  return substantial !== -1 ? substantial : 0;
}

function formatParamCount(total?: number): string | null {
  if (!total || !Number.isFinite(total) || total <= 0) return null;
  if (total >= 1e9) return `${(total / 1e9).toFixed(total >= 10e9 ? 0 : 1)}B params`;
  if (total >= 1e6) return `${Math.round(total / 1e6)}M params`;
  return `${Math.round(total / 1e3)}K params`;
}

/** Returns honest, modality-aware specification cards including real model weight size instead of duplicate task labels. */
export function getModelSpecGrid(
  details: HfModelDetails,
  quants: LiveQuantOption[],
  selectedQuant?: LiveQuantOption
): SpecGridCard[] {
  const tags = (details.tags || []).map((t) => t.toLowerCase());
  const pTag = (details.pipeline_tag || '').toLowerCase();
  const formatSet = Array.from(new Set(quants.map((q) => q.ext)));
  const detectedFormats = formatSet.length > 0
    ? formatSet.join(' / ')
    : tags.includes('coreml') ? 'CoreML' : details.library_name || 'Repo Files';

  const licenseTag = tags.find((t) => t.startsWith('license:'));
  const licenseValue = details.cardData?.license || (licenseTag ? licenseTag.slice('license:'.length) : 'Not specified');

  const activeQuant = selectedQuant || quants[0];
  const totalBytes = quants.reduce((sum, q) => sum + (q.sizeBytes || 0), 0);
  const selectedSize = activeQuant?.sizeBytes ? activeQuant.sizeDisplay : null;
  const totalSize = totalBytes > 0 ? formatWeightBytes(totalBytes).sizeDisplay : null;
  const paramSummary = formatParamCount(details.safetensors?.total);

  let sizeCore = detectedFormats;
  if (selectedSize && totalSize && quants.length > 1 && totalBytes > (activeQuant?.sizeBytes || 0)) {
    sizeCore = `${selectedSize} · ${totalSize} repo (${quants.length} files)`;
  } else if (selectedSize) {
    sizeCore = `${selectedSize} · ${detectedFormats}`;
  } else if (totalSize) {
    sizeCore = `${totalSize} · ${detectedFormats}`;
  }
  const modelSizeValue = paramSummary ? `${paramSummary} · ${sizeCore}` : sizeCore;

  const isNonLlmTask = [
    'automatic-speech-recognition',
    'text-to-speech',
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
    'text-to-audio',
    'audio-to-audio'
  ].includes(pTag);

  const isLlm = !isNonLlmTask && (
    ['text-generation', 'conversational', 'image-text-to-text'].includes(pTag) ||
    Boolean(details.gguf?.context_length) ||
    quants.some((q) => q.ext === 'GGUF')
  );

  const realArch = details.gguf?.architecture || details.config?.model_type || details.library_name || detectedFormats;

  if (!isLlm) {
    return [
      { label: 'Framework / Runtime', value: details.library_name || realArch },
      { label: 'Model Size', value: modelSizeValue },
      { label: 'License', value: licenseValue }
    ];
  }

  const realContext = details.gguf?.context_length || details.config?.max_position_embeddings;
  return [
    { label: 'Architecture', value: realArch },
    realContext
      ? { label: 'Context Length', value: `${realContext.toLocaleString()} tokens` }
      : { label: 'Model Size', value: modelSizeValue },
    { label: 'License', value: licenseValue }
  ];
}
