export interface ModelMetadata {
  rawId: string;
  cleanId: string;
  displayName: string;
  basename: string;
  filePath: string;
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
  isToolUse: boolean;
  isReasoning: boolean;
  isEmbedding: boolean;
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

  // Capabilities
  const isMmproj = basename.toLowerCase().startsWith('mmproj-') ||
    basename.toLowerCase().includes('-mmproj-') ||
    basename.toLowerCase().includes('clip_l') ||
    basename.toLowerCase().includes('t5xxl');

  const isDiffusion = !isMmproj && (
    /(sd[-_]?turbo|sd[-_]?1\.?5|sd[-_]?2|sd[-_]?xl|sd[-_]?3|stable[-_]?diffusion|flux|qwen[-_]?image|wan|hunyuan|cogvideo|pixart|auraflow|diffusion|diffusers)/i.test(basename) ||
    /(diffusion|diffusers|image[-_]?gen|text[-_]?to[-_]?image|stable[-_]?diffusion)/i.test(clean) ||
    (Boolean(modelObj?.architecture) && /(sd|sdxl|sd3|flux|diffusion|diffusers)/i.test(modelObj?.architecture || '')) ||
    (basename.toLowerCase().endsWith('.safetensors') && !basename.toLowerCase().includes('mmproj'))
  );

  const isVision = !isMmproj && !isDiffusion && (
    /(vl|vision|llava|clip)/i.test(basename) || /(vl|vision)/i.test(clean)
  );

  const isToolUse = !isMmproj && !isDiffusion && (
    /(it|instruct|chat|tool|heretic|neo|freedom|uncensored|agent)/i.test(basename) || /(it|instruct)/i.test(clean)
  );

  const isReasoning = !isMmproj && !isDiffusion && /(think|reason|freedom|r1|deepseek)/i.test(basename);
  const isEmbedding = /(embed|bge|nomic)/i.test(basename);

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

  const filePath = modelObj?.path || clean;

  return {
    rawId: rawId || modelObj?.id || '',
    cleanId: clean,
    displayName,
    basename,
    filePath,
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
    isToolUse,
    isReasoning,
    isEmbedding
  };
}
