// =============================================================================
// llama.cpp Engine Update Checker & Atomic In-Place Updater Endpoints
// =============================================================================

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use axum::{extract::State, http::StatusCode, Json};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::hardware;
use crate::llama_server::LlamaServerEngine;
use crate::llama_updater_fs::{extract_and_find_bin_dir, probe_llama_server_version, swap_runtime_files};
use crate::llama_updater_match::{select_best_release, select_platform_patterns, GhRelease};
use crate::{ActiveEngine, AppState};

const RELEASES_API_URL: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15";
const ALLOWED_DOWNLOAD_PREFIX: &str = "https://github.com/ggml-org/llama.cpp/releases/download/";

static UPDATE_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct LlamaVersionStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub current_version_raw: Option<String>,
    pub current_build: Option<u64>,
    pub latest_tag: Option<String>,
    pub latest_build: Option<u64>,
    pub update_available: bool,
    pub platform_backend: String,
    pub asset_name: Option<String>,
    pub download_url: Option<String>,
    pub asset_size_bytes: Option<u64>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub active_model_will_unload: bool,
    pub rate_limited: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct InstallLlamaUpdateRequest {
    pub expected_tag: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LlamaUpdateResult {
    pub success: bool,
    pub previous_build: Option<u64>,
    pub new_build: Option<u64>,
    pub new_version_raw: Option<String>,
    pub latest_tag: Option<String>,
    pub asset_name: Option<String>,
    pub target_dir: Option<String>,
    pub unloaded_active_model: bool,
    pub message: String,
}

async fn fetch_upstream_releases() -> Result<Vec<GhRelease>, (bool, String)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| (false, format!("Failed to construct HTTP client: {}", e)))?;

    let res = client
        .get(RELEASES_API_URL)
        .header("User-Agent", "Astrolabe-IDE")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| (false, format!("Failed to reach GitHub releases API: {}", e)))?;

    let status = res.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err((
            true,
            format!("GitHub API rate limit exceeded (HTTP {}). Try again later.", status.as_u16()),
        ));
    }
    if !status.is_success() {
        return Err((false, format!("GitHub API returned HTTP {}", status.as_u16())));
    }
    res.json::<Vec<GhRelease>>()
        .await
        .map_err(|e| (false, format!("Failed to parse GitHub releases JSON: {}", e)))
}

