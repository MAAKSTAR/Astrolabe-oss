// =============================================================================
// llama-server Backend Module
// =============================================================================
// Spawns and manages the `llama-server` child process (from upstream llama.cpp).
// Used for running all GGUF models with full architecture support (Spark 2.5/2.6,
// Qwen, Llama, Gemma, DeepSeek, etc.) and native Vulkan GPU offloading.
// =============================================================================

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::time::sleep;

pub struct LlamaServerEngine {
    pub model_path: String,
    pub model_name: String,
    pub port: u16,
    child: Child,
}

impl LlamaServerEngine {
    /// Find the llama-server binary in candidate locations.
    fn find_binary() -> Option<PathBuf> {
        let mut candidates = Vec::new();

        // 1. Current executable directory (and bin/ subfolder)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join("llama-server"));
                candidates.push(parent.join("bin").join("llama-server"));
            }
        }

        // 2. Relative to workspace / daemon directory
        candidates.push(PathBuf::from("daemon/bin/llama-server"));
        candidates.push(PathBuf::from("bin/llama-server"));

        // 3. User local share
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(&home).join(".local/share/astrolabe/daemon/llama-server"));
            candidates.push(PathBuf::from(&home).join(".local/share/astrolabe/resources/app/daemon/llama-server"));
        }

        // 4. System PATH
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(':') {
                candidates.push(Path::new(dir).join("llama-server"));
            }
        }

        candidates.into_iter().find(|p| p.is_file())
    }

    /// Check if llama-server binary is present on the system.
    pub fn is_available() -> bool {
        Self::find_binary().is_some()
    }

    /// Spawn the llama-server as a managed child process.
    pub async fn load(
        model_path: &str,
        port: u16,
        ctx_size: u32,
        n_gpu_layers: i32,
        flash_attn: bool,
    ) -> Result<Self, String> {
        let path = Path::new(model_path);
        if !path.exists() {
            return Err(format!("Model file not found: {}", model_path));
        }

        let binary_path = Self::find_binary().ok_or_else(|| {
            "llama-server binary not found in candidate paths".to_string()
        })?;

        let model_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let bin_dir = binary_path.parent().unwrap_or_else(|| Path::new("."));
        let ld_path = format!("{}:{}", bin_dir.display(), std::env::var("LD_LIBRARY_PATH").unwrap_or_default());

        // Honor user requested context length (e.g. 131072 / 128K), ensuring at least 8192 for editor instructions.
        let effective_ctx = if ctx_size == 0 {
            131072
        } else {
            ctx_size.max(8192)
        };

        // Safe GPU layer offloading: if user specified negative or excessive layers for integrated GPU, cap at 24
        let effective_gpu_layers = if n_gpu_layers < 0 || n_gpu_layers > 24 {
            24
        } else {
            n_gpu_layers
        };

        tracing::info!("🚀 Spawning llama-server for model: {} on port {}", model_name, port);
        tracing::info!("   Binary: {}", binary_path.display());
        tracing::info!("   Context size: {} (requested: {}), GPU layers: {} (requested: {})", effective_ctx, ctx_size, effective_gpu_layers, n_gpu_layers);

        let mut cmd = Command::new(&binary_path);
        cmd.arg("-m").arg(model_path)
            .arg("--port").arg(port.to_string())
            .arg("--host").arg("127.0.0.1")
            .arg("-c").arg(effective_ctx.to_string())
            .arg("-np").arg("1") // Single slot to reserve all context for editor chat
            .arg("-ngl").arg(effective_gpu_layers.to_string())
            .env("LD_LIBRARY_PATH", &ld_path);

        if flash_attn {
            cmd.arg("-fa").arg("on");
        }

        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open("/tmp/llama_server.log")
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        let err_file = log_file.try_clone()
            .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

        cmd.stdout(log_file);
        cmd.stderr(err_file);
        cmd.kill_on_drop(true);

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

        let mut engine = Self {
            model_path: model_path.to_string(),
            model_name: model_name.clone(),
            port,
            child,
        };

        if let Err(e) = engine.wait_until_ready().await {
            engine.unload().await;
            return Err(e);
        }

        tracing::info!("✅ llama-server ready: {}", model_name);
        Ok(engine)
    }

    /// Polls the llama-server health endpoint until ready.
    async fn wait_until_ready(&mut self) -> Result<(), String> {
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/health", self.port);
        let max_attempts = 120; // 60 seconds max wait (500ms * 120)

        for attempt in 1..=max_attempts {
            if let Ok(Some(status)) = self.child.try_wait() {
                return Err(format!("llama-server exited prematurely with status {}", status));
            }

            match client.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    return Ok(());
                }
                _ => {
                    tracing::debug!("Waiting for llama-server (attempt {}/{})", attempt, max_attempts);
                    sleep(Duration::from_millis(500)).await;
                }
            }
        }

        Err("Timeout waiting for llama-server to become healthy".to_string())
    }

    /// Kill the llama-server child process.
    pub async fn unload(&mut self) {
        tracing::info!("🗑️  Killing llama-server process for: {}", self.model_name);
        let _ = self.child.kill().await;
    }
}
