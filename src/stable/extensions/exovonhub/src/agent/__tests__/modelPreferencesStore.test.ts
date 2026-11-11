import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildDaemonLoadPayload,
    getModelPreference,
    getModelPreferenceKey,
    loadAllModelPreferences,
    resolveModelPreferenceFromMap,
    saveModelPreference,
} from '../ModelPreferencesStore';

describe('ModelPreferencesStore', () => {
    const tempDirs: string[] = [];

    function makeStorePath(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exovon-prefs-'));
        tempDirs.push(dir);
        return path.join(dir, 'model_preferences.json');
    }

    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()!;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('normalizes prefixed ids and file paths to a shared preference key', () => {
        expect(getModelPreferenceKey('local:Xing4.0-29B-A4B-IQ3_M-MTP.gguf')).toBe(
            'Xing4.0-29B-A4B-IQ3_M-MTP.gguf',
        );
        expect(getModelPreferenceKey('/home/user/.models/Xing4.0-29B-A4B-IQ3_M-MTP.gguf')).toBe(
            'Xing4.0-29B-A4B-IQ3_M-MTP.gguf',
        );
        expect(getModelPreferenceKey('diffusion:flux-dev/model.safetensors')).toBe(
            'flux-dev/model.safetensors',
        );
    });

    it('persists and resolves preferences across Settings paths and Chat Sidebar ids', () => {
        const storePath = makeStorePath();
        saveModelPreference(
            '/mnt/models/Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf',
            {
                modality: 'diffusion',
                steps: 12,
                cfgScale: 2.5,
                resolution: '1024x1024',
                diffusionFlashAttn: true,
            },
            storePath,
        );

        const fromSidebar = getModelPreference(
            'diffusion:Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf',
            storePath,
        );
        expect(fromSidebar).toMatchObject({
            modality: 'diffusion',
            steps: 12,
            cfgScale: 2.5,
            resolution: '1024x1024',
            diffusionFlashAttn: true,
        });

        const all = loadAllModelPreferences(storePath);
        expect(resolveModelPreferenceFromMap(all, 'local:qwen-image-2.1-turbo-uncensored-ad-q3_k.gguf')?.steps).toBe(12);
    });

    it('merges saved LLM and diffusion preferences into daemon load payload with explicit overrides winning', () => {
        const saved = {
            ctxSize: 65536,
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
        };

        const sidebarPayload = buildDaemonLoadPayload('local:Qwen3.5-4B-Q5_K_S.gguf', {}, saved);
        expect(sidebarPayload).toMatchObject({
            model_path: 'Qwen3.5-4B-Q5_K_S.gguf',
            target: 'Qwen3.5-4B-Q5_K_S.gguf',
            ctx_size: 65536,
            n_gpu_layers: 42,
            temperature: 0.45,
            n_threads: 12,
            n_batch: 1024,
            n_ubatch: 512,
            flash_attn: true,
            use_mmap: false,
            offload_context_to_cpu: true,
            no_kv_offload: true,
            kv_quant: 'q8_0',
            cache_type_k: 'q8_0',
            cache_type_v: 'q8_0',
        });

        const explicitOverride = buildDaemonLoadPayload(
            '/models/Qwen3.5-4B-Q5_K_S.gguf',
            { ctxSize: 16384, temperature: 0.9 },
            saved,
        );
        expect(explicitOverride.ctx_size).toBe(16384);
        expect(explicitOverride.temperature).toBe(0.9);
        expect(explicitOverride.n_gpu_layers).toBe(42);
    });
});
