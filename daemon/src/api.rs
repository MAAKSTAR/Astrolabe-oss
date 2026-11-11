// =============================================================================
// API Module — OpenAI-Compatible HTTP Endpoints
// =============================================================================
// Exposes:
//   POST /v1/chat/completions   — Streaming SSE inference (OpenAI format)
//   GET  /v1/models             — List loaded + local models
//   POST /v1/models/load        — Load a .gguf model into memory
//   POST /v1/models/unload      — Unload the active model
//   POST /v1/models/download    — Download a model from HuggingFace
//   GET  /v1/models/search      — Search HuggingFace for GGUF models
//   GET  /v1/health             — Health check + system info
// =============================================================================

use std::sync::Arc;
use std::path::{Path, PathBuf};

use crate::diffusion_common::normalize_sd_flash_attn;
use crate::diffusion_companions::resolve_pipeline_companions;

use axum::{
    Router,
    Json,
    extract::{DefaultBodyLimit, Query, State},
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, post},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::engine::{EngineConfig, InferenceEngine};
use crate::models;
use crate::hardware;

// =============================================================================
// Router
// =============================================================================

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/images/generations", post(crate::diffusion_images::generate_images))
        .route("/v1/images/edits", post(crate::diffusion_images::edit_images))
        .route("/v1/videos/generations", post(crate::diffusion_videos::generate_videos))
        .route("/v1/diffusion/status", get(crate::diffusion_runner::diffusion_status_handler))
        .route("/v1/diffusion/cancel", post(crate::diffusion_runner::diffusion_cancel_handler))
        .route("/v1/models", get(list_models))
        .route("/v1/models/load", post(load_model))
        .route("/v1/models/load/status", get(load_status))
        .route("/v1/models/unload", post(unload_model))
        .route("/v1/models/organize", post(organize_models_handler))
        .route("/v1/models/move", post(move_model_handler))
        .route("/v1/models/download", post(download_model))
        .route("/v1/models/downloads", get(active_downloads))
        .route("/v1/models/downloads/control", post(control_download))
        .route("/v1/models/search", get(search_models))
        .route("/v1/models/tree", get(repo_tree))
        .route("/v1/health", get(health_check))
        .route("/v1/system/config", get(get_system_config).post(update_system_config))
        .route("/v1/system/install_sglang", post(install_sglang))
        .route("/v1/system/llama-version", get(crate::llama_updater::check_llama_update_handler))
        .route("/v1/system/llama-update", post(crate::llama_updater::install_llama_update_handler))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state)
}

/// POST /v1/system/install_sglang — Installs SGLang via pip
async fn install_sglang() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let output = tokio::process::Command::new("pip")
        .arg("install")
        .arg("sglang[all]")
        .output()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to run pip: {}", e)))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("pip install failed: {}", err)));
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "message": "SGLang installed successfully",
    })))
}

// =============================================================================
// Request / Response Types (OpenAI-Compatible)
// =============================================================================

#[derive(Debug, Deserialize)]
struct ChatCompletionRequest {
    model: Option<String>,
    messages: Vec<ChatMessage>,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
    #[serde(default = "default_true")]
    stream: bool,
    temperature: Option<f32>,
    top_p: Option<f32>,
    repeat_penalty: Option<f32>,
    presence_penalty: Option<f32>,
    frequency_penalty: Option<f32>,
    tools: Option<serde_json::Value>,
}

fn default_max_tokens() -> u32 { 4096 }
fn default_true() -> bool { true }

#[derive(Debug, Deserialize, Serialize, Clone)]
struct ChatMessage {
    role: String,
    content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Serialize)]
struct ChatCompletionChunk {
    id: String,
    object: String,
    created: u64,
    model: String,
    choices: Vec<ChunkChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<crate::engine::InferenceMetrics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_processed: Option<usize>,
}

#[derive(Serialize)]
struct ChunkChoice {
    index: u32,
    delta: ChunkDelta,
    finish_reason: Option<String>,
}

#[derive(Serialize)]
struct ChunkDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}

#[derive(Serialize)]
struct ModelsResponse {
    object: String,
    data: Vec<ModelInfo>,
}

#[derive(Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: String,
    pub owned_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_context_length: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_layers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loaded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_family: Option<String>,
}

pub type ModelEntry = ModelInfo;

#[derive(Deserialize, Debug, Clone)]
pub struct LoadRequest {
    #[serde(alias = "modelId", alias = "model")]
    pub model_path: String,
    #[serde(default = "default_ctx", alias = "ctxSize")]
    pub ctx_size: u32,
    #[serde(default = "default_gpu_layers", alias = "nGPULayers", alias = "gpuLayers")]
    pub n_gpu_layers: i32,
    #[serde(default = "default_zero", alias = "nThreads", alias = "threads")]
    pub n_threads: u32,
    #[serde(default = "default_batch", alias = "nBatch", alias = "batch")]
    pub n_batch: u32,
    #[serde(default = "default_ubatch", alias = "nUbatch", alias = "ubatch")]
    pub n_ubatch: u32,
    #[serde(default, alias = "backendPreference")]
    pub backend_preference: Option<String>,
    #[serde(default = "default_true", alias = "useMmap")]
    pub use_mmap: bool,
    #[serde(default = "default_true", alias = "flashAttn")]
    pub flash_attn: bool,
    #[serde(default, alias = "offloadContextToCpu")]
    pub offload_context_to_cpu: Option<bool>,
    #[serde(default, alias = "noKvOffload")]
    pub no_kv_offload: Option<bool>,
    #[serde(default, alias = "modelFamily")]
    pub model_family: Option<String>,
    #[serde(default)]
    pub modality: Option<String>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default, alias = "cfgScale")]
    pub cfg_scale: Option<f32>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default, alias = "vaeTiling")]
    pub vae_tiling: Option<bool>,
    #[serde(default, alias = "temporalTiling")]
    pub temporal_tiling: Option<bool>,
    #[serde(default)]
    pub sampler: Option<String>,
    #[serde(default, alias = "clipPath")]
    pub clip_path: Option<String>,
    #[serde(default, alias = "vaePath")]
    pub vae_path: Option<String>,
    #[serde(default, alias = "t5Path")]
    pub t5_path: Option<String>,
    #[serde(default, alias = "loraPath")]
    pub lora_path: Option<String>,
    #[serde(default, alias = "loraScale")]
    pub lora_scale: Option<f32>,
    #[serde(default, alias = "videoFrames")]
    pub video_frames: Option<u32>,
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default, alias = "flowShift")]
    pub flow_shift: Option<f32>,
    #[serde(default, alias = "offloadToCpu")]
    pub offload_to_cpu: Option<bool>,
    #[serde(default, alias = "diffusionFlashAttn", alias = "videoFlashAttn")]
    pub diffusion_flash_attn: Option<String>,
}

