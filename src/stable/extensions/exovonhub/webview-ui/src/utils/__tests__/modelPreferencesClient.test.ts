import { describe, expect, it } from 'vitest';
import {
  buildModelTuningRequest,
  resolveSavedModelPreference,
  type InspectorTuningState,
} from '../../components/settings/modelPreferencesClient';

const baseState: InspectorTuningState = {
  ctxSize: 32768,
  nGPULayers: 42,
  temperature: 0.45,
  nThreads: 12,
  nBatch: 1024,
  nUbatch: 512,
  flashAttn: true,
  useMmap: false,
  offloadContextToCpu: true,
  cacheTypeK: 'q8_0',
  cacheTypeV: 'q8_0',
  diffSteps: 14,
  diffCfg: 2.5,
  diffResolution: '1024x1024',
  diffSampler: 'Euler',
  diffVaeTiling: true,
  diffOffloadRam: true,
  diffGpuLayers: 24,
  diffFlashAttn: 'on',
  videoFrames: 25,
  videoFps: 24,
  videoFlowShift: 6.0,
  videoTemporalTiling: true,
  selectedVae: '/vae/qwen.safetensors',
  selectedClip: 'auto',
  selectedT5: 'auto',
  selectedLora: 'none',
  loraScale: 1.0,
  arGridResolution: '512x512',
  arVisualTemp: 0.7,
  arVisualTopP: 0.9,
  arLogitCfg: 4.0,
  arTokenContext: 4096,
};

describe('modelPreferencesClient', () => {
  it('resolves saved preferences across path, prefixed id, and filename keys', () => {
    const prefs = {
      'Xing4.0-29B-A4B-IQ3_M-MTP.gguf': { ctxSize: 65536, nGPULayers: 35 },
      'flux-dev/model.safetensors': { steps: 28, resolution: '1024x1024' },
    };

    expect(
      resolveSavedModelPreference(prefs, '/home/user/.exovon/models/Xing4.0-29B-A4B-IQ3_M-MTP.gguf')?.ctxSize,
    ).toBe(65536);
    expect(
      resolveSavedModelPreference(prefs, 'local:xing4.0-29b-a4b-iq3_m-mtp.gguf')?.nGPULayers,
    ).toBe(35);
    expect(
      resolveSavedModelPreference(prefs, '/models/flux-dev/model.safetensors')?.steps,
    ).toBe(28);
  });

  it('builds consistent tuning payloads for Save Preference vs Load Model with Settings', () => {
    const llmSave = buildModelTuningRequest(
      { modelFamily: 'text_llm' },
      baseState,
      { includeTarget: false },
    );
    expect(llmSave).not.toHaveProperty('target');
    expect(llmSave).toMatchObject({
      modality: 'llm',
      modelFamily: 'text_llm',
      ctxSize: 32768,
      nGPULayers: 42,
      cacheTypeK: 'q8_0',
      useMmap: false,
      offloadContextToCpu: true,
    });

    const videoLoad = buildModelTuningRequest(
      { modelFamily: 'diffusion_flow', isVideo: true },
      baseState,
      { includeTarget: true },
    );
    expect(videoLoad).toMatchObject({
      target: 'video',
      modality: 'video',
      steps: 14,
      cfgScale: 2.5,
      resolution: '1024x1024',
      vaePath: '/vae/qwen.safetensors',
      videoFrames: 25,
      videoFps: 24,
      flowShift: 6.0,
      temporalTiling: true,
    });
    expect(videoLoad.loraPath).toBeUndefined();
  });
});
