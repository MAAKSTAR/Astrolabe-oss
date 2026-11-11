// =============================================================================
// Supervised sd-cli Process Runner (Live Progress, Timeout & Cancellation)
// =============================================================================

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::watch;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Default)]
pub struct DiffusionProgressDto {
    pub active: bool,
    pub modality: String,
    pub model: String,
    pub step: u32,
    pub total_steps: u32,
    pub percent: u8,
    pub stage: String,
    pub elapsed_secs: u64,
}

pub struct SdCliOutput {
    pub status: ExitStatus,
    pub stderr: String,
}

pub enum SdCliError {
    Spawn(String),
    Timeout(u64),
    Cancelled,
}

pub async fn diffusion_status_handler(State(state): State<Arc<AppState>>) -> Json<DiffusionProgressDto> {
    let guard = state.diffusion_progress.read().await;
    Json(guard.clone().unwrap_or_default())
}

pub async fn diffusion_cancel_handler(State(state): State<Arc<AppState>>) -> (StatusCode, Json<serde_json::Value>) {
    let tx_opt = {
        let guard = state.diffusion_cancel.read().await;
        guard.clone()
    };
    if let Some(tx) = tx_opt {
        let _ = tx.send(true);
        tracing::info!("🛑 Diffusion cancellation signal sent to active sd-cli process");
        (StatusCode::OK, Json(serde_json::json!({ "cancelled": true, "active": true })))
    } else {
        (StatusCode::OK, Json(serde_json::json!({ "cancelled": false, "active": false })))
    }
}

pub fn parse_sd_progress_line(line: &str) -> (Option<(u32, u32)>, Option<&'static str>) {
    let lower = line.to_ascii_lowercase();
    let stage = if lower.contains("generating image") || lower.contains("sampling") {
        Some("Sampling latent trajectory...")
    } else if lower.contains("decoding") || lower.contains("vae") && lower.contains("decode") {
        Some("Decoding VAE output...")
    } else if lower.contains("get_learned_condition") || lower.contains("encoding") || lower.contains("text encoder") {
        Some("Encoding prompt conditioning...")
    } else if lower.contains("loading model") || lower.contains("loading tensors") || lower.contains("loading weights") {
        Some("Loading diffusion weights...")
    } else {
        None
    };

    let mut step_pair = None;
    for token in line.split_whitespace() {
        let trimmed = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '/');
        if let Some((a, b)) = trimmed.split_once('/') {
            if !a.is_empty() && !b.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit()) {
                if let (Ok(cur), Ok(tot)) = (a.parse::<u32>(), b.parse::<u32>()) {
                    if tot > 0 && cur <= tot && tot <= 1000 {
                        step_pair = Some((cur, tot));
                    }
                }
            }
        }
    }
    (step_pair, stage)
}

async fn pump_stream<R: AsyncRead + Unpin>(
    mut reader: R,
    capture: bool,
    progress_state: Arc<tokio::sync::RwLock<Option<DiffusionProgressDto>>>,
    start: Instant,
) -> String {
    let mut collected = String::new();
    let mut buf = [0u8; 2048];
    let mut pending = String::new();

    while let Ok(n) = reader.read(&mut buf).await {
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf[..n]);
        if capture && collected.len() < 128 * 1024 {
            collected.push_str(&chunk);
        }
        pending.push_str(&chunk);

        while let Some(pos) = pending.find(['\n', '\r']) {
            let line = pending[..pos].trim().to_string();
            pending.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            let (pair, stage_opt) = parse_sd_progress_line(&line);
            if pair.is_some() || stage_opt.is_some() {
                let mut guard = progress_state.write().await;
                if let Some(ref mut dto) = *guard {
                    dto.elapsed_secs = start.elapsed().as_secs();
                    if let Some((cur, tot)) = pair {
                        dto.step = cur;
                        dto.total_steps = tot;
                        dto.percent = ((cur as f64 / tot as f64) * 100.0).round().clamp(5.0, 99.0) as u8;
                    }
                    if let Some(st) = stage_opt {
                        dto.stage = st.to_string();
                    }
                }
            }
        }
    }
    collected
}

pub async fn run_sd_cli_supervised(
    state: Arc<AppState>,
    mut cmd: tokio::process::Command,
    modality: &str,
    model_label: &str,
    total_steps: u32,
    timeout_secs: Option<u64>,
) -> Result<SdCliOutput, SdCliError> {
    cmd.kill_on_drop(true).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| SdCliError::Spawn(e.to_string()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    {
        *state.diffusion_cancel.write().await = Some(cancel_tx);
    }
    let start = Instant::now();
    {
        *state.diffusion_progress.write().await = Some(DiffusionProgressDto {
            active: true,
            modality: modality.to_string(),
            model: model_label.to_string(),
            step: 0,
            total_steps,
            percent: 5,
            stage: "Loading diffusion weights...".to_string(),
            elapsed_secs: 0,
        });
    }

    let stdout_task = tokio::spawn({
        let prog = Arc::clone(&state.diffusion_progress);
        async move {
            if let Some(r) = stdout {
                pump_stream(r, false, prog, start).await;
            }
            String::new()
        }
    });
    let stderr_task = tokio::spawn({
        let prog = Arc::clone(&state.diffusion_progress);
        async move {
            if let Some(r) = stderr {
                pump_stream(r, true, prog, start).await
            } else {
                String::new()
            }
        }
    });

    let effective_timeout = match timeout_secs {
        Some(0) => None,
        Some(v) => Some(Duration::from_secs(v)),
        None => Some(Duration::from_secs(if modality == "video" { 1800 } else { 600 })),
    };

    let result = tokio::select! {
        status_res = child.wait() => {
            match status_res {
                Ok(status) => {
                    let _ = stdout_task.await;
                    let captured_err = stderr_task.await.unwrap_or_default();
                    Ok(SdCliOutput { status, stderr: captured_err })
                }
                Err(e) => Err(SdCliError::Spawn(e.to_string())),
            }
        }
        _ = cancel_rx.changed() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(SdCliError::Cancelled)
        }
        _ = async {
            match effective_timeout {
                Some(dur) => tokio::time::sleep(dur).await,
                None => std::future::pending::<()>().await,
            }
        } => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(SdCliError::Timeout(effective_timeout.map(|d| d.as_secs()).unwrap_or(0)))
        }
    };

    *state.diffusion_cancel.write().await = None;
    *state.diffusion_progress.write().await = None;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sd_cli_progress_bars_and_stages() {
        let (pair1, st1) = parse_sd_progress_line("[INFO ] generating image |====>    | 7/20 - 1.2s/it");
        assert_eq!(pair1, Some((7, 20)));
        assert_eq!(st1, Some("Sampling latent trajectory..."));

        let (pair2, st2) = parse_sd_progress_line("decoding latents with VAE");
        assert_eq!(pair2, None);
        assert_eq!(st2, Some("Decoding VAE output..."));
    }
}