#[derive(Debug, Serialize)]
struct LoadStatusResponse {
    loading: Option<crate::LoadingProgressDto>,
}

#[derive(Debug, Deserialize)]
struct OrganizeModelsRequest {
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Deserialize)]
struct MoveModelRequest {
    id_or_path: String,
    target_modality: String,
    #[serde(default)]
    component_role: Option<String>,
}

fn default_ctx() -> u32 { 131072 }
fn default_gpu_layers() -> i32 { -1 }
fn default_zero() -> u32 { 0 }
fn default_batch() -> u32 { 2048 }
fn default_ubatch() -> u32 { 512 }

#[derive(Deserialize)]
struct DownloadRequest {
    url: String,
    filename: String,
    #[serde(default)]
    hf_token: Option<String>,
    #[serde(default)]
    use_mirror: Option<bool>,
    #[serde(default)]
    repo_id: Option<String>,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    modality_hint: Option<String>,
    #[serde(default)]
    component_role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SystemConfigRequest {
    #[serde(default)]
    hf_token: Option<String>,
    #[serde(default)]
    use_mirror: Option<bool>,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    page: Option<usize>,
}

#[derive(Deserialize)]
struct RepoTreeQuery {
    repo: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    hardware: HardwareSummary,
    active_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ctx_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_diffusion: Option<ActiveDiffusionConfigDto>,
    loading_model: Option<crate::LoadingProgressDto>,
}

#[derive(Serialize, Clone)]
struct ActiveDiffusionConfigDto {
    pub model_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality: Option<String>,
    pub resolution: Option<String>,
    pub steps: Option<u32>,
    pub cfg_scale: Option<f32>,
    pub sampler: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_frames: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_shift: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vae_tiling: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temporal_tiling: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offload_to_cpu: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diffusion_flash_attn: Option<String>,
}

#[derive(Serialize)]
struct HardwareSummary {
    cpu: String,
    cpu_threads: usize,
    memory_gb: f64,
    used_memory_gb: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    available_memory_gb: Option<f64>,
    memory_percent: f64,
    cpu_temp: Option<f32>,
    gpu_temp: Option<f32>,
    max_temp: f32,
    is_thermal_throttled: bool,
    gpu: String,
    recommended_backend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vram_total_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vram_used_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vram_free_mb: Option<u64>,
    unified_memory: bool,
}

// =============================================================================
// Handlers
// =============================================================================

/// POST /v1/chat/completions — OpenAI-compatible streaming inference
async fn chat_completions(
    State(state): State<Arc<AppState>>,
    req_body: axum::body::Bytes,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let req: ChatCompletionRequest = serde_json::from_slice(&req_body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", e)))?;

    let engine_guard = state.engine.read().await;
    let engine = engine_guard
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "No model loaded. POST /v1/models/load first.".to_string()))?;

    match engine {
        crate::ActiveEngine::Llama(llama_engine) => {
            let model_name = llama_engine.model_name.clone();
            let prompt = build_prompt(&req.messages, &model_name);

            // Extract sampling parameters from request (with sensible defaults)
            let temperature = req.temperature.unwrap_or(0.7);
            let top_p = req.top_p.unwrap_or(0.9);
            let top_k = 40; // OpenAI doesn't expose top_k, use a sensible default
            let repeat_penalty = req.repeat_penalty
                .or_else(|| req.frequency_penalty.map(|f| 1.0 + f * 0.1))
                .unwrap_or(1.15); // Strong repetition penalty for local models

            // Launch inference on a dedicated OS thread via the engine
            let mut rx = llama_engine.generate_stream(&prompt, req.max_tokens, temperature, top_p, top_k, repeat_penalty);

            // Drop the read lock before streaming
            drop(engine_guard);

            let stream = async_stream::stream! {
                let id = format!("chatcmpl-{}", uuid_v4());
                let created = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                // First chunk: role
                yield Ok::<_, std::convert::Infallible>(Event::default().data(serde_json::to_string(&ChatCompletionChunk {
                    id: id.clone(),
                    object: "chat.completion.chunk".to_string(),
                    created,
                    model: model_name.clone(),
                    choices: vec![ChunkChoice {
                        index: 0,
                        delta: ChunkDelta {
                            role: Some("assistant".to_string()),
                            content: None,
                        },
                        finish_reason: None,
                    }],
                    usage: None,
                    prompt_tokens: None,
                    prompt_processed: None,
                }).unwrap()));

                // Token chunks
                while let Some(chunk) = rx.recv().await {
                    if chunk.is_final {
                        // Final chunk with finish_reason and full usage metrics
                        yield Ok::<_, std::convert::Infallible>(Event::default().data(serde_json::to_string(&ChatCompletionChunk {
                            id: id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created,
                            model: model_name.clone(),
                            choices: vec![ChunkChoice {
                                index: 0,
                                delta: ChunkDelta { role: None, content: None },
                                finish_reason: Some("stop".to_string()),
                            }],
                            usage: chunk.metrics,
                            prompt_tokens: chunk.prompt_tokens,
                            prompt_processed: chunk.prompt_processed,
                        }).unwrap()));
                        break;
                    }

                    yield Ok::<_, std::convert::Infallible>(Event::default().data(serde_json::to_string(&ChatCompletionChunk {
                        id: id.clone(),
                        object: "chat.completion.chunk".to_string(),
                        created,
                        model: model_name.clone(),
                        choices: vec![ChunkChoice {
                            index: 0,
                            delta: ChunkDelta {
                                role: None,
                                content: if chunk.text.is_empty() { None } else { Some(chunk.text) },
                            },
                            finish_reason: None,
                        }],
                        usage: None,
                        prompt_tokens: chunk.prompt_tokens,
                        prompt_processed: chunk.prompt_processed,
                    }).unwrap()));
                }

                // Terminal signal
                yield Ok::<_, std::convert::Infallible>(Event::default().data("[DONE]".to_string()));
            };

            Ok(Sse::new(stream).into_response())
        }
        crate::ActiveEngine::LlamaServer(server_engine) => {
            let server_port = server_engine.port;
            drop(engine_guard);

            let client = reqwest::Client::new();
            let server_url = format!("http://127.0.0.1:{}/v1/chat/completions", server_port);
            
            let server_res = client
                .post(&server_url)
                .header("Content-Type", "application/json")
                .body(req_body.to_vec())
                .send()
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to reach llama-server: {}", e)))?;

            let mut response_builder = axum::response::Response::builder()
                .status(server_res.status());
            
            for (k, v) in server_res.headers() {
                response_builder = response_builder.header(k, v);
            }

            let stream = server_res.bytes_stream();
            let body = axum::body::Body::from_stream(stream);
            
            Ok(response_builder.body(body).unwrap())
        }
        crate::ActiveEngine::Sglang(sglang_engine) => {
            let sglang_port = sglang_engine.port;
            drop(engine_guard);

            // Proxy the raw JSON request to SGLang
            let client = reqwest::Client::new();
            let sglang_url = format!("http://127.0.0.1:{}/v1/chat/completions", sglang_port);
            
            let sglang_res = client
                .post(&sglang_url)
                .header("Content-Type", "application/json")
                .body(req_body.to_vec())
                .send()
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to reach SGLang: {}", e)))?;

            // Stream the response back to the client
            let mut response_builder = axum::response::Response::builder()
                .status(sglang_res.status());
            
            for (k, v) in sglang_res.headers() {
                response_builder = response_builder.header(k, v);
            }

            let stream = sglang_res.bytes_stream();
            let body = axum::body::Body::from_stream(stream);
            
            Ok(response_builder.body(body).unwrap())
        }
    }
}

