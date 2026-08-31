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
use std::convert::Infallible;

use axum::{
    Router,
    Json,
    extract::{Query, State},
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, post},
    http::StatusCode,
};
use futures::stream::Stream;
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
        .route("/v1/models", get(list_models))
        .route("/v1/models/load", post(load_model))
        .route("/v1/models/unload", post(unload_model))
        .route("/v1/models/download", post(download_model))
        .route("/v1/models/downloads", get(active_downloads))
        .route("/v1/models/downloads/control", post(control_download))
        .route("/v1/models/search", get(search_models))
        .route("/v1/models/tree", get(repo_tree))
        .route("/v1/health", get(health_check))
        .route("/v1/system/install_sglang", post(install_sglang))
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
struct ModelInfo {
    id: String,
    object: String,
    owned_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_context_length: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_layers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quantization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loaded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct LoadRequest {
    model_path: String,
    #[serde(default = "default_ctx")]
    ctx_size: u32,
    #[serde(default = "default_gpu_layers")]
    n_gpu_layers: i32,
    #[serde(default = "default_zero")]
    n_threads: u32,
    #[serde(default = "default_batch")]
    n_batch: u32,
    #[serde(default = "default_ubatch")]
    n_ubatch: u32,
    backend_preference: Option<String>,
    #[serde(default = "default_true")]
    use_mmap: bool,
    #[serde(default = "default_true")]
    flash_attn: bool,
}
fn default_ctx() -> u32 { 8192 }
fn default_gpu_layers() -> i32 { -1 }
fn default_zero() -> u32 { 0 }
fn default_batch() -> u32 { 2048 }
fn default_ubatch() -> u32 { 512 }

#[derive(Deserialize)]
struct DownloadRequest {
    url: String,
    filename: String,
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
}

#[derive(Serialize)]
struct HardwareSummary {
    cpu: String,
    memory_gb: f64,
    used_memory_gb: f64,
    memory_percent: f64,
    cpu_temp: Option<f32>,
    gpu_temp: Option<f32>,
    max_temp: f32,
    is_thermal_throttled: bool,
    gpu: String,
    recommended_backend: String,
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
    let local = models::list_local_models(&state.models_dir);
    let active = state.active_model.read().await.clone();

    let data = local
        .into_iter()
        .map(|m| {
            let is_loaded = active.as_ref().map(|a| a == &m.path).unwrap_or(false);
            ModelInfo {
                id: m.path,
                object: "model".to_string(),
                owned_by: "local".to_string(),
                size_display: Some(m.size_display),
                size_bytes: Some(m.size_bytes),
                max_context_length: Some(m.max_context_length),
                total_layers: Some(m.total_layers),
                architecture: Some(m.architecture),
                quantization: Some(m.quantization),
                loaded: Some(is_loaded),
                name: Some(m.name),
            }
        })
        .collect();

    Json(ModelsResponse {
        object: "list".to_string(),
        data,
    })
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
                crate::ActiveEngine::Sglang(s) => s.unload().await,
            }
        }
        *engine = None;
    }

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

    let resolved_path = if std::path::Path::new(&req.model_path).is_absolute() {
        req.model_path.clone()
    } else {
        std::path::Path::new(&state.models_dir)
            .join(&req.model_path)
            .to_string_lossy()
            .to_string()
    };

    let (name, new_engine) = if use_sglang {
        let sglang_engine = crate::sglang::SglangEngine::load(&resolved_path, 47991)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let name = sglang_engine.model_name.clone();
        (name, crate::ActiveEngine::Sglang(sglang_engine))
    } else {
        let config = EngineConfig {
            model_path: resolved_path,
            ctx_size: req.ctx_size,
            n_gpu_layers: req.n_gpu_layers,
            n_threads: req.n_threads,
            n_batch: req.n_batch,
            n_ubatch: req.n_ubatch,
            use_mmap: req.use_mmap,
            flash_attn: req.flash_attn,
            ..Default::default()
        };

        let engine = tokio::task::spawn_blocking(move || InferenceEngine::load(config))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Task join error: {}", e)))?
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
        let name = engine.model_name.clone();
        (name, crate::ActiveEngine::Llama(engine))
    };

    {
        let mut state_engine = state.engine.write().await;
        *state_engine = Some(new_engine);
    }
    {
        let mut active = state.active_model.write().await;
        *active = Some(req.model_path);
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
            crate::ActiveEngine::Sglang(s) => s.unload().await,
        }
    }
    *engine = None;

    let mut active = state.active_model.write().await;
    *active = None;

    Json(serde_json::json!({ "status": "unloaded" }))
}

