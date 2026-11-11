// =============================================================================
// Diffusion Video Generation HTTP Handler (/v1/videos/generations)
// =============================================================================

use axum::{extract::State, http::StatusCode, Json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::api::resolve_model_path_in_workspace;
use crate::diffusion_common::{
    apply_sd_flash_attn_arg, apply_sd_sampler_arg, base64_encode, find_ffmpeg_binary,
    find_sd_cli_binary, format_sd_cli_failure, resolve_image_input, sanitize_generation_prompt,
    TempFileGuard, VideoData, VideoGenerationRequest, VideoGenerationResponse,
};
use crate::diffusion_companions::{collect_downloading_files, resolve_pipeline_companions};
use crate::diffusion_runner::{run_sd_cli_supervised, SdCliError};
use crate::{models, AppState};

async fn resolve_target_video_model(
    state: &Arc<AppState>,
    req_model: Option<&str>,
    active_diff: &crate::ActiveDiffusionConfig,
) -> Option<PathBuf> {
    if let Some(m) = req_model {
        let candidate = resolve_model_path_in_workspace(&state.models_dir, m, &["video", "image"]);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if let Some(ref p) = active_diff.model_path {
        let path = PathBuf::from(p);
        let p_l = p.to_lowercase();
        if path.exists()
            && (active_diff.modality.as_deref() == Some("video")
                || p_l.contains("/video/")
                || p_l.contains("\\video\\")
                || ["wan", "cogvideo", "hunyuan", "ltx", "mochi"].iter().any(|k| p_l.contains(k)))
        {
            return Some(path);
        }
    }
    if let Some(active) = state.active_model.read().await.as_ref() {
        let path = PathBuf::from(active);
        let p_l = active.to_lowercase();
        if path.exists() && (p_l.contains("/video/") || p_l.contains("\\video\\") || p_l.contains("wan")) {
            return Some(path);
        }
    }
    let models_dir = state.models_dir.clone();
    let found = tokio::task::spawn_blocking(move || {
        models::list_local_models(&models_dir)
            .into_iter()
            .find(|m| m.modality.as_deref() == Some("video"))
    })
    .await
    .unwrap_or(None);
    found.map(|m| PathBuf::from(m.path))
}

pub async fn generate_videos(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VideoGenerationRequest>,
) -> Result<Json<VideoGenerationResponse>, (StatusCode, String)> {
    let prompt = sanitize_generation_prompt(&req.prompt)?;
    let active_diff = state.active_diffusion.read().await.clone();

    let resolved_model = resolve_target_video_model(&state, req.model.as_deref(), &active_diff)
        .await
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "No video generation model found. Please select or place a video model (e.g. Wan 2.2) in models/video/ first.".to_string(),
            )
        })?;

    let sd_cli = find_sd_cli_binary().ok_or_else(|| {
        (StatusCode::INTERNAL_SERVER_ERROR, "sd-cli binary not found; cannot execute native video generation.".to_string())
    })?;

    let mut temp_guard = TempFileGuard(Vec::new());
    let init_img_path = match req.init_image {
        Some(ref img) => {
            let (p, is_tmp) = resolve_image_input(img, "vid_init").map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid init_image: {}", e)))?;
            if is_tmp { temp_guard.0.push(p.clone()); }
            Some(p)
        }
        None => None,
    };
    let end_img_path = match req.end_image {
        Some(ref img) => {
            let (p, is_tmp) = resolve_image_input(img, "vid_end").map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid end_image: {}", e)))?;
            if is_tmp { temp_guard.0.push(p.clone()); }
            Some(p)
        }
        None => None,
    };

    let model_name_lower = resolved_model.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    let resolved_for_arch = resolved_model.clone();
    let is_wan = tokio::task::spawn_blocking(move || {
        if model_name_lower.contains("wan") {
            return true;
        }
        resolved_for_arch
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false)
            && models::inspect_gguf_metadata(&resolved_for_arch).architecture.eq_ignore_ascii_case("wan")
    })
    .await
    .unwrap_or(false);

    let size_str = req.size.as_deref().filter(|s| !s.trim().is_empty())
        .or(active_diff.resolution.as_deref().filter(|s| !s.trim().is_empty()))
        .unwrap_or("480x272");
    let (mut width, mut height) = (480u32, 272u32);
    if let Some((w, h)) = size_str.split_once('x') {
        if let (Ok(wi), Ok(hi)) = (w.trim().parse::<u32>(), h.trim().parse::<u32>()) {
            width = wi;
            height = hi;
        }
    }

    let steps = req.steps.or(active_diff.steps).unwrap_or(20);
    let cfg_scale = req.cfg_scale.or(active_diff.cfg_scale).unwrap_or(3.5);
    let video_frames = req.video_frames.or(active_diff.video_frames).unwrap_or(17).clamp(5, 257);
    let fps = req.fps.or(active_diff.fps).unwrap_or(16).clamp(1, 60);
    let flow_shift = req.flow_shift.or(active_diff.flow_shift).or_else(|| if is_wan { Some(5.0) } else { None });
    let vae_tiling = req.vae_tiling.or(active_diff.vae_tiling).unwrap_or(true);
    let temporal_tiling = req.temporal_tiling.or(active_diff.temporal_tiling).unwrap_or(true);
    let offload_to_cpu = req.offload_to_cpu.or(active_diff.offload_to_cpu).unwrap_or(false);

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
        resolve_pipeline_companions(&models_dir_clone, &resolved_clone, vae_e.as_deref(), clip_e.as_deref(), t5_e.as_deref(), lora_e.as_deref(), true, &downloading_files)
    }).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Companion scan failed: {}", e)))?;

    let out_dir = std::env::temp_dir().join("astrolabe_videos");
    tokio::fs::create_dir_all(&out_dir).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create video output dir: {}", e)))?;
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let webm_path = out_dir.join(format!("astrolabe_vid_{}_{}.webm", std::process::id(), now_ms));
    let mp4_path = out_dir.join(format!("astrolabe_vid_{}_{}.mp4", std::process::id(), now_ms));

    let mut cmd = tokio::process::Command::new(&sd_cli);
    cmd.arg("-M").arg("vid_gen").arg("--diffusion-model").arg(&resolved_model).arg("--lora-model-dir").arg(&companions.lora_dir);

    let lora_scale = req.lora_scale.or(active_diff.lora_scale).unwrap_or(1.0);
    let mut final_prompt = prompt.clone();
    if let Some(ref name) = companions.lora_name {
        if !final_prompt.contains(&format!("<lora:{}", name)) {
            final_prompt = format!("{} <lora:{}:{:.2}>", final_prompt, name, lora_scale);
        }
    }
    cmd.arg("-p").arg(&final_prompt).arg("-o").arg(&webm_path).arg("-W").arg(width.to_string()).arg("-H").arg(height.to_string()).arg("--steps").arg(steps.to_string()).arg("--cfg-scale").arg(cfg_scale.to_string()).arg("--video-frames").arg(video_frames.to_string()).arg("--fps").arg(fps.to_string());

    if let Some(shift) = flow_shift { cmd.arg("--flow-shift").arg(shift.to_string()); }
    if vae_tiling { cmd.arg("--vae-tiling"); }
    if temporal_tiling { cmd.arg("--temporal-tiling"); }
    apply_sd_flash_attn_arg(&mut cmd, req.diffusion_flash_attn.as_deref().or(active_diff.diffusion_flash_attn.as_deref()));
    if offload_to_cpu { cmd.arg("--offload-to-cpu"); }
    if let Some(ref vae) = companions.vae { cmd.arg("--vae").arg(vae); }
    if is_wan { cmd.arg("--vae-format").arg("wan"); }
    if let Some(ref t5) = companions.t5 { cmd.arg("--t5xxl").arg(t5); }
    if let Some(ref llm) = companions.llm_encoder { if companions.t5.is_none() && llm.exists() { cmd.arg("--llm").arg(llm); } }
    if let Some(ref init_p) = init_img_path { cmd.arg("--init-img").arg(init_p); }
    if let Some(ref end_p) = end_img_path { cmd.arg("--end-img").arg(end_p); }
    apply_sd_sampler_arg(&mut cmd, req.sampler.as_deref().or(active_diff.sampler.as_deref()), true);
    if let Some(bin_dir) = sd_cli.parent() {
        let cur_ld = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        cmd.env("LD_LIBRARY_PATH", format!("{}:{}", bin_dir.display(), cur_ld));
    }

    let label = resolved_model.file_name().unwrap_or_default().to_string_lossy().to_string();
    let run_out = match run_sd_cli_supervised(Arc::clone(&state), cmd, "video", &label, steps, req.timeout_secs).await {
        Ok(o) => o,
        Err(SdCliError::Cancelled) => {
            let _ = tokio::fs::remove_file(&webm_path).await;
            return Err((StatusCode::from_u16(499).unwrap_or(StatusCode::REQUEST_TIMEOUT), "Video generation cancelled by user".into()));
        }
        Err(SdCliError::Timeout(secs)) => {
            let _ = tokio::fs::remove_file(&webm_path).await;
            return Err((StatusCode::GATEWAY_TIMEOUT, format!("Video generation timed out after {} seconds", secs)));
        }
        Err(SdCliError::Spawn(e)) => {
            let _ = tokio::fs::remove_file(&webm_path).await;
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to spawn sd-cli: {}", e)));
        }
    };

    if !run_out.status.success() || !webm_path.exists() {
        let _ = tokio::fs::remove_file(&webm_path).await;
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format_sd_cli_failure(&run_out.stderr, run_out.status.code(), "Video generation requires compatible VAE and text encoder (e.g. Wan2.2_VAE.safetensors and umt5-xxl in models/components/).")));
    }

    let (mut final_path, mut final_ext, mut final_mime) = (webm_path.clone(), "webm".to_string(), "video/webm".to_string());
    if let Some(ffmpeg) = find_ffmpeg_binary() {
        let mut ff_cmd = tokio::process::Command::new(ffmpeg);
        ff_cmd.kill_on_drop(true).args(["-y", "-i"]).arg(&webm_path).args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]).arg(&mp4_path);
        if let Ok(Ok(ff_out)) = tokio::time::timeout(Duration::from_secs(60), ff_cmd.output()).await {
            if ff_out.status.success() && mp4_path.exists() && tokio::fs::metadata(&mp4_path).await.map(|m| m.len() > 0).unwrap_or(false) {
                let _ = tokio::fs::remove_file(&webm_path).await;
                final_path = mp4_path;
                final_ext = "mp4".to_string();
                final_mime = "video/mp4".to_string();
            } else {
                let _ = tokio::fs::remove_file(&mp4_path).await;
            }
        }
    }

    let bytes = tokio::fs::read(&final_path).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read generated video '{}': {}", final_path.display(), e)))?;
    if bytes.is_empty() {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "Generated video file is empty".to_string()));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    Ok(Json(VideoGenerationResponse {
        created: now,
        data: vec![VideoData {
            b64_json: base64_encode(&bytes),
            file_path: final_path.to_string_lossy().to_string(),
            mime_type: final_mime,
            ext: final_ext,
            revised_prompt: Some(prompt),
        }],
    }))
}