/// GET /v1/models — List all local models + active model
async fn list_models(
    State(state): State<Arc<AppState>>,
) -> Json<ModelsResponse> {
    let models_dir = state.models_dir.clone();
    let local = tokio::task::spawn_blocking(move || models::list_local_models(&models_dir))
        .await
        .unwrap_or_default();
    let active = state.active_model.read().await.clone();

    let data = local
        .into_iter()
        .map(|m| {
            let is_loaded = active
                .as_ref()
                .map(|a| {
                    a == &m.path
                        || a == &m.name
                        || m.relative_path.as_deref() == Some(a.as_str())
                        || m.path.ends_with(a)
                })
                .unwrap_or(false);
            ModelInfo {
                id: m.path.clone(),
                object: "model".to_string(),
                owned_by: "local".to_string(),
                path: Some(m.path),
                relative_path: m.relative_path,
                modality: m.modality,
                component_role: m.component_role,
                size_display: Some(m.size_display),
                size_bytes: Some(m.size_bytes),
                max_context_length: m.max_context_length,
                total_layers: m.total_layers,
                architecture: Some(m.architecture),
                quantization: Some(m.quantization),
                loaded: Some(is_loaded),
                name: Some(m.name),
                model_family: Some(models::model_family_as_str(&m.model_family).to_string()),
            }
        })
        .collect();

    Json(ModelsResponse {
        object: "list".to_string(),
        data,
    })
}

struct LoadingResetGuard(Arc<tokio::sync::RwLock<Option<crate::LoadingProgressDto>>>);

impl Drop for LoadingResetGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.try_write() {
            *guard = None;
        } else if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let lock = Arc::clone(&self.0);
            handle.spawn(async move {
                *lock.write().await = None;
            });
        }
    }
}

async fn set_loading_stage(
    lock: &Arc<tokio::sync::RwLock<Option<crate::LoadingProgressDto>>>,
    model_id: &str,
    percent: u8,
    stage: &str,
) {
    let mut guard = lock.write().await;
    *guard = Some(crate::LoadingProgressDto {
        model_id: model_id.to_string(),
        percent,
        stage: stage.to_string(),
    });
}

pub(crate) fn resolve_model_path_in_workspace(
    models_dir: &str,
    requested: &str,
    preferred_subfolders: &[&str],
) -> PathBuf {
    let req_trimmed = requested.trim();
    let req_path = PathBuf::from(req_trimmed);
    if req_path.is_absolute() && req_path.exists() {
        return req_path;
    }

    let root = Path::new(models_dir);
    let direct = root.join(req_trimmed);
    if direct.exists() {
        return direct;
    }
    if !req_trimmed.ends_with(".gguf") && !req_trimmed.ends_with(".safetensors") && !req_trimmed.ends_with(".sft") {
        let with_gguf = direct.with_extension("gguf");
        if with_gguf.exists() {
            return with_gguf;
        }
    }

    if let Some(fname) = req_path.file_name() {
        let fname_str = fname.to_string_lossy();
        let root_cand = root.join(fname);
        if root_cand.exists() {
            return root_cand;
        }
        for folder in preferred_subfolders {
            let sub = root.join(folder).join(fname);
            if sub.exists() {
                return sub;
            }
            if !fname_str.ends_with(".gguf") && !fname_str.ends_with(".safetensors") && !fname_str.ends_with(".sft") {
                let sub_gguf = root.join(folder).join(format!("{}.gguf", fname_str));
                if sub_gguf.exists() {
                    return sub_gguf;
                }
            }
        }
    }

    let local = models::list_local_models(models_dir);
    if let Some(m) = local.into_iter().find(|m| {
        m.path == req_trimmed
            || m.relative_path.as_deref() == Some(req_trimmed)
            || m.name == req_trimmed
    }) {
        return PathBuf::from(m.path);
    }

    if req_path.is_absolute() {
        req_path
    } else {
        direct
    }
}

/// GET /v1/models/load/status — Return live model load percentage & stage
async fn load_status(
    State(state): State<Arc<AppState>>,
) -> Json<LoadStatusResponse> {
    let loading = state.loading_model.read().await.clone();
    Json(LoadStatusResponse { loading })
}

/// POST /v1/models/organize — Safely classify and optionally relocate loose root model files
async fn organize_models_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OrganizeModelsRequest>,
) -> Result<Json<models::OrganizeResult>, (StatusCode, String)> {
    let models_dir = state.models_dir.clone();
    let dry_run = req.dry_run;
    let res = tokio::task::spawn_blocking(move || models::organize_root_models(&models_dir, dry_run))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Organize task panicked: {}", e)))?
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    if !dry_run && !res.moves.is_empty() {
        let root = Path::new(&state.models_dir);
        let mut active = state.active_model.write().await;
        if let Some(cur) = active.clone() {
            for mv in &res.moves {
                if cur == mv.filename || cur == root.join(&mv.from).to_string_lossy().as_ref() {
                    *active = Some(root.join(&mv.to).to_string_lossy().to_string());
                    break;
                }
            }
        }
        let mut diff = state.active_diffusion.write().await;
        if let Some(cur_diff) = diff.model_path.clone() {
            for mv in &res.moves {
                if cur_diff == mv.filename || cur_diff == root.join(&mv.from).to_string_lossy().as_ref() {
                    diff.model_path = Some(root.join(&mv.to).to_string_lossy().to_string());
                    diff.modality = Some(mv.modality.clone());
                    break;
                }
            }
        }
    }

    Ok(Json(res))
}

