import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface DiffusionProgressInfo {
  active: boolean;
  modality: string;
  model: string;
  step: number;
  total_steps: number;
  percent: number;
  stage: string;
  elapsed_secs: number;
}

export interface DiffusionGenerationOptions {
  prompt: string;
  model?: string;
  modality?: string;
  isDiffusion?: boolean;
  size?: string;
  resolution?: string;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  vae_tiling?: boolean;
  diffusion_flash_attn?: string;
  diffusionFlashAttn?: string;
  video_frames?: number;
  videoFrames?: number;
  fps?: number;
  flow_shift?: number;
  flowShift?: number;
  temporal_tiling?: boolean;
  temporalTiling?: boolean;
  offload_to_cpu?: boolean;
  offloadToCpu?: boolean;
  timeout_secs?: number;
  initImage?: string;
  strength?: number;
  outputPath?: string;
  cachedLocalModels?: any[];
  cachedDiffusionModelName?: string;
  cachedDiffusionModality?: string;
}

export interface DiffusionGenerationResult {
  cancelled?: boolean;
  ignored?: boolean;
  savedPath?: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  ext?: string;
  b64?: string;
  displayModelName: string;
  prompt: string;
  updatedCache?: {
    modelName?: string;
    resolution?: string;
    modality?: string;
  };
}

export interface DiffusionRunCallbacks {
  onStart?: (info: { mediaType: 'image' | 'video'; displayModelName: string; prompt: string }) => void;
  onProgress?: (progress: DiffusionProgressInfo) => void;
}

const VIDEO_MODEL_KEYWORDS = ['wan', 'ltx', 'hunyuanvideo', 'cogvideo', 'mochi'];
const IMAGE_MODEL_KEYWORDS = ['flux', 'sd-', 'sd_', 'sdxl', 'diffusion', 'dit'];

/** Resolve whether a diffusion model ref targets video or image output. */
export function inferDiffusionModality(
  modelIdOrName: string,
  explicitModality?: string,
  activeDiffusion?: any,
  cachedLocalModels: any[] = [],
): 'video' | 'image' {
  const exp = String(explicitModality || activeDiffusion?.modality || '').toLowerCase();
  if (exp === 'video') {return 'video';}
  if (exp === 'image') {return 'image';}

  const raw = String(modelIdOrName || '').replace(/^(?:diffusion|video|local):/i, '');
  const base = path.basename(raw);
  const matched = cachedLocalModels.find((m: any) =>
    m.id === raw || m.path === raw || path.basename(String(m.id || '')) === base || m.name === base
  );
  const matchedMod = String(matched?.modality || '').toLowerCase();
  if (matchedMod === 'video') {return 'video';}
  if (matchedMod === 'image') {return 'image';}

  const matchedRel = String(matched?.relative_path || '').replace(/\\/g, '/').toLowerCase();
  if (matchedRel.startsWith('video/')) {return 'video';}

  const norm = raw.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/video/') || norm.startsWith('video/') || VIDEO_MODEL_KEYWORDS.some((kw) => norm.includes(kw))) {
    return 'video';
  }
  return 'image';
}

/** Determine whether a model selection belongs to the diffusion / video pipeline. */
export function classifyDiffusionModel(
  model: string,
  opts?: {
    modality?: string;
    isDiffusion?: boolean;
    cachedLocalModels?: any[];
    cachedDiffusionModality?: string;
    cachedDiffusionModelName?: string;
  },
): { isDiffusion: boolean; isVideoHint: boolean; cleanModel: string } {
  const raw = model || '';
  const modelLower = raw.toLowerCase();
  const cleanModel = raw.replace(/^(?:diffusion|video|local):/i, '');
  const cleanLower = cleanModel.toLowerCase();
  const normClean = cleanLower.replace(/\\/g, '/');
  const cached = opts?.cachedLocalModels || [];

  const matchedLocal = cached.find((m: any) =>
    m.id === cleanModel || m.path === cleanModel || path.basename(String(m.id || '')) === path.basename(cleanModel) || m.name === cleanModel
  );
  const matchedMod = String(matchedLocal?.modality || '').toLowerCase();
  const matchedRel = String(matchedLocal?.relative_path || '').replace(/\\/g, '/').toLowerCase();

  const isVideoHint = opts?.modality === 'video'
    || raw.startsWith('video:')
    || matchedMod === 'video'
    || matchedRel.startsWith('video/')
    || normClean.includes('/video/')
    || normClean.startsWith('video/')
    || (opts?.cachedDiffusionModality === 'video' && (!cleanModel || cleanModel === opts?.cachedDiffusionModelName || Boolean(opts?.isDiffusion)))
    || VIDEO_MODEL_KEYWORDS.some((kw) => cleanLower.includes(kw));

  const isDiffusion = raw.startsWith('diffusion')
    || raw.startsWith('video:')
    || Boolean(opts?.isDiffusion)
    || isVideoHint
    || opts?.modality === 'image'
    || matchedMod === 'image'
    || matchedRel.startsWith('image/')
    || IMAGE_MODEL_KEYWORDS.some((kw) => modelLower.includes(kw))
    || (modelLower.includes('qwen') && modelLower.includes('image'));

  return { isDiffusion, isVideoHint, cleanModel };
}

