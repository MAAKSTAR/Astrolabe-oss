// =============================================================================
// exovon-daemon: System-Level Local LLM Inference Daemon for Astrolabe IDE
// =============================================================================
// This is the main entry point. It boots an Axum HTTP server on localhost:47990
// that exposes an OpenAI-compatible /v1/chat/completions endpoint.
// The Astrolabe VS Code extension spawns this binary and routes inference to it.
// =============================================================================

mod api;
mod engine;
mod hardware;
mod models;

mod sglang;
mod llama_server;
mod llama_updater;
mod llama_updater_fs;
mod llama_updater_match;

use std::sync::Arc;
use tokio::sync::RwLock;
use clap::Parser;
use tracing_subscriber::EnvFilter;

pub enum ActiveEngine {
    Llama(engine::InferenceEngine),
    LlamaServer(llama_server::LlamaServerEngine),
    Sglang(sglang::SglangEngine),
}

use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LoadingProgressDto {
    pub model_id: String,
    pub percent: u8,
    pub stage: String,
}

#[derive(Debug, Clone, Default)]
pub struct ActiveDiffusionConfig {
    pub model_path: Option<String>,
    pub modality: Option<String>,
    pub steps: Option<u32>,
    pub cfg_scale: Option<f32>,
    pub resolution: Option<String>,
    pub vae_tiling: Option<bool>,
    pub temporal_tiling: Option<bool>,
    pub sampler: Option<String>,
    pub clip_path: Option<String>,
    pub vae_path: Option<String>,
    pub t5_path: Option<String>,
    pub lora_path: Option<String>,
    pub lora_scale: Option<f32>,
    pub video_frames: Option<u32>,
    pub fps: Option<u32>,
    pub flow_shift: Option<f32>,
    pub offload_to_cpu: Option<bool>,
    pub diffusion_flash_attn: Option<String>,
}

/// Shared application state accessible by all Axum handlers.
pub struct AppState {
    pub engine: RwLock<Option<ActiveEngine>>,
    pub models_dir: String,
    pub active_model: RwLock<Option<String>>,
    pub loading_model: Arc<RwLock<Option<LoadingProgressDto>>>,
    pub active_downloads: RwLock<HashMap<String, crate::models::DownloadProgress>>,
    pub download_tasks: RwLock<HashMap<String, tokio::task::AbortHandle>>,
    pub download_urls: RwLock<HashMap<String, String>>,
    pub hf_token: RwLock<Option<String>>,
    pub use_mirror: RwLock<bool>,
    pub active_diffusion: RwLock<ActiveDiffusionConfig>,
}