/// POST /v1/models/move — Explicitly move/reclassify a model to a modality folder
async fn move_model_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MoveModelRequest>,
) -> Result<Json<models::MoveModelResult>, (StatusCode, String)> {
    let models_dir = state.models_dir.clone();
    let id_or_path = req.id_or_path.clone();
    let target_modality = req.target_modality.clone();
    let component_role = req.component_role.clone();

    let res = tokio::task::spawn_blocking(move || {
        models::move_model_file(&models_dir, &id_or_path, &target_modality, component_role.as_deref())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Move task panicked: {}", e)))?
    .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let old_abs = Path::new(&state.models_dir).join(&res.from).to_string_lossy().to_string();
    {
        let mut active = state.active_model.write().await;
        if let Some(ref cur) = *active {
            if cur == &old_abs || cur == &res.from || cur == &res.filename {
                *active = Some(res.path.clone());
            }
        }
    }
    {
        let mut diff = state.active_diffusion.write().await;
        if let Some(ref cur_diff) = diff.model_path {
            if cur_diff == &old_abs || cur_diff == &res.from || cur_diff == &res.filename {
                diff.model_path = Some(res.path.clone());
                diff.modality = Some(res.modality.clone());
            }
        }
    }

    Ok(Json(res))
}

/// POST /v1/models/load — Load a .gguf model into GPU/CPU memory
async fn load_model(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoadRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Unload existing model first
    {
        let mut engine = state.engine.write().await;
        if let Some(ref mut e) = *engine {
            match e {
                crate::ActiveEngine::Llama(l) => l.unload(),
                crate::ActiveEngine::LlamaServer(s) => s.unload().await,
                crate::ActiveEngine::Sglang(s) => s.unload().await,
            }
        }
        *engine = None;
    }

    let _loading_guard = LoadingResetGuard(Arc::clone(&state.loading_model));
    set_loading_stage(&state.loading_model, &req.model_path, 5, "Resolving model file...").await;

    let hw = hardware::detect();
    let mut use_sglang = false;

    if let Some(pref) = &req.backend_preference {
        if pref.to_lowercase() == "sglang" {
            if hw.has_nvidia {
                use_sglang = true;
            } else {
                tracing::warn!("SGLang requested but no NVIDIA GPU detected. Falling back to llama.cpp");
            }
        }
    }

    let models_dir_clone = state.models_dir.clone();
    let req_model_clone = req.model_path.clone();
    let resolved = tokio::task::spawn_blocking(move || {
        resolve_model_path_in_workspace(
            &models_dir_clone,
            &req_model_clone,
            &[
                "llm",
                "image",
                "video",
                "music",
                "components/vae",
                "components/encoders",
                "components/mmproj",
                "components/loras",
            ],
        )
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Path resolve failed: {}", e)))?;

    let resolved_path = resolved.to_string_lossy().to_string();
    if !resolved.exists() {
        return Err((StatusCode::NOT_FOUND, format!("Model file not found: {}", resolved_path)));
    }

    let rel_for_class = resolved
        .strip_prefix(&state.models_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| resolved_path.clone());
    let resolved_for_meta = resolved.clone();
    let (detected_modality, _detected_role, detected_family) = tokio::task::spawn_blocking(move || {
        let meta = if resolved_for_meta.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("gguf")).unwrap_or(false) {
            models::inspect_gguf_metadata(&resolved_for_meta)
        } else {
            models::inspect_safetensors_metadata(&resolved_for_meta)
        };
        models::classify_model_entry(&rel_for_class, &meta, None)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Metadata inspect failed: {}", e)))?;

    let effective_modality = req
        .modality
        .as_deref()
        .and_then(models::normalize_modality)
        .unwrap_or(detected_modality.as_str())
        .to_string();

    let is_diffusion = req.model_family.as_deref() == Some("diffusion_flow")
        || matches!(effective_modality.as_str(), "image" | "video" | "music")
        || (req.model_family.is_none() && detected_family == models::ModelFamily::DiffusionFlow);

    if is_diffusion {
        set_loading_stage(&state.loading_model, &req.model_path, 25, "Validating diffusion/video weights...").await;
        let check_path = resolved.clone();
        tokio::task::spawn_blocking(move || std::fs::metadata(&check_path).map(|m| m.len()))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("File verification failed: {}", e)))?
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Cannot access model file: {}", e)))?;

        set_loading_stage(&state.loading_model, &req.model_path, 65, "Resolving companion components...").await;
        let downloading_files: std::collections::HashSet<String> = {
            let dl = state.active_downloads.read().await;
            dl.values()
                .filter(|d| d.status == "downloading" || d.status == "starting" || d.status == "paused")
                .map(|d| d.model_name.to_lowercase())
                .collect()
        };
        let models_dir_scan = state.models_dir.clone();
        let resolved_scan = resolved.clone();
        let req_clone = req.clone();
        let is_video_mod = effective_modality == "video";
        let _companions = tokio::task::spawn_blocking(move || {
            resolve_pipeline_companions(
                &models_dir_scan,
                &resolved_scan,
                req_clone.vae_path.as_deref(),
                req_clone.clip_path.as_deref(),
                req_clone.t5_path.as_deref(),
                req_clone.lora_path.as_deref(),
                is_video_mod,
                &downloading_files,
            )
        })
        .await;

        set_loading_stage(&state.loading_model, &req.model_path, 90, "Applying pipeline configuration...").await;
        let mut diff = state.active_diffusion.write().await;
        *diff = crate::ActiveDiffusionConfig {
            model_path: Some(resolved_path.clone()),
            modality: Some(effective_modality.clone()),
            steps: req.steps,
            cfg_scale: req.cfg_scale,
            resolution: req.resolution.clone(),
            vae_tiling: req.vae_tiling,
            temporal_tiling: req.temporal_tiling,
            sampler: req.sampler.clone(),
            clip_path: req.clip_path.clone(),
            vae_path: req.vae_path.clone(),
            t5_path: req.t5_path.clone(),
            lora_path: req.lora_path.clone(),
            lora_scale: req.lora_scale,
            video_frames: req.video_frames,
            fps: req.fps,
            flow_shift: req.flow_shift,
            offload_to_cpu: req.offload_to_cpu,
            diffusion_flash_attn: req
                .diffusion_flash_attn
                .as_deref()
                .map(|s| normalize_sd_flash_attn(Some(s)).to_string()),
        };
        let model_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "diffusion".to_string());
        {
            let mut active = state.active_model.write().await;
            *active = Some(resolved_path.clone());
        }
        set_loading_stage(&state.loading_model, &req.model_path, 100, "Model ready").await;
        tracing::info!("🎨 Active {} model configured: {}", effective_modality, resolved_path);
        return Ok(Json(serde_json::json!({
            "status": "loaded",
            "model": model_name,
            "model_family": "diffusion_flow",
            "modality": effective_modality
        })));
    }

    let is_component = req.model_family.as_deref() == Some("pipeline_component")
        || effective_modality == "component"
        || detected_family == models::ModelFamily::PipelineComponent;
    if is_component {
        set_loading_stage(&state.loading_model, &req.model_path, 100, "Component selected").await;
        let model_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "component".to_string());
        {
            let mut active = state.active_model.write().await;
            *active = Some(resolved_path.clone());
        }
        return Ok(Json(serde_json::json!({
            "status": "loaded",
            "model": model_name,
            "model_family": "pipeline_component",
            "modality": "component"
        })));
    }

    let (name, new_engine) = if use_sglang {
        set_loading_stage(&state.loading_model, &req.model_path, 20, "Starting SGLang runtime server...").await;
        let sglang_engine = crate::sglang::SglangEngine::load(&resolved_path, 47991)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        set_loading_stage(&state.loading_model, &req.model_path, 100, "Model ready").await;
        let name = sglang_engine.model_name.clone();
        (name, crate::ActiveEngine::Sglang(sglang_engine))
    } else {
        let use_server = if let Some(pref) = &req.backend_preference {
            let p = pref.to_lowercase();
            if p == "legacy" || p == "internal" {
                false
            } else {
                crate::llama_server::LlamaServerEngine::is_available()
            }
        } else {
            crate::llama_server::LlamaServerEngine::is_available()
        };

        let no_kv_offload = req.offload_context_to_cpu.unwrap_or_else(|| req.no_kv_offload.unwrap_or(false));

        if use_server {
            tracing::info!("Using modern llama-server for model: {} (no_kv_offload={})", resolved_path, no_kv_offload);
            set_loading_stage(&state.loading_model, &req.model_path, 8, "Spawning llama-server process...").await;
            let server_engine = crate::llama_server::LlamaServerEngine::load(
                &resolved_path,
                47995,
                req.ctx_size,
                req.n_gpu_layers,
                req.n_threads,
                req.n_batch,
                req.n_ubatch,
                req.flash_attn,
                req.use_mmap,
                no_kv_offload,
                Some((Arc::clone(&state.loading_model), req.model_path.clone())),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let name = server_engine.model_name.clone();
            (name, crate::ActiveEngine::LlamaServer(server_engine))
        } else {
            let config = EngineConfig {
                model_path: resolved_path.clone(),
                ctx_size: req.ctx_size,
                n_gpu_layers: req.n_gpu_layers,
                n_threads: req.n_threads,
                n_batch: req.n_batch,
                n_ubatch: req.n_ubatch,
                use_mmap: req.use_mmap,
                flash_attn: req.flash_attn,
                no_kv_offload,
                ..Default::default()
            };

            set_loading_stage(&state.loading_model, &req.model_path, 25, "Loading GGUF into in-process runtime...").await;
            let in_proc_res = tokio::task::spawn_blocking(move || InferenceEngine::load(config)).await;
            match in_proc_res {
                Ok(Ok(engine)) => {
                    set_loading_stage(&state.loading_model, &req.model_path, 100, "Model ready").await;
                    let name = engine.model_name.clone();
                    (name, crate::ActiveEngine::Llama(engine))
                }
                _ => {
                    tracing::warn!("In-process engine load failed or architecture unsupported. Falling back to upstream llama-server...");
                    set_loading_stage(&state.loading_model, &req.model_path, 10, "Falling back to llama-server...").await;
                    let server_engine = crate::llama_server::LlamaServerEngine::load(
                        &resolved_path,
                        47995,
                        req.ctx_size,
                        req.n_gpu_layers,
                        req.n_threads,
                        req.n_batch,
                        req.n_ubatch,
                        req.flash_attn,
                        req.use_mmap,
                        no_kv_offload,
                        Some((Arc::clone(&state.loading_model), req.model_path.clone())),
                    )
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
                    let name = server_engine.model_name.clone();
                    (name, crate::ActiveEngine::LlamaServer(server_engine))
                }
            }
        }
    };

    {
        let mut state_engine = state.engine.write().await;
        *state_engine = Some(new_engine);
    }
    {
        let mut active = state.active_model.write().await;
        *active = Some(resolved_path);
    }

    Ok(Json(serde_json::json!({
        "status": "loaded",
        "model": name,
    })))
}

/// POST /v1/models/unload — Free the model from memory
async fn unload_model(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let mut engine = state.engine.write().await;
    if let Some(ref mut e) = *engine {
        match e {
            crate::ActiveEngine::Llama(l) => l.unload(),
            crate::ActiveEngine::LlamaServer(s) => s.unload().await,
            crate::ActiveEngine::Sglang(s) => s.unload().await,
        }
    }
    *engine = None;

    let mut active = state.active_model.write().await;
    *active = None;

    {
        let mut diff = state.active_diffusion.write().await;
        *diff = crate::ActiveDiffusionConfig::default();
    }

    Json(serde_json::json!({ "status": "unloaded" }))
}

/// GET /v1/system/config — Get current system configurations (HF token, mirror, network concurrency)
async fn get_system_config(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let tok = state.hf_token.read().await;
    let mirror = *state.use_mirror.read().await;
    Json(serde_json::json!({
        "hf_token_configured": tok.is_some() && !tok.as_ref().unwrap().trim().is_empty(),
        "use_mirror": mirror,
        "max_connections": 16,
        "disk_cache_mb": 64,
        "preallocation": "falloc",
    }))
}

/// POST /v1/system/config — Update system configurations
async fn update_system_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SystemConfigRequest>,
) -> Json<serde_json::Value> {
    if let Some(tok) = req.hf_token {
        let trimmed = tok.trim();
        let val = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        *state.hf_token.write().await = val;
    }
    if let Some(mirror) = req.use_mirror {
        *state.use_mirror.write().await = mirror;
    }
    let tok = state.hf_token.read().await;
    let mirror = *state.use_mirror.read().await;
    Json(serde_json::json!({
        "status": "updated",
        "hf_token_configured": tok.is_some() && !tok.as_ref().unwrap().trim().is_empty(),
        "use_mirror": mirror,
    }))
}

/// POST /v1/models/download — Download a model from HuggingFace into its routed modality subfolder
async fn download_model(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DownloadRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let url = req.url.clone();
    let hf_token = if req.hf_token.is_some() && !req.hf_token.as_ref().unwrap().trim().is_empty() {
        req.hf_token
    } else {
        state.hf_token.read().await.clone()
    };
    let use_mirror = req.use_mirror.unwrap_or(*state.use_mirror.read().await);

    let route = models::resolve_download_target(
        &url,
        &req.filename,
        req.repo_id.as_deref(),
        req.pipeline_tag.as_deref(),
        req.tags.as_deref(),
        req.modality_hint.as_deref(),
        req.component_role.as_deref(),
        hf_token.as_deref(),
    )
    .await;
    let filename = route.filename.clone();

    // Check if it's already downloading
    if state.active_downloads.read().await.contains_key(&filename) {
        let dl = state.active_downloads.read().await.get(&filename).unwrap().clone();
        if dl.status == "downloading" || dl.status == "starting" {
            return Err((StatusCode::CONFLICT, format!("{} is already downloading", filename)));
        }
    }

    // Cache the download URL for pause/retry support
    state.download_urls.write().await.insert(filename.clone(), url.clone());

    let initial_progress = crate::models::DownloadProgress {
        model_name: filename.clone(),
        downloaded_bytes: 0,
        total_bytes: 0,
        percent: 0.0,
        speed_bytes_per_sec: None,
        speed_display: None,
        eta_seconds: None,
        status: "starting".to_string(),
        url: Some(url.clone()),
        relative_path: Some(route.relative_path.clone()),
        modality: Some(route.modality.clone()),
    };

    // Immediately insert initial "starting" progress so the client sees it right away
    state.active_downloads.write().await.insert(filename.clone(), initial_progress.clone());

    let (tx, mut rx) = tokio::sync::watch::channel(initial_progress);

    let state_clone = Arc::clone(&state);
    let filename_clone = filename.clone();

    tokio::spawn(async move {
        while rx.changed().await.is_ok() {
            let progress = rx.borrow().clone();
            state_clone.active_downloads.write().await.insert(filename_clone.clone(), progress);
        }
    });

    let models_dir = state.models_dir.clone();
    let filename_for_task = filename.clone();
    let state_clone2 = Arc::clone(&state);
    let url_for_task = url.clone();
    let route_for_task = route.clone();

    let hf_token_for_task = hf_token.clone();
    let task = tokio::spawn(async move {
        match models::download_model(
            &url,
            &models_dir,
            &route_for_task,
            hf_token_for_task.as_deref(),
            use_mirror,
            Some(tx),
        )
        .await
        {
            Ok(_) => {
                if let Some(dl) = state_clone2.active_downloads.write().await.get_mut(&filename_for_task) {
                    dl.status = "finished".to_string();
                    dl.percent = 100.0;
                }
                state_clone2.download_tasks.write().await.remove(&filename_for_task);
            }
            Err(e) => {
                let mut map = state_clone2.active_downloads.write().await;
                if let Some(dl) = map.get_mut(&filename_for_task) {
                    dl.status = format!("error: {}", e);
                } else {
                    map.insert(
                        filename_for_task.clone(),
                        crate::models::DownloadProgress {
                            model_name: filename_for_task.clone(),
                            downloaded_bytes: 0,
                            total_bytes: 0,
                            percent: 0.0,
                            speed_bytes_per_sec: None,
                            speed_display: None,
                            eta_seconds: None,
                            status: format!("error: {}", e),
                            url: Some(url_for_task),
                            relative_path: Some(route_for_task.relative_path.clone()),
                            modality: Some(route_for_task.modality.clone()),
                        },
                    );
                }
                state_clone2.download_tasks.write().await.remove(&filename_for_task);
            }
        }
    });

    state.download_tasks.write().await.insert(filename.clone(), task.abort_handle());

    Ok(Json(serde_json::json!({
        "status": "started",
        "filename": filename,
        "relative_path": route.relative_path,
        "modality": route.modality,
    })))
}

#[derive(Debug, Deserialize)]
struct DownloadControlRequest {
    filename: String,
    action: String, // "pause" | "retry" | "delete"
    #[serde(default)]
    url: Option<String>,
}

/// POST /v1/models/downloads/control — Control active downloads (pause, retry, delete)
async fn control_download(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DownloadControlRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let raw_filename = req.filename;
    let filename = Path::new(&raw_filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| raw_filename.clone());
    let action = req.action.to_lowercase();

    match action.as_str() {
        "pause" => {
            if let Some(handle) = state.download_tasks.write().await.remove(&filename) {
                handle.abort();
            }
            if let Some(dl) = state.active_downloads.write().await.get_mut(&filename) {
                dl.status = "paused".to_string();
                dl.speed_display = None;
                dl.speed_bytes_per_sec = None;
                dl.eta_seconds = None;
            }
            models::update_manifest_entry(&state.models_dir, &filename, "", 0, "paused");
            Ok(Json(serde_json::json!({ "status": "paused", "filename": filename })))
        }
        "retry" | "resume" => {
            let manifest = models::load_manifest(&state.models_dir);
            let manifest_rec = manifest
                .get(&filename)
                .or_else(|| manifest.get(&raw_filename));

            let mut url_opt = req.url.clone();
            if url_opt.is_none() {
                url_opt = state.download_urls.read().await.get(&filename).cloned();
            }
            if url_opt.is_none() {
                if let Some(rec) = manifest_rec {
                    url_opt = Some(rec.url.clone());
                }
            }
            if let Some(url) = url_opt {
                state.download_urls.write().await.insert(filename.clone(), url.clone());
                if let Some(handle) = state.download_tasks.write().await.remove(&filename) {
                    handle.abort();
                }

                let hf_token = state.hf_token.read().await.clone();
                let use_mirror = *state.use_mirror.read().await;

                let route = if let Some(rec) = manifest_rec {
                    if let (Some(rp), Some(mod_str)) = (&rec.relative_path, &rec.modality) {
                        if !rp.is_empty() && !mod_str.is_empty() {
                            let fam = match rec.family.as_deref() {
                                Some("diffusion_flow") => models::ModelFamily::DiffusionFlow,
                                Some("autoregressive_image") => models::ModelFamily::AutoregressiveImage,
                                Some("pipeline_component") => models::ModelFamily::PipelineComponent,
                                _ => models::ModelFamily::TextLlm,
                            };
                            let role = if mod_str == "component" {
                                Some(models::infer_component_role(rp, "").to_string())
                            } else {
                                None
                            };
                            models::DownloadRoutePlan {
                                filename: filename.clone(),
                                relative_path: rp.clone(),
                                modality: mod_str.clone(),
                                component_role: role,
                                family: fam,
                                repo_id: rec.repo_id.clone(),
                                explicit_override: false,
                            }
                        } else {
                            models::resolve_download_target(
                                &url,
                                &filename,
                                rec.repo_id.as_deref(),
                                None,
                                None,
                                None,
                                None,
                                hf_token.as_deref(),
                            )
                            .await
                        }
                    } else {
                        models::resolve_download_target(
                            &url,
                            &filename,
                            rec.repo_id.as_deref(),
                            None,
                            None,
                            None,
                            None,
                            hf_token.as_deref(),
                        )
                        .await
                    }
                } else {
                    models::resolve_download_target(
                        &url,
                        &raw_filename,
                        None,
                        None,
                        None,
                        None,
                        None,
                        hf_token.as_deref(),
                    )
                    .await
                };

                let dest_path = models::resolve_download_file_path(&state.models_dir, &raw_filename, manifest_rec);
                let existing_size = if dest_path.exists() {
                    tokio::fs::metadata(&dest_path).await.map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };

                let (tx, mut rx) = tokio::sync::watch::channel(crate::models::DownloadProgress {
                    model_name: filename.clone(),
                    downloaded_bytes: existing_size,
                    total_bytes: 0,
                    percent: 0.0,
                    speed_bytes_per_sec: None,
                    speed_display: None,
                    eta_seconds: None,
                    status: "downloading".to_string(),
                    url: Some(url.clone()),
                    relative_path: Some(route.relative_path.clone()),
                    modality: Some(route.modality.clone()),
                });

                let state_clone = Arc::clone(&state);
                let filename_clone = filename.clone();
                tokio::spawn(async move {
                    while rx.changed().await.is_ok() {
                        let progress = rx.borrow().clone();
                        state_clone.active_downloads.write().await.insert(filename_clone.clone(), progress);
                    }
                });

                let models_dir = state.models_dir.clone();
                let filename_for_task = filename.clone();
                let state_clone2 = Arc::clone(&state);
                let route_for_task = route.clone();
                let hf_token_for_task = hf_token.clone();

                let task = tokio::spawn(async move {
                    match models::download_model(
                        &url,
                        &models_dir,
                        &route_for_task,
                        hf_token_for_task.as_deref(),
                        use_mirror,
                        Some(tx),
                    )
                    .await
                    {
                        Ok(_) => {
                            if let Some(dl) = state_clone2.active_downloads.write().await.get_mut(&filename_for_task) {
                                dl.status = "finished".to_string();
                                dl.percent = 100.0;
                            }
                            state_clone2.download_tasks.write().await.remove(&filename_for_task);
                        }
                        Err(e) => {
                            if let Some(dl) = state_clone2.active_downloads.write().await.get_mut(&filename_for_task) {
                                dl.status = format!("error: {}", e);
                            }
                            state_clone2.download_tasks.write().await.remove(&filename_for_task);
                        }
                    }
                });

                state.download_tasks.write().await.insert(filename.clone(), task.abort_handle());
                Ok(Json(serde_json::json!({
                    "status": "resumed",
                    "filename": filename,
                    "relative_path": route.relative_path,
                    "modality": route.modality
                })))
            } else {
                Err((StatusCode::NOT_FOUND, format!("No URL cached or found in manifest for {}", filename)))
            }
        }
        "delete" | "cancel" => {
            if let Some(handle) = state.download_tasks.write().await.remove(&filename) {
                handle.abort();
            }
            state.active_downloads.write().await.remove(&filename);
            state.download_urls.write().await.remove(&filename);

            let manifest = models::load_manifest(&state.models_dir);
            let manifest_rec = manifest
                .get(&filename)
                .or_else(|| manifest.get(&raw_filename));

            let file_path = models::resolve_download_file_path(&state.models_dir, &raw_filename, manifest_rec);
            if file_path.exists() {
                let _ = tokio::fs::remove_file(&file_path).await;
            }
            let aria2_file = PathBuf::from(format!("{}.aria2", file_path.display()));
            if aria2_file.exists() {
                let _ = tokio::fs::remove_file(&aria2_file).await;
            }

            // Also clean any stray root file/sidecar if manifest pointed elsewhere
            let root_file = std::path::PathBuf::from(&state.models_dir).join(&filename);
            if root_file != file_path {
                if root_file.exists() {
                    let _ = tokio::fs::remove_file(&root_file).await;
                }
                let root_aria2 = PathBuf::from(format!("{}.aria2", root_file.display()));
                if root_aria2.exists() {
                    let _ = tokio::fs::remove_file(&root_aria2).await;
                }
            }

            models::remove_manifest_entry(&state.models_dir, &filename);

            Ok(Json(serde_json::json!({ "status": "deleted", "filename": filename })))
        }
        _ => Err((StatusCode::BAD_REQUEST, format!("Unknown action '{}'. Use pause, retry, or delete", action)))
    }
}

/// GET /v1/models/downloads — Get active downloads
async fn active_downloads(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let downloads = state.active_downloads.read().await;
    let mut list: Vec<_> = downloads.values().cloned().collect();
    // Sort so the UI is stable
    list.sort_by(|a, b| a.model_name.cmp(&b.model_name));
    Json(serde_json::json!({ "downloads": list }))
}

/// GET /v1/models/search?q=qwen&page=0 — Search HuggingFace for GGUF models
async fn search_models(
    Query(params): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let results = models::search_huggingface(&params.q)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    // Implement pagination (10 per page)
    let page = params.page.unwrap_or(0);
    let start = page * 10;
    
    let paged_results = if start < results.len() {
        results.into_iter().skip(start).take(10).collect::<Vec<_>>()
    } else {
        vec![]
    };

    Ok(Json(serde_json::json!({
        "results": paged_results,
    })))
}

/// GET /v1/models/tree?repo=TheBloke/Llama-2-7B-Chat-GGUF
async fn repo_tree(
    Query(params): Query<RepoTreeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let files = models::fetch_repo_tree(&params.repo)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    Ok(Json(serde_json::json!({
        "files": files,
    })))
}

/// GET /v1/health — System health and hardware info
async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Json<HealthResponse> {
    let metrics = hardware::get_live_metrics();
    let active = state.active_model.read().await.clone();
    let engine_guard = state.engine.read().await;
    let ctx_size = match engine_guard.as_ref() {
        Some(crate::ActiveEngine::Llama(l)) => Some(l.ctx_size),
        Some(crate::ActiveEngine::LlamaServer(s)) => Some(s.ctx_size),
        _ => None,
    };
    drop(engine_guard);

    let diff_guard = state.active_diffusion.read().await;
    let active_diffusion = diff_guard.model_path.as_ref().map(|p| {
        ActiveDiffusionConfigDto {
            model_path: Some(p.clone()),
            modality: diff_guard.modality.clone(),
            resolution: diff_guard.resolution.clone(),
            steps: diff_guard.steps,
            cfg_scale: diff_guard.cfg_scale,
            sampler: diff_guard.sampler.clone(),
            video_frames: diff_guard.video_frames,
            fps: diff_guard.fps,
            flow_shift: diff_guard.flow_shift,
            vae_tiling: diff_guard.vae_tiling,
            temporal_tiling: diff_guard.temporal_tiling,
            offload_to_cpu: diff_guard.offload_to_cpu,
            diffusion_flash_attn: diff_guard.diffusion_flash_attn.clone(),
        }
    });
    drop(diff_guard);

    let loading_model = state.loading_model.read().await.clone();

    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        hardware: HardwareSummary {
            cpu: metrics.cpu_name,
            cpu_threads: metrics.cpu_threads,
            memory_gb: metrics.total_memory_gb,
            used_memory_gb: metrics.used_memory_gb,
            available_memory_gb: metrics.available_memory_gb,
            memory_percent: metrics.memory_percent,
            cpu_temp: metrics.cpu_temp,
            gpu_temp: metrics.gpu_temp,
            max_temp: metrics.max_temp,
            is_thermal_throttled: metrics.is_thermal_throttled,
            gpu: metrics.gpu_description,
            recommended_backend: metrics.backend_recommendation,
            vram_total_mb: metrics.vram_total_mb,
            vram_used_mb: metrics.vram_used_mb,
            vram_free_mb: metrics.vram_free_mb,
            unified_memory: metrics.unified_memory,
        },
        active_model: active.map(|p| {
            std::path::Path::new(&p)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or(p)
        }),
        ctx_size,
        active_diffusion,
        loading_model,
    })
}

