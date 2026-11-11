export type ModelModality = 'llm' | 'image' | 'video' | 'music' | 'component';
export type ComponentRole = 'vae' | 'encoders' | 'mmproj' | 'loras';

export interface ModelMetadata {
  rawId: string;
  cleanId: string;
  displayName: string;
  basename: string;
  filePath: string;
  relativePath: string;
  modality: ModelModality;
  componentRole: ComponentRole | null;
  format: 'GGUF' | 'SafeTensors' | 'PyTorch' | 'ONNX' | 'Binary';
  architecture: string;
  params: string;
  publisher: string;
  quant: string;
  sizeDisplay: string;
  sizeBytes?: number;
  modified: string;
  isVision: boolean;
  isMmproj: boolean;
  isDiffusion: boolean;
  isVideo: boolean;
  isMusic: boolean;
  isComponent: boolean;
  isToolUse: boolean;
  isReasoning: boolean;
  isEmbedding: boolean;
  maxContextLength?: number;
  totalLayers?: number;
  modelFamily: 'text_llm' | 'diffusion_flow' | 'autoregressive_image' | 'pipeline_component';
}

export function cleanModelId(rawId?: string): string {
  if (!rawId) return '';
  return rawId.replace(/^local:/i, '');
}

export function formatModelDisplayName(modelStr?: string): string {
  if (!modelStr) return '';
  const clean = cleanModelId(modelStr);
  const parts = clean.split(/[/\\]/);
  let name = parts[parts.length - 1] || clean;
  name = name.replace(/\.(gguf|safetensors|pt|pth|bin|onnx)$/i, '');
  return name;
}

