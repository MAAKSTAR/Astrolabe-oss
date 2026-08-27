// =============================================================================
// SGLang Backend Module
// =============================================================================
// Spawns and manages the `python3 -m sglang.launch_server` child process.
// Used for maximum CUDA throughput on NVIDIA GPUs.
// =============================================================================

use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::time::sleep;

pub struct SglangEngine {
    pub model_path: String,
    pub model_name: String,
    pub port: u16,
    child: Child,
}

impl SglangEngine {
    /// Spawn the SGLang server as a child process.
    pub async fn load(model_path: &str, port: u16) -> Result<Self, String> {
        let path = std::path::Path::new(model_path);
        if !path.exists() {
            return Err(format!("Model file not found: {}", model_path));
        }

        let model_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        tracing::info!("🚀 Spawning SGLang process for model: {} on port {}", model_name, port);

        // Spawn `python3 -m sglang.launch_server`
        let child = Command::new("python3")
            .arg("-m")
            .arg("sglang.launch_server")
            .arg("--model-path")
            .arg(model_path)
            .arg("--port")
            .arg(port.to_string())
            .arg("--host")
            .arg("127.0.0.1")
            .kill_on_drop(true) // Automatically kill if the daemon crashes
            .spawn()
            .map_err(|e| format!("Failed to spawn SGLang process: {}", e))?;

        let mut engine = Self {
            model_path: model_path.to_string(),
            model_name: model_name.clone(),
            port,
            child,
        };

        // Wait for the server to be ready
        if let Err(e) = engine.wait_until_ready().await {
            engine.unload().await;
            return Err(e);
        }

        tracing::info!("✅ SGLang server ready: {}", model_name);
        Ok(engine)
    }

    /// Polls the SGLang health endpoint until it returns 200 OK.
    async fn wait_until_ready(&mut self) -> Result<(), String> {
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/health", self.port);
        let max_attempts = 60; // 30 seconds max wait (500ms * 60)

        for attempt in 1..=max_attempts {
            // Check if process crashed
            if let Ok(Some(status)) = self.child.try_wait() {
                return Err(format!("SGLang process exited prematurely with status {}", status));
            }

            match client.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    return Ok(());
                }
                _ => {
                    tracing::debug!("Waiting for SGLang (attempt {}/{})", attempt, max_attempts);
                    sleep(Duration::from_millis(500)).await;
                }
            }
        }

        Err("Timeout waiting for SGLang server to become healthy".to_string())
    }

    /// Kill the SGLang child process.
    pub async fn unload(&mut self) {
        tracing::info!("🗑️  Killing SGLang process for: {}", self.model_name);
        let _ = self.child.kill().await;
    }
}