// =============================================================================
// Helpers
// =============================================================================

/// Build a multi-turn text prompt from OpenAI chat messages with full tool call & response preservation
/// applying exact native ChatML (<|im_start|>), Llama-3 (<|start_header_id|>), or Gemma templates.
fn build_prompt(messages: &[ChatMessage], model_name: &str) -> String {
    let lower_name = model_name.to_lowercase();
    let is_llama3 = lower_name.contains("llama-3") || lower_name.contains("llama3");
    let is_gemma = lower_name.contains("gemma");
    let is_phi = lower_name.contains("phi");

    let mut prompt = String::new();

    if is_llama3 {
        // Llama 3 / 3.1 / 3.2 format
        for msg in messages {
            let text = extract_msg_text(msg);
            let role = match msg.role.as_str() {
                "system" => "system",
                "assistant" => "assistant",
                "tool" => "user",
                _ => "user",
            };
            prompt.push_str(&format!("<|start_header_id|>{}<|end_header_id|>\n\n{}<|eot_id|>", role, text));
        }
        prompt.push_str("<|start_header_id|>assistant<|end_header_id|>\n\n");
    } else if is_gemma {
        // Gemma 2 format
        for msg in messages {
            let text = extract_msg_text(msg);
            let role = match msg.role.as_str() {
                "system" | "user" | "tool" => "user",
                _ => "model",
            };
            prompt.push_str(&format!("<start_of_turn>{}\n{}<end_of_turn>\n", role, text));
        }
        prompt.push_str("<start_of_turn>model\n");
    } else if is_phi {
        // Phi-3 / Phi-4 format
        for msg in messages {
            let text = extract_msg_text(msg);
            let role = match msg.role.as_str() {
                "system" => "system",
                "assistant" => "assistant",
                _ => "user",
            };
            prompt.push_str(&format!("<|{}|>\n{}<|end|>\n", role, text));
        }
        prompt.push_str("<|assistant|>\n");
    } else {
        // ChatML format (Qwen 2.5 / DeepSeek / Yi / Standard Open-Source)
        for msg in messages {
            let text = extract_msg_text(msg);
            let role = match msg.role.as_str() {
                "system" => "system",
                "assistant" => "assistant",
                "tool" => "user",
                _ => "user",
            };
            prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role, text));
        }
        prompt.push_str("<|im_start|>assistant\n");
    }

    prompt
}

fn extract_msg_text(msg: &ChatMessage) -> String {
    let mut text = match &msg.content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
        None => String::new(),
    };

    if let Some(serde_json::Value::Array(tcs)) = &msg.tool_calls {
        for tc in tcs {
            if let Some(func) = tc.get("function") {
                let name = func.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                let args = func.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&format!("<call:{}({})>", name, args));
            }
        }
    }

    if msg.role == "tool" {
        let name = msg.name.as_deref().unwrap_or("tool");
        text = format!("[Tool Output for {}]:\n{}", name, text);
    }

    text
}

/// Generate a simple pseudo-UUID for request IDs.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:032x}", nanos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_request_preserves_llm_flash_attn_and_diffusion_flash_attn() {
        let json = r#"{
            "modelId": "video/Wan2.2.gguf",
            "flashAttn": false,
            "diffusionFlashAttn": "on"
        }"#;
        let req: LoadRequest = serde_json::from_str(json).expect("LoadRequest should parse");
        assert!(!req.flash_attn);
        assert_eq!(req.diffusion_flash_attn.as_deref(), Some("on"));
    }
}