export function detectFileFormat(pathOrId?: string): 'GGUF' | 'SafeTensors' | 'PyTorch' | 'ONNX' | 'Binary' {
  if (!pathOrId) return 'GGUF';
  const lower = pathOrId.toLowerCase();
  if (lower.endsWith('.safetensors') || lower.endsWith('.sft')) return 'SafeTensors';
  if (lower.endsWith('.pt') || lower.endsWith('.pth')) return 'PyTorch';
  if (lower.endsWith('.onnx')) return 'ONNX';
  if (lower.endsWith('.bin')) return 'Binary';
  return 'GGUF';
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function extractModelMetadata(rawId?: string, modelObj?: any): ModelMetadata {
  const clean = cleanModelId(rawId || modelObj?.id || '');
  const basename = clean.split(/[/\\]/).pop() || clean;
  const displayName = formatModelDisplayName(clean);
  const format = detectFileFormat(clean);

  // Extract Params (e.g. 4x6B, 26B-A4B, 3.1B, 24B, 4B, 8B, 31B, 35B, 9B, 3B, 1B, 70B, etc.)
  let params = modelObj?.params || '';
  if (!params) {
    const pMatch = basename.match(/(\d+x\d+B|\d+B-A\d+B|\d+(?:\.\d+)?B)/i);
    if (pMatch) {
      params = pMatch[1].toUpperCase();
    } else {
      params = 'N/A';
    }
  }

  // Extract Publisher
  let publisher = modelObj?.publisher || '';
  if (!publisher) {
    const segments = clean.split(/[/\\]/).filter(Boolean);
    const aiModelsIdx = segments.findIndex(s => s.toLowerCase().includes('model') || s.toLowerCase() === 'models');
    if (aiModelsIdx !== -1 && segments.length > aiModelsIdx + 1 && !segments[aiModelsIdx + 1].endsWith('.gguf')) {
      publisher = segments[aiModelsIdx + 1];
    } else if (segments.length >= 2 && !segments[segments.length - 2].toLowerCase().includes('model')) {
      publisher = segments[segments.length - 2];
    } else {
      const pubMatch = basename.match(/^(DavidAU|HauhauCS|Andycurrent|lmstudio-community|deepreinforce-ai|squ11z1|prithivMLmods|Nexlab|RHB56|bartowski|TheBloke|google|meta-llama|Qwen|Nexusflow|turboderp|mistralai)/i);
      if (pubMatch) {
        publisher = pubMatch[1];
      } else {
        const parts = basename.split(/[-_]/);
        if (parts.length > 2 && !/^(qwen|gemma|llama|deepseek|mistral|vibe|mythos|ltx|phi)/i.test(parts[0])) {
          publisher = parts[0];
        } else {
          publisher = 'Local';
        }
      }
    }
  }

  // Extract Quantization
  let quant = modelObj?.quantization || modelObj?.quant || '';
  if (!quant) {
    const qMatch = basename.match(/(IQ[0-9]_[A-Z0-9_]+|Q[0-9]_[A-Z0-9_]+|Q[0-9]_[0-9]|F16|F32|BF16)/i);
    if (qMatch) {
      quant = qMatch[1].toUpperCase();
    } else {
      quant = format === 'SafeTensors' ? 'BF16' : 'GGUF';
    }
  }

  // Extract Architecture
  let architecture = modelObj?.architecture || '';
  if (!architecture) {
    const lower = basename.toLowerCase();
    if (lower.includes('qwen')) architecture = 'Qwen';
    else if (lower.includes('llama')) architecture = 'LLaMA';
    else if (lower.includes('gemma')) architecture = 'Gemma';
    else if (lower.includes('deepseek')) architecture = 'DeepSeek';
    else if (lower.includes('mistral') || lower.includes('mixtral')) architecture = 'Mistral';
    else if (lower.includes('phi')) architecture = 'Phi';
    else if (lower.includes('flux')) architecture = 'FLUX';
    else if (lower.includes('sdxl') || lower.includes('stable-diffusion') || lower.includes('sd15')) architecture = 'Stable Diffusion';
    else if (lower.includes('starcoder')) architecture = 'StarCoder';
    else architecture = 'Transformer';
  }

  // Capabilities, Modality & Component Detection
  const lowerBase = basename.toLowerCase();
  const lowerArch = (architecture || modelObj?.architecture || '').toLowerCase();
  const lowerClean = clean.toLowerCase();
  const relativePath = typeof modelObj?.relative_path === 'string' ? modelObj.relative_path.replace(/\\/g, '/') : '';
  const lowerRel = relativePath.toLowerCase();

  const rawBackendModality = typeof modelObj?.modality === 'string' ? modelObj.modality.toLowerCase() : '';
  const validModalities: ModelModality[] = ['llm', 'image', 'video', 'music', 'component'];
  const backendModality = validModalities.includes(rawBackendModality as ModelModality)
    ? (rawBackendModality as ModelModality)
    : undefined;

  const rawBackendRole = typeof modelObj?.component_role === 'string' ? modelObj.component_role.toLowerCase() : '';
  const validRoles: ComponentRole[] = ['vae', 'encoders', 'mmproj', 'loras'];
  let componentRole: ComponentRole | null = validRoles.includes(rawBackendRole as ComponentRole)
    ? (rawBackendRole as ComponentRole)
    : null;

  if (!componentRole) {
    if (lowerRel.includes('/mmproj/') || lowerRel.startsWith('components/mmproj/') || lowerBase.startsWith('mmproj-') || lowerBase.includes('-mmproj-') || lowerBase.includes('mmproj')) {
      componentRole = 'mmproj';
    } else if (lowerRel.includes('/vae/') || lowerRel.startsWith('components/vae/') || lowerBase.includes('vae') || lowerBase.endsWith('.ae.safetensors') || lowerBase === 'ae.safetensors' || lowerBase.startsWith('ae.') || lowerArch === 'ae') {
      componentRole = 'vae';
    } else if (lowerRel.includes('/loras/') || lowerRel.startsWith('components/loras/') || /(^|[-_.])lora([-_.]|$)/i.test(lowerBase)) {
      componentRole = 'loras';
    } else if (lowerRel.includes('/encoders/') || lowerRel.startsWith('components/encoders/') || /(clip[-_]?l|clip[-_]?g|t5xxl|umt5|text[-_]?encoder|encoder)/i.test(lowerBase) || lowerArch.includes('clip') || lowerArch.includes('t5')) {
      componentRole = 'encoders';
    }
  }

  const isMmprojHeuristic =
    lowerBase.startsWith('mmproj-') ||
    lowerBase.includes('-mmproj-') ||
    componentRole === 'mmproj';

  const isPipelineComponentHeuristic =
    isMmprojHeuristic ||
    componentRole !== null ||
    lowerBase.includes('clip') ||
    lowerBase.includes('vae') ||
    lowerBase.includes('t5') ||
    lowerBase.includes('mmproj') ||
    lowerBase.endsWith('.ae.safetensors') ||
    lowerBase.startsWith('ae.') ||
    lowerArch === 'ae' ||
    lowerArch.includes('clip') ||
    lowerArch.includes('vae') ||
    lowerArch.includes('mmproj');

  const isVideoHeuristic =
    !isPipelineComponentHeuristic && (
      /(wan[-_.]?2(\.\d)?|wan2[12]|hunyuan[-_]?video|cogvideo|ltx[-_]?video|mochi|svd|animate[-_]?diff|text[-_]?to[-_]?video|image[-_]?to[-_]?video)/i.test(lowerBase) ||
      /(wan[-_.]?2(\.\d)?|hunyuan[-_]?video|cogvideo|ltx[-_]?video|mochi|text[-_]?to[-_]?video|image[-_]?to[-_]?video)/i.test(lowerClean) ||
      /(wan|hunyuan_video|cogvideo|ltx|mochi|video)/i.test(lowerArch)
    );

  const isMusicHeuristic =
    !isPipelineComponentHeuristic && (
      /(ace[-_]?step|musicgen|audioldm|riffusion|stable[-_]?audio|bark[-_])/i.test(lowerBase) ||
      /(ace[-_]?step|musicgen|audioldm|riffusion|stable[-_]?audio)/i.test(lowerClean) ||
      /(musicgen|audioldm|acestep|stable_audio|audio)/i.test(lowerArch)
    );

  const isDiffusionImageHeuristic = !isPipelineComponentHeuristic && !isVideoHeuristic && !isMusicHeuristic && (
    /(sd[-_]?turbo|sd[-_]?1\.?5|sd[-_]?2|sd[-_]?xl|sd[-_]?3|stable[-_]?diffusion|flux|qwen[-_]?image|pixart|auraflow|diffusion|diffusers|dit)/i.test(basename) ||
    (lowerBase.includes('qwen') && lowerBase.includes('image')) ||
    (lowerArch.includes('qwen') && lowerArch.includes('image')) ||
    /(diffusion|diffusers|image[-_]?gen|text[-_]?to[-_]?image|stable[-_]?diffusion)/i.test(clean) ||
    (Boolean(modelObj?.architecture) && /(sd|sdxl|sd3|flux|diffusion|diffusers|dit)/i.test(lowerArch)) ||
    (lowerBase.endsWith('.safetensors') && !isPipelineComponentHeuristic)
  );

  // Subfolder-based modality fallback before filename heuristics
  const relModality: ModelModality | undefined =
    lowerRel.startsWith('components/') || lowerRel.includes('/components/') ? 'component' :
    lowerRel.startsWith('video/') || lowerRel.includes('/video/') ? 'video' :
    lowerRel.startsWith('music/') || lowerRel.includes('/music/') ? 'music' :
    lowerRel.startsWith('image/') || lowerRel.includes('/image/') ? 'image' :
    lowerRel.startsWith('llm/') || lowerRel.includes('/llm/') ? 'llm' :
    undefined;

  const mfRaw = modelObj?.model_family || modelObj?.family;

  const modality: ModelModality =
    backendModality ??
    relModality ??
    (mfRaw === 'pipeline_component' || isPipelineComponentHeuristic ? 'component'
      : isVideoHeuristic ? 'video'
      : isMusicHeuristic ? 'music'
      : mfRaw === 'diffusion_flow' || mfRaw === 'autoregressive_image' || isDiffusionImageHeuristic ? 'image'
      : 'llm');

  const isComponent = modality === 'component' || mfRaw === 'pipeline_component';
  const isMmproj = componentRole === 'mmproj' || lowerBase.startsWith('mmproj-') || lowerBase.includes('-mmproj-');
  const isVideo = modality === 'video';
  const isMusic = modality === 'music';

  const isArImage =
    !isComponent && (
      mfRaw === 'autoregressive_image' ||
      /(janus|chameleon|var|emu|show-o|llamagen)/i.test(lowerBase) ||
      /(janus|chameleon|var|emu|show-o|llamagen)/i.test(lowerArch) ||
      /(janus|chameleon|var|emu|show-o|llamagen)/i.test(lowerClean)
    );

  const isDiffusion =
    !isComponent && !isMusic && !isArImage && (
      modality === 'image' ||
      modality === 'video' ||
      mfRaw === 'diffusion_flow'
    );

  const isVision = !isComponent && !isDiffusion && !isMusic && !isArImage && (
    /(vl|vision|llava|clip)/i.test(basename) || /(vl|vision)/i.test(clean)
  );

  const isToolUse = !isComponent && !isDiffusion && !isMusic && (
    /(it|instruct|chat|tool|heretic|neo|freedom|uncensored|agent)/i.test(basename) || /(it|instruct)/i.test(clean)
  );

  const isReasoning = !isComponent && !isDiffusion && !isMusic && /(think|reason|freedom|r1|deepseek)/i.test(basename);
  const isEmbedding = !isComponent && /(embed|bge|nomic)/i.test(basename);

  // Modified Time
  let modified = modelObj?.modified || modelObj?.mtime_display || '';
  if (!modified && modelObj?.mtime) {
    const diffMs = Date.now() - new Date(modelObj.mtime).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) modified = `${diffDays}d ago`;
    else if (diffHours > 0) modified = `${diffHours}h ago`;
    else modified = 'Just now';
  }
  if (!modified) modified = 'Recently';

  // Size display
  const sizeDisplay = modelObj?.size_display ||
    modelObj?.size ||
    (modelObj?.size_bytes ? formatBytes(modelObj.size_bytes) : '-');

  // Context & Layer Metadata — strictly use daemon-parsed values when available; never invent defaults
  const rawMaxCtx = modelObj?.max_context_length ?? modelObj?.context_length;
  const maxContextLength = typeof rawMaxCtx === 'number' && rawMaxCtx > 0 ? rawMaxCtx : undefined;

  const rawLayers = modelObj?.total_layers;
  const totalLayers = typeof rawLayers === 'number' && rawLayers > 0 ? rawLayers : undefined;

  const filePath = modelObj?.path || clean;

  // Determine Model Family
  let modelFamily: 'text_llm' | 'diffusion_flow' | 'autoregressive_image' | 'pipeline_component' = 'text_llm';

  if (isComponent || mfRaw === 'pipeline_component') {
    modelFamily = 'pipeline_component';
  } else if (isArImage) {
    modelFamily = 'autoregressive_image';
  } else if (isDiffusion || mfRaw === 'diffusion_flow') {
    modelFamily = 'diffusion_flow';
  } else {
    modelFamily = 'text_llm';
  }

  return {
    rawId: rawId || modelObj?.id || '',
    cleanId: clean,
    displayName,
    basename,
    filePath,
    relativePath,
    modality,
    componentRole,
    format,
    architecture,
    params,
    publisher,
    quant,
    sizeDisplay,
    sizeBytes: modelObj?.size_bytes,
    modified,
    isVision,
    isMmproj,
    isDiffusion,
    isVideo,
    isMusic,
    isComponent,
    isToolUse,
    isReasoning,
    isEmbedding,
    maxContextLength,
    totalLayers,
    modelFamily
  };
}
