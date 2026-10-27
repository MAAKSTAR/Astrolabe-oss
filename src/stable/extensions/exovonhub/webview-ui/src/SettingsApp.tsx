import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { getVsCodeApi } from './vscodeApi';

const vscodeApi = getVsCodeApi();

function extractModelMetadata(rawId: string, modelObj?: any) {
  const clean = (rawId || '').replace(/^local:/i, '');
  const basename = clean.split('/').pop() || clean;

  // Extract Params (e.g. 4x6B, 26B-A4B, 3.1B, 24B, 4B, 8B, 31B, 35B, 9B, 3B, 1B, etc.)
  let params = modelObj?.params || '';
  if (!params) {
    const pMatch = basename.match(/(\d+x\d+B|\d+B-A\d+B|\d+(?:\.\d+)?B)/i);
    if (pMatch) params = pMatch[1].toUpperCase();
  }

  // Extract Publisher (e.g. DavidAU, HauhauCS, Andycurrent, lmstudio-community, deepreinforce-ai, squ11z1, prithivMLmods, Nexlab, RHB56, bartowski, TheBloke, google, Qwen)
  let publisher = modelObj?.publisher || '';
  if (!publisher) {
    const segments = clean.split('/').filter(Boolean);
    const aiModelsIdx = segments.findIndex(s => s.toLowerCase().includes('model') || s.toLowerCase() === 'models');
    if (aiModelsIdx !== -1 && segments.length > aiModelsIdx + 1 && !segments[aiModelsIdx + 1].endsWith('.gguf')) {
      publisher = segments[aiModelsIdx + 1];
    } else if (segments.length >= 2 && !segments[segments.length - 2].toLowerCase().includes('model')) {
      publisher = segments[segments.length - 2];
    } else {
      const pubMatch = basename.match(/^(DavidAU|HauhauCS|Andycurrent|lmstudio-community|deepreinforce-ai|squ11z1|prithivMLmods|Nexlab|RHB56|bartowski|TheBloke|google|meta-llama|Qwen|Nexusflow|turboderp)/i);
      if (pubMatch) {
        publisher = pubMatch[1];
      } else {
        const parts = basename.split(/[-_]/);
        if (parts.length > 2 && !/^(qwen|gemma|llama|deepseek|mistral|vibe|mythos|ltx)/i.test(parts[0])) {
          publisher = parts[0];
        } else {
          publisher = 'Local';
        }
      }
    }
  }

  // Extract Quantization
  let quant = modelObj?.quantization || '';
  if (!quant) {
    const qMatch = basename.match(/(IQ[0-9]_[A-Z0-9_]+|Q[0-9]_[A-Z0-9_]+|Q[0-9]_[0-9]|F16|F32|BF16)/i);
    if (qMatch) quant = qMatch[1].toUpperCase();
    else quant = 'GGUF';
  }

  // Capabilities
  const isMmproj = basename.toLowerCase().startsWith('mmproj-') || basename.toLowerCase().includes('-mmproj-') || basename.toLowerCase().includes('clip_l') || basename.toLowerCase().includes('t5xxl');
  const isDiffusion = !isMmproj && (
    /(sd[-_]?turbo|sd[-_]?1\.?5|sd[-_]?2|sd[-_]?xl|sd[-_]?3|stable[-_]?diffusion|flux|qwen[-_]?image|wan|hunyuan|cogvideo|pixart|auraflow|diffusion|diffusers)/i.test(basename) ||
    /(diffusion|diffusers|image[-_]?gen|text[-_]?to[-_]?image|stable[-_]?diffusion)/i.test(clean) ||
    (Boolean(modelObj?.architecture) && /(sd|sdxl|sd3|flux|diffusion|diffusers)/i.test(modelObj?.architecture || '')) ||
    (basename.toLowerCase().endsWith('.safetensors') && !basename.toLowerCase().includes('mmproj'))
  );
  const isVision = !isMmproj && !isDiffusion && (/(vl|vision|llava|clip)/i.test(basename) || /(vl|vision)/i.test(clean));
  const isToolUse = !isMmproj && !isDiffusion && (/(it|instruct|chat|tool|heretic|neo|freedom|uncensored|agent)/i.test(basename) || /(it|instruct)/i.test(clean));
  const isReasoning = !isMmproj && !isDiffusion && /(think|reason|freedom|r1|deepseek)/i.test(basename);
  const isEmbedding = /(embed|bge|nomic)/i.test(basename);

  // Modified Time
  let modified = modelObj?.modified || modelObj?.mtime_display || '';
  if (!modified && modelObj?.mtime) {
    const diffMs = Date.now() - new Date(modelObj.mtime).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) modified = `${diffDays} days ago`;
    else if (diffHours > 0) modified = `${diffHours} hours ago`;
    else modified = 'Just now';
  }
  if (!modified) {
    modified = 'Recently';
  }

  return {
    name: basename,
    params,
    publisher,
    quant,
    isVision,
    isMmproj,
    isDiffusion,
    isToolUse,
    isReasoning,
    isEmbedding,
    modified
  };
}

function formatModelDisplayName(modelStr?: string): string {
  if (!modelStr) return '';
  let name = modelStr.replace(/^local:/i, '');
  const parts = name.split(/[\/]/);
  name = parts[parts.length - 1] || name;
  name = name.replace(/\.gguf$/i, '');
  return name;
}

export interface LocalModel {
  id: string;
  name?: string;
  size_display?: string;
  size_bytes?: number;
  max_context_length?: number;
  total_layers?: number;
  architecture?: string;
  quantization?: string;
  loaded?: boolean;
}

export interface ImageGenPipelineConfig {
  family: 'qwen-image' | 'flux' | 'sdxl' | 'sd15' | 'standalone' | 'other';
  familyTitle: string;
  architectureDescription: string;
  // Stage 1: Encoder / Conditioning
  encoderType: 'embedded' | 'mmproj' | 'clip_t5';
  encoderTitle: string;
  encoderStatus: 'auto-connected' | 'embedded' | 'missing';
  encoderPath: string;
  encoderFileDisplay: string;
  recommendedEncoderName: string;
  encoderDownloadUrl?: string;
  encoderDownloadSize?: string;
  // Stage 2: Diffusion Core (DiT / UNet)
  coreName: string;
  coreType: string;
  // Stage 3: VAE Latent-to-RGB Decoder
  vaeType: 'embedded' | 'external';
  vaeTitle: string;
  vaeStatus: 'auto-connected' | 'embedded' | 'missing';
  vaePath: string;
  vaeFileDisplay: string;
  recommendedVaeName: string;
  vaeDownloadUrl?: string;
  vaeDownloadSize?: string;
  // Summary
  isReady: boolean;
  statusSummary: string;
}

export function resolveImageGenPipeline(modelId: string, localModels: LocalModel[]): ImageGenPipelineConfig {
  const lower = (modelId || '').toLowerCase();
  const baseName = modelId ? (modelId.split('/').pop() || modelId) : '';

  // 1. QWEN-IMAGE Family
  if (lower.includes('qwen-image') || lower.includes('qwen_image')) {
    const companionEncoder = localModels.find(m => {
      const ml = m.id.toLowerCase();
      return (ml.includes('mmproj') || ml.includes('vl')) && (ml.includes('qwen') || ml.includes('qwen3') || ml.includes('qwen2'));
    });
    const companionVae = localModels.find(m => {
      const ml = m.id.toLowerCase();
      return ml.includes('vae') && (ml.includes('qwen') || ml.includes('qwen_image'));
    });

    const encStatus = companionEncoder ? 'auto-connected' : 'missing';
    const vaeStatus = companionVae ? 'auto-connected' : 'missing';

    return {
      family: 'qwen-image',
      familyTitle: 'Qwen-Image 2.1 (MMDiT)',
      architectureDescription: 'Multimodal Diffusion Transformer. Synchronizes dual-conditioning from Qwen-VL CLIP projector and high-fidelity VAE.',
      encoderType: 'mmproj',
      encoderTitle: 'Text & Visual Conditioning (Qwen3-VL CLIP)',
      encoderStatus: encStatus,
      encoderPath: companionEncoder ? companionEncoder.id : '',
      encoderFileDisplay: companionEncoder ? (companionEncoder.id.split('/').pop() || '') : 'mmproj-Qwen3-VL-8B-Instruct-F16.gguf',
      recommendedEncoderName: 'mmproj-Qwen3-VL-8B-Instruct-F16.gguf',
      encoderDownloadUrl: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3-VL-8B-Instruct-F16.gguf',
      encoderDownloadSize: '1.2 GB',
      coreName: baseName,
      coreType: 'Diffusion Backbone (DiT Transformer)',
      vaeType: 'external',
      vaeTitle: 'Variational Autoencoder (VAE)',
      vaeStatus: vaeStatus,
      vaePath: companionVae ? companionVae.id : 'qwen_image_2.1_vae_bf16.safetensors',
      vaeFileDisplay: companionVae ? (companionVae.id.split('/').pop() || '') : 'qwen_image_2.1_vae_bf16.safetensors',
      recommendedVaeName: 'qwen_image_2.1_vae_bf16.safetensors',
      vaeDownloadUrl: 'https://huggingface.co/Qwen/Qwen-Image-2.1/resolve/main/qwen_image_2.1_vae_bf16.safetensors',
      vaeDownloadSize: '480 MB',
      isReady: encStatus === 'auto-connected' && vaeStatus === 'auto-connected',
      statusSummary: (encStatus === 'auto-connected' && vaeStatus === 'auto-connected')
        ? 'All 3 components auto-detected and linked! Ready to synthesize.'
        : 'Missing required companion file. Click 1-Click Download to auto-install.'
    };
  }

  // 2. FLUX.1 Family (Schnell, Dev)
  if (lower.includes('flux')) {
    const companionEncoder = localModels.find(m => {
      if (m.id === modelId) return false;
      const ml = m.id.toLowerCase();
      return ml.includes('clip_l') || ml.includes('t5xxl') || ml.includes('flux-encoder');
    });
    const companionVae = localModels.find(m => {
      if (m.id === modelId) return false;
      const ml = m.id.toLowerCase();
      const base = ml.split(/[\/\\]/).pop() || '';
      return (base.startsWith('ae.') || base.includes('flux-vae') || base.includes('flux_vae') || (base.includes('vae') && !base.includes('flux3-image') && !base.includes('flux.1-') && !base.includes('flux1-') && !base.includes('flux-schnell') && !base.includes('flux-dev'))) && (ml.endsWith('.safetensors') || ml.endsWith('.gguf') || ml.endsWith('.sft'));
    });

    const encStatus = companionEncoder ? 'auto-connected' : 'missing';
    const vaeStatus = companionVae ? 'auto-connected' : 'missing';

    return {
      family: 'flux',
      familyTitle: 'FLUX.1 Flow Matching Transformer',
      architectureDescription: '12B parameter rectifier flow core. Requires ae.safetensors VAE and CLIP/T5 text tokens.',
      encoderType: 'clip_t5',
      encoderTitle: 'Text Encoder (CLIP-L / T5XXL)',
      encoderStatus: encStatus,
      encoderPath: companionEncoder ? companionEncoder.id : '',
      encoderFileDisplay: companionEncoder ? (companionEncoder.id.split(/[\/\\]/).pop() || '') : 'clip_l.safetensors',
      recommendedEncoderName: 'clip_l.safetensors',
      encoderDownloadUrl: 'https://huggingface.co/second-state/FLUX.1-dev-GGUF/resolve/main/clip_l.safetensors',
      encoderDownloadSize: '246 MB',
      coreName: baseName,
      coreType: 'FLUX Rectified Flow Core',
      vaeType: 'external',
      vaeTitle: 'FLUX 16-channel Autoencoder (ae.safetensors)',
      vaeStatus: vaeStatus,
      vaePath: companionVae ? companionVae.id : 'ae.safetensors',
      vaeFileDisplay: companionVae ? (companionVae.id.split(/[\/\\]/).pop() || '') : 'ae.safetensors',
      recommendedVaeName: 'ae.safetensors',
      vaeDownloadUrl: 'https://huggingface.co/second-state/FLUX.1-dev-GGUF/resolve/main/ae.safetensors',
      vaeDownloadSize: '335 MB',
      isReady: encStatus === 'auto-connected' && vaeStatus === 'auto-connected',
      statusSummary: (encStatus === 'auto-connected' && vaeStatus === 'auto-connected')
        ? 'FLUX core and companion weights linked!'
        : 'FLUX companion weights required.'
    };
  }

  // 3. SDXL Family
  if (lower.includes('sdxl') || lower.includes('xl')) {
    const companionVae = localModels.find(m => {
      const ml = m.id.toLowerCase();
      return ml.includes('sdxl') && ml.includes('vae');
    });

    return {
      family: 'sdxl',
      familyTitle: 'Stable Diffusion XL (SDXL)',
      architectureDescription: 'High-resolution latent diffusion UNet. Dual CLIP text encoders are integrated directly inside the checkpoint.',
      encoderType: 'embedded',
      encoderTitle: 'Dual CLIP Text Encoders',
      encoderStatus: 'embedded',
      encoderPath: '',
      encoderFileDisplay: 'Integrated inside Checkpoint (No extra file needed)',
      recommendedEncoderName: '',
      coreName: baseName,
      coreType: 'SDXL UNet Backbone',
      vaeType: companionVae ? 'external' : 'embedded',
      vaeTitle: 'SDXL 16-channel VAE',
      vaeStatus: companionVae ? 'auto-connected' : 'embedded',
      vaePath: companionVae ? companionVae.id : '',
      vaeFileDisplay: companionVae ? (companionVae.id.split('/').pop() || '') : 'Built-in Native VAE',
      recommendedVaeName: 'sdxl_vae.safetensors',
      vaeDownloadUrl: 'https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors',
      vaeDownloadSize: '335 MB',
      isReady: true,
      statusSummary: 'SDXL Checkpoint is self-contained. Ready for immediate generation.'
    };
  }

  // 4. SD 1.5 / Turbo / Standalone / Custom
  return {
    family: 'sd15',
    familyTitle: 'Stable Diffusion Standalone (All-In-One)',
    architectureDescription: 'Self-contained latent diffusion architecture. Text encoder and VAE decoder are completely baked inside this single file.',
    encoderType: 'embedded',
    encoderTitle: 'Text Encoder (CLIP-L)',
    encoderStatus: 'embedded',
    encoderPath: '',
    encoderFileDisplay: 'Baked inside Single Checkpoint (Zero setup required)',
    recommendedEncoderName: '',
    coreName: baseName,
    coreType: 'Latent Diffusion Core (UNet)',
    vaeType: 'embedded',
    vaeTitle: 'Variational Autoencoder (VAE)',
    vaeStatus: 'embedded',
    vaePath: '',
    vaeFileDisplay: 'Baked inside Single Checkpoint',
    recommendedVaeName: '',
    isReady: true,
    statusSummary: '100% Standalone: Single-file generation ready with zero external dependencies.'
  };
}

interface HfLiveModel {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  pipeline_tag?: string;
  tags?: string[];
}

interface HfModelDetails {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  pipeline_tag?: string;
  tags?: string[];
  gguf?: {
    architecture?: string;
    context_length?: number;
    total?: number;
  };
  cardData?: {
    license?: string;
    language?: string[];
    base_model?: string[];
  };
  siblings?: Array<{ rfilename: string; size?: number; lfs?: { size?: number; sha256?: string } }>;
}

interface LiveQuantOption {
  filename: string;
  quant: string;
  sizeGB: number;
  sizeDisplay: string;
  directUrl: string;
}

export interface UnifiedImagePack {
  id: string;
  title: string;
  badge: string;
  badgeColor: string;
  description: string;
  totalSize: string;
  targetVram: string;
  files: Array<{
    name: string;
    role: string;
    size: string;
    filename: string;
    url: string;
  }>;
}

export const VERIFIED_IMAGE_PACKS: UnifiedImagePack[] = [
  {
    id: 'sd15-turbo-all-in-one',
    title: 'SD 1.5 Turbo All-in-One Checkpoint',
    badge: 'LOW VRAM CHAMPION',
    badgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    description: 'Fully self-contained single checkpoint. UNet, CLIP Text Encoder, and VAE are 100% baked in. Generates crisp images in 4-8 steps with zero companion setup.',
    totalSize: '2.1 GB',
    targetVram: '4 GB - 8 GB VRAM / iGPU',
    files: [
      {
        name: 'SD 1.5 Turbo Standalone Checkpoint',
        role: 'Complete All-in-One Engine (Baked CLIP + VAE)',
        size: '2.1 GB',
        filename: 'sd-turbo-f16.gguf',
        url: 'https://huggingface.co/stabilityai/sd-turbo/resolve/main/sd_turbo.safetensors'
      }
    ]
  },
  {
    id: 'qwen-image-21-studio-pack',
    title: 'Qwen-Image 2.1 Complete Studio Pack',
    badge: 'PHOTOREAL MMDiT',
    badgeColor: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    description: 'State-of-the-art multimodal diffusion transformer. Unifies the DiT Core backbone, Qwen-VL CLIP Projector, and high-fidelity VAE into a synchronized 1-click download pack.',
    totalSize: '5.8 GB Total',
    targetVram: '8 GB - 16 GB VRAM',
    files: [
      {
        name: 'Qwen-Image 2.1 Core DiT',
        role: 'Diffusion Backbone Transformer',
        size: '4.1 GB',
        filename: 'Qwen-Image-2.1-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/Qwen/Qwen-Image-2.1-Instruct-GGUF/resolve/main/Qwen-Image-2.1-Instruct-Q4_K_M.gguf'
      },
      {
        name: 'Qwen3-VL Vision Text Projector',
        role: 'Prompt & Visual Conditioning Encoder',
        size: '1.2 GB',
        filename: 'mmproj-Qwen3-VL-8B-Instruct-F16.gguf',
        url: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3-VL-8B-Instruct-F16.gguf'
      },
      {
        name: 'Qwen-Image 2.1 Autoencoder VAE',
        role: 'Latent-to-RGB Pixel Decoder',
        size: '480 MB',
        filename: 'qwen_image_2.1_vae_bf16.safetensors',
        url: 'https://huggingface.co/Qwen/Qwen-Image-2.1/resolve/main/qwen_image_2.1_vae_bf16.safetensors'
      }
    ]
  },
  {
    id: 'flux-schnell-fast-pack',
    title: 'FLUX.1 Schnell Complete Flow Pack',
    badge: 'ULTRA FAST FLOW',
    badgeColor: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    description: 'Black Forest Labs 4-step rectified flow model. Bundles the quantized Schnell DiT transformer, CLIP-L text conditioner, and 16-channel autoencoder.',
    totalSize: '6.9 GB Total',
    targetVram: '8 GB - 16 GB VRAM',
    files: [
      {
        name: 'FLUX.1 Schnell DiT Core',
        role: 'Rectified Flow Transformer Backbone',
        size: '6.4 GB',
        filename: 'flux1-schnell-Q4_K_S.gguf',
        url: 'https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q4_K_S.gguf'
      },
      {
        name: 'CLIP-L Conditioner',
        role: 'Text Token Projector',
        size: '246 MB',
        filename: 'clip_l.safetensors',
        url: 'https://huggingface.co/second-state/FLUX.1-dev-GGUF/resolve/main/clip_l.safetensors'
      },
      {
        name: 'FLUX 16-Channel Autoencoder',
        role: 'Latent Space VAE',
        size: '335 MB',
        filename: 'ae.safetensors',
        url: 'https://huggingface.co/second-state/FLUX.1-dev-GGUF/resolve/main/ae.safetensors'
      }
    ]
  }
];

export type ModelModality = 'all' | 'llm' | 'image' | 'video' | 'voice' | 'audio';

export function getModelModalityInfo(m: HfLiveModel): { label: string; color: string } {
  const p = (m.pipeline_tag || '').toLowerCase();
  const id = m.id.toLowerCase();
  const tags = (m.tags || []).map(t => t.toLowerCase());

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

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'Recently';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
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

function renderProviderLogo(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.includes('qwen') || lower.includes('alibaba')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-300 flex-shrink-0">
        <span className="font-bold text-xs">Q</span>
      </div>
    );
  }
  if (lower.includes('meta') || lower.includes('llama')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-blue-400 flex-shrink-0">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16.994 6.002c-1.892 0-3.32 1.058-4.994 3.013C10.326 7.06 8.898 6.002 7.006 6.002 3.864 6.002 1.5 8.536 1.5 12c0 3.464 2.364 5.998 5.506 5.998 2.052 0 3.593-1.185 4.994-3.09 1.401 1.905 2.942 3.09 4.994 3.09 3.142 0 5.506-2.534 5.506-5.998 0-3.464-2.364-5.998-5.506-5.998zm0 9.77c-1.884 0-3.308-1.745-4.494-3.772 1.186-2.027 2.61-3.772 4.494-3.772 1.884 0 3.28 1.574 3.28 3.772 0 2.198-1.396 3.772-3.28 3.772zm-9.988 0c-1.884 0-3.28-1.574-3.28-3.772 0-2.198 1.396-3.772 3.28-3.772 1.884 0 3.308 1.745 4.494 3.772-1.186 2.027-2.61 3.772-4.494 3.772z"/>
        </svg>
      </div>
    );
  }
  if (lower.includes('google') || lower.includes('gemma')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center flex-shrink-0">
        <span className="font-bold text-xs text-amber-400">G</span>
      </div>
    );
  }
  if (lower.includes('deepseek')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-sky-400 flex-shrink-0">
        <span className="font-bold text-xs">DS</span>
      </div>
    );
  }
  if (lower.includes('mistral') || lower.includes('mixtral')) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-amber-500 flex-shrink-0">
        <span className="font-bold text-xs">M</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-400 flex-shrink-0 font-mono text-[10px] font-bold">
      HF
    </div>
  );
}