pub async fn check_llama_update_handler(State(state): State<Arc<AppState>>) -> Json<LlamaVersionStatus> {
    let hw = hardware::detect();
    let (platform_label, patterns) = select_platform_patterns(std::env::consts::OS, std::env::consts::ARCH, &hw);
    let bin_opt = LlamaServerEngine::binary_path();
    let installed = bin_opt.is_some();

    let (current_version_raw, current_build) = match bin_opt.clone() {
        Some(path) => tokio::task::spawn_blocking(move || probe_llama_server_version(&path))
            .await
            .unwrap_or((None, None)),
        None => (None, None),
    };

    let active_model_will_unload = {
        let guard = state.engine.read().await;
        matches!(guard.as_ref(), Some(ActiveEngine::LlamaServer(_)))
    };

    let mut status = LlamaVersionStatus {
        installed,
        binary_path: bin_opt.as_ref().map(|p| p.to_string_lossy().to_string()),
        current_version_raw,
        current_build,
        latest_tag: None,
        latest_build: None,
        update_available: false,
        platform_backend: platform_label.to_string(),
        asset_name: None,
        download_url: None,
        asset_size_bytes: None,
        release_url: None,
        release_notes: None,
        active_model_will_unload,
        rate_limited: false,
        error: None,
    };

    if patterns.is_empty() {
        status.error = Some(format!(
            "No prebuilt llama.cpp release pattern configured for {}/{}.",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        return Json(status);
    }

    match fetch_upstream_releases().await {
        Ok(releases) => {
            if let Some((rel, build_num, asset)) = select_best_release(&releases, &patterns) {
                status.latest_tag = Some(rel.tag_name.clone());
                status.latest_build = Some(build_num);
                status.asset_name = Some(asset.name.clone());
                status.download_url = Some(asset.browser_download_url.clone());
                status.asset_size_bytes = Some(asset.size);
                status.release_url = Some(rel.html_url.clone());
                status.release_notes = rel.body.clone();
                status.update_available = installed && current_build.map_or(true, |cur| build_num > cur);
            } else {
                status.error = Some(format!("No matching release archive found for '{}'.", platform_label));
            }
        }
        Err((rate_limited, msg)) => {
            status.rate_limited = rate_limited;
            status.error = Some(msg);
        }
    }

    Json(status)
}

pub async fn install_llama_update_handler(
    State(state): State<Arc<AppState>>,
    body: Option<Json<InstallLlamaUpdateRequest>>,
) -> (StatusCode, Json<LlamaUpdateResult>) {
    let lock = UPDATE_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().await;
    let req = body.map(|b| b.0).unwrap_or_default();

    let existing_bin = LlamaServerEngine::binary_path();
    let previous_build = existing_bin.as_ref().and_then(|p| probe_llama_server_version(p).1);
    let Some(target_dir) = resolve_target_dir(existing_bin.as_deref()) else {
        return err_result(StatusCode::INTERNAL_SERVER_ERROR, previous_build, "Unable to determine install directory for llama-server.");
    };

    let (download_url, asset_name, latest_tag) = match resolve_download_source(&req).await {
        Ok(tuple) => tuple,
        Err(msg) => return err_result(StatusCode::BAD_GATEWAY, previous_build, &msg),
    };

    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let staging_dir = target_dir.join(format!(".llama-update-staging-{}", ts));
    let backup_dir = target_dir.join(format!(".llama-update-backup-{}", ts));
    if let Err(e) = fs::create_dir_all(&staging_dir) {
        return err_result(StatusCode::INTERNAL_SERVER_ERROR, previous_build, &format!("Cannot create staging folder: {}", e));
    }

    let archive_path = staging_dir.join(&asset_name);
    if let Err(msg) = download_to_file(&download_url, &archive_path).await {
        let _ = fs::remove_dir_all(&staging_dir);
        return err_result(StatusCode::BAD_GATEWAY, previous_build, &msg);
    }

    let extract_res = tokio::task::spawn_blocking({
        let archive = archive_path.clone();
        let stage = staging_dir.clone();
        move || extract_and_find_bin_dir(&archive, &stage)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Extraction join error: {}", e)));

    let bin_src_dir = match extract_res {
        Ok(dir) => dir,
        Err(msg) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return err_result(StatusCode::INTERNAL_SERVER_ERROR, previous_build, &msg);
        }
    };

    let unloaded = unload_active_llama_server(&state).await;
    let swap_res = tokio::task::spawn_blocking({
        let dst = target_dir.clone();
        let bak = backup_dir.clone();
        move || swap_runtime_files(&bin_src_dir, &dst, &bak)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Swap task failed: {}", e)));

    let _ = fs::remove_dir_all(&staging_dir);
    let _ = fs::remove_dir_all(&backup_dir);

    match swap_res {
        Ok((new_raw, new_build)) => (
            StatusCode::OK,
            Json(LlamaUpdateResult {
                success: true,
                previous_build,
                new_build,
                new_version_raw: new_raw,
                latest_tag: Some(latest_tag),
                asset_name: Some(asset_name),
                target_dir: Some(target_dir.to_string_lossy().to_string()),
                unloaded_active_model: unloaded,
                message: format!(
                    "Updated llama-server in {} to build {}.",
                    target_dir.display(),
                    new_build.map_or_else(|| "latest".into(), |b| format!("b{}", b))
                ),
            }),
        ),
        Err(msg) => err_result(StatusCode::INTERNAL_SERVER_ERROR, previous_build, &msg),
    }
}

fn err_result(code: StatusCode, previous_build: Option<u64>, msg: &str) -> (StatusCode, Json<LlamaUpdateResult>) {
    (
        code,
        Json(LlamaUpdateResult {
            success: false,
            previous_build,
            new_build: None,
            new_version_raw: None,
            latest_tag: None,
            asset_name: None,
            target_dir: None,
            unloaded_active_model: false,
            message: msg.to_string(),
        }),
    )
}

fn resolve_target_dir(existing_bin: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = existing_bin.and_then(|p| p.parent()) {
        return Some(dir.to_path_buf());
    }
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

async fn resolve_download_source(req: &InstallLlamaUpdateRequest) -> Result<(String, String, String), String> {
    if let Some(url) = req.download_url.as_deref() {
        if !url.starts_with(ALLOWED_DOWNLOAD_PREFIX) {
            return Err("Rejected untrusted download URL (must originate from ggml-org/llama.cpp releases).".into());
        }
        let asset_name = url.rsplit('/').next().unwrap_or("llama-update.tar.gz").to_string();
        let tag = req.expected_tag.clone().unwrap_or_else(|| "latest".to_string());
        return Ok((url.to_string(), asset_name, tag));
    }

    let hw = hardware::detect();
    let (_, patterns) = select_platform_patterns(std::env::consts::OS, std::env::consts::ARCH, &hw);
    if patterns.is_empty() {
        return Err("Unsupported OS/architecture for automatic llama.cpp binary download.".into());
    }
    let releases = fetch_upstream_releases().await.map_err(|(_, msg)| msg)?;
    let (rel, _, asset) = select_best_release(&releases, &patterns)
        .ok_or_else(|| "No matching llama.cpp release archive available.".to_string())?;
    Ok((asset.browser_download_url.clone(), asset.name.clone(), rel.tag_name.clone()))
}

async fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let res = client
        .get(url)
        .header("User-Agent", "Astrolabe-IDE")
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download returned HTTP {}", res.status().as_u16()));
    }

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| format!("File create error: {}", e))?;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        file.write_all(&bytes).await.map_err(|e| format!("Disk write error: {}", e))?;
    }
    file.flush().await.map_err(|e| format!("Disk flush error: {}", e))?;
    Ok(())
}

async fn unload_active_llama_server(state: &Arc<AppState>) -> bool {
    let taken = {
        let mut guard = state.engine.write().await;
        if matches!(guard.as_ref(), Some(ActiveEngine::LlamaServer(_))) {
            guard.take()
        } else {
            None
        }
    };
    if let Some(ActiveEngine::LlamaServer(mut ls)) = taken {
        {
            let mut active = state.active_model.write().await;
            *active = None;
        }
        ls.unload().await;
        return true;
    }
    false
}
