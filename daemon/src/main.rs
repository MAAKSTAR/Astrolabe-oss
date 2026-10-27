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

/// Shared application state accessible by all Axum handlers.
pub struct AppState {
    pub engine: RwLock<Option<ActiveEngine>>,
    pub models_dir: String,
    pub active_model: RwLock<Option<String>>,
    pub active_downloads: RwLock<HashMap<String, crate::models::DownloadProgress>>,
    pub download_tasks: RwLock<HashMap<String, tokio::task::AbortHandle>>,
    pub download_urls: RwLock<HashMap<String, String>>,
    pub hf_token: RwLock<Option<String>>,
    pub use_mirror: RwLock<bool>,
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
        let file_path = std::path::PathBuf::from(&models_dir).join(&fname);
        let existing = if file_path.exists() {
            std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let is_done = record.total_bytes > 0 && existing >= record.total_bytes;
        let pct = if record.total_bytes > 0 {
            ((existing as f64 / record.total_bytes as f64) * 100.0).min(100.0)
        } else {
            0.0
        };

        let status = if is_done {
            "finished".to_string()
        } else {
            "paused".to_string()
        };

        // If not completed yet and has partial bytes, restore to active_downloads as paused
        if !is_done && existing > 0 {
            tracing::info!("Found partial download for {} ({} bytes, {:.1}%), ready to resume", fname, existing, pct);
            initial_downloads.insert(fname.clone(), models::DownloadProgress {
                model_name: fname,
                downloaded_bytes: existing,
                total_bytes: record.total_bytes,
                percent: pct,
                speed_bytes_per_sec: None,
                speed_display: None,
                eta_seconds: None,
                status,
                url: Some(record.url.clone()),
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
        active_downloads: RwLock::new(initial_downloads),
        download_tasks: RwLock::new(HashMap::new()),
        download_urls: RwLock::new(initial_urls),
        hf_token: RwLock::new(initial_hf_token),
        use_mirror: RwLock::new(initial_use_mirror),
    });

    let app = api::build_router(state);

    let addr = format!("127.0.0.1:{}", args.port);
    tracing::info!("✅ Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server crashed");
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