export default function SettingsApp() {
  const [activeTab, setActiveTab] = useState('Models');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [tokenQuota, setTokenQuota] = useState<number | string>('...');
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [membershipType, setMembershipType] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('Exovon Cloud Sync');
  const [email, setEmail] = useState<string | null>(null);
  const [usedPercentage, setUsedPercentage] = useState<number>(0);
  const [dailyLimit, setDailyLimit] = useState<number>(0);
  const [tokensUsed, setTokensUsed] = useState<number>(0);
  const [resetsIn, setResetsIn] = useState<string>('...');
  const [showQuotaDetails, setShowQuotaDetails] = useState<boolean>(false);

  const [isMaximized, setIsMaximized] = useState(false);

  interface ModelRate {
    id: string;
    displayName: string;
    requiresPro: boolean;
    tierColor: string;
    percentage: number;
  }
  const [modelRates, setModelRates] = useState<ModelRate[]>([]);  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'windowStateChanged') {
        setIsMaximized(!!message.isMaximized);
        return;
      }
      if (message.type === 'workspaceInfo') {
        setIsLoggedIn(message.isLoggedIn);
        setTokenQuota(message.tokenQuota);
        setProfilePic(message.profilePic || null);
        setMembershipType(message.membershipType || 'Free');
        setDisplayName(message.displayName || message.email || 'Astrolabe User');
        setEmail(message.email || null);
        if (message.usedPercentage !== undefined) setUsedPercentage(message.usedPercentage);
        if (message.dailyLimit !== undefined) setDailyLimit(message.dailyLimit);
        if (message.tokensUsed !== undefined) setTokensUsed(message.tokensUsed);
        if (message.resetsIn !== undefined) setResetsIn(message.resetsIn);
        
        if (message.modelRates) {
          setModelRates(message.modelRates);
        }
      } else if (message.type === 'settingsState') {
        // model state is now handled in App.tsx chat footer
      }
    };
    window.addEventListener('message', handleMessage);

    // Request initial state
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getWorkspaceInfo' });
      vscodeApi.postMessage({ command: 'getSettingsState' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  interface LocalModel {
    id: string;
    name?: string;
    size_display?: string;
    size_bytes?: number;
    max_context_length?: number;
    total_layers?: number;
    architecture?: string;
    quantization?: string;
    loaded?: boolean;
  }
  
  interface DownloadProgress {
    model_name: string;
    downloaded_bytes: number;
    total_bytes: number;
    percent: number;
    speed_bytes_per_sec?: number;
    speed_display?: string;
    eta_seconds?: number;
    status: string;
  }
  
  const [daemonRunning, setDaemonRunning] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<DownloadProgress[]>([]);
  const [activeLocalModel, setActiveLocalModel] = useState<string>('');
  const [inlineGhostModel, setInlineGhostModel] = useState<string>('');
  const [enableGhostText, setEnableGhostText] = useState<boolean>(true);
  const [localModelsDir, setLocalModelsDir] = useState<string>('~/.exovon/models');

  // Load Model Modal State
  const [loadModelModalOpen, setLoadModelModalOpen] = useState(false);
  const [selectedModelToLoad, setSelectedModelToLoad] = useState<string>('');
  const [loadBackend, setLoadBackend] = useState<'llama.cpp' | 'sglang' | 'stable-diffusion.cpp'>('llama.cpp');
  const [loadTarget, setLoadTarget] = useState<'primary' | 'ghost' | 'diffusion'>('primary');
  const [selectedMmprojPath, setSelectedMmprojPath] = useState<string>('');
  const [selectedVaePath, setSelectedVaePath] = useState<string>('');
  const [kvQuant, setKvQuant] = useState<'f16' | 'q8_0' | 'q4_0' | 'q5_0'>('q8_0');
  const [modelTemperature, setModelTemperature] = useState<number>(0.2);
  const [ctxSize, setCtxSize] = useState<number>(8192);
  const [nGPULayers, setNGPULayers] = useState<number>(33);
  const [nThreads, setNThreads] = useState<number>(4);
  const [nBatch, setNBatch] = useState<number>(2048);
  const [nUbatch, setNUbatch] = useState<number>(512);
  const [directGpuMemory, setDirectGpuMemory] = useState<boolean>(true);
  const [flashAttn, setFlashAttn] = useState<boolean>(true);
  const [maxTokens, setMaxTokens] = useState<number>(16384);

  // Dedicated Diffusion Engine States
  const [diffusionSteps, setDiffusionSteps] = useState<number>(20);
  const [diffusionCfgScale, setDiffusionCfgScale] = useState<number>(7.0);
  const [diffusionResolution, setDiffusionResolution] = useState<string>('1024x1024');
  const [diffusionVaeTiling, setDiffusionVaeTiling] = useState<boolean>(true);

  // Interactive Image Generation Studio States
  const [isImageStudioOpen, setIsImageStudioOpen] = useState<boolean>(false);
  const [imageStudioPrompt, setImageStudioPrompt] = useState<string>('Futuristic neon cyberpunk game asset, glowing style, 8k resolution');
  const [imageStudioSize, setImageStudioSize] = useState<string>('1024x1024');
  const [imageStudioSteps, setImageStudioSteps] = useState<number>(20);
  const [imageStudioCfg, setImageStudioCfg] = useState<number>(7.0);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [generatedImageB64, setGeneratedImageB64] = useState<string | null>(null);
  const [imageStudioError, setImageStudioError] = useState<string | null>(null);

  // System & Engine States
  const [isCheckingUpdates, setIsCheckingUpdates] = useState<boolean>(false);
  const [systemUpdateInfo, setSystemUpdateInfo] = useState<any>(null);

  // Live Model Loading Progress State
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadProgressPercent, setLoadProgressPercent] = useState<number>(0);
  const [loadStatusMessage, setLoadStatusMessage] = useState<string>('');

  const [daemonHealth, setDaemonHealth] = useState<any>(null);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);
  const [localModalityFilter, setLocalModalityFilter] = useState<'all' | 'llm' | 'vision' | 'image' | 'ghost'>('all');
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Live Hugging Face API States
  const [sidebarModelSearch, setSidebarModelSearch] = useState('');
  const [isModelHubOpen, setIsModelHubOpen] = useState(false);
  const [hubSearchQuery, setHubSearchQuery] = useState('');
  const [hubSortMode, setHubSortMode] = useState<'lastModified' | 'trendingScore' | 'downloads'>('lastModified');
  const [selectedModality, setSelectedModality] = useState<ModelModality>('all');
  const [liveModelsList, setLiveModelsList] = useState<HfLiveModel[]>([]);
  const [isLoadingModelsList, setIsLoadingModelsList] = useState(false);
  const [selectedHubModelId, setSelectedHubModelId] = useState<string>('');
  const [selectedModelDetails, setSelectedModelDetails] = useState<HfModelDetails | null>(null);
  const [modelReadme, setModelReadme] = useState<string>('');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [availableQuants, setAvailableQuants] = useState<LiveQuantOption[]>([]);
  const [selectedQuantIndex, setSelectedQuantIndex] = useState<number>(0);
  const [copiedRepoId, setCopiedRepoId] = useState(false);
  const [downloadConfirmDelete, setDownloadConfirmDelete] = useState<DownloadProgress | null>(null);
  const [huggingFaceToken, setHuggingFaceToken] = useState<string>('');
  const [useHfMirror, setUseHfMirror] = useState<boolean>(false);
  const [showHfToken, setShowHfToken] = useState<boolean>(false);
  const [isHfTokenSaved, setIsHfTokenSaved] = useState<boolean>(false);

  // Speed and ETA calculation helper
  const prevDownloadsRef = useRef<{ [key: string]: { bytes: number; time: number; speed: string; eta: string } }>({});

  const formatSpeedStr = (bytesPerSec: number): string => {
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    } else if (bytesPerSec >= 1024) {
      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    }
    return `${bytesPerSec.toFixed(0)} B/s`;
  };

  const formatEtaStr = (seconds: number): string => {
    if (seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };

  const getSpeedAndEta = (dl: DownloadProgress) => {
    if (dl.speed_display) {
      const eta = dl.eta_seconds ? formatEtaStr(dl.eta_seconds) : '';
      return { speed: dl.speed_display, eta };
    }

    const now = Date.now();
    const prev = prevDownloadsRef.current[dl.model_name];
    if (prev && (dl.status === 'downloading' || dl.status === 'starting')) {
      const timeDiff = (now - prev.time) / 1000;
      if (timeDiff >= 0.7) {
        const bytesDiff = dl.downloaded_bytes - prev.bytes;
        if (bytesDiff > 0) {
          const speedNum = bytesDiff / timeDiff;
          const speedStr = formatSpeedStr(speedNum);
          const remainingBytes = Math.max(0, dl.total_bytes - dl.downloaded_bytes);
          const etaSecs = speedNum > 0 ? remainingBytes / speedNum : 0;
          const etaStr = formatEtaStr(etaSecs);
          prevDownloadsRef.current[dl.model_name] = { bytes: dl.downloaded_bytes, time: now, speed: speedStr, eta: etaStr };
          return { speed: speedStr, eta: etaStr };
        }
      }
      return { speed: prev.speed || '', eta: prev.eta || '' };
    }

    prevDownloadsRef.current[dl.model_name] = { bytes: dl.downloaded_bytes, time: now, speed: '', eta: '' };
    return { speed: '', eta: '' };
  };

  // 1. Fetch live models list directly from Hugging Face API with modality routing
  const fetchLiveModels = async (
    sortMode: 'lastModified' | 'trendingScore' | 'downloads', 
    search?: string,
    modality: ModelModality = selectedModality
  ) => {
    setIsLoadingModelsList(true);
    try {
      let filterParam = 'filter=gguf';
      let defaultSearchTerm = '';

      switch (modality) {
        case 'llm':
          filterParam = 'pipeline_tag=text-generation&filter=gguf';
          break;
        case 'image':
          filterParam = 'pipeline_tag=text-to-image';
          if (!search?.trim()) defaultSearchTerm = 'flux';
          break;
        case 'video':
          filterParam = 'pipeline_tag=text-to-video';
          break;
        case 'voice':
          filterParam = 'pipeline_tag=automatic-speech-recognition';
          if (!search?.trim()) defaultSearchTerm = 'whisper';
          break;
        case 'audio':
          filterParam = 'pipeline_tag=text-to-audio';
          if (!search?.trim()) defaultSearchTerm = 'musicgen';
          break;
        case 'all':
        default:
          filterParam = 'filter=gguf';
          break;
      }

      const queryTerm = (search?.trim() || defaultSearchTerm).trim();
      let url = `https://huggingface.co/api/models?${filterParam}&sort=${sortMode}&direction=-1&limit=35`;
      if (queryTerm) {
        url = `https://huggingface.co/api/models?search=${encodeURIComponent(queryTerm)}&${filterParam}&sort=downloads&direction=-1&limit=35`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLiveModelsList(data);
          if (data.length > 0) {
            const firstId = data[0].id;
            setSelectedHubModelId(firstId);
            fetchModelDetails(firstId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch Hugging Face models:', err);
    } finally {
      setIsLoadingModelsList(false);
    }
  };

  // 2. Fetch live model details and real README from Hugging Face API
  const fetchModelDetails = async (modelId: string) => {
    if (!modelId) return;
    setIsLoadingDetails(true);
    setSelectedHubModelId(modelId);
    setSelectedQuantIndex(0);
    try {
      const [infoRes, readmeRes] = await Promise.all([
        fetch(`https://huggingface.co/api/models/${modelId}?blobs=true`),
        fetch(`https://huggingface.co/${modelId}/raw/main/README.md`)
      ]);

      if (infoRes.ok) {
        const info = await infoRes.json() as HfModelDetails;
        setSelectedModelDetails(info);

        // Extract real model weights siblings (.gguf, .safetensors, .onnx, .bin)
        const validFiles = (info.siblings || []).filter(s => {
          if (!s.rfilename) return false;
          const fn = s.rfilename.toLowerCase();
          return fn.endsWith('.gguf') || fn.endsWith('.safetensors') || fn.endsWith('.onnx') || fn.endsWith('.bin');
        });

        const quants: LiveQuantOption[] = validFiles.map(f => {
          const fn = f.rfilename;
          const quantMatch = fn.match(/(Q\d+_[A-Za-z0-9_]+|IQ\d+_[A-Za-z0-9_]+|F16|F32|Q8_0|Q4_0|Q4_1|Q5_0|Q5_1|BF16|NVFP4|FP8|FP4)/i);
          const extMatch = fn.match(/\.(safetensors|onnx|bin|gguf)$/i);
          const ext = extMatch ? extMatch[1].toUpperCase() : 'WEIGHTS';
          const quant = quantMatch ? quantMatch[1].toUpperCase() : ext;
          const rawBytes = f.lfs?.size || f.size || 0;
          let sizeGB = 0;
          let sizeDisplay = '';
          if (rawBytes > 0) {
            sizeGB = Number((rawBytes / (1024 * 1024 * 1024)).toFixed(2));
            if (sizeGB >= 1.0) {
              sizeDisplay = `${sizeGB} GB`;
            } else {
              const sizeMB = Number((rawBytes / (1024 * 1024)).toFixed(0));
              sizeDisplay = `${sizeMB} MB`;
            }
          } else {
            const paramMatch = (fn + ' ' + modelId).match(/(\d+(\.\d+)?B)/i);
            const param = paramMatch ? parseFloat(paramMatch[1]) : 7;
            sizeGB = Number((param * 0.58).toFixed(1));
            sizeDisplay = `~${sizeGB} GB`;
          }
          return {
            filename: fn,
            quant,
            sizeGB,
            sizeDisplay,
            directUrl: `https://huggingface.co/${modelId}/resolve/main/${fn}`
          };
        });

        // Fallback default quant if siblings list is empty
        if (quants.length === 0) {
          const baseName = modelId.split('/').pop() || 'model';
          quants.push({
            filename: `${baseName.toLowerCase()}-q4_k_m.gguf`,
            quant: 'Q4_K_M',
            sizeGB: 4.8,
            sizeDisplay: '4.8 GB',
            directUrl: `https://huggingface.co/${modelId}`
          });
        }

        setAvailableQuants(quants);
      }

      if (readmeRes.ok) {
        const rawReadme = await readmeRes.text();
        const cleanReadme = rawReadme.replace(/^---[\s\S]*?---/, '').trim();
        setModelReadme(cleanReadme || 'No README provided for this repository.');
      } else {
        setModelReadme('No README provided for this repository.');
      }
    } catch (err) {
      console.error('Failed to fetch model details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const openModelHubWithQuery = (query: string = '') => {
    setHubSearchQuery(query);
    setSidebarModelSearch(query);
    setIsModelHubOpen(true);
    fetchLiveModels(hubSortMode, query);
  };

  // Keyboard shortcut (Ctrl+F / Cmd+F) to focus filter input, Escape to close sub-windows/modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (activeTab === 'Models') {
          e.preventDefault();
          filterInputRef.current?.focus();
          filterInputRef.current?.select();
        }
      } else if (e.key === 'Escape') {
        if (activeActionMenuId) {
          setActiveActionMenuId(null);
        } else if (loadModelModalOpen) {
          setLoadModelModalOpen(false);
        } else if (isModelHubOpen) {
          setIsModelHubOpen(false);
        } else {
          vscodeApi?.postMessage({ command: 'closeSettings' });
        }
      } else if (e.key === 'F11') {
        e.preventDefault();
        vscodeApi?.postMessage({ command: 'toggleFullScreen' });
      }
    };

    const handleClickOutside = () => {
      setActiveActionMenuId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [activeTab, activeActionMenuId, loadModelModalOpen, isModelHubOpen]);

  useEffect(() => {
    // Request initial daemon status and local models config
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getDaemonStatus' });
    }
  }, []);

  const [localSystemPrompt, setLocalSystemPrompt] = useState<string>('');
  const [isPromptSaved, setIsPromptSaved] = useState<boolean>(false);

  useEffect(() => {
    const handleEvents = (event: MessageEvent) => {
      if (event.data.type === 'daemonStatus') {
        setDaemonRunning(event.data.isRunning);
      } else if (event.data.type === 'localModels') {
        setLocalModels(event.data.models || []);
      } else if (event.data.type === 'settingsState') {
        if (event.data.localLlmModelName) setActiveLocalModel(event.data.localLlmModelName);
        if (event.data.localModelsDirectory) setLocalModelsDir(event.data.localModelsDirectory);
        if (event.data.inlineGhostModel !== undefined) setInlineGhostModel(event.data.inlineGhostModel);
        if (event.data.enableGhostText !== undefined) setEnableGhostText(event.data.enableGhostText);
        if (event.data.localModelSystemPrompt !== undefined) {
          setLocalSystemPrompt(event.data.localModelSystemPrompt);
          setIsPromptSaved(false);
        }
        if (event.data.huggingFaceToken !== undefined) {
          setHuggingFaceToken(event.data.huggingFaceToken);
          setIsHfTokenSaved(true);
        }
        if (event.data.useHfMirror !== undefined) {
          setUseHfMirror(event.data.useHfMirror);
        }
      } else if (event.data.type === 'inlineGhostModelUpdated') {
        setInlineGhostModel(event.data.model);
      } else if (event.data.type === 'ghostTextToggled') {
        setEnableGhostText(event.data.enabled);
      } else if (event.data.type === 'modelLoadProgress') {
        setLoadingModelId(event.data.modelId);
        setLoadProgressPercent(event.data.percent || 0);
        setLoadStatusMessage(event.data.message || 'Loading model...');
      } else if (event.data.type === 'modelLoaded') {
        setLoadingModelId(null);
        setLoadProgressPercent(100);
        setLoadStatusMessage('');
        vscodeApi?.postMessage({ command: 'getLocalModels' });
      } else if (event.data.type === 'modelLoadError') {
        setLoadingModelId(null);
        setLoadProgressPercent(0);
        setLoadStatusMessage('');
        vscodeApi?.postMessage({ command: 'getLocalModels' });
      } else if (event.data.type === 'modelUnloaded') {
        setActiveLocalModel('');
        vscodeApi?.postMessage({ command: 'getLocalModels' });
        vscodeApi?.postMessage({ command: 'getDaemonHealth' });
      } else if (event.data.type === 'daemonHealth') {
        setDaemonHealth(event.data.health);
        if (!event.data.health?.active_model) {
          setActiveLocalModel('');
        } else {
          setActiveLocalModel(event.data.health.active_model);
        }
      } else if (event.data.type === 'activeDownloads') {
        setActiveDownloads(event.data.downloads || []);
      } else if (event.data.type === 'imageGenerationResult') {
        setIsGeneratingImage(false);
        if (event.data.success && event.data.data) {
          setGeneratedImageB64(event.data.data);
          setImageStudioError(null);
        } else {
          setImageStudioError(event.data.error || 'Failed to synthesize visual asset.');
        }
      } else if (event.data.type === 'systemUpdateStatus') {
        setIsCheckingUpdates(false);
        setSystemUpdateInfo(event.data);
      }
    };
    window.addEventListener('message', handleEvents);
    return () => window.removeEventListener('message', handleEvents);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setTimeout>;
    if ((activeTab === 'Models' || activeTab === 'System') && vscodeApi) {
      vscodeApi.postMessage({ command: 'getLocalModels' });
      
      interval = setInterval(() => {
        if (daemonRunning) {
          vscodeApi.postMessage({ command: 'getDaemonHealth' });
          vscodeApi.postMessage({ command: 'getActiveDownloads' });
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab, daemonRunning]);

    const navTabs = [
      { id: 'Models', label: 'Models' },
      { id: 'System', label: 'System & Engine' },
      { id: 'Account', label: 'Account' },
      { id: 'Agent', label: 'Agent' },
      { id: 'Quota', label: 'Quota' },
      { id: 'Notifications', label: 'Notifications' },
      { id: 'Customizations', label: 'Appearance' },
      { id: 'Browser', label: 'Browser' },
    ];

    const getTabDescription = (tab: string) => {
      switch (tab) {
        case 'Models':
          return 'Manage active loaded models, browse local model cards, and explore unified model packs.';
        case 'System':
          return 'Inference daemon health, hardware acceleration telemetry, and models directory configuration.';
        case 'Agent':
          return 'Configure agent execution, autonomous permissions, and model constitutions.';
        case 'Account':
          return 'Manage your account profile, plan credentials, and cloud synchronization.';
        case 'Quota':
          return 'Daily compute quotas and relative inference burn rates.';
        case 'Notifications':
          return 'Desktop alerts, audio feedback, and verbose thinking loop settings.';
        case 'Customizations':
          return 'Editor theme styling, glassmorphic UI, and syntax settings.';
        case 'Browser':
          return 'Configure browser automation, search providers, and web access rules.';
        default:
          return 'Configure Astrolabe workspace and local AI preferences.';
      }
    };

    const isElectronWindow = typeof window !== 'undefined' && !!(window as any).__IS_ELECTRON__;

    return (
      <div 
        className={`w-screen h-screen flex items-center justify-center overflow-hidden font-sans select-none ${
          isElectronWindow 
            ? (isMaximized ? 'bg-transparent p-0' : 'bg-transparent p-2 sm:p-3') 
            : 'fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 sm:p-6 md:p-8'
        }`}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isElectronWindow) {
            vscodeApi?.postMessage({ command: 'closeSettings' });
          }
        }}
      >
        <div 
          className={`w-full h-full bg-[#1a1a1c] shadow-2xl flex overflow-hidden relative text-zinc-100 transition-all duration-150 ${
            isMaximized ? 'rounded-none border-none' : 'rounded-[28px] border border-white/10'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left Navigation Sidebar */}
        <div className="w-56 sm:w-64 bg-[#141416] border-r border-white/10 flex flex-col justify-between shrink-0 overflow-y-auto">
          {/* Top Navigation Items */}
          <div className="p-4 space-y-4">
            <div className="window-drag h-6 flex items-center cursor-move">
              <h1 className="text-xs font-bold text-zinc-400 uppercase tracking-widest px-2 pointer-events-none">Settings</h1>
            </div>

            {/* Main Tabs Group */}
            <div className="window-no-drag space-y-1">
                {navTabs.map(item => (
                  <button
                    key={item.id}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center justify-between ${
                      activeTab === item.id 
                        ? 'bg-white/10 text-white font-semibold shadow-sm border border-white/10' 
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Sidebar Search Bar for Models */}
              <div className="pt-2 border-t border-white/5">
                <div className="relative mb-2">
                  <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input 
                    type="text"
                    placeholder="Search Hub..."
                    value={sidebarModelSearch}
                    onChange={(e) => setSidebarModelSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        openModelHubWithQuery(sidebarModelSearch);
                      }
                    }}
                    onClick={() => {
                      if (!isModelHubOpen) {
                        openModelHubWithQuery(sidebarModelSearch);
                      }
                    }}
                    className="w-full bg-zinc-950/80 border border-white/10 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-sky-500/50 transition-all"
                  />
                </div>
                <button
                  onClick={() => openModelHubWithQuery('')}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 border border-white/5 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span>Discover Models</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Hub</span>
                </button>
              </div>

              {/* IDE Core Quick Links */}
              <div className="pt-2 border-t border-white/5">
                <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 px-2">IDE Core</h2>
                <div className="space-y-0.5">
                  <button
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 flex items-center justify-between transition-colors"
                    onClick={() => vscodeApi?.postMessage({ command: 'openNativeSettings' })}
                  >
                    <span>Settings (UI)</span>
                  </button>
                  <button
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 flex items-center justify-between transition-colors"
                    onClick={() => vscodeApi?.postMessage({ command: 'openKeybindings' })}
                  >
                    <span>Keyboard Shortcuts</span>
                  </button>
                  <button
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 flex items-center justify-between transition-colors"
                    onClick={() => vscodeApi?.postMessage({ command: 'selectTheme' })}
                  >
                    <span>Color Theme</span>
                  </button>
                  <button
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 flex items-center justify-between transition-colors"
                    onClick={() => vscodeApi?.postMessage({ command: 'showCommandPalette' })}
                  >
                    <span>Command Palette</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom: User Profile Card */}
            <div className="p-3 border-t border-white/10 bg-[#0f0f12]">
              <div 
                onClick={() => setActiveTab('Account')}
                className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
              >
                {isLoggedIn && profilePic ? (
                  <img src={profilePic} alt="Profile" className="w-8 h-8 rounded-full border border-white/15 object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 text-zinc-300 flex items-center justify-center font-bold text-xs shrink-0">
                    {displayName ? displayName.charAt(0).toUpperCase() : 'A'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{isLoggedIn ? displayName : 'Astrolabe User'}</p>
                  <p className="text-[10px] text-zinc-500 truncate font-mono">{email || 'Local Mode'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#1a1a1c] overflow-hidden">
            {/* Header Bar */}
            <div 
              className="window-drag px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#1a1a1c] cursor-move select-none"
              onDoubleClick={() => {
                vscodeApi?.postMessage({ command: 'toggleMaximizeSettings' });
                setIsMaximized(prev => !prev);
              }}
            >
              <div className="pointer-events-none">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  {activeTab === 'System' ? 'System & Engine' : activeTab === 'Customizations' ? 'Appearance' : activeTab}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">{getTabDescription(activeTab)}</p>
              </div>
              
              <div className="window-no-drag flex items-center gap-1.5">
                <button 
                  onClick={() => vscodeApi?.postMessage({ command: 'getWorkspaceInfo' })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer mr-1"
                >
                  Refresh
                </button>
                {/* Minimize Button */}
                <button
                  onClick={() => vscodeApi?.postMessage({ command: 'minimizeSettings' })}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="Minimize"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                {/* Maximize / Restore Button */}
                <button
                  onClick={() => {
                    vscodeApi?.postMessage({ command: 'toggleMaximizeSettings' });
                    setIsMaximized(prev => !prev);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title={isMaximized ? "Restore Window" : "Maximize / Fullscreen"}
                >
                  {isMaximized ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                    </svg>
                  )}
                </button>
                {/* Close "X" Button */}
                <button
                  onClick={() => vscodeApi?.postMessage({ command: 'closeSettings' })}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="Close Settings (Esc)"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable Tab Body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 w-full min-w-0">

        {activeTab === 'Quota' && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Model Quota</h3>
              <div 
                className="glass-panel-dark rounded-2xl p-6 cursor-pointer border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group shadow-2xl"
                onClick={() => setShowQuotaDetails(!showQuotaDetails)}
              >
                {/* Background ambient glow based on usage */}
                <div 
                  className={`absolute inset-0 opacity-10 transition-colors duration-700 ${usedPercentage > 90 ? 'bg-red-500' : usedPercentage > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                ></div>

                <div className="p-8 flex flex-col items-center justify-center relative z-10">
                  {/* Circular Progress Ring */}
                  <div className="relative w-48 h-48 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      {/* Background Track */}
                      <circle 
                        cx="50" cy="50" r="42" 
                        fill="transparent" 
                        stroke="#27272a" 
                        strokeWidth="8" 
                      />
                      {/* Progress Ring */}
                      <circle 
                        cx="50" cy="50" r="42" 
                        fill="transparent" 
                        stroke={usedPercentage > 90 ? '#ef4444' : usedPercentage > 75 ? '#f59e0b' : '#10b981'} 
                        strokeWidth="8" 
                        strokeLinecap="round"
                        strokeDasharray="263.89"
                        strokeDashoffset={263.89 - (263.89 * Math.min(100, usedPercentage)) / 100}
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    
                    {/* Inner Content */}
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-white tracking-tight">
                        {usedPercentage.toFixed(1)}<span className="text-lg text-zinc-500">%</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Used</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 mt-6 flex items-center gap-2 group-hover:text-zinc-300 transition-colors">
                    <span>Tap to {showQuotaDetails ? 'hide' : 'view'} details</span>
                    <svg className={`w-3 h-3 transition-transform duration-300 ${showQuotaDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </p>
                </div>

                {/* Expanded Details */}
                <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showQuotaDetails ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="p-6 bg-zinc-900/50 flex flex-col gap-4">
                    <div className="flex justify-between items-center pb-3 border-b border-zinc-800/50">
                      <span className="text-sm text-zinc-400">Remaining Balance</span>
                      <span className="text-emerald-400 font-mono text-lg font-medium">{tokenQuota}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-zinc-800/50">
                      <span className="text-sm text-zinc-400">Tokens Used</span>
                      <span className="text-zinc-200 font-mono">{tokensUsed.toLocaleString()} / {dailyLimit.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-400">Quota Resets In</span>
                      <span className="text-zinc-200 font-mono text-sm">{resetsIn}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {activeTab === 'Account' && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Profile</h3>
              <div className="glass-panel-dark rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    {isLoggedIn && profilePic ? (
                      <img src={profilePic} alt="Profile" className="w-16 h-16 rounded-full border-2 border-white/10 object-cover shadow-lg" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-white/5 shadow-lg">
                        <svg className="w-7 h-7 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      </div>
                    )}
                    <div>
                      <div className="flex flex-col">
                        <h4 className="text-lg font-semibold text-white tracking-wide">{isLoggedIn ? displayName : 'Astrolabe User'}</h4>
                        {isLoggedIn && email && displayName !== email && (
                          <span className="text-[10px] text-zinc-500 font-mono tracking-wider">{email}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-md border border-white/5">
                          <span className={`w-1.5 h-1.5 rounded-full ${isLoggedIn ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{isLoggedIn ? 'Online' : 'Offline'}</span>
                        </div>
                        {isLoggedIn && membershipType && (
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 text-[10px] font-bold text-sky-400 uppercase tracking-widest">
                              {membershipType.replace(' + Hosting', '')} Plan
                            </span>
                            <span className={`px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${membershipType.toLowerCase().includes('hosting') ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500'}`}>
                              {membershipType.toLowerCase().includes('hosting') ? 'Hosting Enabled' : 'No Hosting'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {isLoggedIn ? (
                      <button
                        onClick={() => vscodeApi?.postMessage({ command: 'logout' })}
                        className="bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-all active:scale-95"
                      >
                        Sign Out
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => vscodeApi?.postMessage({ command: 'pasteAuthToken' })}
                          className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
                        >
                          Paste Token
                        </button>
                        <button
                          onClick={() => vscodeApi?.postMessage({ command: 'login' })}
                          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-500 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                        >
                          Sign In via Web
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Tiers Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Available Upgrades</h3>
                <span className="text-[10px] text-zinc-500">Billed via exovon.in/payments</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Free Plan */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-5 flex flex-col justify-between hover:border-white/10 transition-colors">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Free</h4>
                    <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Basic agent access. No edge hosting included.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'free' })} className="mt-6 w-full py-2 rounded-lg text-xs font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors">Current Plan</button>
                </div>

                {/* Pro Plan */}
                <div className="bg-zinc-900/30 border border-sky-500/20 rounded-2xl p-5 flex flex-col justify-between hover:border-sky-500/40 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/10 blur-2xl rounded-full group-hover:bg-sky-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <h4 className="text-sm font-bold text-sky-400 uppercase tracking-widest">Astrolabe Pro</h4>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Advanced reasoning models and unlimited local context.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'pro' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-900/20 transition-colors">Upgrade to Pro</button>
                </div>

                {/* Pro + Hosting Plan */}
                <div className="bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 border border-blue-500/30 rounded-2xl p-5 flex flex-col justify-between hover:border-blue-500/50 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 blur-2xl rounded-full group-hover:bg-blue-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-white uppercase tracking-widest">Pro</h4>
                      <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded uppercase tracking-wider">+ Hosting</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Everything in Pro, plus 1-click global edge hosting deployments.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'pro_hosting' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-colors">Upgrade to Pro+Hosting</button>
                </div>

                {/* Enterprise Plan */}
                <div className="bg-zinc-900/30 border border-amber-500/20 rounded-2xl p-5 flex flex-col justify-between hover:border-amber-500/40 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 blur-2xl rounded-full group-hover:bg-amber-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <h4 className="text-sm font-bold text-amber-400 uppercase tracking-widest">Enterprise</h4>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Custom fine-tuning and organizational vector databases.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'enterprise' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-900/20 transition-colors">Upgrade to Enterprise</button>
                </div>

                {/* Enterprise + Hosting Plan */}
                <div className="bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 border border-emerald-500/30 rounded-2xl p-5 flex flex-col justify-between hover:border-emerald-500/50 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 blur-2xl rounded-full group-hover:bg-emerald-500/20 transition-all"></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-amber-400 uppercase tracking-widest">Enterprise</h4>
                      <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded uppercase tracking-wider">+ Hosting</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">Complete organization suite with dedicated edge fleet nodes.</p>
                  </div>
                  <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass', tier: 'enterprise_hosting' })} className="relative z-10 mt-6 w-full py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition-colors">Upgrade to Enterprise+Hosting</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Quota' && (
          <div className="space-y-6">
            <div className="glass-panel-dark rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-3xl rounded-full"></div>
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center justify-between relative z-10">
                <span>Daily Compute Quota</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">Resets at Midnight</span>
              </h3>
              
              {/* Progress Bar */}
              <div className="mb-8 relative z-10">
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-black text-white tracking-tighter">0%</span>
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Used</span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-3 border border-white/5 overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all" style={{ width: '0%' }}></div>
                </div>
              </div>

              {/* Model Burn Rates */}
              <div className="space-y-3 relative z-10">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Daily API Burn Rate (Relative to Free Quota)</h4>
                
                {modelRates && modelRates.length > 0 ? (
                  modelRates.map((m: ModelRate) => (
                    <div key={m.id} className={`flex items-center justify-between p-3 rounded-xl bg-${m.tierColor}-500/5 border border-${m.tierColor}-500/10 relative overflow-hidden group`}>
                      <div className="flex items-center gap-3 relative z-10">
                        <div className={`w-2 h-2 rounded-full bg-${m.tierColor}-500 shadow-[0_0_10px_rgba(var(--tw-colors-${m.tierColor}-500),0.8)]`}></div>
                        <span className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                          {m.displayName}
                          {m.requiresPro && (
                            <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider border border-amber-500/20">Pro</span>
                          )}
                        </span>
                      </div>
                      <span className={`text-xs font-black text-${m.tierColor}-400 tracking-wider relative z-10`}>{m.percentage}%</span>
                      {/* Hover effect background */}
                      <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-${m.tierColor}-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700`}></div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center border border-dashed border-white/10 rounded-xl">
                    <p className="text-xs text-zinc-500 animate-pulse">Syncing dynamic quota rates from Exovon Cloud...</p>
                  </div>
                )}
              </div>

              <div className="mt-8 flex justify-center relative z-10">
                <button onClick={() => vscodeApi?.postMessage({ command: 'buyProPass' })} className="px-6 py-2.5 rounded-lg text-xs font-bold text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 shadow-lg transition-all active:scale-95 flex items-center gap-2">
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Upgrade Monthly Base Plan
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Agent' && (
          <div className="space-y-6">
            {/* 1. Local Agent System Instruction Editor */}
            <div className="glass-panel-dark rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-wide uppercase">Local Model System Instruction</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">Model-aware agent instructions for local SLMs & LLMs (Qwen 2.5 Coder, Llama 3, DeepSeek, Gemma).</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
                    Math.round(localSystemPrompt.length / 3.8) <= 650 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    ~{Math.round(localSystemPrompt.length / 3.8)} tokens {Math.round(localSystemPrompt.length / 3.8) <= 650 ? '(Calibrated 500-600)' : '(High)'}
                  </span>
                </div>
              </div>

              <p className="text-xs text-zinc-500 mb-3">
                A compact, structured prompt (~500-600 tokens) preserves 90%+ of your local model's KV context for code, enforces deterministic tool calling, and eliminates hallucinations.
              </p>

              <textarea 
                className="w-full h-80 bg-zinc-950 border border-white/10 rounded-xl p-4 text-xs font-mono text-zinc-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all resize-y leading-relaxed"
                value={localSystemPrompt}
                onChange={e => {
                  setLocalSystemPrompt(e.target.value);
                  setIsPromptSaved(false);
                }}
                placeholder="Enter local model system instructions..."
              ></textarea>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {isPromptSaved && (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Instruction saved successfully
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'resetLocalModelSystemPrompt' });
                      }
                    }}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-white/5 transition-all"
                  >
                    Reset to Default
                  </button>
                  <button 
                    onClick={() => {
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'updateLocalModelSystemPrompt', prompt: localSystemPrompt });
                        setIsPromptSaved(true);
                      }
                    }}
                    className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-sky-600/30 transition-all flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    Save Instruction
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Agent Behaviors & Autonomous Mode */}
            <div className="glass-panel-dark rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Agent Behaviors
              </h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Autonomous Execution Mode</h4>
                    <p className="text-xs text-zinc-500 mt-1">Allow agent to run safe terminal commands without asking.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">System Constitution</h4>
                  <p className="text-xs text-zinc-500 mb-4">Provide global custom instructions the agent must strictly follow across all workspaces.</p>
                  <textarea 
                    className="w-full h-32 bg-zinc-950 border border-white/10 rounded-xl p-4 text-sm text-zinc-300 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all resize-none font-mono text-xs"
                    placeholder="e.g. Always use functional React components. Never use Tailwind unless requested..."
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Notifications' && (
          <div className="space-y-6">
            <div className="glass-panel-dark rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                Alerts & Logging
              </h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Task Completion Sounds</h4>
                    <p className="text-xs text-zinc-500 mt-1">Play a subtle chime when the agent finishes executing a plan.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Desktop Push Notifications</h4>
                    <p className="text-xs text-zinc-500 mt-1">Receive OS-level notifications for critical agent errors or success.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Verbose Thinking Loops</h4>
                    <p className="text-xs text-zinc-500 mt-1">Show full background reasoning logs in the chat interface.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Customizations' && (
          <div className="space-y-6">
            <div className="glass-panel-dark rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
                Appearance
              </h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Chat UI Theme</h4>
                  <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm text-zinc-300 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none appearance-none cursor-pointer">
                    <option>Astrolabe Glass (Default)</option>
                    <option>Midnight Obsidian</option>
                    <option>VSCodium Native</option>
                  </select>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Code Block Font Size</h4>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500">Small</span>
                    <input type="range" min="10" max="18" defaultValue="13" className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-pink-500" />
                    <span className="text-xs text-zinc-500">Large</span>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-300">Glassmorphic Micro-Animations</h4>
                    <p className="text-xs text-zinc-500 mt-1">Disable to save GPU resources on low-end machines.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Browser' && (
          <div className="space-y-6">
            <div className="glass-panel-dark rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                Agent Web Tools
              </h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Default Search Engine</h4>
                  <p className="text-xs text-zinc-500 mb-4">The engine the agent uses when performing internet research.</p>
                  <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm text-zinc-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none appearance-none cursor-pointer">
                    <option>Google Search (Recommended)</option>
                    <option>DuckDuckGo</option>
                    <option>Bing Search</option>
                  </select>
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="text-sm font-bold text-zinc-300 mb-2">Browser Automation Engine</h4>
                  <p className="text-xs text-zinc-500 mb-4">How the agent loads websites internally.</p>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-orange-500/30 bg-orange-500/10 cursor-pointer">
                      <input type="radio" name="browser" defaultChecked className="w-4 h-4 text-orange-500 bg-zinc-900 border-white/20 focus:ring-orange-500 focus:ring-2" />
                      <div>
                        <span className="block text-sm font-bold text-orange-400">Headless Chrome (Native)</span>
                        <span className="block text-xs text-zinc-400">Fast, invisible background execution.</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-zinc-950 hover:border-white/20 transition-colors cursor-pointer">
                      <input type="radio" name="browser" className="w-4 h-4 text-orange-500 bg-zinc-900 border-white/20 focus:ring-orange-500 focus:ring-2" />
                      <div>
                        <span className="block text-sm font-bold text-zinc-300">System Webview</span>
                        <span className="block text-xs text-zinc-500">Opens a visible window. Best for debugging.</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'System' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header Telemetry */}
            <div className="bg-[#141416] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 relative z-10">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                    <svg className="w-4 h-4 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                    Multi-Engine Port Architecture
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Isolated local process microservices powering text completion, tool-use agents, and visual synthesis.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2.5 py-1 rounded-md border font-mono font-medium ${daemonRunning ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-zinc-500 bg-zinc-800 border-zinc-700'}`}>
                    {daemonRunning ? 'CLUSTER ONLINE' : 'CLUSTER OFFLINE'}
                  </span>
                </div>
              </div>

              {/* Three Service Port Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 relative z-10 mb-6">
                {/* 1. Gateway Daemon: Port 47990 */}
                <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Core Daemon Gateway</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        PORT 47990
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-zinc-100 font-mono">
                      http://127.0.0.1:47990
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                      Orchestration API, aria2c 8-channel parallel download accelerator, and memory governance.
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-zinc-500">Status</span>
                    <span className={daemonRunning ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
                      {daemonRunning ? 'Active & Routing' : 'Offline'}
                    </span>
                  </div>
                </div>

                {/* 2. Text Inference (LLM): Port 47991 */}
                <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Primary LLM Server</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        PORT 47991
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-zinc-100 font-mono truncate" title={activeLocalModel || 'Idle'}>
                      {activeLocalModel ? formatModelDisplayName(activeLocalModel) : 'Idle (No Model Loaded)'}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                      {daemonHealth?.hardware?.gpu?.toLowerCase().includes('nvidia') ? 'SGLang CUDA engine' : 'llama.cpp Vulkan engine'} with OpenAI-compatible completions.
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-zinc-500">Context Window</span>
                    <span className="text-zinc-300 font-semibold">
                      {daemonHealth?.ctx_size ? `${Math.round(daemonHealth.ctx_size / 1024)}K Tokens` : '8K Tokens'}
                    </span>
                  </div>
                </div>

                {/* 3. Dedicated Diffusion Engine: Port 47992 */}
                <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Visual Synthesis Engine</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                        PORT 47992
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-zinc-100 font-mono truncate" title={daemonHealth?.active_diffusion_model || 'sd-turbo-f16'}>
                      {daemonHealth?.active_diffusion_model ? formatModelDisplayName(daemonHealth.active_diffusion_model) : 'sd-turbo-f16 (Ready)'}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                      Dedicated multimodal diffusion worker (DiT / UNet / VAE) running text-to-image synthesis.
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono">Slot 3</span>
                    <button
                      type="button"
                      onClick={() => setIsImageStudioOpen(true)}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 transition-all flex items-center gap-1 cursor-pointer"
                    >
                      Launch Studio
                    </button>
                  </div>
                </div>
              </div>

              {/* Daemon Process Control Actions */}
              <div className="flex flex-wrap gap-2.5 pt-4 border-t border-white/5 relative z-10">
                {!daemonRunning ? (
                  <button 
                    onClick={() => vscodeApi?.postMessage({ command: 'startDaemon' })}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-white hover:bg-zinc-200 shadow-md transition-colors cursor-pointer"
                  >
                    Start Local Engine Cluster
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => vscodeApi?.postMessage({ command: 'stopDaemon' })}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors cursor-pointer"
                    >
                      Stop Engines
                    </button>
                    <button 
                      onClick={() => {
                        vscodeApi?.postMessage({ command: 'stopDaemon' });
                        setTimeout(() => vscodeApi?.postMessage({ command: 'startDaemon' }), 1000);
                      }}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/5 transition-colors cursor-pointer"
                    >
                      Restart Cluster
                    </button>
                  </>
                )}
                <button
                  onClick={() => setIsImageStudioOpen(true)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Open Image Studio
                </button>
              </div>

              {/* Detected Hardware Grid */}
              {daemonRunning && daemonHealth?.hardware && (
                <div className="border-t border-white/5 pt-5 mt-5">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-3">Detected Hardware Acceleration</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">CPU</p>
                      <p className="text-xs text-zinc-200 font-mono truncate">{daemonHealth.hardware.cpu}</p>
                    </div>
                    <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Memory</p>
                      <p className="text-xs text-zinc-200 font-mono">
                        {daemonHealth.hardware.used_memory_gb ? `${daemonHealth.hardware.used_memory_gb.toFixed(1)} GB / ` : ''}
                        {daemonHealth.hardware.memory_gb.toFixed(1)} GB
                      </p>
                    </div>
                    <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">GPU / Accelerator</p>
                      <p className="text-xs text-emerald-400 font-mono font-medium truncate">{daemonHealth.hardware.gpu}</p>
                    </div>
                    <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Thermal Telemetry</p>
                      <p className="text-xs text-zinc-200 font-mono">
                        {daemonHealth.hardware.max_temp ? `${daemonHealth.hardware.max_temp.toFixed(1)}°C` : 'Optimal'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Production Download Accelerator & Priority CDN Suite */}
            <div className="bg-[#141416] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Production Download Accelerator & Priority CDN
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    16-channel concurrent chunking, fallback-resilient edge routing, and Hugging Face token authentication.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] px-2.5 py-1 rounded-md border font-mono font-semibold ${
                    huggingFaceToken.trim() || useHfMirror
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {huggingFaceToken.trim() ? '⚡ PRIORITY CDN UNLOCKED' : useHfMirror ? '⚡ REGIONAL MIRROR ACTIVE' : '⚠️ ANONYMOUS CDN (~1 MB/s)'}
                  </span>
                </div>
              </div>

              {/* Technical Specifications Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block font-mono">Parallel Channels</span>
                  <span className="text-xs text-zinc-200 font-mono font-semibold">16 Multi-Streams</span>
                </div>
                <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block font-mono">Disk I/O Cache</span>
                  <span className="text-xs text-zinc-200 font-mono font-semibold">64 MB RAM Buffer</span>
                </div>
                <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block font-mono">Allocation Engine</span>
                  <span className="text-xs text-zinc-200 font-mono font-semibold">falloc (Zero Fragmentation)</span>
                </div>
                <div className="bg-[#18181b] border border-white/5 p-3 rounded-xl">
                  <span className="text-[10px] text-zinc-500 uppercase block font-mono">Integrity Protocol</span>
                  <span className="text-xs text-emerald-400 font-mono font-semibold">Auto-Resumable Chunking</span>
                </div>
              </div>

              {/* Hugging Face Token Configuration */}
              <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <span>Hugging Face Access Token</span>
                    <span className="text-[10px] text-zinc-500 font-normal">(Free User Read Token)</span>
                  </label>
                  <a 
                    href="https://huggingface.co/settings/tokens" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
                  >
                    <span>Get free token on Hugging Face</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
                <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
                  Hugging Face CloudFront throttles anonymous requests to ~1 MB/s. Providing your free read-access token routes requests to the authenticated high-bandwidth CDN tier (30–100+ MB/s).
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showHfToken ? 'text' : 'password'}
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={huggingFaceToken}
                      onChange={(e) => {
                        setHuggingFaceToken(e.target.value);
                        setIsHfTokenSaved(false);
                      }}
                      className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHfToken(!showHfToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
                    >
                      {showHfToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      vscodeApi?.postMessage({ command: 'updateHfToken', token: huggingFaceToken.trim() });
                      setIsHfTokenSaved(true);
                    }}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isHfTokenSaved
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm'
                    }`}
                  >
                    {isHfTokenSaved ? 'Saved ✓' : 'Save Token'}
                  </button>
                  {huggingFaceToken && (
                    <button
                      type="button"
                      onClick={() => {
                        setHuggingFaceToken('');
                        vscodeApi?.postMessage({ command: 'updateHfToken', token: '' });
                        setIsHfTokenSaved(true);
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Regional Edge Mirror Toggle */}
              <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-zinc-200">High-Speed Regional Mirror (hf-mirror.com)</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                      NO TOKEN REQUIRED
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed max-w-xl">
                    Proxies LFS downloads through global low-latency edge caches. Recommended if you are experiencing slow speeds or CloudFront CDN throttling.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !useHfMirror;
                    setUseHfMirror(next);
                    vscodeApi?.postMessage({ command: 'toggleHfMirror', useMirror: next });
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    useHfMirror
                      ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-sm shadow-purple-900/30'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/5'
                  }`}
                >
                  {useHfMirror ? 'Mirror Enabled ✓' : 'Enable Mirror'}
                </button>
              </div>
            </div>

            {/* Runtime Updater Card (Runtime Update & Connected Status) */}
            <div className="bg-[#141416] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Astrolabe System & Runtime Updater
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Maintains binary integrity across daemon services, Vulkan shader pipelines, and Hugging Face model registry caches.
                  </p>
                </div>
                <span className="text-[10px] px-2.5 py-1 rounded-md border font-mono font-semibold bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0">
                  UPDATER CONNECTED
                </span>
              </div>

              <div className="bg-[#18181b] border border-white/5 rounded-xl p-4 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase">Runtime Version</span>
                    <span className="text-zinc-200 font-semibold">v0.1.4-beta (Production)</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase">Inference Core</span>
                    <span className="text-zinc-200 font-semibold">exovon-daemon v0.1.0</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase">Multichannel Engine</span>
                    <span className="text-zinc-200 font-semibold">aria2c 8-Conn Parallel</span>
                  </div>
                </div>
              </div>

              {systemUpdateInfo && (
                <div className={`mb-4 p-3.5 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 border ${
                  systemUpdateInfo.hasUpdate 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                    : 'bg-white/5 border-white/10 text-zinc-300'
                }`}>
                  <div className="flex items-center gap-2.5 font-mono">
                    <svg className={`w-4 h-4 shrink-0 ${systemUpdateInfo.hasUpdate ? 'text-emerald-400' : 'text-zinc-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{systemUpdateInfo.message || 'All runtime components and model workers are synchronized and operational.'}</span>
                  </div>
                  {systemUpdateInfo.hasUpdate && systemUpdateInfo.downloadUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        vscodeApi?.postMessage({
                          command: 'installSystemUpdate',
                          downloadUrl: systemUpdateInfo.downloadUrl
                        });
                      }}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/30 flex items-center gap-2 shrink-0 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Update to {systemUpdateInfo.latestVersion} & Restart</span>
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isCheckingUpdates}
                  onClick={() => {
                    setIsCheckingUpdates(true);
                    vscodeApi?.postMessage({ command: 'checkSystemUpdates' });
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors flex items-center gap-2 cursor-pointer"
                >
                  {isCheckingUpdates ? (
                    <>
                      <span className="animate-spin w-3 h-3 border-2 border-t-white border-zinc-600 rounded-full" />
                      <span>Checking Runtime Upstream...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Check for Updates</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Models' && (
          <div className="space-y-6">
            {/* Active Memory Slots Matrix */}
            <div className="bg-[#141416] border border-white/5 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${daemonRunning ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
                  <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Active Memory Slots</h3>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {daemonRunning ? 'Daemon Online (47990)' : 'Daemon Offline'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Slot 1: Primary Agent */}
                {(() => {
                  const isPrimaryLoaded = Boolean(daemonHealth?.active_model);
                  const currentPrimaryModel = daemonHealth?.active_model || '';

                  return (
                    <div className="bg-[#18181b] border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Primary Agent</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isPrimaryLoaded ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-white/5'}`}>
                            {isPrimaryLoaded ? 'LOADED' : 'EMPTY'}
                          </span>
                        </div>
                        <div className={`text-xs font-semibold truncate font-mono ${isPrimaryLoaded ? 'text-zinc-200' : 'text-zinc-500'}`}>
                          {isPrimaryLoaded ? formatModelDisplayName(currentPrimaryModel) : 'No model loaded'}
                        </div>
                        {isPrimaryLoaded && daemonHealth?.ctx_size && (
                          <div className="text-[10px] text-zinc-500 font-mono mt-1">
                            Context: {Math.round(daemonHealth.ctx_size / 1024)}K tokens
                          </div>
                        )}
                      </div>
                      {isPrimaryLoaded && (
                        <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                          <span className="text-[10px] text-zinc-500 font-mono">Chat & Tools</span>
                          <button
                            onClick={() => vscodeApi?.postMessage({ command: 'unloadLocalModel' })}
                            className="text-[10px] font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-0.5 rounded transition-colors"
                            title="Unload model to free VRAM"
                          >
                            Unload Slot
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Slot 2: Inline Ghost */}
                {(() => {
                  const isGhostLoaded = Boolean(daemonHealth?.active_ghost_model || (inlineGhostModel && daemonRunning));
                  const currentGhostModel = daemonHealth?.active_ghost_model || inlineGhostModel;

                  return (
                    <div className="bg-[#18181b] border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Inline Ghost (FIM)</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isGhostLoaded ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-white/5'}`}>
                            {isGhostLoaded ? 'LOADED' : 'EMPTY'}
                          </span>
                        </div>
                        <div className={`text-xs font-semibold truncate font-mono ${isGhostLoaded ? 'text-zinc-200' : 'text-zinc-500'}`}>
                          {isGhostLoaded ? formatModelDisplayName(currentGhostModel) : 'No ghost model'}
                        </div>
                        {isGhostLoaded && (
                          <div className="text-[10px] text-zinc-500 font-mono mt-1">
                            Fast autocomplete stream
                          </div>
                        )}
                      </div>
                      {isGhostLoaded && (
                        <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                          <span className="text-[10px] text-zinc-500 font-mono">Tab completion</span>
                          <button
                            onClick={() => vscodeApi?.postMessage({ command: 'setInlineGhostModel', model: '' })}
                            className="text-[10px] font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-0.5 rounded transition-colors"
                            title="Unload ghost model"
                          >
                            Unload Slot
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Slot 3: Multimodal & Diffusion */}
                {(() => {
                  const isDiffusionLoaded = Boolean(daemonHealth?.active_diffusion_model);
                  const currentDiffusionModel = daemonHealth?.active_diffusion_model;

                  return (
                    <div className="bg-[#18181b] border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Vision & Diffusion</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isDiffusionLoaded ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-white/5'}`}>
                            {isDiffusionLoaded ? 'LOADED' : 'EMPTY'}
                          </span>
                        </div>
                        <div className={`text-xs font-semibold truncate font-mono ${isDiffusionLoaded ? 'text-zinc-200' : 'text-zinc-500'}`}>
                          {isDiffusionLoaded ? formatModelDisplayName(currentDiffusionModel) : 'No diffusion model'}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-1">
                          Port 47992 • Dedicated visual engine
                        </div>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-mono">Atomic MMDiT/UNet</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setIsImageStudioOpen(true)}
                            className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Open Visual Generation Studio (Port 47992)"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>Studio</span>
                          </button>
                          {isDiffusionLoaded ? (
                            <button
                              onClick={() => {
                                vscodeApi?.postMessage({
                                  command: 'unloadLocalModel',
                                  target: 'diffusion'
                                });
                              }}
                              className="text-[10px] font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-0.5 rounded transition-colors cursor-pointer"
                              title="Unload diffusion model"
                            >
                              Unload Slot
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                const firstImageModel = localModels.find(m => {
                                  const id = m.id.toLowerCase();
                                  return id.includes('diffusion') || id.includes('flux') || id.includes('qwen-image') || id.includes('sd1') || id.includes('sdxl') || id.includes('sd-turbo');
                                });
                                setSelectedModelToLoad(firstImageModel ? firstImageModel.id : (localModels[0]?.id || ''));
                                setLoadTarget('diffusion');
                                setLoadBackend('stable-diffusion.cpp');
                                setLoadModelModalOpen(true);
                              }}
                              className="text-[10px] font-medium text-zinc-300 hover:text-white hover:bg-white/5 px-2 py-0.5 rounded border border-white/5 transition-colors cursor-pointer"
                            >
                              Configure
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>



            {/* Active Downloads List */}
            {activeDownloads.length > 0 && (
              <div className="bg-[#121215] border border-white/5 rounded-xl p-5 relative shadow-xl">
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <h3 className="text-xs font-semibold text-zinc-200 tracking-wide uppercase">
                      Active Downloads
                    </h3>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-white/5">
                      {activeDownloads.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('System')}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                      huggingFaceToken.trim() || useHfMirror
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                    }`}
                    title="Click to configure Download Accelerator & Priority CDN"
                  >
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-current"></span>
                    <span>{huggingFaceToken.trim() ? '⚡ 16x Priority CDN' : useHfMirror ? '⚡ Regional Mirror' : '⚠️ Throttled (~1 MB/s) — Boost'}</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {activeDownloads.map((dl, i) => {
                    const { speed, eta } = getSpeedAndEta(dl);
                    const isDownloading = dl.status === 'downloading' || dl.status === 'starting';
                    const isPaused = dl.status === 'paused';
                    const isError = dl.status.includes('error');
                    const isFinished = dl.status === 'finished';

                    const downloadedGb = ((dl.downloaded_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2);
                    const totalGb = ((dl.total_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2);
                    const packFile = VERIFIED_IMAGE_PACKS.flatMap(p => p.files).find(f => f.filename === dl.model_name);
                    const fallbackUrl = (dl as any).url || packFile?.url;

                    return (
                      <div key={i} className="bg-[#18181c] border border-white/[0.06] p-3.5 rounded-lg flex flex-col gap-2.5 transition-all">
                        {/* Top Row: File Name + Status Badge + Actions */}
                        <div className="flex justify-between items-center gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isDownloading ? 'bg-emerald-400 animate-pulse' :
                              isPaused ? 'bg-amber-400' :
                              isFinished ? 'bg-emerald-400' : 'bg-rose-400'
                            }`} />
                            <h4 className="text-xs font-medium text-zinc-100 truncate" title={dl.model_name}>
                              {dl.model_name}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                              isDownloading ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                              isPaused ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' :
                              isFinished ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                              'bg-rose-500/10 text-rose-300 border-rose-500/20'
                            }`}>
                              {isDownloading ? 'Downloading' : isPaused ? 'Paused' : isFinished ? 'Completed' : 'Error'}
                            </span>

                            {/* Download Action Controls */}
                            <div className="flex items-center gap-1">
                              {isDownloading && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDownloads(prev => prev.map(d => d.model_name === dl.model_name ? { ...d, status: 'paused', speed_display: '', speed_bytes_per_sec: 0, eta_seconds: undefined } : d));
                                    vscodeApi?.postMessage({ command: 'controlDownload', filename: dl.model_name, action: 'pause' });
                                  }}
                                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-300 hover:text-white rounded border border-white/5 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                                  title="Pause download"
                                >
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="4" width="4" height="16" rx="1"/>
                                    <rect x="14" y="4" width="4" height="16" rx="1"/>
                                  </svg>
                                  Pause
                                </button>
                              )}

                              {isPaused && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDownloads(prev => prev.map(d => d.model_name === dl.model_name ? { ...d, status: 'starting' } : d));
                                    vscodeApi?.postMessage({ command: 'controlDownload', filename: dl.model_name, action: 'retry', url: fallbackUrl });
                                  }}
                                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 hover:text-white rounded border border-white/10 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                                  title="Resume download"
                                >
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                  </svg>
                                  Resume
                                </button>
                              )}

                              {isError && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDownloads(prev => prev.map(d => d.model_name === dl.model_name ? { ...d, status: 'starting' } : d));
                                    vscodeApi?.postMessage({ command: 'controlDownload', filename: dl.model_name, action: 'retry', url: fallbackUrl });
                                  }}
                                  className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 active:scale-[0.98] text-amber-300 rounded border border-amber-500/20 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                                  title="Retry download"
                                >
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                                  </svg>
                                  Retry
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setDownloadConfirmDelete(dl)}
                                className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 active:scale-[0.98] rounded border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                                title="Cancel and delete download"
                              >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Middle Row: Progress Bar */}
                        <div className="w-full bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isFinished ? 'bg-emerald-500' :
                              isError ? 'bg-rose-500' :
                              isPaused ? 'bg-amber-400' : 'bg-zinc-200'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, dl.percent))}%` }}
                          />
                        </div>

                        {/* Bottom Row: Unified Telemetry */}
                        <div className="flex justify-between items-center text-[11px] font-mono tabular-nums text-zinc-400">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-200">{dl.percent.toFixed(1)}%</span>
                            {speed && isDownloading && (
                              <>
                                <span className="text-zinc-600">•</span>
                                <span className="text-zinc-300 font-medium">{speed}</span>
                              </>
                            )}
                            {eta && isDownloading && (
                              <>
                                <span className="text-zinc-600">•</span>
                                <span className="text-zinc-400">ETA {eta}</span>
                              </>
                            )}
                          </div>
                          <span>{downloadedGb} GB / {totalGb} GB</span>
                        </div>

                        {/* Error Banner */}
                        {isError && dl.status && (
                          <div className="text-[10px] text-rose-400 font-mono bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-md flex items-center gap-1.5 mt-0.5">
                            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="truncate">{dl.status.replace(/^error:\s*/i, '')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Local Models Table: "My Models" */}
            <div className="bg-[#141416] rounded-xl border border-white/5 shadow-2xl overflow-hidden relative">
              {/* Header Bar */}
              <div className="px-5 py-3.5 border-b border-white/5 bg-[#18181b]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100 tracking-wide">
                    My Models
                  </h3>
                  <span className="text-xs text-zinc-400 font-mono px-2 py-0.5 bg-zinc-800/60 rounded-full border border-white/5">
                    {localModels.filter((m: LocalModel) => {
                      const meta = extractModelMetadata(m.id, m);
                      if (localModalityFilter === 'llm' && (meta.isDiffusion || meta.isMmproj)) return false;
                      if (localModalityFilter === 'vision' && (!meta.isVision && !meta.isMmproj)) return false;
                      if (localModalityFilter === 'image' && !meta.isDiffusion) return false;
                      if (localModalityFilter === 'ghost' && inlineGhostModel !== m.id && !m.id.toLowerCase().includes('ghost') && !m.id.toLowerCase().includes('fim')) return false;

                      if (!modelFilterQuery.trim()) return true;
                      const q = modelFilterQuery.toLowerCase();
                      const raw = (m.id || '').toLowerCase();
                      const name = (m.name || '').toLowerCase();
                      const arch = (m.architecture || '').toLowerCase();
                      const quant = (m.quantization || '').toLowerCase();
                      return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
                    }).length}
                  </span>

                  {/* Clean Models Directory Path Breadcrumb */}
                  <div className="hidden lg:flex items-center gap-2 bg-[#121214] border border-white/5 rounded-lg px-2.5 py-1 text-xs text-zinc-400 font-mono max-w-sm truncate">
                    <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="truncate text-zinc-300" title={localModelsDir}>{localModelsDir}</span>
                    <button
                      type="button"
                      onClick={() => vscodeApi?.postMessage({ command: 'browseLocalModelsDirectory' })}
                      className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors shrink-0 cursor-pointer"
                      title="Change models folder"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button 
                    onClick={() => {
                      const next = !enableGhostText;
                      setEnableGhostText(next);
                      vscodeApi?.postMessage({ command: 'toggleGhostText', enabled: next });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                      enableGhostText 
                        ? 'bg-zinc-800 text-zinc-100 border-zinc-700' 
                        : 'bg-zinc-900/60 text-zinc-500 border-white/5 hover:text-zinc-300'
                    }`}
                    title={enableGhostText ? 'Inline Ghost Autocomplete Enabled' : 'Inline Ghost Autocomplete Disabled'}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${enableGhostText ? 'bg-sky-400' : 'bg-zinc-600'}`} />
                    <span>Ghost: {enableGhostText ? 'ON' : 'OFF'}</span>
                  </button>

                  <button 
                    onClick={() => vscodeApi?.postMessage({ command: 'getLocalModels' })}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors border border-white/5"
                    title="Refresh Models List"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modality Filter Pills & Search Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-5 py-2.5 bg-[#161618] border-b border-white/5">
                <div className="inline-flex p-0.5 bg-zinc-900/90 rounded-lg border border-white/5 gap-0.5 overflow-x-auto">
                  {(['all', 'llm', 'vision', 'image', 'ghost'] as const).map(pill => (
                    <button
                      key={pill}
                      type="button"
                      onClick={() => setLocalModalityFilter(pill)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        localModalityFilter === pill 
                          ? 'bg-zinc-800 text-white shadow-sm' 
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                      }`}
                    >
                      {pill === 'all' ? 'All Models' : pill === 'llm' ? 'Chat / LLM' : pill === 'vision' ? 'Vision' : pill === 'image' ? 'Image Gen' : 'Ghost'}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input 
                    ref={filterInputRef}
                    type="text"
                    value={modelFilterQuery}
                    onChange={(e) => setModelFilterQuery(e.target.value)}
                    placeholder="Filter models... (Ctrl + F)"
                    className="bg-zinc-900 border border-white/10 rounded-lg pl-8 pr-7 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 w-full sm:w-56 transition-all"
                  />
                  {modelFilterQuery && (
                    <button 
                      onClick={() => setModelFilterQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Table View */}
              {localModels.length === 0 ? (
                <div className="text-center py-12 border-dashed border-white/5 rounded-xl m-4 space-y-3">
                  <p className="text-xs text-zinc-400 font-mono">No models found in <span className="text-zinc-200">{localModelsDir}</span>.</p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => vscodeApi?.postMessage({ command: 'browseLocalModelsDirectory' })}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors"
                    >
                      Change Directory
                    </button>
                    <button
                      onClick={() => openModelHubWithQuery('')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                    >
                      Discover Models on Hub
                    </button>
                  </div>
                </div>
              ) : localModels.filter((m: LocalModel) => {
                const meta = extractModelMetadata(m.id, m);
                if (localModalityFilter === 'llm' && (meta.isDiffusion || meta.isMmproj)) return false;
                if (localModalityFilter === 'vision' && (!meta.isVision && !meta.isMmproj)) return false;
                if (localModalityFilter === 'image' && (!meta.isDiffusion && !meta.isMmproj)) return false;
                if (localModalityFilter === 'ghost' && inlineGhostModel !== m.id && !m.id.toLowerCase().includes('ghost') && !m.id.toLowerCase().includes('fim')) return false;

                if (!modelFilterQuery.trim()) return true;
                const q = modelFilterQuery.toLowerCase();
                const raw = (m.id || '').toLowerCase();
                const name = (m.name || '').toLowerCase();
                const arch = (m.architecture || '').toLowerCase();
                const quant = (m.quantization || '').toLowerCase();
                return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
              }).length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  No models match the selected filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[11px] font-semibold text-zinc-400 bg-[#121214]">
                        <th className="py-2.5 px-4 font-medium">Name</th>
                        <th className="py-2.5 px-3 font-medium">Params</th>
                        <th className="py-2.5 px-3 font-medium">Publisher</th>
                        <th className="py-2.5 px-3 font-medium text-center">Quant</th>
                        <th className="py-2.5 px-3 font-medium">Size</th>
                        <th className="py-2.5 px-4 font-medium text-right min-w-[120px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03] text-xs">
                      {localModels.filter((m: LocalModel) => {
                        const meta = extractModelMetadata(m.id, m);
                        if (localModalityFilter === 'llm' && (meta.isDiffusion || meta.isMmproj)) return false;
                        if (localModalityFilter === 'vision' && (!meta.isVision && !meta.isMmproj)) return false;
                        if (localModalityFilter === 'image' && !meta.isDiffusion) return false;
                        if (localModalityFilter === 'ghost' && inlineGhostModel !== m.id && !m.id.toLowerCase().includes('ghost') && !m.id.toLowerCase().includes('fim')) return false;

                        if (!modelFilterQuery.trim()) return true;
                        const q = modelFilterQuery.toLowerCase();
                        const raw = (m.id || '').toLowerCase();
                        const name = (m.name || '').toLowerCase();
                        const arch = (m.architecture || '').toLowerCase();
                        const quant = (m.quantization || '').toLowerCase();
                        return raw.includes(q) || name.includes(q) || arch.includes(q) || quant.includes(q);
                      }).map((m: LocalModel) => {
                        const meta = extractModelMetadata(m.id, m);
                        const isRowActive = activeLocalModel === m.id || m.loaded;
                        const isLoadingThis = loadingModelId === m.id;

                        return (
                          <tr 
                            key={m.id}
                            className={`transition-colors duration-150 group relative ${
                              isRowActive 
                                ? 'bg-[#242428] text-zinc-100 border-l-2 border-emerald-400' 
                                : 'hover:bg-white/[0.02] text-zinc-300'
                            }`}
                          >
                            {/* 1. Name Column */}
                            <td className="py-3 px-4 max-w-[340px]">
                              <div className="flex items-center gap-2">
                                {isRowActive && (
                                  <span className="flex h-2 w-2 relative flex-shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span 
                                      className={`font-semibold text-xs truncate ${isRowActive ? 'text-emerald-300' : 'text-zinc-100'}`}
                                      title={m.id}
                                    >
                                      {m.name || formatModelDisplayName(m.id)}
                                    </span>
                                    {meta.isMmproj && (
                                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[9px] font-mono shrink-0 font-bold" title="Multimodal Vision Projector (mmproj). Visual CLIP encoder for Vision-Language Models & Diffusion conditioning.">
                                        PROJECTOR
                                      </span>
                                    )}
                                    {meta.isDiffusion && (
                                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[9px] font-mono shrink-0 font-bold" title="Diffusion / Visual Synthesis Engine">
                                        DIFFUSION
                                      </span>
                                    )}
                                    {meta.isVision && !meta.isMmproj && (
                                      <span className="px-1 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] font-mono shrink-0" title="Vision Multimodal">
                                        VL
                                      </span>
                                    )}
                                    {meta.isReasoning && (
                                      <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] font-mono shrink-0" title="Reasoning / Thinking">
                                        Think
                                      </span>
                                    )}
                                    {inlineGhostModel === m.id && (
                                      <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 text-[9px] font-mono shrink-0 flex items-center gap-1" title="Dedicated Inline Ghost Model">
                                        <svg className="w-2.5 h-2.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                        Ghost
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 font-mono truncate" title={m.id}>
                                    {m.id}
                                  </div>
                                </div>
                              </div>
                              {isLoadingThis && (
                                <div className="mt-1.5 space-y-1">
                                  <div className="flex justify-between text-[10px] text-sky-400 font-mono">
                                    <span>{loadStatusMessage || 'Loading model...'}</span>
                                    <span>{loadProgressPercent}%</span>
                                  </div>
                                  <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden">
                                    <div 
                                      className="bg-sky-400 h-1 rounded-full transition-all duration-300"
                                      style={{ width: `${Math.max(5, loadProgressPercent)}%` }}
                                    ></div>
                                  </div>
                                </div>
                              )}
                            </td>

                            {/* 2. Params Column */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              {meta.params ? (
                                <span className="inline-block px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300 text-[11px] font-mono">
                                  {meta.params}
                                </span>
                              ) : (
                                <span className="text-zinc-600 font-mono text-[11px]">-</span>
                              )}
                            </td>

                            {/* 3. Publisher Column */}
                            <td className="py-3 px-3 whitespace-nowrap text-zinc-400 text-xs">
                              {meta.publisher}
                            </td>

                            {/* 4. Quant Column */}
                            <td className="py-3 px-3 whitespace-nowrap text-center">
                              <span className="inline-block px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-300 text-[11px] font-mono">
                                {meta.quant}
                              </span>
                            </td>

                            {/* 6. Size Column */}
                            <td className="py-3 px-3 whitespace-nowrap font-mono text-zinc-400 text-xs">
                              {m.size_display || (m.size_bytes ? `${(m.size_bytes / (1024*1024*1024)).toFixed(1)} GB` : '-')}
                            </td>

                            {/* 7. Actions Column (Load / Set Active / ⋯ menu) */}
                            <td className="py-3 px-4 text-right whitespace-nowrap relative min-w-[120px]">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {/* Inline Quick Trigger: Load or Active Indicator */}
                                {isLoadingThis ? (
                                  <span className="text-[10px] font-mono text-sky-400 animate-pulse">
                                    {loadProgressPercent}%
                                  </span>
                                ) : m.loaded ? (
                                  <button 
                                    onClick={() => vscodeApi?.postMessage({ command: 'setLocalLlmModelName', model: m.id })}
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                      activeLocalModel === m.id 
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                    }`}
                                  >
                                    {activeLocalModel === m.id ? 'Active' : 'Set Active'}
                                  </button>
                                ) : meta.isMmproj ? (
                                  <button 
                                    onClick={() => {
                                      // Find matching companion base model in local models list
                                      const cleanMmproj = m.id.toLowerCase();
                                      let companion = localModels.find(x => {
                                        if (x.id === m.id || x.id.toLowerCase().includes('mmproj')) return false;
                                        const xClean = x.id.toLowerCase();
                                        if (cleanMmproj.includes('bonsai') && xClean.includes('bonsai')) return true;
                                        if (cleanMmproj.includes('qwen3-vl') && xClean.includes('qwen3-vl')) return true;
                                        if (cleanMmproj.includes('26b') && xClean.includes('26b')) return true;
                                        if (cleanMmproj.includes('31b') && xClean.includes('31b')) return true;
                                        if (cleanMmproj.includes('gemma') && xClean.includes('gemma')) return true;
                                        return false;
                                      });

                                      if (!companion) {
                                        // Fallback: search for any non-mmproj model in the same directory
                                        const lastSlash = m.id.lastIndexOf('/');
                                        if (lastSlash > 0) {
                                          const mDir = m.id.substring(0, lastSlash);
                                          companion = localModels.find(x => x.id !== m.id && !x.id.toLowerCase().includes('mmproj') && x.id.startsWith(mDir));
                                        }
                                      }

                                      if (companion) {
                                        setSelectedModelToLoad(companion.id);
                                        setSelectedMmprojPath(m.id);
                                        setLoadTarget('primary');
                                        setLoadBackend('llama.cpp');
                                      } else {
                                        setSelectedModelToLoad(m.id);
                                        setSelectedMmprojPath(m.id);
                                      }
                                      setLoadModelModalOpen(true);
                                    }}
                                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 transition-colors"
                                    title="Pair this Vision Projector with its base language or diffusion model"
                                  >
                                    Pair with Model
                                  </button>
                                ) : meta.isDiffusion ? (
                                  <div className="flex items-center gap-1.5">
                                    <button 
                                      onClick={() => {
                                        setSelectedModelToLoad(m.id);
                                        setIsImageStudioOpen(true);
                                      }}
                                      className="px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors flex items-center gap-1 cursor-pointer"
                                      title="Open Visual Generation Studio with this model"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      Studio
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setSelectedModelToLoad(m.id);
                                        setLoadTarget('diffusion');
                                        setLoadBackend('stable-diffusion.cpp');
                                        const match = localModels.find(x => x.id.toLowerCase().includes('qwen3-vl') || x.id.toLowerCase().includes('mmproj'));
                                        if (match) setSelectedMmprojPath(match.id);
                                        const vaeMatch = localModels.find(x => x.id.toLowerCase().includes('vae'));
                                        if (vaeMatch) setSelectedVaePath(vaeMatch.id);
                                        else setSelectedVaePath('qwen_image_2.1_vae_bf16.safetensors');
                                        setLoadModelModalOpen(true);
                                      }}
                                      className="px-2 py-1 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/5 transition-colors cursor-pointer"
                                      title="Configure diffusion pipeline and parameters"
                                    >
                                      Config
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => {
                                      setSelectedModelToLoad(m.id);
                                      setLoadTarget('primary');
                                      if (daemonHealth?.hardware?.gpu?.toLowerCase().includes('nvidia')) {
                                        setLoadBackend('sglang');
                                      } else {
                                        setLoadBackend('llama.cpp');
                                      }
                                      const baseName = m.id.split('/').pop()?.replace(/\.gguf$/i, '').toLowerCase() || '';
                                      const mmMatch = localModels.find(x => x.id.toLowerCase().includes('mmproj') && (
                                        (baseName.includes('gemma') && x.id.toLowerCase().includes('gemma')) ||
                                        (baseName.includes('bonsai') && x.id.toLowerCase().includes('bonsai')) ||
                                        (baseName.includes('qwen3-vl') && x.id.toLowerCase().includes('qwen3-vl')) ||
                                        (baseName.includes('qwen') && x.id.toLowerCase().includes('qwen'))
                                      ));
                                      if (mmMatch) setSelectedMmprojPath(mmMatch.id);
                                      else setSelectedMmprojPath('');
                                      setLoadModelModalOpen(true);
                                    }}
                                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                                  >
                                    Load
                                  </button>
                                )}

                                {/* Clean ⋯ Dropdown Menu Button */}
                                <div className="relative inline-block text-left">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveActionMenuId(activeActionMenuId === m.id ? null : m.id);
                                    }}
                                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
                                    title="Model Actions"
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <circle cx="12" cy="12" r="2" />
                                      <circle cx="19" cy="12" r="2" />
                                      <circle cx="5" cy="12" r="2" />
                                    </svg>
                                  </button>

                                  {/* Dropdown Popup */}
                                  {activeActionMenuId === m.id && (
                                    <div 
                                      className="absolute right-0 top-full mt-1 w-52 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl py-1.5 z-50 text-xs text-zinc-200"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {m.loaded ? (
                                        <>
                                          <button 
                                            onClick={() => {
                                              vscodeApi?.postMessage({ command: 'clearKvCache' });
                                              setActiveActionMenuId(null);
                                            }}
                                            className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-sky-300 transition-colors"
                                          >
                                            <svg className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            <span>Clear KV Cache</span>
                                          </button>
                                          <button 
                                            onClick={() => {
                                              vscodeApi?.postMessage({ command: 'unloadLocalModel' });
                                              setActiveActionMenuId(null);
                                            }}
                                            className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-amber-400 transition-colors"
                                          >
                                            <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                            </svg>
                                            <span>Unload Model</span>
                                          </button>
                                        </>
                                      ) : (
                                        <button 
                                          onClick={() => {
                                            setSelectedModelToLoad(m.id);
                                            if (daemonHealth?.hardware?.gpu?.toLowerCase().includes('nvidia')) {
                                              setLoadBackend('sglang');
                                            } else {
                                              setLoadBackend('llama.cpp');
                                            }
                                            setLoadModelModalOpen(true);
                                            setActiveActionMenuId(null);
                                          }}
                                          className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-sky-400 transition-colors"
                                        >
                                          <svg className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                          </svg>
                                          <span>Load in Memory</span>
                                        </button>
                                      )}

                                      <button 
                                        onClick={() => {
                                          vscodeApi?.postMessage({ command: 'setLocalLlmModelName', model: m.id });
                                          setActiveActionMenuId(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-zinc-300 transition-colors"
                                      >
                                        <svg className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <circle cx="12" cy="12" r="3" strokeWidth={2} />
                                          <circle cx="12" cy="12" r="8" strokeWidth={2} strokeDasharray="3 3" />
                                        </svg>
                                        <span>Set as Active Model</span>
                                      </button>

                                      <button 
                                        onClick={() => {
                                          vscodeApi?.postMessage({ command: 'setInlineGhostModel', model: m.id });
                                          setInlineGhostModel(m.id);
                                          setActiveActionMenuId(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-cyan-300 transition-colors"
                                      >
                                        <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                        <span>{inlineGhostModel === m.id ? 'Active Ghost Model' : 'Set as Inline Ghost'}</span>
                                      </button>

                                      {meta.isDiffusion && (
                                        <button 
                                          onClick={() => {
                                            setSelectedModelToLoad(m.id);
                                            setIsImageStudioOpen(true);
                                            setActiveActionMenuId(null);
                                          }}
                                          className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-emerald-400 transition-colors"
                                        >
                                          <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                          </svg>
                                          <span>Open in Visual Studio</span>
                                        </button>
                                      )}

                                      <div className="my-1 border-t border-white/5"></div>

                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(m.id);
                                          setActiveActionMenuId(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center gap-2 text-zinc-400 transition-colors"
                                      >
                                        <svg className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        <span>Copy Model ID / Path</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
            </div>
          </div>
      {/* Live Hugging Face Model Explorer Sub-Window Modal */}
      {isModelHubOpen && (() => {
        const selectedQuant = availableQuants[selectedQuantIndex] || availableQuants[0];
        const isDownloaded = selectedQuant && localModels.some(m => m.id.toLowerCase().includes(selectedQuant.filename.toLowerCase()));
        const activeDownloadItem = selectedQuant && activeDownloads.find(d => d.model_name.toLowerCase().includes(selectedQuant.filename.toLowerCase()));

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 animate-in fade-in duration-150"
            onClick={() => setIsModelHubOpen(false)}
          >
            <div 
              className="bg-[#18181b] border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex overflow-hidden text-zinc-200 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              
              {/* Left Column: Search & Live Model List */}
              <div className="w-[360px] border-r border-white/10 flex flex-col bg-[#141416]">
                {/* Search Bar */}
                <div className="p-3.5 border-b border-white/5 space-y-2.5">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                      Model Hub
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsModelHubOpen(false)}
                      className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
                      title="Close Hub (Esc)"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      Close
                    </button>
                  </div>
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input 
                      type="text"
                      placeholder="Search Hugging Face models..."
                      value={hubSearchQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHubSearchQuery(val);
                        fetchLiveModels(hubSortMode, val, selectedModality);
                      }}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                  </div>

                  {/* Modality Filter Pills */}
                  <div className="grid grid-cols-3 gap-1 bg-zinc-950/60 p-1 rounded-lg border border-white/5 text-[11px] font-mono">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'llm', label: 'LLM' },
                      { id: 'image', label: 'Image' },
                      { id: 'video', label: 'Video' },
                      { id: 'voice', label: 'Voice' },
                      { id: 'audio', label: 'Music' }
                    ].map((mod) => (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => {
                          const newMod = mod.id as ModelModality;
                          setSelectedModality(newMod);
                          fetchLiveModels(hubSortMode, hubSearchQuery, newMod);
                        }}
                        className={`py-1 px-1.5 rounded text-center transition-colors font-medium ${
                          selectedModality === mod.id
                            ? 'bg-zinc-800 text-white border border-white/10 shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                        }`}
                      >
                        {mod.label}
                      </button>
                    ))}
                  </div>

                  {/* Filter / Sort Tabs */}
                  <div className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-white/5 text-xs">
                    <button 
                      onClick={() => {
                        setHubSortMode('lastModified');
                        fetchLiveModels('lastModified', hubSearchQuery, selectedModality);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'lastModified' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Recent
                    </button>
                    <button 
                      onClick={() => {
                        setHubSortMode('trendingScore');
                        fetchLiveModels('trendingScore', hubSearchQuery, selectedModality);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'trendingScore' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Trending
                    </button>
                    <button 
                      onClick={() => {
                        setHubSortMode('downloads');
                        fetchLiveModels('downloads', hubSearchQuery, selectedModality);
                      }}
                      className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium text-center transition-colors ${hubSortMode === 'downloads' ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      Downloads
                    </button>
                  </div>
                </div>

                {/* Live Model Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-1.5">
                  {isLoadingModelsList ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-500 text-xs space-y-2">
                      <svg className="animate-spin w-5 h-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Fetching Hugging Face models...</span>
                    </div>
                  ) : liveModelsList.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500 text-xs">
                      No models found.
                    </div>
                  ) : (
                    liveModelsList.map((m) => {
                      const isSelected = selectedHubModelId === m.id;
                      const parts = m.id.split('/');
                      const author = parts.length > 1 ? parts[0] : '';
                      const modelName = parts.length > 1 ? parts[1] : m.id;

                      return (
                        <div 
                          key={m.id}
                          onClick={() => fetchModelDetails(m.id)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2.5 ${
                            isSelected 
                              ? 'bg-zinc-800/90 border-zinc-600 text-white shadow-sm ring-1 ring-white/10' 
                              : 'bg-zinc-900/40 border-white/5 hover:border-white/10 hover:bg-zinc-800/40 text-zinc-300'
                          }`}
                        >
                          {renderProviderLogo(m.id)}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                {modelName}
                              </span>
                              <span className="text-[10px] text-zinc-500 flex-shrink-0 font-mono">
                                {formatRelativeTime(m.lastModified)}
                              </span>
                            </div>

                            {author && (
                              <p className="text-[10px] text-zinc-400 truncate mb-1.5 font-mono">
                                by {author}
                              </p>
                            )}

                            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                              <span className="flex items-center gap-1">
                                <svg className="w-2.5 h-2.5 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                {(m.downloads || 0).toLocaleString()}
                              </span>
                              <span className="flex items-center gap-1">
                                <svg className="w-2.5 h-2.5 text-zinc-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                </svg>
                                {m.likes || 0}
                              </span>
                              {(() => {
                                const modInfo = getModelModalityInfo(m);
                                return (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border ml-auto ${modInfo.color}`}>
                                    {modInfo.label}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Model Details & Download Panel */}
              <div className="flex-1 flex flex-col bg-[#18181b] overflow-y-auto custom-scrollbar">
                {isLoadingDetails ? (
                  <div className="flex flex-col items-center justify-center h-full py-24 text-zinc-500 text-xs space-y-3">
                    <svg className="animate-spin w-6 h-6 text-zinc-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Loading repository details and files...</span>
                  </div>
                ) : selectedModelDetails ? (
                  <>
                    {/* Header Bar */}
                    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#18181b] z-10">
                      <div className="flex items-center gap-3 min-w-0">
                        {renderProviderLogo(selectedModelDetails.id)}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold text-white tracking-wide truncate">
                              {selectedModelDetails.id}
                            </h2>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(selectedModelDetails.id);
                                setCopiedRepoId(true);
                                setTimeout(() => setCopiedRepoId(false), 2000);
                              }}
                              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-white/10 text-[11px] transition-colors"
                              title="Copy Model ID"
                            >
                              {copiedRepoId ? 'Copied' : 'Copy ID'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={() => setIsModelHubOpen(false)}
                        className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Close"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>

                    <div className="p-6 space-y-5">
                      {/* Metric Stats */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 font-mono">
                        <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-lg border border-white/5">
                          <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          <span>{(selectedModelDetails.downloads || 0).toLocaleString()} downloads</span>
                        </span>

                        <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-lg border border-white/5">
                          <svg className="w-3.5 h-3.5 text-zinc-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                          </svg>
                          <span>{selectedModelDetails.likes || 0} likes</span>
                        </span>

                        <span className="text-zinc-500">
                          Updated {formatRelativeTime(selectedModelDetails.lastModified)}
                        </span>

                        {selectedModelDetails.pipeline_tag && (
                          <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-white/10 text-[11px] font-mono ml-auto">
                            {selectedModelDetails.pipeline_tag}
                          </span>
                        )}
                      </div>

                      {/* Specifications Grid */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Architecture</span>
                          <span className="text-xs font-mono font-medium text-zinc-200">
                            {selectedModelDetails.gguf?.architecture || 'GGUF / Llama'}
                          </span>
                        </div>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Context Length</span>
                          <span className="text-xs font-mono font-medium text-zinc-200">
                            {selectedModelDetails.gguf?.context_length ? `${selectedModelDetails.gguf.context_length.toLocaleString()} tokens` : '131,072 tokens'}
                          </span>
                        </div>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-lg p-3">
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">License</span>
                          <span className="text-xs font-mono font-medium text-zinc-200 truncate block">
                            {selectedModelDetails.cardData?.license || 'Open Weights'}
                          </span>
                        </div>
                      </div>

                      {/* Download Options Box */}
                      <div className="bg-zinc-900/80 border border-white/10 rounded-xl p-4 space-y-3.5 shadow-lg">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Download Quantization ({availableQuants.length} files found)
                          </h4>
                        </div>

                        {/* Quantization Dropdown Selector */}
                        <div className="space-y-3">
                          <div className="relative">
                            <select 
                              value={selectedQuantIndex}
                              onChange={(e) => setSelectedQuantIndex(Number(e.target.value))}
                              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3.5 py-2 text-xs text-zinc-200 font-mono appearance-none focus:outline-none focus:border-zinc-500 cursor-pointer"
                            >
                              {availableQuants.map((q, idx) => (
                                <option key={idx} value={idx}>
                                  [{q.quant}] {q.filename} - {q.sizeDisplay}
                                </option>
                              ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                              </svg>
                            </div>
                          </div>

                          {/* Hardware Check & Action */}
                          <div className="flex items-center justify-between pt-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-white/5">
                              <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              <span>Estimated VRAM: ~{selectedQuant?.sizeDisplay || '4.5 GB'}</span>
                            </span>

                            {isDownloaded ? (
                              <button 
                                disabled
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5"
                              >
                                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>Downloaded</span>
                              </button>
                            ) : activeDownloadItem ? (
                              <button 
                                disabled
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center gap-2"
                              >
                                <svg className="animate-spin w-3.5 h-3.5 text-sky-400" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Downloading {activeDownloadItem.percent.toFixed(1)}%</span>
                              </button>
                            ) : (
                              <button 
                                onClick={() => {
                                  if (selectedQuant) {
                                    vscodeApi?.postMessage({ command: 'downloadLocalModel', url: selectedQuant.directUrl, filename: selectedQuant.filename });
                                    vscodeApi?.postMessage({ command: 'showNotification', message: `Started download for ${selectedQuant.filename}` });
                                  }
                                }}
                                className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 shadow-md flex items-center gap-2 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                <span>Download {selectedQuant?.sizeDisplay || ''}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Real Live Rendered README Section */}
                      <div className="space-y-2 pt-2">
                        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span>Repository README</span>
                        </h4>

                        <div className="bg-zinc-900/60 border border-white/5 rounded-xl p-6 text-xs text-zinc-300 max-h-[500px] overflow-y-auto custom-scrollbar">
                          {modelReadme ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeRaw, rehypeHighlight]}
                              components={{
                                h1: ({ children }) => <h1 className="text-base font-bold text-white mt-4 mb-2 pb-1.5 border-b border-white/10">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-100 mt-4 mb-2 pb-1 border-b border-white/5">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-xs font-semibold text-zinc-200 mt-3 mb-1.5">{children}</h3>,
                                h4: ({ children }) => <h4 className="text-xs font-semibold text-zinc-300 mt-2 mb-1">{children}</h4>,
                                p: ({ children }) => <p className="text-xs leading-relaxed mb-3 last:mb-0 text-zinc-300 font-sans">{children}</p>,
                                a: ({ href, children }) => (
                                  <a 
                                    href={href} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors break-all"
                                  >
                                    {children}
                                  </a>
                                ),
                                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-xs text-zinc-300 pl-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-xs text-zinc-300 pl-1">{children}</ol>,
                                li: ({ children }) => <li className="text-xs leading-relaxed text-zinc-300">{children}</li>,
                                blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-sky-500/60 bg-zinc-950/60 py-2 px-3 rounded-r-md text-zinc-400 text-xs italic">{children}</blockquote>,
                                img: ({ src, alt, ...props }) => <img src={src} alt={alt || 'Image'} className="max-w-full rounded-lg border border-white/10 my-3 shadow-md object-contain" {...props} />,
                                table: ({ children }) => (
                                  <div className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-zinc-950/80">
                                    <table className="w-full text-left text-xs border-collapse font-sans">{children}</table>
                                  </div>
                                ),
                                thead: ({ children }) => <thead className="bg-zinc-900 border-b border-white/10 text-zinc-200 font-semibold uppercase text-[10px]">{children}</thead>,
                                tbody: ({ children }) => <tbody className="divide-y divide-white/5 text-zinc-300">{children}</tbody>,
                                tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
                                th: ({ children }) => <th className="px-3 py-2 font-medium border-r border-white/5 last:border-r-0">{children}</th>,
                                td: ({ children }) => <td className="px-3 py-2 text-zinc-300 border-r border-white/5 last:border-r-0">{children}</td>,
                                hr: () => <hr className="my-4 border-white/10" />,
                                code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <div className="relative group my-3 border border-white/10 rounded-lg overflow-hidden bg-zinc-950 shadow-md">
                                      <div className="flex items-center justify-between bg-zinc-900 border-b border-white/5 px-3 py-1.5 select-none">
                                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">{match[1]}</span>
                                        <button
                                          onClick={(e) => {
                                            navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                                            const btn = e.currentTarget;
                                            btn.textContent = 'Copied!';
                                            setTimeout(() => btn.textContent = 'Copy', 2000);
                                          }}
                                          className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono transition-colors cursor-pointer"
                                        >
                                          Copy
                                        </button>
                                      </div>
                                      <div className="p-3 overflow-x-auto custom-scrollbar text-[11px] font-mono text-zinc-300 leading-normal">
                                        <code className={className} {...props}>
                                          {children}
                                        </code>
                                      </div>
                                    </div>
                                  ) : (
                                    <code className="bg-zinc-800/80 px-1.5 py-0.5 rounded border border-white/10 text-sky-300 font-mono text-[11px]" {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                              }}
                            >
                              {modelReadme.replace(/^---[\s\S]*?---\s*/, '')}
                            </ReactMarkdown>
                          ) : (
                            <span className="text-zinc-500 italic">No README content found for this repository.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                    <div className="flex items-center justify-between border-b border-white/5 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            Verified 1-Click Complete Packs
                          </h3>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          Unified bundles that automatically package Core weights, Projectors, and VAEs. Zero manual plugging.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/10">
                          Plug & Play
                        </span>
                        <button 
                          onClick={() => setIsModelHubOpen(false)}
                          className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
                          title="Close Hub (Esc)"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {VERIFIED_IMAGE_PACKS.map(pack => {
                        // Check if all files in the pack are already downloaded
                        const filesStatus = pack.files.map(f => {
                          const isPresent = localModels.some(m => m.id.toLowerCase().includes(f.filename.toLowerCase()));
                          const isDownloading = activeDownloads.some(d => d.model_name.toLowerCase().includes(f.filename.toLowerCase()));
                          return { ...f, isPresent, isDownloading };
                        });
                        const allPresent = filesStatus.every(f => f.isPresent);
                        const anyDownloading = filesStatus.some(f => f.isDownloading);

                        return (
                          <div key={pack.id} className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3.5 hover:border-white/20 transition-all">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-zinc-100 font-mono">{pack.title}</h4>
                                  <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-semibold ${pack.badgeColor}`}>
                                    {pack.badge}
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{pack.description}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-xs font-mono font-bold text-zinc-200 block">{pack.totalSize}</span>
                                <span className="text-[10px] font-mono text-zinc-500 block">{pack.targetVram}</span>
                              </div>
                            </div>

                            {/* Files bundled list */}
                            <div className="bg-[#18181b] rounded-lg p-2.5 border border-white/5 space-y-1.5">
                              <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block font-mono">
                                Included Components ({pack.files.length} Files):
                              </span>
                              {filesStatus.map((f, i) => (
                                <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-zinc-500">{i + 1}.</span>
                                    <span className="text-zinc-300 font-semibold truncate">{f.name}</span>
                                    <span className="text-[10px] text-zinc-500 truncate">({f.role})</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-zinc-500">{f.size}</span>
                                    {f.isPresent ? (
                                      <span className="text-emerald-400 text-[10px] font-semibold">✓ Ready</span>
                                    ) : f.isDownloading ? (
                                      <span className="text-sky-400 text-[10px] font-semibold animate-pulse">Downloading...</span>
                                    ) : (
                                      <span className="text-zinc-600 text-[10px]">Pending</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Action Button */}
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[10px] font-mono text-zinc-500">
                                {allPresent ? 'All components found in local models' : `${filesStatus.filter(f => !f.isPresent).length} components to download`}
                              </span>

                              {allPresent ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsModelHubOpen(false);
                                    const coreFile = pack.files[0];
                                    const match = localModels.find(m => m.id.toLowerCase().includes(coreFile.filename.toLowerCase()));
                                    if (match) {
                                      setSelectedModelToLoad(match.id);
                                      setLoadTarget('diffusion');
                                      setLoadBackend('stable-diffusion.cpp');
                                      setLoadModelModalOpen(true);
                                    }
                                  }}
                                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                  <span>Configure & Load Engine</span>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={anyDownloading}
                                  onClick={() => {
                                    filesStatus.filter(f => !f.isPresent).forEach(f => {
                                      vscodeApi?.postMessage({
                                        command: 'downloadLocalModel',
                                        url: f.url,
                                        filename: f.filename
                                      });
                                    });
                                    vscodeApi?.postMessage({
                                      command: 'showNotification',
                                      message: `Queued 1-Click download for ${pack.title} components`
                                    });
                                  }}
                                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 text-black hover:bg-zinc-200 transition-colors flex items-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  <span>{anyDownloading ? 'Downloading Pack...' : `Download Complete Pack (${pack.totalSize})`}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* LM Studio-Style Model Hardware Configuration Sub-Window */}
      {loadModelModalOpen && (() => {
        const effectiveModelPath = selectedModelToLoad || (loadTarget === 'diffusion' ? (localModels.find(m => m.id.toLowerCase().includes('sd') || m.id.toLowerCase().includes('turbo') || m.id.toLowerCase().includes('diffusion'))?.id || localModels[0]?.id || '') : (localModels[0]?.id || ''));
        const modelObj = localModels.find(m => m.id === effectiveModelPath);
        const displayName = modelObj?.name || formatModelDisplayName(effectiveModelPath) || (loadTarget === 'diffusion' ? 'Diffusion Engine' : 'Configure Model');
        
        // Extract Quantization tag
        const quant = modelObj?.quantization || (effectiveModelPath.match(/(Q\d+_[A-Za-z0-9_]+|FP16|BF16|Q\d+_\d+|IQ\d+_[A-Za-z0-9_]+)/i)?.[1].toUpperCase() || 'Q4_K_M');
        
        // Extract Param Size tag
        const paramMatch = effectiveModelPath.match(/(\d+(\.\d+)?B(-[A-Za-z0-9]+)?)/i);
        const paramSize = paramMatch ? paramMatch[1].toUpperCase() : '7B';
        
        // Size in GB
        let sizeGb = 4.5;
        if (modelObj?.size_display) {
          const parsed = parseFloat(modelObj.size_display);
          if (!isNaN(parsed)) {
            if (modelObj.size_display.includes('GB')) sizeGb = parsed;
            else if (modelObj.size_display.includes('MB')) sizeGb = parsed / 1024;
          }
        }
        
        // Dynamic Model Geometry from GGUF metadata
        const maxContextLength = modelObj?.max_context_length || (paramSize.includes('26B') || paramSize.includes('35B') ? 262144 : (paramSize.includes('3B') || paramSize.includes('7B') || paramSize.includes('8B') ? 131072 : 32768));
        const totalModelLayers = modelObj?.total_layers || (paramSize.includes('26B') ? 31 : (paramSize.includes('31B') || paramSize.includes('32B') ? 61 : (paramSize.includes('35B') ? 41 : (paramSize.includes('14B') ? 49 : (paramSize.includes('1B') ? 27 : 33)))));
        
        const currentGpuLayers = nGPULayers < 0 ? totalModelLayers : Math.min(totalModelLayers, nGPULayers);
        const offloadLayers = currentGpuLayers;
        const offloadRatio = totalModelLayers > 0 ? currentGpuLayers / totalModelLayers : 1;

        // Real-time Memory Physics & KV Quantization Footprint Savings Calculation
        const kvRatio = sizeGb > 12 ? 0.26 : (sizeGb > 6 ? 0.16 : 0.08); // GB per 1024 tokens of full standard KV cache
        const ctxK = ctxSize / 1024;
        
        // KV Quant multiplier: Q8_0 is ~52% of FP16, Q4_0 is ~28% of FP16
        const kvQuantMultiplier = kvQuant === 'q4_0' ? 0.28 : (kvQuant === 'q8_0' ? 0.52 : (kvQuant === 'q5_0' ? 0.35 : 1.0));

        // 1. Standard Attention (without Flash Attention)
        const stdKvGb = ctxK * kvRatio * kvQuantMultiplier;
        // Standard attention quadratic activation scratch matrix: O(S^2)
        const stdScratchGb = Math.min(16, Math.max(0.35, ctxK * 0.12 + 0.000000045 * (ctxSize * ctxSize)));
        const stdTotalContextGb = (stdKvGb + stdScratchGb) * offloadRatio;
        
        // 2. Flash Attention (with Flash Attention enabled)
        // Flash Attention computes attention in tiled on-chip SRAM: O(1) activation memory (~30MB)
        const faKvGb = ctxK * kvRatio * 0.78 * kvQuantMultiplier;
        const faScratchGb = 0.03; // ~30 MB on-chip GPU SRAM tile buffer
        const faTotalContextGb = (faKvGb + faScratchGb) * offloadRatio;

        // 3. Realtime VRAM Saved
        const savedVramGb = Math.max(0.1, (stdTotalContextGb - faTotalContextGb)).toFixed(2);
        
        // 4. Final Estimated Footprint
        const weightsGpuGb = sizeGb * offloadRatio;
        const activeContextGpuGb = flashAttn ? faTotalContextGb : stdTotalContextGb;
        const estimatedGpuGb = (weightsGpuGb + activeContextGpuGb + 0.25).toFixed(2);
        const activeContextTotalGb = flashAttn ? (faKvGb + faScratchGb) : (stdKvGb + stdScratchGb);
        const estimatedTotalGb = (sizeGb + activeContextTotalGb + 0.45).toFixed(2);

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150"
            onClick={() => setLoadModelModalOpen(false)}
          >
            <div 
              className="bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-zinc-900/40">
                <div className="flex items-center gap-3 min-w-0">
                  <button 
                    onClick={() => setLoadModelModalOpen(false)}
                    className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    title="Back"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <h3 className="text-base font-bold text-white truncate">{displayName}</h3>
                </div>
                <button 
                  onClick={() => setLoadModelModalOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              
              <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                {/* Target Engine Slot */}
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Target Engine Slot</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLoadTarget('primary');
                        if (loadBackend === 'stable-diffusion.cpp') setLoadBackend('llama.cpp');
                      }}
                      className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                        loadTarget === 'primary' 
                          ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                          : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-semibold">Primary Agent</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Chat, Code Gen & Reasoning</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoadTarget('ghost');
                        if (loadBackend === 'stable-diffusion.cpp') setLoadBackend('llama.cpp');
                      }}
                      className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                        loadTarget === 'ghost' 
                          ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                          : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-semibold">Inline Ghost</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">FIM Autocomplete</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoadTarget('diffusion');
                        setLoadBackend('stable-diffusion.cpp');
                        const match = localModels.find(x => x.id.toLowerCase().includes('qwen3-vl') || x.id.toLowerCase().includes('mmproj'));
                        if (match && !selectedMmprojPath) setSelectedMmprojPath(match.id);
                        if (!selectedVaePath) setSelectedVaePath('qwen_image_2.1_vae_bf16.safetensors');
                      }}
                      className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                        loadTarget === 'diffusion' 
                          ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                          : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-semibold">Vision & Diffusion</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Images, Visual Synthesis & Video</div>
                    </button>
                  </div>
                </div>

                {/* Model File Selection */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium text-zinc-400">Model File</label>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {localModels.length} local file{localModels.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {localModels.length > 0 ? (
                    <select
                      value={selectedModelToLoad}
                      onChange={(e) => setSelectedModelToLoad(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500 cursor-pointer"
                    >
                      {localModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name || formatModelDisplayName(m.id)} ({m.size_display || 'Local'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="p-3 rounded-xl bg-zinc-900/60 border border-white/5 text-xs text-zinc-400 flex items-center justify-between">
                      <span>No models found in your local models directory.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setLoadModelModalOpen(false);
                          setIsModelHubOpen(true);
                        }}
                        className="text-[11px] text-blue-400 hover:text-blue-300 underline font-medium cursor-pointer"
                      >
                        Browse Hub
                      </button>
                    </div>
                  )}
                </div>

                {/* Diffusion Multimodal Pipeline Configuration (Port 47992) */}
                {loadTarget === 'diffusion' && (() => {
                  const pipe = resolveImageGenPipeline(selectedModelToLoad, localModels);
                  const isStandalone = pipe.family === 'sd15' || pipe.family === 'sdxl' || pipe.family === 'standalone' || pipe.vaeType === 'embedded';

                  const encoderDl = activeDownloads.find(d => 
                    d.model_name === pipe.recommendedEncoderName || 
                    d.model_name.toLowerCase().includes('clip_l') ||
                    (pipe.encoderDownloadUrl && (d as any).url === pipe.encoderDownloadUrl)
                  );
                  const vaeDl = activeDownloads.find(d => 
                    d.model_name === pipe.recommendedVaeName || 
                    d.model_name.toLowerCase().includes('ae.safetensors') ||
                    (pipe.vaeDownloadUrl && (d as any).url === pipe.vaeDownloadUrl)
                  );

                  return (
                    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-4 shadow-xl">
                      {/* Architecture Header */}
                      <div className="flex items-center justify-between border-b border-white/5 pb-3">
                        <div>
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            {pipe.familyTitle}
                          </h4>
                          <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                            {pipe.architectureDescription}
                          </p>
                        </div>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 ${
                          pipe.isReady 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        }`}>
                          {pipe.isReady ? '✓ READY TO ATOMIC LOAD' : '⚠️ COMPANIONS REQUIRED'}
                        </span>
                      </div>

                      {/* If Standalone: Confirms Single Checkpoint without confusion */}
                      {isStandalone ? (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3.5 flex items-start gap-3">
                          <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="space-y-1">
                            <div className="text-xs font-bold text-emerald-300">Standalone Single Checkpoint</div>
                            <div className="text-[11px] text-zinc-300 leading-relaxed">
                              This model has its Text Encoder (CLIP) and Variational Autoencoder (VAE) baked directly inside the single checkpoint file. Zero companion files or external projectors needed.
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* 3-Stage Visual Pipeline Matrix - Spacious & Readable */
                        <div className="space-y-2">
                          <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider font-mono">
                            Synchronized Pipeline Stages (Loaded Atomically):
                          </div>

                          <div className="space-y-2">
                            {/* Stage 1: Text & Prompt Conditioner */}
                            <div className="p-3.5 rounded-xl border bg-[#18181b] border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono">Stage 1: Conditioner</span>
                                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-medium ${
                                    pipe.encoderStatus === 'auto-connected' 
                                      ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' 
                                      : encoderDl 
                                      ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' 
                                      : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                  }`}>
                                    {pipe.encoderStatus === 'auto-connected' ? '✓ Linked' : encoderDl ? 'Downloading' : 'Missing'}
                                  </span>
                                </div>
                                <div className="text-xs font-semibold text-zinc-200 font-mono">
                                  {pipe.encoderTitle}
                                </div>
                                <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                                  File: <span className="text-zinc-300 font-medium">{pipe.encoderFileDisplay}</span>
                                </div>
                              </div>
                              {pipe.encoderStatus === 'missing' && (
                                encoderDl ? (
                                  <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-[140px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                                      <span className="text-xs font-mono text-cyan-400 font-semibold">
                                        {encoderDl.percent.toFixed(1)}%
                                      </span>
                                      <span className="text-[10px] font-mono text-zinc-400">
                                        ({encoderDl.status})
                                      </span>
                                    </div>
                                    <div className="w-36 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                      <div 
                                        className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${Math.max(3, Math.min(100, encoderDl.percent))}%` }}
                                      />
                                    </div>
                                    {encoderDl.speed_display && (
                                      <span className="text-[10px] text-zinc-400 font-mono">{encoderDl.speed_display}</span>
                                    )}
                                  </div>
                                ) : pipe.encoderDownloadUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      vscodeApi?.postMessage({
                                        command: 'downloadLocalModel',
                                        url: pipe.encoderDownloadUrl,
                                        filename: pipe.recommendedEncoderName
                                      });
                                      vscodeApi?.postMessage({
                                        command: 'showNotification',
                                        message: `Downloading companion projector ${pipe.recommendedEncoderName}...`
                                      });
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 text-xs font-mono font-medium transition-colors shrink-0 cursor-pointer"
                                  >
                                    1-Click Install ({pipe.encoderDownloadSize})
                                  </button>
                                ) : null
                              )}
                            </div>

                            {/* Stage 2: Diffusion Core */}
                            <div className="p-3.5 rounded-xl border bg-[#18181b] border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono">Stage 2: Core Backbone</span>
                                  <span className="text-[9px] font-mono px-2 py-0.5 rounded font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20">
                                    ✓ DiT / UNet
                                  </span>
                                </div>
                                <div className="text-xs font-semibold text-zinc-200 font-mono">
                                  {pipe.coreType}
                                </div>
                                <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                                  File: <span className="text-zinc-300 font-medium">{pipe.coreName}</span>
                                </div>
                              </div>
                              <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                                Primary latent denoising tensor
                              </span>
                            </div>

                            {/* Stage 3: VAE Decoder */}
                            <div className="p-3.5 rounded-xl border bg-[#18181b] border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider font-mono">Stage 3: VAE Decoder</span>
                                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-medium ${
                                    pipe.vaeStatus === 'auto-connected' 
                                      ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' 
                                      : vaeDl 
                                      ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' 
                                      : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                  }`}>
                                    {pipe.vaeStatus === 'auto-connected' ? '✓ Linked' : vaeDl ? 'Downloading' : 'Missing'}
                                  </span>
                                </div>
                                <div className="text-xs font-semibold text-zinc-200 font-mono">
                                  {pipe.vaeTitle}
                                </div>
                                <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                                  File: <span className="text-zinc-300 font-medium">{pipe.vaeFileDisplay}</span>
                                </div>
                              </div>
                              {pipe.vaeStatus === 'missing' && (
                                vaeDl ? (
                                  <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-[140px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                                      <span className="text-xs font-mono text-cyan-400 font-semibold">
                                        {vaeDl.percent.toFixed(1)}%
                                      </span>
                                      <span className="text-[10px] font-mono text-zinc-400">
                                        ({vaeDl.status})
                                      </span>
                                    </div>
                                    <div className="w-36 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                      <div 
                                        className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${Math.max(3, Math.min(100, vaeDl.percent))}%` }}
                                      />
                                    </div>
                                    {vaeDl.speed_display && (
                                      <span className="text-[10px] text-zinc-400 font-mono">{vaeDl.speed_display}</span>
                                    )}
                                  </div>
                                ) : pipe.vaeDownloadUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      vscodeApi?.postMessage({
                                        command: 'downloadLocalModel',
                                        url: pipe.vaeDownloadUrl,
                                        filename: pipe.recommendedVaeName
                                      });
                                      vscodeApi?.postMessage({
                                        command: 'showNotification',
                                        message: `Downloading companion VAE ${pipe.recommendedVaeName}...`
                                      });
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 text-xs font-mono font-medium transition-colors shrink-0 cursor-pointer"
                                  >
                                    1-Click Install ({pipe.vaeDownloadSize})
                                  </button>
                                ) : null
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Companion Vision Projector for Primary LLM (Multimodal) */}
                {loadTarget === 'primary' && localModels.some(m => m.id.toLowerCase().startsWith('mmproj-') || m.id.toLowerCase().includes('-mmproj-')) && (
                  <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-zinc-200">Multimodal Vision Projector (mmproj)</span>
                        <span className="text-[9px] bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded font-mono border border-amber-500/20">Optional</span>
                      </div>
                      <span className="text-[10px] text-zinc-500">Enables Image Input in Chat</span>
                    </div>
                    <select
                      value={selectedMmprojPath}
                      onChange={(e) => setSelectedMmprojPath(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500 cursor-pointer"
                    >
                      <option value="">None (Text & Code Only)</option>
                      {localModels.filter(m => m.id.toLowerCase().includes('mmproj') || m.id.toLowerCase().includes('vl')).map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id.split('/').pop()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Estimated Memory Usage Bar */}
                {loadTarget === 'diffusion' ? (
                  <div className="bg-zinc-900/90 border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-200">Diffusion Footprint</span>
                        <span className="text-[10px] bg-zinc-800 text-zinc-300 border border-white/5 px-2 py-0.5 rounded font-mono font-medium">
                          Port 47992 Visual Pipeline
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs">
                        <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                          <span className="text-zinc-500 font-medium">Model Size</span>
                          <span className="font-bold text-zinc-200">{sizeGb.toFixed(2)} GB</span>
                        </div>
                        <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                          <span className="text-zinc-500 font-medium">Resolution</span>
                          <span className="text-zinc-200 font-bold">{diffusionResolution}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-zinc-900/90 border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-200">Estimated Memory Usage</span>
                        {flashAttn ? (
                          <span className="text-[10px] bg-zinc-800 text-zinc-300 border border-white/5 px-2 py-0.5 rounded font-mono font-medium">
                            Flash Attention Active (-{savedVramGb} GB VRAM)
                          </span>
                        ) : (
                          <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-white/5 px-2 py-0.5 rounded font-mono">
                            Standard Attention (+{savedVramGb} GB Overhead)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs">
                        <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                          <span className="text-zinc-500 font-medium">GPU VRAM</span>
                          <span className="font-bold text-zinc-200">{estimatedGpuGb} GB</span>
                        </div>
                        <div className="bg-zinc-950/80 border border-white/5 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                          <span className="text-zinc-500 font-medium">Total RAM</span>
                          <span className="text-zinc-200 font-bold">{estimatedTotalGb} GB</span>
                        </div>
                      </div>
                    </div>

                    {/* Real-time Flash Attention Memory Breakdown Mini-Bar */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono">
                      <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                        <div className="text-zinc-500 text-[10px]">Model Weights</div>
                        <div className="text-zinc-300 font-semibold">{weightsGpuGb.toFixed(2)} GB</div>
                      </div>
                      <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                        <div className="text-zinc-500 text-[10px]">KV Cache ({Math.round(ctxSize / 1024)}k, {kvQuant.toUpperCase()})</div>
                        <div className="text-zinc-300 font-semibold">
                          {(flashAttn ? faKvGb : stdKvGb).toFixed(2)} GB 
                          {flashAttn && <span className="text-zinc-400 text-[9px] ml-1">(-{((stdKvGb - faKvGb) * offloadRatio).toFixed(2)}G)</span>}
                        </div>
                      </div>
                      <div className="bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                        <div className="text-zinc-500 text-[10px]">Attn Scratch Buffer</div>
                        <div className="text-zinc-300 font-semibold">
                          {flashAttn ? (
                            <span className="text-zinc-300 font-semibold">O(1) 30MB</span>
                          ) : (
                            <span className="text-zinc-300 font-semibold">{stdScratchGb.toFixed(2)} GB</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Model Selection Dropdown */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-zinc-400">Target Model File</label>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {localModels.length} Models on Disk
                    </span>
                  </div>
                  <select
                    value={effectiveModelPath}
                    onChange={(e) => setSelectedModelToLoad(e.target.value)}
                    className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-500 cursor-pointer"
                  >
                    {localModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id.split('/').pop()} ({m.size_display || 'GGUF'}) {m.quantization ? `[${m.quantization}]` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="bg-zinc-950/40 border border-white/5 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200 truncate">{displayName}</span>
                    <span className="text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-white/5">{quant}</span>
                    <span className="text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-white/5">{paramSize}</span>
                    <span className="text-[10px] font-mono font-bold bg-sky-500/15 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20">
                      {loadTarget === 'diffusion' ? 'DIFFUSION' : 'GGUF'}
                    </span>
                  </div>
                </div>

                {/* Diffusion Parameters (when target is diffusion) */}
                {loadTarget === 'diffusion' ? (
                  <>
                    {/* Canvas Resolution & Aspect Ratio */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-300">Canvas Resolution & Aspect Ratio</span>
                        <span className="font-mono text-xs font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/25 px-2 py-0.5 rounded-md">
                          {diffusionResolution}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { res: '1024x1024', label: '1024 × 1024', sub: 'Square 1:1' },
                          { res: '1152x896', label: '1152 × 896', sub: 'Landscape 4:3' },
                          { res: '896x1152', label: '896 × 1152', sub: 'Portrait 3:4' },
                          { res: '1280x720', label: '1280 × 720', sub: 'Widescreen 16:9' },
                          { res: '768x768', label: '768 × 768', sub: 'Compact Square' },
                          { res: '512x512', label: '512 × 512', sub: 'Fast Draft (SD1.5)' }
                        ].map(item => {
                          const isSelected = diffusionResolution === item.res;
                          return (
                            <button
                              key={item.res}
                              type="button"
                              onClick={() => {
                                setDiffusionResolution(item.res);
                                setImageStudioSize(item.res);
                              }}
                              className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer relative ${
                                isSelected 
                                  ? 'bg-blue-600/20 text-white border-blue-500/60 ring-1 ring-blue-500/40 shadow-sm shadow-blue-500/10' 
                                  : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300 hover:bg-zinc-900/50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold font-mono">{item.label}</span>
                                {isSelected && (
                                  <span className="text-blue-400 text-xs font-bold">✓</span>
                                )}
                              </div>
                              <div className={`text-[10px] mt-0.5 ${isSelected ? 'text-blue-300/80' : 'text-zinc-500'}`}>
                                {item.sub}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sampling Steps */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-300">Sampling Steps</span>
                          <span className="text-zinc-500 text-[10px]" title="Number of iterative denoising steps. Higher values yield more refined details.">(?)</span>
                        </div>
                        <input 
                          type="number"
                          value={diffusionSteps}
                          onChange={(e) => setDiffusionSteps(Math.max(1, Math.min(60, Number(e.target.value))))}
                          className="w-20 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-blue-500/50"
                          min={1}
                          max={60}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                        <span>Recommended: <span className="text-zinc-300 font-mono">4</span> (Turbo/Schnell) • <span className="text-zinc-300 font-mono">20-28</span> (SDXL/Flux)</span>
                        <span className="font-mono text-zinc-400">{diffusionSteps} steps</span>
                      </div>
                      <input 
                        type="range"
                        min={1}
                        max={50}
                        value={diffusionSteps}
                        onChange={(e) => setDiffusionSteps(Number(e.target.value))}
                        className="w-full accent-blue-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex items-center gap-1.5 pt-1">
                        {[4, 10, 20, 28, 40].map((steps) => (
                          <button
                            key={steps}
                            type="button"
                            onClick={() => setDiffusionSteps(steps)}
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${diffusionSteps === steps ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                          >
                            {steps === 4 ? '4 (Turbo)' : steps === 20 ? '20 (Fast)' : steps === 28 ? '28 (Standard)' : `${steps} steps`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Classifier-Free Guidance (CFG Scale) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-300">Classifier-Free Guidance (CFG Scale)</span>
                          <span className="text-zinc-500 text-[10px]" title="Controls how strictly the generation adheres to the text prompt.">(?)</span>
                        </div>
                        <input 
                          type="number"
                          step={0.5}
                          value={diffusionCfgScale}
                          onChange={(e) => setDiffusionCfgScale(Math.max(1.0, Math.min(20.0, Number(e.target.value))))}
                          className="w-20 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-blue-500/50"
                          min={1.0}
                          max={20.0}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                        <span>Prompt fidelity strength</span>
                        <span className="font-mono text-zinc-400">{diffusionCfgScale.toFixed(1)} CFG</span>
                      </div>
                      <input 
                        type="range"
                        min={1.0}
                        max={15.0}
                        step={0.5}
                        value={diffusionCfgScale}
                        onChange={(e) => setDiffusionCfgScale(Number(e.target.value))}
                        className="w-full accent-blue-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex items-center gap-1.5 pt-1">
                        {[
                          { val: 1.0, label: '1.0 (Schnell / Distilled)' },
                          { val: 3.5, label: '3.5 (FLUX Dev)' },
                          { val: 7.0, label: '7.0 (SDXL / SD1.5 Standard)' },
                          { val: 9.0, label: '9.0 (High Guidance)' }
                        ].map(p => (
                          <button
                            key={p.val}
                            type="button"
                            onClick={() => setDiffusionCfgScale(p.val)}
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${diffusionCfgScale === p.val ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* VAE Tiling (Low VRAM Protection) */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                      <div className="pr-3">
                        <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <span>VAE Tiling (Low VRAM Protection)</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono font-medium border border-zinc-700">Recommended</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                          Decodes images in memory-efficient spatial tiles to prevent GPU Out-of-Memory (OOM) errors during high-resolution decoding on smaller GPUs.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDiffusionVaeTiling(!diffusionVaeTiling)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${diffusionVaeTiling ? 'bg-blue-600' : 'bg-zinc-700'}`}
                        title="Toggle VAE Tiling"
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${diffusionVaeTiling ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Context Length */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-300">Context Length</span>
                          <span className="text-zinc-500 text-[10px]" title="Context buffer token capacity for prompts and memory">(?)</span>
                        </div>
                        <input 
                          type="number"
                          value={ctxSize}
                          onChange={(e) => setCtxSize(Math.max(1024, Math.min(maxContextLength, Number(e.target.value))))}
                          className="w-28 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                          step={1024}
                          min={1024}
                          max={maxContextLength}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                        <span>Model natively supports up to <span className="text-sky-400 font-mono font-semibold">{maxContextLength.toLocaleString()}</span> tokens</span>
                        <span className="font-mono text-zinc-400">{Math.round(ctxSize / 1024)}K tokens</span>
                      </div>
                      <input 
                        type="range"
                        min={2048}
                        max={maxContextLength}
                        step={1024}
                        value={ctxSize}
                        onChange={(e) => setCtxSize(Number(e.target.value))}
                        className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                      {/* Preset quick buttons */}
                      <div className="flex items-center gap-1.5 pt-1">
                        {[4096, 8192, 16384, 32768, 65536, 131072, maxContextLength]
                          .filter((val, idx, arr) => val <= maxContextLength && arr.indexOf(val) === idx)
                          .map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setCtxSize(preset)}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${ctxSize === preset ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                            >
                              {preset === maxContextLength ? `Max (${Math.round(preset / 1024)}K)` : `${Math.round(preset / 1024)}K`}
                            </button>
                          ))}
                      </div>
                    </div>

                    {/* Max Generation Output Tokens (Horizon) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-300">Max Generation Tokens (Output Limit)</span>
                          <span className="text-zinc-500 text-[10px]" title="Maximum output tokens the model can produce in a single response turn">(?)</span>
                        </div>
                        <input 
                          type="number"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(Math.max(512, Math.min(ctxSize, Number(e.target.value))))}
                          className="w-28 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                          step={1024}
                          min={512}
                          max={ctxSize}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center justify-between">
                        <span>Upper generation horizon: <span className="text-sky-400 font-mono font-semibold">{maxTokens.toLocaleString()}</span> tokens</span>
                        <span className="font-mono text-zinc-400">{Math.round(maxTokens / 1024)}K max output</span>
                      </div>
                      <input 
                        type="range"
                        min={1024}
                        max={Math.min(65536, ctxSize)}
                        step={1024}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                      {/* Preset quick buttons */}
                      <div className="flex items-center gap-1.5 pt-1">
                        {[2048, 4096, 8192, 16384, 32768, 65536]
                          .filter((val, idx, arr) => val <= ctxSize && arr.indexOf(val) === idx)
                          .map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setMaxTokens(preset)}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${maxTokens === preset ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold' : 'bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200'}`}
                            >
                              {Math.round(preset / 1024)}K
                            </button>
                          ))}
                      </div>
                    </div>
                  </>
                )}

                {/* GPU Offload */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">GPU Offload</span>
                      <span className="text-zinc-500 text-[10px]" title="Number of transformer layers offloaded to GPU">(?)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="number"
                        value={nGPULayers < 0 ? totalModelLayers : nGPULayers}
                        onChange={(e) => setNGPULayers(Number(e.target.value))}
                        className="w-24 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                        min={0}
                        max={totalModelLayers}
                      />
                      <button
                        onClick={() => setNGPULayers(nGPULayers < 0 ? currentGpuLayers : -1)}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md border transition-colors ${nGPULayers < 0 ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' : 'bg-zinc-800 text-zinc-400 border-transparent hover:bg-zinc-700'}`}
                      >
                        All ({totalModelLayers})
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Offload layers to <span className="text-zinc-400 font-medium">AMD Radeon 760M (Vulkan)</span> ({offloadLayers}/{totalModelLayers} layers)
                  </div>
                  <input 
                    type="range"
                    min={0}
                    max={totalModelLayers}
                    value={offloadLayers}
                    onChange={(e) => setNGPULayers(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* CPU Thread Pool Size */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">CPU Thread Pool Size</span>
                      <span className="text-zinc-500 text-[10px]" title="Threads utilized for host CPU matrix ops and token generation">(?)</span>
                    </div>
                    <input 
                      type="number"
                      value={nThreads}
                      onChange={(e) => setNThreads(Math.max(1, Number(e.target.value)))}
                      className="w-24 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                      min={1}
                      max={16}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Physical Zen 4 CPU cores for host execution (recommended: 4 or 6)
                  </div>
                  <input 
                    type="range"
                    min={1}
                    max={12}
                    value={nThreads}
                    onChange={(e) => setNThreads(Number(e.target.value))}
                    className="w-full accent-sky-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* LLM Inference Tuning (Only for Primary LLM and Ghost) */}
                {loadTarget !== 'diffusion' && (
                  <>
                    {/* Batch Sizes (Evaluation & Physical) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Evaluation Batch Size (n_batch) */}
                      <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-medium text-zinc-300">Evaluation Batch</span>
                            <span className="text-zinc-500 text-[10px]" title="Prompt parallel throughput chunk size (n_batch)">(?)</span>
                          </div>
                          <input 
                            type="number"
                            value={nBatch}
                            onChange={(e) => setNBatch(Math.max(128, Number(e.target.value)))}
                            className="w-16 bg-zinc-950 border border-white/10 rounded-lg px-2 py-0.5 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                            step={128}
                            min={128}
                            max={4096}
                          />
                        </div>
                        <input 
                          type="range"
                          min={256}
                          max={4096}
                          step={256}
                          value={nBatch}
                          onChange={(e) => setNBatch(Number(e.target.value))}
                          className="w-full accent-sky-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>

                      {/* Physical Batch Size (n_ubatch) */}
                      <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-medium text-zinc-300">Physical Batch</span>
                            <span className="text-zinc-500 text-[10px]" title="Micro-batch dispatch size for GPU queue (n_ubatch)">(?)</span>
                          </div>
                          <input 
                            type="number"
                            value={nUbatch}
                            onChange={(e) => setNUbatch(Math.max(64, Number(e.target.value)))}
                            className="w-16 bg-zinc-950 border border-white/10 rounded-lg px-2 py-0.5 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                            step={64}
                            min={64}
                            max={1024}
                          />
                        </div>
                        <input 
                          type="range"
                          min={128}
                          max={1024}
                          step={64}
                          value={nUbatch}
                          onChange={(e) => setNUbatch(Number(e.target.value))}
                          className="w-full accent-sky-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Model Sampling Temperature */}
                    <div className="space-y-1.5 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-zinc-300">Model Temperature</span>
                          <span className="text-[9px] font-mono text-zinc-500">
                            {modelTemperature <= 0.2 ? 'Deterministic & Exact Code' : modelTemperature <= 0.7 ? 'Balanced Reasoning' : 'Creative Exploration'}
                          </span>
                        </div>
                        <input 
                          type="number"
                          value={modelTemperature}
                          onChange={(e) => setModelTemperature(Math.max(0, Math.min(1.5, Number(e.target.value))))}
                          className="w-16 bg-zinc-950 border border-white/10 rounded-lg px-2 py-0.5 text-xs text-right font-mono text-white focus:outline-none focus:border-sky-500/50"
                          step={0.05}
                          min={0}
                          max={1.5}
                        />
                      </div>
                      <input 
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={modelTemperature}
                        onChange={(e) => setModelTemperature(Number(e.target.value))}
                        className="w-full accent-sky-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* KV Cache Quantization */}
                    <div className="pt-2 border-t border-white/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <span>KV Cache Quantization</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono font-medium border border-zinc-700">
                            {kvQuant === 'q4_0' ? '-75% VRAM' : kvQuant === 'q8_0' ? '-50% VRAM' : 'Lossless'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400">
                          {kvQuant === 'q4_0' ? 'Q4_0 (Max Context)' : kvQuant === 'q8_0' ? 'Q8_0 (Recommended)' : 'FP16 (Full Precision)'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setKvQuant('q8_0')}
                          className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                            kvQuant === 'q8_0' 
                              ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                              : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                          }`}
                        >
                          <div className="text-xs font-semibold">Q8_0</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">50% VRAM Reduction (Optimal)</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setKvQuant('q4_0')}
                          className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                            kvQuant === 'q4_0' 
                              ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                              : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                          }`}
                        >
                          <div className="text-xs font-semibold">Q4_0</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">75% VRAM Reduction (Large Context)</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setKvQuant('f16')}
                          className={`px-3 py-2 rounded-xl text-left border transition-colors ${
                            kvQuant === 'f16' 
                              ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm' 
                              : 'bg-zinc-950/40 text-zinc-400 border-white/5 hover:border-white/10 hover:text-zinc-300'
                          }`}
                        >
                          <div className="text-xs font-semibold">FP16</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">Standard Unquantized</div>
                        </button>
                      </div>
                    </div>

                    {/* Flash Attention Toggle */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                      <div className="pr-3">
                        <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <span>Flash Attention (VRAM & Speed Optimization)</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono font-medium border border-zinc-700">Vulkan / CUDA</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                          {flashAttn 
                            ? "Calculates attention in tiled on-chip cache. Reduces KV cache memory footprint & boosts prompt processing speeds by 2-3x." 
                            : "Standard attention calculation."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFlashAttn(!flashAttn)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${flashAttn ? 'bg-sky-500' : 'bg-zinc-700'}`}
                        title="Toggle Flash Attention"
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${flashAttn ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  </>
                )}

                {/* Direct GPU Memory Allocation Toggle */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <div className="pr-3">
                    <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span>Direct GPU Memory Allocation (no-mmap)</span>
                      <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-medium border border-emerald-500/20">iGPU / VRAM</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                      {directGpuMemory 
                        ? "Allocates explicit device memory buffer objects (visible in system GPU/VRAM manager like LM Studio)." 
                        : "Uses fast virtual memory mapping (mmap)."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirectGpuMemory(!directGpuMemory)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${directGpuMemory ? 'bg-sky-500' : 'bg-zinc-700'}`}
                    title="Toggle Direct GPU Memory Allocation"
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${directGpuMemory ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
              </div>

              {/* Action Footer */}
              <div className="p-4 border-t border-white/5 bg-zinc-900/40 flex items-center justify-between gap-3">
                <button
                  onClick={() => setLoadModelModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const modelToLaunch = selectedModelToLoad || effectiveModelPath;
                    if (!modelToLaunch) return;
                    setLoadingModelId(modelToLaunch);
                    setLoadProgressPercent(10);
                    setLoadStatusMessage(
                      loadTarget === 'diffusion' 
                        ? 'Allocating Multimodal Diffusion buffers on Port 47992...' 
                        : loadTarget === 'ghost' 
                        ? 'Allocating dedicated Inline Ghost buffers...' 
                        : 'Allocating GPU memory buffers...'
                    );
                    const activePipe = loadTarget === 'diffusion' ? resolveImageGenPipeline(modelToLaunch, localModels) : null;
                    const finalMmproj = selectedMmprojPath || (activePipe && activePipe.encoderStatus === 'auto-connected' ? activePipe.encoderPath : '');
                    const finalVae = selectedVaePath || (activePipe && activePipe.vaeStatus === 'auto-connected' ? activePipe.vaePath : '');

                    vscodeApi?.postMessage({ 
                      command: 'loadLocalModel', 
                      modelId: modelToLaunch,
                      backendPreference: loadBackend,
                      target: loadTarget,
                      mmprojPath: finalMmproj,
                      vaePath: finalVae,
                      kvQuant: kvQuant,
                      temperature: modelTemperature,
                      ctxSize: ctxSize,
                      nGPULayers: nGPULayers,
                      nThreads: nThreads,
                      nBatch: nBatch,
                      nUbatch: nUbatch,
                      useMmap: !directGpuMemory,
                      flashAttn: flashAttn,
                      maxTokens: maxTokens,
                      steps: diffusionSteps,
                      cfgScale: diffusionCfgScale,
                      resolution: diffusionResolution,
                      vaeTiling: diffusionVaeTiling
                    });
                    if (loadTarget === 'diffusion') {
                      setImageStudioSize(diffusionResolution);
                      setImageStudioSteps(diffusionSteps);
                      setImageStudioCfg(diffusionCfgScale);
                    }
                    setLoadModelModalOpen(false);
                  }}
                  disabled={!(selectedModelToLoad || effectiveModelPath)}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm border border-transparent flex items-center gap-2 ${
                    !(selectedModelToLoad || effectiveModelPath)
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border-white/5' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                  }`}
                  title={!(selectedModelToLoad || effectiveModelPath) ? 'Please select a local model file first' : undefined}
                >
                  <span>
                    {loadTarget === 'diffusion'
                      ? 'Launch Diffusion Engine (Port 47992)'
                      : loadTarget === 'ghost' 
                      ? 'Load Inline Ghost' 
                      : `Load Primary Agent (${kvQuant.toUpperCase()})`}
                  </span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Interactive Visual Synthesis Studio Modal */}
      {isImageStudioOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 md:p-8"
          onClick={() => setIsImageStudioOpen(false)}
        >
          <div 
            className="max-w-5xl w-full max-h-[92vh] bg-[#141416] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:px-6 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#161619]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                    Visual Synthesis Studio
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-medium">
                      Port 47992
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Multimodal Diffusion & Generative Vision Engine
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsImageStudioOpen(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Close Studio (Esc)"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body: Left Controls & Right Canvas */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
              {/* Left Column: Controls & Prompt */}
              <div className="w-full md:w-5/12 p-5 border-b md:border-b-0 md:border-r border-white/5 space-y-4 overflow-y-auto bg-[#141416]">
                {/* Active Model Selector */}
                <div className="bg-[#18181b] border border-white/5 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                    <span>DIFFUSION ENGINE MODEL</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Port 47992
                    </span>
                  </div>
                  <select
                    value={selectedModelToLoad || daemonHealth?.active_diffusion_model || (localModels.find(m => m.id.toLowerCase().includes('sd') || m.id.toLowerCase().includes('turbo') || m.id.toLowerCase().includes('diffusion'))?.id || localModels[0]?.id || '')}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setSelectedModelToLoad(newModel);
                      vscodeApi?.postMessage({
                        command: 'loadLocalModel',
                        modelId: newModel,
                        target: 'diffusion',
                        steps: imageStudioSteps,
                        cfgScale: imageStudioCfg,
                        resolution: imageStudioSize
                      });
                    }}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {localModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id.split('/').pop()} ({m.size_display || 'GGUF'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Prompt Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">Prompt / Visual Brief</label>
                    <span className="text-[10px] text-zinc-500 font-mono">Natural Language</span>
                  </div>
                  <textarea
                    rows={4}
                    value={imageStudioPrompt}
                    onChange={(e) => setImageStudioPrompt(e.target.value)}
                    placeholder="Enter prompt description... e.g. Cyberpunk samurai overlooking a neon-drenched metropolis, 8k resolution, highly detailed"
                    className="w-full bg-[#18181b] border border-white/10 rounded-xl p-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none leading-relaxed"
                  />

                  {/* Mood / Style Presets */}
                  <div className="pt-1">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
                      Style Presets
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Photorealistic', suffix: ', photorealistic, 8k resolution, cinematic lighting, highly detailed' },
                        { label: 'Cyberpunk', suffix: ', futuristic cyberpunk, neon holographic glow, rain-slicked streets' },
                        { label: 'Anime', suffix: ', masterpiece anime aesthetic, vibrant lighting, Makoto Shinkai style' },
                        { label: '3D Game Asset', suffix: ', isometric 3D asset, stylized PBR textures, clean Octane render' },
                        { label: 'Dark Fantasy', suffix: ', dark fantasy illustration, atmospheric volumetric fog, gothic' },
                        { label: 'Pixel Art', suffix: ', 16-bit retro arcade pixel art, detailed sprite, crisp palette' },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            if (!imageStudioPrompt.includes(preset.label.toLowerCase())) {
                              setImageStudioPrompt(prev => prev.trim() + preset.suffix);
                            }
                          }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors cursor-pointer"
                        >
                          + {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Resolution Selector */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">Resolution & Aspect Ratio</label>
                    <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                      {imageStudioSize}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {[
                      { res: '1024x1024', label: '1024×1024', sub: 'Square 1:1' },
                      { res: '1152x896', label: '1152×896', sub: 'Landscape 4:3' },
                      { res: '896x1152', label: '896×1152', sub: 'Portrait 3:4' },
                      { res: '1280x720', label: '1280×720', sub: 'Wide 16:9' },
                      { res: '768x768', label: '768×768', sub: 'Compact' },
                      { res: '512x512', label: '512×512', sub: 'Draft' }
                    ].map(item => {
                      const isSelected = imageStudioSize === item.res;
                      return (
                        <button
                          key={item.res}
                          type="button"
                          onClick={() => {
                            setImageStudioSize(item.res);
                            setDiffusionResolution(item.res);
                          }}
                          className={`p-1.5 rounded-xl text-left border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50 ring-1 ring-emerald-500/30'
                              : 'bg-[#18181b] text-zinc-400 border-white/5 hover:bg-white/5 hover:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium">{item.label}</span>
                            {isSelected && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                          </div>
                          <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-emerald-300/80' : 'text-zinc-500'}`}>
                            {item.sub}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Inference Steps Slider */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">Inference Steps</label>
                    <span className="text-[10px] font-mono text-zinc-400">{imageStudioSteps} steps</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="50"
                    step="1"
                    value={imageStudioSteps}
                    onChange={(e) => setImageStudioSteps(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer h-1 bg-zinc-800 rounded-lg"
                  />
                  <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                    <button type="button" onClick={() => setImageStudioSteps(4)} className="hover:text-emerald-400 cursor-pointer">Turbo (4)</button>
                    <button type="button" onClick={() => setImageStudioSteps(15)} className="hover:text-emerald-400 cursor-pointer">Fast (15)</button>
                    <button type="button" onClick={() => setImageStudioSteps(20)} className="hover:text-emerald-400 cursor-pointer">Default (20)</button>
                    <button type="button" onClick={() => setImageStudioSteps(35)} className="hover:text-emerald-400 cursor-pointer">High (35)</button>
                  </div>
                </div>

                {/* CFG Scale Slider */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300">CFG Guidance Scale</label>
                    <span className="text-[10px] font-mono text-zinc-400">{imageStudioCfg.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="15.0"
                    step="0.5"
                    value={imageStudioCfg}
                    onChange={(e) => setImageStudioCfg(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer h-1 bg-zinc-800 rounded-lg"
                  />
                  <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                    <span>1.0 (Creative)</span>
                    <span>7.0 (Balanced)</span>
                    <span>15.0 (Strict)</span>
                  </div>
                </div>

                {/* Generate Button */}
                <div className="pt-3">
                  <button
                    type="button"
                    disabled={isGeneratingImage || !imageStudioPrompt.trim()}
                    onClick={() => {
                      if (!imageStudioPrompt.trim() || isGeneratingImage) return;
                      setIsGeneratingImage(true);
                      setImageStudioError(null);
                      vscodeApi?.postMessage({
                        command: 'generateImage',
                        prompt: imageStudioPrompt,
                        size: imageStudioSize,
                        steps: imageStudioSteps,
                        cfgScale: imageStudioCfg
                      });
                    }}
                    className={`w-full py-3 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                      isGeneratingImage || !imageStudioPrompt.trim()
                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-500/20 active:scale-[0.99]'
                    }`}
                  >
                    {isGeneratingImage ? (
                      <>
                        <span className="animate-spin w-4 h-4 border-2 border-t-white border-emerald-400/30 rounded-full" />
                        <span>Synthesizing on Port 47992...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        <span>Generate Visual Asset</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Column: Visual Canvas & Image Output */}
              <div className="w-full md:w-7/12 p-6 flex flex-col items-center justify-center bg-[#0d0d0f] relative overflow-hidden min-h-[420px]">
                {/* Background ambient lighting */}
                <div className="absolute inset-0 bg-radial from-emerald-500/5 via-transparent to-transparent pointer-events-none" />

                {imageStudioError && (
                  <div className="absolute top-4 left-4 right-4 z-20 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center justify-between font-mono animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="truncate">{imageStudioError}</span>
                    </div>
                    <button
                      onClick={() => setImageStudioError(null)}
                      className="text-rose-400 hover:text-rose-200 text-xs px-2 py-0.5 rounded cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {isGeneratingImage ? (
                  <div className="w-full max-w-md flex flex-col items-start gap-3 animate-in fade-in duration-200 z-10">
                    <div className="flex items-center gap-2 text-zinc-200 text-xs font-medium tracking-wide">
                      <span className="text-emerald-400 animate-pulse text-sm">✦</span>
                      <span>Creating your image</span>
                    </div>
                    <div className="w-full aspect-square rounded-3xl bg-[#18181b] border border-white/10 relative overflow-hidden flex flex-col items-center justify-center shadow-2xl">
                      {/* Subtle elegant shimmer pulse */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                      <div className="text-center p-6 space-y-2 z-10">
                        <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-400 animate-spin mx-auto mb-3" />
                        <div className="text-xs font-mono text-zinc-300 font-semibold">Diffusion Engine (Port 47992)</div>
                        <div className="text-[11px] font-mono text-zinc-500">{imageStudioSteps} steps • {imageStudioSize} • CFG {imageStudioCfg.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                ) : generatedImageB64 ? (
                  <div className="flex flex-col items-center justify-center w-full h-full z-10 space-y-4 animate-in fade-in zoom-in-95">
                    <div className="relative group max-h-[500px] flex items-center justify-center rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black">
                      <img
                        src={`data:image/png;base64,${generatedImageB64}`}
                        alt="Generated Art"
                        className="max-h-[460px] w-auto object-contain rounded-xl"
                      />
                    </div>

                    {/* Action buttons bar */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          vscodeApi?.postMessage({
                            command: 'saveGeneratedImage',
                            b64_json: generatedImageB64,
                            prompt: imageStudioPrompt
                          });
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        <span>Save to Project</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch(`data:image/png;base64,${generatedImageB64}`);
                            const blob = await res.blob();
                            await navigator.clipboard.write([
                              new ClipboardItem({ 'image/png': blob })
                            ]);
                            vscodeApi?.postMessage({
                              command: 'showMessage',
                              text: 'Copied generated asset to clipboard!'
                            });
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Copy image to clipboard"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>Copy</span>
                      </button>

                      <a
                        href={`data:image/png;base64,${generatedImageB64}`}
                        download={`diffusion_${Date.now()}.png`}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Download PNG to disk"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span>Download</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-8 z-10 space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 border border-white/10 flex items-center justify-center text-zinc-500 shadow-xl">
                      <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="max-w-xs">
                      <h4 className="text-sm font-semibold text-zinc-300">Visual Canvas Idle</h4>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        Enter a prompt on the left and click Generate to synthesize photorealistic images, 3D assets, and concept art locally on Port 47992.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Download Deletion Confirmation Warning Modal */}
      {downloadConfirmDelete && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setDownloadConfirmDelete(null)}
        >
          <div 
            className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Cancel & Delete Download?
                </h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Are you sure you want to cancel and remove <span className="font-mono text-zinc-200 font-semibold">{downloadConfirmDelete.model_name}</span>?
                </p>
              </div>
            </div>

            {/* Body Details */}
            <div className="p-5 space-y-3 bg-[#141416]/50">
              <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">Current Progress:</span>
                <span className="text-zinc-200 font-semibold">
                  {downloadConfirmDelete.percent.toFixed(1)}% ({((downloadConfirmDelete.downloaded_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB / {((downloadConfirmDelete.total_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB)
                </span>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-200/90 leading-relaxed">
                <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  <strong>Warning:</strong> This will abort the active download stream and permanently delete any partially downloaded model files from your disk.
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-4 border-t border-white/5 bg-[#18181b] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDownloadConfirmDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Keep Download
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = downloadConfirmDelete;
                  setDownloadConfirmDelete(null);
                  setActiveDownloads(prev => prev.filter(d => d.model_name !== target.model_name));
                  vscodeApi?.postMessage({ command: 'controlDownload', filename: target.model_name, action: 'delete' });
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 active:scale-[0.98] shadow-lg shadow-rose-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Cancel & Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
    );
  }
