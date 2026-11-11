// =============================================================================
// llama-server Backend Module
// =============================================================================
// Spawns and manages the `llama-server` child process (from upstream llama.cpp).
// Used for running all GGUF models with full architecture support (Spark 2.5/2.6,
// Qwen, Llama, Gemma, DeepSeek, etc.) and native Vulkan GPU offloading.
// =============================================================================

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use tokio::time::sleep;

pub type LoadingTracker = (Arc<RwLock<Option<crate::LoadingProgressDto>>>, String);

pub struct LlamaServerEngine {
    pub model_path: String,
    pub model_name: String,
    pub port: u16,
    pub ctx_size: u32,
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

        // 3. User local share & application data paths
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            let home_path = PathBuf::from(&home);
            candidates.push(home_path.join(".local/share/astrolabe/daemon/llama-server"));
            candidates.push(home_path.join(".local/share/astrolabe/resources/app/daemon/llama-server"));
            candidates.push(home_path.join(".local/share/astrolabe/llama-server"));
            candidates.push(home_path.join(".local/share/astrolabe/bin/llama-server"));
            candidates.push(home_path.join("AppData/Local/astrolabe/daemon/llama-server.exe"));
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
        n_threads: u32,
        n_batch: u32,
        n_ubatch: u32,
        flash_attn: bool,
        use_mmap: bool,
        no_kv_offload: bool,
        loading_tracker: Option<LoadingTracker>,
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

        tracing::info!("🚀 Spawning llama-server for model: {} on port {}", model_name, port);
        tracing::info!("   Binary: {}", binary_path.display());
        tracing::info!("   Context size: {}, GPU layers: {}, Threads: {}, Batch: {}, UBatch: {}, FlashAttn: {}, MMap: {}, KV in CPU RAM: {}", 
            ctx_size, n_gpu_layers, n_threads, n_batch, n_ubatch, flash_attn, use_mmap, no_kv_offload);

        let mut cmd = Command::new(&binary_path);
        cmd.arg("-m").arg(model_path)
            .arg("--port").arg(port.to_string())
            .arg("--host").arg("127.0.0.1")
            .arg("-c").arg(ctx_size.to_string())
            .arg("-np").arg("1") // Single slot to reserve all context for editor chat
            .env("LD_LIBRARY_PATH", &ld_path);

        if n_gpu_layers > 0 {
            cmd.arg("-ngl").arg(n_gpu_layers.to_string());
        } else if n_gpu_layers == 0 {
            cmd.arg("-ngl").arg("0");
            cmd.arg("--device").arg("none");
        } else {
            // Negative means offload all layers in llama.cpp
            cmd.arg("-ngl").arg("999");
        }

        if n_threads > 0 {
            cmd.arg("-t").arg(n_threads.to_string());
        }

        if n_batch > 0 {
            cmd.arg("-b").arg(n_batch.to_string());
        }

        if n_ubatch > 0 {
            cmd.arg("-ub").arg(n_ubatch.to_string());
        }

        if flash_attn {
            cmd.arg("-fa").arg("on");
        } else {
            cmd.arg("-fa").arg("off");
        }

        if !use_mmap {
            cmd.arg("--load-mode").arg("none");
        }

        if no_kv_offload {
            cmd.arg("--no-kv-offload");
        }

        tracing::info!("   Exact Args: {:?}", cmd.as_std().get_args().collect::<Vec<_>>());

        let log_path = std::env::temp_dir().join("llama_server.log");
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        let err_file = log_file.try_clone()
            .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

        cmd.stdout(log_file);
        cmd.stderr(err_file);
        cmd.kill_on_drop(true);

        if let Some((ref lock, ref model_id)) = loading_tracker {
            let mut guard = lock.write().await;
            *guard = Some(crate::LoadingProgressDto {
                model_id: model_id.clone(),
                percent: 5,
                stage: "Starting llama-server...".to_string(),
            });
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

        let mut engine = Self {
            model_path: model_path.to_string(),
            model_name: model_name.clone(),
            port,
            ctx_size,
            child,
        };

        if let Err(e) = engine.wait_until_ready(&log_path, loading_tracker).await {
            engine.unload().await;
            return Err(e);
        }

        tracing::info!("✅ llama-server ready: {}", model_name);
        Ok(engine)
    }