/// POST /v1/models/download — Download a model from HuggingFace
async fn download_model(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DownloadRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let filename = req.filename.clone();
    let url = req.url.clone();
    
    // Check if it's already downloading
    if state.active_downloads.read().await.contains_key(&filename) {
        let dl = state.active_downloads.read().await.get(&filename).unwrap().clone();
        if dl.status == "downloading" || dl.status == "starting" {
            return Err((StatusCode::CONFLICT, format!("{} is already downloading", filename)));
        }
    }

    // Cache the download URL for pause/retry support
    state.download_urls.write().await.insert(filename.clone(), url.clone());

    let (tx, mut rx) = tokio::sync::watch::channel(crate::models::DownloadProgress {
        model_name: filename.clone(),
        downloaded_bytes: 0,
        total_bytes: 0,
        percent: 0.0,
        speed_bytes_per_sec: None,
        speed_display: None,
        eta_seconds: None,
        status: "starting".to_string(),
    });

    let state_clone = Arc::clone(&state);
    let filename_clone = filename.clone();
    
    tokio::spawn(async move {
        // Monitor progress and update map
        while rx.changed().await.is_ok() {
            let progress = rx.borrow().clone();
            state_clone.active_downloads.write().await.insert(filename_clone.clone(), progress);
        }
    });

    let models_dir = state.models_dir.clone();
    let filename_for_task = filename.clone();
    let state_clone2 = Arc::clone(&state);

    let task = tokio::spawn(async move {
        match models::download_model(&url, &models_dir, &filename_for_task, Some(tx)).await {
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
        "status": "started",
        "filename": filename,
    })))
}

#[derive(Debug, Deserialize)]
struct DownloadControlRequest {
    filename: String,
    action: String, // "pause" | "retry" | "delete"
}

/// POST /v1/models/downloads/control — Control active downloads (pause, retry, delete)
async fn control_download(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DownloadControlRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let filename = req.filename;
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
            Ok(Json(serde_json::json!({ "status": "paused", "filename": filename })))
        }
        "retry" | "resume" => {
            let url_opt = state.download_urls.read().await.get(&filename).cloned();
            if let Some(url) = url_opt {
                if let Some(handle) = state.download_tasks.write().await.remove(&filename) {
                    handle.abort();
                }

                let (tx, mut rx) = tokio::sync::watch::channel(crate::models::DownloadProgress {
                    model_name: filename.clone(),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    percent: 0.0,
                    speed_bytes_per_sec: None,
                    speed_display: None,
                    eta_seconds: None,
                    status: "starting".to_string(),
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

                let task = tokio::spawn(async move {
                    match models::download_model(&url, &models_dir, &filename_for_task, Some(tx)).await {
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
                Ok(Json(serde_json::json!({ "status": "resumed", "filename": filename })))
            } else {
                Err((StatusCode::NOT_FOUND, format!("No URL cached for {}", filename)))
            }
        }
        "delete" | "cancel" => {
            if let Some(handle) = state.download_tasks.write().await.remove(&filename) {
                handle.abort();
            }
            state.active_downloads.write().await.remove(&filename);
            state.download_urls.write().await.remove(&filename);

            let file_path = std::path::PathBuf::from(&state.models_dir).join(&filename);
            if file_path.exists() {
                let _ = tokio::fs::remove_file(&file_path).await;
            }

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
    let mut results = models::search_huggingface(&params.q)
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
        _ => None,
    };
    drop(engine_guard);

    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        hardware: HardwareSummary {
            cpu: metrics.cpu_name,
            memory_gb: metrics.total_memory_gb,
            used_memory_gb: metrics.used_memory_gb,
            memory_percent: metrics.memory_percent,
            cpu_temp: metrics.cpu_temp,
            gpu_temp: metrics.gpu_temp,
            max_temp: metrics.max_temp,
            is_thermal_throttled: metrics.is_thermal_throttled,
            gpu: metrics.gpu_description,
            recommended_backend: metrics.backend_recommendation,
        },
        active_model: active.map(|p| {
            std::path::Path::new(&p)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or(p)
        }),
        ctx_size,
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