#[derive(Parser, Debug)]
#[command(name = "exovon-daemon", about = "Astrolabe Local LLM Inference Daemon")]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 47990)]
    port: u16,

    /// Directory to store downloaded models
    #[arg(short, long, default_value = "~/.exovon/models")]
    models_dir: String,
}

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let args = Args::parse();

    // Expand ~ to the user's home directory
    let mut models_dir = shellexpand(&args.models_dir);
    if let Err(e) = std::fs::create_dir_all(&models_dir) {
        tracing::error!("Failed to create models directory {}: {}", models_dir, e);
        
        let default_dir = shellexpand("~/.exovon/models");
        tracing::warn!("Falling back to default models directory: {}", default_dir);
        
        if let Err(fallback_err) = std::fs::create_dir_all(&default_dir) {
            tracing::error!("Failed to create fallback directory {}: {}", default_dir, fallback_err);
            std::process::exit(1);
        }
        models_dir = default_dir;
    }

    tracing::info!("🚀 exovon-daemon starting on port {}", args.port);
    tracing::info!("📂 Models directory: {}", models_dir);

    // Detect hardware capabilities
    let hw = hardware::detect();
    tracing::info!("🖥️  Hardware: {} ({})", hw.gpu_description, hw.backend_recommendation);

    // Load persisted download history from manifest
    let manifest = models::load_manifest(&models_dir);
    let mut initial_downloads = HashMap::new();
    let mut initial_urls = HashMap::new();

    for (fname, record) in manifest {
        initial_urls.insert(fname.clone(), record.url.clone());
        let file_path = models::resolve_download_file_path(&models_dir, &fname, Some(&record));
        let aria2_companion = std::path::PathBuf::from(format!("{}.aria2", file_path.display()));
        let has_aria2 = aria2_companion.exists();
        let existing = if file_path.exists() {
            std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let is_done = record.total_bytes > 0 && existing >= record.total_bytes && !has_aria2 && record.status == "finished";
        let actual_bytes = if has_aria2 {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                std::fs::metadata(&file_path).map(|m| m.blocks() * 512).unwrap_or(0)
            }
            #[cfg(not(unix))]
            {
                0
            }
        } else {
            existing
        };

        let pct = if record.total_bytes > 0 {
            if has_aria2 {
                ((actual_bytes as f64 / record.total_bytes as f64) * 100.0).min(99.0)
            } else {
                ((existing as f64 / record.total_bytes as f64) * 100.0).min(100.0)
            }
        } else {
            0.0
        };

        let status = if is_done {
            "finished".to_string()
        } else {
            "paused".to_string()
        };

        let rel_path_opt = file_path
            .strip_prefix(&models_dir)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .or_else(|| record.relative_path.clone());

        // If not completed yet and has partial bytes, restore to active_downloads as paused
        if !is_done && existing > 0 {
            tracing::info!("Found partial download for {} (actual: {} bytes, {:.1}%), ready to resume", fname, actual_bytes, pct);
            initial_downloads.insert(fname.clone(), models::DownloadProgress {
                model_name: fname,
                downloaded_bytes: actual_bytes,
                total_bytes: record.total_bytes,
                percent: pct,
                speed_bytes_per_sec: None,
                speed_display: None,
                eta_seconds: None,
                status,
                url: Some(record.url.clone()),
                relative_path: rel_path_opt,
                modality: record.modality.clone(),
            });
        }
    }

    let initial_hf_token = std::env::var("HF_TOKEN")
        .or_else(|_| std::env::var("HUGGING_FACE_HUB_TOKEN"))
        .ok()
        .filter(|t| !t.trim().is_empty());
    let initial_use_mirror = std::env::var("HF_MIRROR")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);

    let state = Arc::new(AppState {
        engine: RwLock::new(None),
        models_dir: models_dir.clone(),
        active_model: RwLock::new(None),
        loading_model: Arc::new(RwLock::new(None)),
        active_downloads: RwLock::new(initial_downloads),
        download_tasks: RwLock::new(HashMap::new()),
        download_urls: RwLock::new(initial_urls),
        hf_token: RwLock::new(initial_hf_token),
        use_mirror: RwLock::new(initial_use_mirror),
        active_diffusion: RwLock::new(ActiveDiffusionConfig::default()),
    });

    let app = api::build_router(state.clone());

    let addr = format!("127.0.0.1:{}", args.port);
    tracing::info!("✅ Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Failed to bind");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(state))
        .await
        .expect("Server crashed");
}

async fn shutdown_signal(state: Arc<AppState>) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received; cleaning up active inference engine...");
    let engine = {
        let mut guard = state.engine.write().await;
        guard.take()
    };
    {
        let mut active = state.active_model.write().await;
        *active = None;
    }
    if let Some(eng) = engine {
        match eng {
            ActiveEngine::LlamaServer(mut ls) => ls.unload().await,
            ActiveEngine::Sglang(mut sg) => sg.unload().await,
            ActiveEngine::Llama(_) => {}
        }
    }
}

/// Expand ~ in paths to the user home directory.
fn shellexpand(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs_home() {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

fn dirs_home() -> Option<String> {
    std::env::var("HOME").ok().or_else(|| std::env::var("USERPROFILE").ok())
}
