// =============================================================================
// Diffusion Image Generation & Editing HTTP Handlers (/v1/images/*)
// =============================================================================

use axum::{extract::State, http::StatusCode, Json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::api::resolve_model_path_in_workspace;
use crate::diffusion_common::{
    apply_sd_flash_attn_arg, apply_sd_sampler_arg, base64_encode, find_sd_cli_binary,
    format_sd_cli_failure, resolve_image_input, sanitize_generation_prompt, ImageData,
    ImageEditRequest, ImageGenerationRequest, ImageGenerationResponse, TempFileGuard,
};
use crate::diffusion_companions::{collect_downloading_files, resolve_pipeline_companions};
use crate::diffusion_runner::{run_sd_cli_supervised, SdCliError};
use crate::{models, AppState};

pub async fn edit_images(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImageEditRequest>,
) -> Result<Json<ImageGenerationResponse>, (StatusCode, String)> {
    let gen_req = ImageGenerationRequest {
        prompt: req.prompt,
        model: req.model,
        size: req.size,
        steps: req.steps,
        cfg_scale: req.cfg_scale,
        clip_path: None,
        vae_path: None,
        t5_path: None,
        lora_path: None,
        lora_scale: None,
        image: Some(req.image),
        mask: req.mask,
        strength: req.strength,
        diffusion_flash_attn: req.diffusion_flash_attn,
        timeout_secs: req.timeout_secs,
    };
    generate_images(State(state), Json(gen_req)).await
}

async fn resolve_target_image_model(
    state: &Arc<AppState>,
    req_model: Option<&str>,
    active_diff: &crate::ActiveDiffusionConfig,
) -> Option<PathBuf> {
    if let Some(m) = req_model {
        let candidate = resolve_model_path_in_workspace(&state.models_dir, m, &["image", "video"]);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if active_diff.modality.as_deref() != Some("video") {
        if let Some(p) = &active_diff.model_path {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
    }
    if let Some(active) = state.active_model.read().await.as_ref() {
        let path = PathBuf::from(active);
        let p_lower = path.to_string_lossy().to_lowercase();
        if path.exists() && !p_lower.contains("/video/") && !p_lower.contains("\\video\\") {
            return Some(path);
        }
    }
    let models_dir = state.models_dir.clone();
    let found = tokio::task::spawn_blocking(move || {
        let list = models::list_local_models(&models_dir);
        list.iter()
            .find(|m| {
                m.modality.as_deref() == Some("image")
                    && (m.model_family == models::ModelFamily::DiffusionFlow
                        || m.model_family == models::ModelFamily::AutoregressiveImage)
            })
            .cloned()
            .or_else(|| {
                list.into_iter().find(|m| {
                    m.model_family == models::ModelFamily::DiffusionFlow && m.modality.as_deref() != Some("video")
                })
            })
    })
    .await
    .unwrap_or(None);
    found.map(|m| PathBuf::from(m.path))
}

async fn delegate_worker_image(body: serde_json::Value, timeout_secs: u64) -> Result<Option<ImageGenerationResponse>, (StatusCode, String)> {
    if let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(timeout_secs)).build() {
        if let Ok(resp) = client.post("http://127.0.0.1:47992/v1/images/generations").json(&body).send().await {
            if resp.status().is_success() {
                if let Ok(parsed) = resp.json::<ImageGenerationResponse>().await {
                    return Ok(Some(parsed));
                }
            } else {
                let err_text = resp.text().await.unwrap_or_default();
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Diffusion generation failed: {}", err_text)));
            }
        }
    }
    Ok(None)
}

pub async fn generate_images(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImageGenerationRequest>,
) -> Result<Json<ImageGenerationResponse>, (StatusCode, String)> {
    let prompt = sanitize_generation_prompt(&req.prompt)?;
    let active_diff = state.active_diffusion.read().await.clone();

    let Some(resolved_model) = resolve_target_image_model(&state, req.model.as_deref(), &active_diff).await else {
        let req_lower = req.model.as_deref().unwrap_or_default().to_lowercase();
        let is_fb_flux = req_lower.contains("flux");
        let is_fb_turbo = is_fb_flux || req_lower.contains("turbo") || req_lower.contains("schnell");
        let fb_body = serde_json::json!({
            "prompt": prompt,
            "size": req.size,
            "steps": req.steps.unwrap_or(if is_fb_turbo { 4 } else { 20 }),
            "cfg_scale": req.cfg_scale.unwrap_or(if is_fb_flux { 1.0 } else if is_fb_turbo { 1.8 } else { 7.0 }),
            "model": req.model
        });
        if let Some(parsed) = delegate_worker_image(fb_body, 120).await? {
            return Ok(Json(parsed));
        }
        return Err((StatusCode::BAD_REQUEST, "No diffusion or image generation model loaded in memory. Please select and load a diffusion model first.".into()));
    };

    let mut temp_guard = TempFileGuard(Vec::new());
    let init_img_path = req.image.as_ref().and_then(|img| match resolve_image_input(img, "init") {
        Ok((p, is_tmp)) => { if is_tmp { temp_guard.0.push(p.clone()); } Some(p) }
        Err(e) => { tracing::warn!("Failed to resolve init image: {}", e); None }
    });
    let mask_path = req.mask.as_ref().and_then(|m| match resolve_image_input(m, "mask") {
        Ok((p, is_tmp)) => { if is_tmp { temp_guard.0.push(p.clone()); } Some(p) }
        Err(e) => { tracing::warn!("Failed to resolve mask image: {}", e); None }
    });

    let model_name_lower = resolved_model.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    let is_flux = model_name_lower.contains("flux");
    let is_qwen = model_name_lower.contains("qwen");
    let is_turbo = is_flux || is_qwen || model_name_lower.contains("turbo") || model_name_lower.contains("schnell");

    let size_str = req.size.as_deref().filter(|s| !s.trim().is_empty())
        .or(active_diff.resolution.as_deref().filter(|s| !s.trim().is_empty()))
        .unwrap_or(if is_qwen || is_flux { "768x768" } else { "512x512" });
    let (mut width, mut height) = (768u32, 768u32);
    if let Some((w, h)) = size_str.split_once('x') {
        if let (Ok(wi), Ok(hi)) = (w.trim().parse::<u32>(), h.trim().parse::<u32>()) {
            width = wi;
            height = hi;
        }
    }

    let steps_raw = req.steps.or(active_diff.steps).unwrap_or(if is_qwen { 8 } else if is_turbo { 4 } else { 20 });
    let steps = if is_turbo && steps_raw > 10 && !is_qwen { 4 } else { steps_raw };
    let default_cfg = if is_flux { 1.0 } else if is_turbo { 1.8 } else { 7.0 };
    let cfg_scale = if is_flux { req.cfg_scale.unwrap_or(default_cfg) } else { req.cfg_scale.or(active_diff.cfg_scale).unwrap_or(default_cfg) };

    if let Some(sd_cli) = find_sd_cli_binary() {
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let out_file = std::env::temp_dir().join(format!("astrolabe_sd_render_{}_{}.png", std::process::id(), now_ms));
        let downloading_files = collect_downloading_files(&state).await;
        let models_dir_clone = state.models_dir.clone();
        let resolved_clone = resolved_model.clone();
        let (vae_e, clip_e, t5_e, lora_e) = (
            req.vae_path.clone().or_else(|| active_diff.vae_path.clone()),
            req.clip_path.clone().or_else(|| active_diff.clip_path.clone()),
            req.t5_path.clone().or_else(|| active_diff.t5_path.clone()),
            req.lora_path.clone().or_else(|| active_diff.lora_path.clone()),
        );
        let companions = tokio::task::spawn_blocking(move || {
            resolve_pipeline_companions(&models_dir_clone, &resolved_clone, vae_e.as_deref(), clip_e.as_deref(), t5_e.as_deref(), lora_e.as_deref(), false, &downloading_files)
        }).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Companion scan failed: {}", e)))?;

        let mut cmd = tokio::process::Command::new(&sd_cli);
        let is_standalone = ["flux", "sd3", "wan", "pixart", "auraflow", "cogvideo", "qwen"].iter().any(|k| model_name_lower.contains(k));
        cmd.arg(if is_standalone { "--diffusion-model" } else { "-m" }).arg(&resolved_model).arg("--lora-model-dir").arg(&companions.lora_dir);

        let lora_scale = req.lora_scale.or(active_diff.lora_scale).unwrap_or(1.0);
        let mut final_prompt = prompt.clone();
        if let Some(ref name) = companions.lora_name {
            if !final_prompt.contains(&format!("<lora:{}", name)) {
                final_prompt = format!("{} <lora:{}:{:.2}>", final_prompt, name, lora_scale);
            }
        }
        cmd.arg("-p").arg(&final_prompt).arg("-o").arg(&out_file).arg("-W").arg(width.to_string()).arg("-H").arg(height.to_string()).arg("--steps").arg(steps.to_string()).arg("--cfg-scale").arg(cfg_scale.to_string());

        if let Some(ref init_p) = init_img_path {
            cmd.arg("--init-img").arg(init_p).arg("--strength").arg(req.strength.unwrap_or(0.65).clamp(0.01, 1.0).to_string());
        }
        if let Some(ref mask_p) = mask_path { cmd.arg("--mask").arg(mask_p); }

        let is_flow = is_qwen || is_flux || model_name_lower.contains("wan") || is_standalone;
        apply_sd_sampler_arg(&mut cmd, active_diff.sampler.as_deref(), is_flow);
        if is_qwen { cmd.arg("--sigmas").arg("qwen-image-2.1-turbo"); }
        if let Some(ref vae) = companions.vae { cmd.arg("--vae").arg(vae); }
        if !is_qwen {
            if let Some(ref clip) = companions.clip { cmd.arg("--clip_l").arg(clip); }
            if let Some(ref t5) = companions.t5 { cmd.arg("--t5xxl").arg(t5); }
        } else if let Some(ref llm) = companions.llm_encoder {
            if llm.exists() { cmd.arg("--llm").arg(llm); }
        }
        if active_diff.vae_tiling.unwrap_or(false) && (!is_qwen || width > 1024 || height > 1024) {
            cmd.arg("--vae-tiling");
        }
        apply_sd_flash_attn_arg(&mut cmd, req.diffusion_flash_attn.as_deref().or(active_diff.diffusion_flash_attn.as_deref()));
        if active_diff.offload_to_cpu.unwrap_or(false) { cmd.arg("--offload-to-cpu"); }
        if let Some(bin_dir) = sd_cli.parent() {
            let cur_ld = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            cmd.env("LD_LIBRARY_PATH", format!("{}:{}", bin_dir.display(), cur_ld));
        }

        let label = resolved_model.file_name().unwrap_or_default().to_string_lossy().to_string();
        match run_sd_cli_supervised(Arc::clone(&state), cmd, "image", &label, steps, req.timeout_secs).await {
            Ok(out) if out.status.success() && out_file.exists() => {
                let bytes = tokio::fs::read(&out_file).await.unwrap_or_default();
                let _ = tokio::fs::remove_file(&out_file).await;
                if !bytes.is_empty() {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                    return Ok(Json(ImageGenerationResponse {
                        created: now,
                        data: vec![ImageData { b64_json: base64_encode(&bytes), revised_prompt: Some(prompt) }],
                    }));
                }
            }
            Ok(out) => {
                let _ = tokio::fs::remove_file(&out_file).await;
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format_sd_cli_failure(&out.stderr, out.status.code(), "Flux model requires both clip_l and t5xxl text encoders. Please download t5xxl (e.g. t5xxl-Q4_k.gguf) into your models/components/encoders/ directory.")));
            }
            Err(SdCliError::Cancelled) => {
                let _ = tokio::fs::remove_file(&out_file).await;
                return Err((StatusCode::from_u16(499).unwrap_or(StatusCode::REQUEST_TIMEOUT), "Image generation cancelled by user".into()));
            }
            Err(SdCliError::Timeout(secs)) => {
                let _ = tokio::fs::remove_file(&out_file).await;
                return Err((StatusCode::GATEWAY_TIMEOUT, format!("Image generation timed out after {} seconds", secs)));
            }
            Err(SdCliError::Spawn(e)) => {
                let _ = tokio::fs::remove_file(&out_file).await;
                tracing::warn!("Failed to spawn sd-cli: {}", e);
            }
        }
    }

    let fb_body = serde_json::json!({
        "prompt": prompt, "size": format!("{}x{}", width, height), "steps": steps, "cfg_scale": cfg_scale, "model": resolved_model.to_string_lossy()
    });
    if let Some(parsed) = delegate_worker_image(fb_body, 300).await? {
        return Ok(Json(parsed));
    }
    Err((StatusCode::INTERNAL_SERVER_ERROR, "Diffusion generation failed: sd-cli binary not executable and no fallback worker available.".into()))
}