/** Strip orchestrator framing and reject background memory summarizer prompts. */
export function prepareDiffusionPrompt(rawPrompt: string): { prompt: string; ignored: boolean } {
  if (rawPrompt.includes('You are a project memory summarizer') || rawPrompt.includes('Review the following transcript')) {
    return { prompt: rawPrompt, ignored: true };
  }
  let prompt = rawPrompt;
  const actionMatch = prompt.match(/Developer Action Request:\s*["']?([\s\S]+?)["']?\s*$/);
  if (actionMatch?.[1]) {prompt = actionMatch[1].trim();}
  prompt = prompt.replace(/\[IDE WORKSPACE ACTIVE CONTEXT\][\s\S]*?\[\/IDE WORKSPACE ACTIVE CONTEXT\]/g, '').trim();
  return { prompt, ignored: false };
}

/** Extract an image attachment URL from OpenAI-style or Gemini-style messages. */
export function extractInitImage(messages: any[] = [], openAiMessages: any[] = []): string | undefined {
  const lastUserMsg = [...openAiMessages].reverse().find((m) => m.role === 'user');
  if (Array.isArray(lastUserMsg?.content)) {
    const imgItem = lastUserMsg.content.find((c: any) => c.type === 'image_url');
    if (imgItem?.image_url?.url) {return imgItem.image_url.url;}
  }
  for (const m of [...messages].reverse()) {
    const inline = m.parts?.find((p: any) => p.inlineData);
    if (inline) {return `data:${inline.inlineData.mimeType};base64,${inline.inlineData.data}`;}
  }
  return undefined;
}

export class DiffusionChatService {
  private static _activeController: AbortController | null = null;
  private static _activeBaseUrl = 'http://127.0.0.1:47990';

  /** Abort in-flight HTTP request and terminate active daemon sd-cli child. */
  public static cancelActive(): boolean {
    const wasActive = Boolean(DiffusionChatService._activeController);
    if (DiffusionChatService._activeController) {
      DiffusionChatService._activeController.abort();
      DiffusionChatService._activeController = null;
    }
    const baseUrl = DiffusionChatService._activeBaseUrl;
    if (wasActive) {
      import('node-fetch')
        .then((mod) => mod.default(`${baseUrl}/v1/diffusion/cancel`, { method: 'POST' }))
        .catch(() => {});
    }
    return wasActive;
  }

  /** Execute image or video generation against the local daemon with live progress & cancellation. */
  public static async generate(
    options: DiffusionGenerationOptions,
    callbacks?: DiffusionRunCallbacks,
  ): Promise<DiffusionGenerationResult> {
    const prepared = prepareDiffusionPrompt(options.prompt || '');
    const classified = classifyDiffusionModel(options.model || '', options);
    if (prepared.ignored) {
      return { ignored: true, mediaType: classified.isVideoHint ? 'video' : 'image', displayModelName: classified.cleanModel, prompt: '' };
    }

    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    DiffusionChatService._activeController = controller;
    let baseUrl = 'http://127.0.0.1:47990';
    let storedDiffusion: any = null;
    let updatedCache: DiffusionGenerationResult['updatedCache'];
    let remoteModels = options.cachedLocalModels || [];

    try {
      const [hRes, mRes] = await Promise.all([
        fetch('http://127.0.0.1:47990/v1/health').catch(() => null),
        remoteModels.length > 0 ? Promise.resolve(null) : fetch('http://127.0.0.1:47990/v1/models').catch(() => null),
      ]);
      if (hRes?.ok) {
        const hData = await hRes.json() as any;
        storedDiffusion = hData?.active_diffusion || null;
        if (storedDiffusion?.model_path) {
          updatedCache = { modelName: path.basename(storedDiffusion.model_path), resolution: storedDiffusion.resolution, modality: storedDiffusion.modality };
        }
      }
      if (mRes?.ok) {
        const mData = await mRes.json() as any;
        if (Array.isArray(mData?.data)) {remoteModels = mData.data;}
      }
    } catch {}

    const inferred = inferDiffusionModality(
      classified.cleanModel || storedDiffusion?.model_path || options.cachedDiffusionModelName || '',
      options.modality,
      storedDiffusion,
      remoteModels,
    );
    const isVideo = classified.isVideoHint || storedDiffusion?.modality === 'video' || inferred === 'video';
    const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';
    const displayModelName = classified.cleanModel || (storedDiffusion?.model_path ? path.basename(storedDiffusion.model_path) : '') || options.cachedDiffusionModelName || '';

    callbacks?.onStart?.({ mediaType, displayModelName, prompt: prepared.prompt });

    const cleanLower = classified.cleanModel.toLowerCase();
    const isFlux = cleanLower.includes('flux');
    const isQwen = cleanLower.includes('qwen');
    const isTurbo = isFlux || isQwen || cleanLower.includes('turbo') || cleanLower.includes('schnell');
    const endpoint = isVideo ? '/v1/videos/generations' : (options.initImage ? '/v1/images/edits' : '/v1/images/generations');

    const body: any = {
      prompt: prepared.prompt,
      model: classified.cleanModel || undefined,
      size: options.size || options.resolution || storedDiffusion?.resolution || undefined,
      steps: options.steps ?? storedDiffusion?.steps ?? (isTurbo ? 4 : 20),
      cfg_scale: options.cfg_scale ?? storedDiffusion?.cfg_scale ?? (isFlux || isQwen ? 1.0 : (isTurbo ? 1.8 : 7.0)),
    };
    if ((options.sampler ?? storedDiffusion?.sampler) !== undefined) {body.sampler = options.sampler ?? storedDiffusion?.sampler;}
    if ((options.vae_tiling ?? storedDiffusion?.vae_tiling) !== undefined) {body.vae_tiling = options.vae_tiling ?? storedDiffusion?.vae_tiling;}
    const flashAttn = options.diffusion_flash_attn ?? options.diffusionFlashAttn ?? storedDiffusion?.diffusion_flash_attn;
    if (flashAttn !== undefined) {body.diffusion_flash_attn = flashAttn;}
    if (options.timeout_secs !== undefined) {body.timeout_secs = options.timeout_secs;}
    if (isVideo) {
      const vf = options.video_frames ?? options.videoFrames ?? storedDiffusion?.video_frames;
      const fps = options.fps ?? storedDiffusion?.fps;
      const fsVal = options.flow_shift ?? options.flowShift ?? storedDiffusion?.flow_shift;
      const tt = options.temporal_tiling ?? options.temporalTiling ?? storedDiffusion?.temporal_tiling;
      const otc = options.offload_to_cpu ?? options.offloadToCpu ?? storedDiffusion?.offload_to_cpu;
      if (vf !== undefined) {body.video_frames = vf;}
      if (fps !== undefined) {body.fps = fps;}
      if (fsVal !== undefined) {body.flow_shift = fsVal;}
      if (tt !== undefined) {body.temporal_tiling = tt;}
      if (otc !== undefined) {body.offload_to_cpu = otc;}
    }
    if (options.initImage) {
      body.image = options.initImage;
      body.strength = options.strength || 0.65;
    }

    let pollTimer: NodeJS.Timeout | null = null;
    if (callbacks?.onProgress) {
      pollTimer = setInterval(async () => {
        if (controller.signal.aborted) {return;}
        try {
          const pRes = await fetch(`${baseUrl}/v1/diffusion/status`, { signal: controller.signal as any });
          if (pRes.ok) {
            const prog = await pRes.json() as DiffusionProgressInfo;
            if (prog?.active) {callbacks.onProgress?.(prog);}
          }
        } catch {}
      }, 850);
    }

    try {
      let genRes: any;
      try {
        DiffusionChatService._activeBaseUrl = 'http://127.0.0.1:47990';
        genRes = await fetch('http://127.0.0.1:47990' + endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal as any,
        });
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') {throw err;}
        baseUrl = 'http://127.0.0.1:47992';
        DiffusionChatService._activeBaseUrl = baseUrl;
        genRes = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal as any,
        });
      }

      if (genRes.status === 499 || controller.signal.aborted) {
        return { cancelled: true, mediaType, displayModelName, prompt: prepared.prompt, updatedCache };
      }
      if (!genRes.ok) {
        const errText = await genRes.text();
        throw new Error(errText || `${isVideo ? 'Video' : 'Diffusion'} worker returned HTTP ${genRes.status}`);
      }

      const genData = await genRes.json() as any;
      const firstItem = genData.data?.[0] || genData;
      const b64: string | undefined = firstItem?.b64_json;
      const returnedPath = firstItem?.path || firstItem?.file_path || genData.path || genData.file_path;
      const rawExt = String(firstItem?.ext || genData.ext || (returnedPath ? path.extname(String(returnedPath)) : '') || (isVideo ? 'mp4' : 'png'))
        .replace(/^\./, '').toLowerCase();
      const ext = rawExt || (isVideo ? 'mp4' : 'png');
      const mimeType = String(firstItem?.mime_type || genData.mime_type || (
        isVideo
          ? (ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : ext === 'avi' ? 'video/x-msvideo' : 'video/mp4')
          : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png')
      ));

      if (!b64 && (!returnedPath || !fs.existsSync(String(returnedPath)))) {
        throw new Error('Diffusion engine responded without image or video data.');
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
      const outPath = options.outputPath
        ? (path.isAbsolute(options.outputPath) ? options.outputPath : path.join(workspaceRoot, options.outputPath))
        : path.join(workspaceRoot, 'assets', `generated_${Date.now()}.${ext}`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (b64) {
        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
      } else {
        fs.copyFileSync(String(returnedPath), outPath);
      }

      return { savedPath: outPath, mediaType, mimeType, ext, b64, displayModelName, prompt: prepared.prompt, updatedCache };
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        return { cancelled: true, mediaType, displayModelName, prompt: prepared.prompt, updatedCache };
      }
      throw err;
    } finally {
      if (pollTimer) {clearInterval(pollTimer);}
      if (DiffusionChatService._activeController === controller) {
        DiffusionChatService._activeController = null;
      }
    }
  }
}
