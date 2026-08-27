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

use std::sync::Arc;
use tokio::sync::RwLock;
use clap::Parser;
use tracing_subscriber::EnvFilter;

pub enum ActiveEngine {
    Llama(engine::InferenceEngine),
    Sglang(sglang::SglangEngine),
}

use std::collections::HashMap;

/// Shared application state accessible by all Axum handlers.
pub struct AppState {
    pub engine: RwLock<Option<ActiveEngine>>,
    pub models_dir: String,
    pub active_model: RwLock<Option<String>>,
    pub active_downloads: RwLock<HashMap<String, crate::models::DownloadProgress>>,
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

    let state = Arc::new(AppState {
        engine: RwLock::new(None),
        models_dir: models_dir.clone(),
        active_model: RwLock::new(None),
        active_downloads: RwLock::new(HashMap::new()),
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