    fn parse_offload_counts(line: &str) -> Option<(u32, u32)> {
        let idx = line.find("offloaded ")?;
        let rest = &line[idx + "offloaded ".len()..];
        let token = rest.split_whitespace().next()?;
        let (x_str, y_str) = token.split_once('/')?;
        let x = x_str.parse::<u32>().ok()?;
        let y = y_str.parse::<u32>().ok()?;
        Some((x, y))
    }

    fn parse_log_line(
        line: &str,
        current_percent: &mut u8,
        current_stage: &mut String,
        total_dots: &mut usize,
    ) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }

        if trimmed.contains("llama_model_loader: loaded meta data") {
            *current_percent = (*current_percent).max(12);
            *current_stage = "Reading GGUF metadata...".to_string();
        } else if trimmed.contains("print_info:") || trimmed.contains("load_hparams:") {
            *current_percent = (*current_percent).max(18);
            *current_stage = "Parsing model architecture...".to_string();
        } else if trimmed.contains("load_vocab:") {
            *current_percent = (*current_percent).max(22);
            *current_stage = "Loading tokenizer vocabulary...".to_string();
        } else if trimmed.contains("load_tensors: loading model tensors") {
            *current_percent = (*current_percent).max(26);
            *current_stage = "Preparing tensor buffers...".to_string();
        } else if trimmed.contains("load_tensors:") && trimmed.contains("offloaded") {
            if let Some((x, y)) = Self::parse_offload_counts(trimmed) {
                if y > 0 {
                    // Offload summary marks the handoff into weight transfer; keep room for progress dots
                    *current_percent = (*current_percent).max(32);
                    *current_stage = if x > 0 {
                        format!("Offloading {}/{} layers to GPU...", x, y)
                    } else {
                        "Loading layers to CPU RAM...".to_string()
                    };
                }
            } else {
                *current_percent = (*current_percent).max(32);
                *current_stage = "Offloading layers...".to_string();
            }
        } else if trimmed.contains("llama_kv_cache") || trimmed.contains("KV buffer size") || trimmed.contains("llama_memory") {
            *current_percent = (*current_percent).max(85);
            *current_stage = "Allocating KV cache...".to_string();
        } else if trimmed.contains("sched_reserve") || trimmed.contains("compute buffer size") || trimmed.contains("graph_reserve") {
            *current_percent = (*current_percent).max(90);
            *current_stage = "Reserving compute graph buffers...".to_string();
        } else if trimmed.contains("warming up")
            || trimmed.contains("starting the main loop")
            || trimmed.contains("server is listening")
        {
            *current_percent = (*current_percent).max(95);
            *current_stage = "Finalizing inference server...".to_string();
        } else if trimmed.chars().all(|c| c == '.') {
            // Line comprised solely of progress dots flushed with newline
            let _ = total_dots;
        }
    }

    fn update_progress_from_log(
        log_path: &Path,
        log_offset: &mut u64,
        pending_line: &mut String,
        current_percent: &mut u8,
        current_stage: &mut String,
        total_dots: &mut usize,
    ) -> bool {
        let mut file = match std::fs::File::open(log_path) {
            Ok(f) => f,
            Err(_) => return false,
        };
        if file.seek(SeekFrom::Start(*log_offset)).is_err() {
            return false;
        }
        let mut buf = Vec::new();
        if file.read_to_end(&mut buf).is_err() || buf.is_empty() {
            return false;
        }
        *log_offset += buf.len() as u64;

        let prev_pct = *current_percent;
        let prev_stage = current_stage.clone();
        let text = String::from_utf8_lossy(&buf);

        for ch in text.chars() {
            if ch == '\n' || ch == '\r' {
                let line = std::mem::take(pending_line);
                Self::parse_log_line(&line, current_percent, current_stage, total_dots);
            } else {
                pending_line.push(ch);
                if ch == '.' && pending_line.chars().all(|c| c == '.' || c.is_whitespace()) {
                    *total_dots += 1;
                    let dot_pct = 32u8.saturating_add(((*total_dots * 50) / 100).min(50) as u8);
                    if dot_pct > *current_percent {
                        *current_percent = dot_pct;
                    }
                    if *current_percent >= 32 && *current_percent <= 82 {
                        *current_stage = format!("Loading model weights... ({}%)", *current_percent);
                    }
                }
            }
        }

        *current_percent != prev_pct || *current_stage != prev_stage
    }

    /// Polls the llama-server health endpoint until ready while streaming real load progress from its log.
    async fn wait_until_ready(
        &mut self,
        log_path: &Path,
        loading_tracker: Option<LoadingTracker>,
    ) -> Result<(), String> {
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/health", self.port);
        let max_attempts = 480; // 120 seconds max wait (250ms * 480)
        let mut log_offset: u64 = 0;
        let mut pending_line = String::new();
        let mut current_percent: u8 = 8;
        let mut current_stage = "Initializing inference server...".to_string();
        let mut total_dots: usize = 0;

        for attempt in 1..=max_attempts {
            if Self::update_progress_from_log(
                log_path,
                &mut log_offset,
                &mut pending_line,
                &mut current_percent,
                &mut current_stage,
                &mut total_dots,
            ) {
                if let Some((ref lock, ref model_id)) = loading_tracker {
                    let mut guard = lock.write().await;
                    *guard = Some(crate::LoadingProgressDto {
                        model_id: model_id.clone(),
                        percent: current_percent.min(95),
                        stage: current_stage.clone(),
                    });
                }
            }

            if let Ok(Some(status)) = self.child.try_wait() {
                let reason = if let Ok(content) = std::fs::read_to_string(log_path) {
                    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
                    if lines.is_empty() {
                        "empty log".to_string()
                    } else {
                        lines.iter().rev().take(5).rev().cloned().collect::<Vec<_>>().join(" \n ")
                    }
                } else {
                    "could not read log".to_string()
                };
                let err_msg = if !reason.is_empty() {
                    format!("llama-server failed: {}", reason)
                } else {
                    format!("llama-server exited prematurely with status {}", status)
                };
                return Err(err_msg);
            }

            match client.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Some((ref lock, ref model_id)) = loading_tracker {
                        let mut guard = lock.write().await;
                        *guard = Some(crate::LoadingProgressDto {
                            model_id: model_id.clone(),
                            percent: 100,
                            stage: "Ready".to_string(),
                        });
                    }
                    return Ok(());
                }
                _ => {
                    tracing::debug!("Waiting for llama-server (attempt {}/{})", attempt, max_attempts);
                    sleep(Duration::from_millis(250)).await;
                }
            }
        }

        Err("Timeout waiting for llama-server to become healthy".to_string())
    }

    /// Kill the llama-server child process and reap it cleanly.
    pub async fn unload(&mut self) {
        tracing::info!("🗑️  Killing llama-server process for: {}", self.model_name);
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_llama_server_stages_and_dots_progressively() {
        let dir = std::env::temp_dir().join(format!("exovon_llama_log_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let log_path = dir.join("llama_server.log");
        let _ = std::fs::remove_file(&log_path);

        let mut offset = 0u64;
        let mut pending = String::new();
        let mut pct = 8u8;
        let mut stage = "Initializing...".to_string();
        let mut dots = 0usize;

        std::fs::write(
            &log_path,
            "llama_model_loader: loaded meta data with 45 key-value pairs\n\
             print_info: file format = GGUF V3 (latest)\n\
             load_tensors: loading model tensors, this can take a while... (mmap = true)\n\
             ....................",
        )
        .unwrap();

        let changed1 = LlamaServerEngine::update_progress_from_log(
            &log_path,
            &mut offset,
            &mut pending,
            &mut pct,
            &mut stage,
            &mut dots,
        );
        assert!(changed1);
        assert_eq!(dots, 20);
        assert!(pct >= 42);

        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&log_path).unwrap();
        writeln!(
            f,
            "\nload_tensors: offloaded 36/36 layers to GPU\n\
             llama_kv_cache: size = 2048.00 MiB\n\
             sched_reserve: reserving 512.00 MiB"
        )
        .unwrap();

        let changed2 = LlamaServerEngine::update_progress_from_log(
            &log_path,
            &mut offset,
            &mut pending,
            &mut pct,
            &mut stage,
            &mut dots,
        );
        assert!(changed2);
        assert_eq!(pct, 90);

        writeln!(f, "main: server is listening on http://127.0.0.1:47995 - starting the main loop").unwrap();
        let changed3 = LlamaServerEngine::update_progress_from_log(
            &log_path,
            &mut offset,
            &mut pending,
            &mut pct,
            &mut stage,
            &mut dots,
        );
        assert!(changed3);
        assert_eq!(pct, 95);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
