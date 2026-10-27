// =============================================================================
// Model Manager Module
// =============================================================================
// Handles:
// 1. Listing locally downloaded .gguf models from ~/.exovon/models/
// 2. Downloading new .gguf models from HuggingFace Hub with progress tracking
// 3. Searching HuggingFace for available GGUF models
// =============================================================================

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncWriteExt, BufWriter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalModel {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub size_display: String,
    pub max_context_length: u32,
    pub total_layers: u32,
    pub architecture: String,
    pub quantization: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub model_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_bytes_per_sec: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_seconds: Option<u64>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadRecord {
    pub filename: String,
    pub url: String,
    pub total_bytes: u64,
    pub status: String,
    #[serde(default)]
    pub modality: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
}

pub fn manifest_path(models_dir: &str) -> PathBuf {
    PathBuf::from(models_dir).join(".downloads_manifest.json")
}

pub fn load_manifest(models_dir: &str) -> std::collections::HashMap<String, DownloadRecord> {
    let p = manifest_path(models_dir);
    if let Ok(data) = std::fs::read_to_string(&p) {
        if let Ok(records) = serde_json::from_str::<std::collections::HashMap<String, DownloadRecord>>(&data) {
            return records;
        }
    }
    std::collections::HashMap::new()
}

pub fn save_manifest(models_dir: &str, records: &std::collections::HashMap<String, DownloadRecord>) {
    let p = manifest_path(models_dir);
    if let Ok(json) = serde_json::to_string_pretty(records) {
        let _ = std::fs::write(p, json);
    }
}

pub fn update_manifest_entry(models_dir: &str, filename: &str, url: &str, total_bytes: u64, status: &str) {
    let mut manifest = load_manifest(models_dir);
    let rec = manifest.entry(filename.to_string()).or_insert_with(|| DownloadRecord {
        filename: filename.to_string(),
        url: url.to_string(),
        total_bytes,
        status: status.to_string(),
        modality: None,
        family: None,
    });
    if !url.is_empty() {
        rec.url = url.to_string();
    }
    if total_bytes > 0 {
        rec.total_bytes = total_bytes;
    }
    rec.status = status.to_string();
    save_manifest(models_dir, &manifest);
}

pub fn remove_manifest_entry(models_dir: &str, filename: &str) {
    let mut manifest = load_manifest(models_dir);
    manifest.remove(filename);
    save_manifest(models_dir, &manifest);
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HfModelResult {
    pub id: String,
    pub author: Option<String>,
    pub downloads: Option<u64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoFile {
    pub path: String,
    pub size: Option<u64>,
    #[serde(rename = "type")]
    pub file_type: String,
}

pub async fn fetch_repo_tree(repo_id: &str) -> Result<Vec<RepoFile>, String> {
    let url = format!("https://huggingface.co/api/models/{}/tree/main", repo_id);
    let client = reqwest::Client::builder()
        .user_agent("Astrolabe-IDE/1.0 (Linux; x86_64)")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client.get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo tree: {}", e))?;
    
    if !resp.status().is_success() {
        return Err(format!("HuggingFace API returned status {}", resp.status()));
    }
    
    let files: Vec<RepoFile> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse tree JSON: {}", e))?;
        
    let gguf_files = files.into_iter()
        .filter(|f| f.file_type == "file" && f.path.ends_with(".gguf"))
        .collect();
        
    Ok(gguf_files)
}

#[derive(Default, Debug, Clone)]
pub struct GgufMeta {
    pub max_context_length: u32,
    pub total_layers: u32,
    pub architecture: String,
    pub quantization: String,
}

pub fn inspect_gguf_metadata(path: &Path) -> GgufMeta {
    use std::fs::File;
    use std::io::{BufReader, Read, Seek, SeekFrom};

    let mut meta = GgufMeta {
        max_context_length: 8192,
        total_layers: 32,
        architecture: "llama".to_string(),
        quantization: "Q4_0".to_string(),
    };

    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return meta,
    };
    let mut reader = BufReader::new(file);

    let mut magic = [0u8; 4];
    if reader.read_exact(&mut magic).is_err() || &magic != b"GGUF" {
        return meta;
    }

    let mut u32_buf = [0u8; 4];
    let mut u64_buf = [0u8; 8];

    // Version
    if reader.read_exact(&mut u32_buf).is_err() { return meta; }
    // Tensor count
    if reader.read_exact(&mut u64_buf).is_err() { return meta; }
    // KV count
    if reader.read_exact(&mut u64_buf).is_err() { return meta; }
    let kv_count = u64::from_le_bytes(u64_buf);

    let mut arch = String::new();
    let mut ctx_len: Option<u32> = None;
    let mut block_cnt: Option<u32> = None;

    for _ in 0..kv_count.min(250) {
        if reader.read_exact(&mut u64_buf).is_err() { break; }
        let klen = u64::from_le_bytes(u64_buf) as usize;
        if klen > 512 { break; }

        let mut key_buf = vec![0u8; klen];
        if reader.read_exact(&mut key_buf).is_err() { break; }
        let key = String::from_utf8_lossy(&key_buf).to_string();

        if reader.read_exact(&mut u32_buf).is_err() { break; }
        let vtype = u32::from_le_bytes(u32_buf);

        match vtype {
            0 | 1 | 7 => {
                let mut b = [0u8; 1];
                if reader.read_exact(&mut b).is_err() { break; }
            }
            2 | 3 => {
                let mut b = [0u8; 2];
                if reader.read_exact(&mut b).is_err() { break; }
            }
            4 => {
                if reader.read_exact(&mut u32_buf).is_err() { break; }
                let val = u32::from_le_bytes(u32_buf);
                if key.ends_with(".context_length") {
                    ctx_len = Some(val);
                } else if key.ends_with(".block_count") {
                    block_cnt = Some(val);
                }
            }
            5 | 6 => {
                if reader.read_exact(&mut u32_buf).is_err() { break; }
            }
            8 => {
                if reader.read_exact(&mut u64_buf).is_err() { break; }
                let slen = u64::from_le_bytes(u64_buf) as usize;
                if slen > 1024 * 1024 { break; }
                let mut sbuf = vec![0u8; slen];
                if reader.read_exact(&mut sbuf).is_err() { break; }
                let sval = String::from_utf8_lossy(&sbuf).to_string();
                if key == "general.architecture" {
                    arch = sval;
                } else if key == "general.file_type_name" {
                    meta.quantization = sval;
                }
            }
            9 => {
                let mut atype_buf = [0u8; 4];
                if reader.read_exact(&mut atype_buf).is_err() { break; }
                let atype = u32::from_le_bytes(atype_buf);
                if reader.read_exact(&mut u64_buf).is_err() { break; }
                let alen = u64::from_le_bytes(u64_buf);

                match atype {
                    8 => {
                        for _ in 0..alen {
                            if reader.read_exact(&mut u64_buf).is_err() { break; }
                            let sl = u64::from_le_bytes(u64_buf) as i64;
                            if reader.seek(SeekFrom::Current(sl)).is_err() { break; }
                        }
                    }
                    0 | 1 | 7 => { let _ = reader.seek(SeekFrom::Current(alen as i64)); }
                    2 | 3 => { let _ = reader.seek(SeekFrom::Current((alen * 2) as i64)); }
                    4 | 5 | 6 => { let _ = reader.seek(SeekFrom::Current((alen * 4) as i64)); }
                    10 | 11 | 12 => { let _ = reader.seek(SeekFrom::Current((alen * 8) as i64)); }
                    _ => { break; }
                }
            }
            10 => {
                if reader.read_exact(&mut u64_buf).is_err() { break; }
                let val = u64::from_le_bytes(u64_buf) as u32;
                if key.ends_with(".context_length") {
                    ctx_len = Some(val);
                } else if key.ends_with(".block_count") {
                    block_cnt = Some(val);
                }
            }
            11 | 12 => {
                let mut b = [0u8; 8];
                if reader.read_exact(&mut b).is_err() { break; }
            }
            _ => { break; }
        }
    }

    if !arch.is_empty() {
        meta.architecture = arch;
    }
    if let Some(ctx) = ctx_len {
        meta.max_context_length = ctx;
    }
    if let Some(blocks) = block_cnt {
        meta.total_layers = blocks + 1; // Include final output layer
    }

    if meta.quantization == "Q4_0" {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if let Some(q) = extract_quant_from_name(&name) {
            meta.quantization = q;
        }
    }

    meta
}

fn extract_quant_from_name(name: &str) -> Option<String> {
    let parts = ["Q4_K_M", "Q4_K_S", "Q4_0", "Q4_1", "Q5_K_M", "Q5_K_S", "Q5_0", "Q5_1", "Q6_K", "Q8_0", "IQ3_M", "IQ3_S", "IQ4_XS", "IQ4_NL", "BF16", "FP16"];
    for p in parts {
        if name.to_uppercase().contains(&p.to_uppercase()) {
            return Some(p.to_string());
        }
    }
    None
}

/// List all .gguf, .safetensors, and .sft files in the models directory.
fn find_gguf_files_recursive(dir: &Path, models: &mut Vec<LocalModel>, depth: usize) {
    if depth > 3 { return; } // Limit depth to avoid symlink loops or massive trees
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_gguf_files_recursive(&path, models, depth + 1);
            } else if path.extension().map(|e| e == "gguf" || e == "safetensors" || e == "sft").unwrap_or(false) {
                if let Ok(meta) = std::fs::metadata(&path) {
                    let size = meta.len();
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    let gguf_meta = if ext == "gguf" {
                        inspect_gguf_metadata(&path)
                    } else {
                        let fname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default().to_lowercase();
                        let arch = if fname.contains("clip_l") || fname.contains("t5xxl") {
                            "clip".to_string()
                        } else if fname.contains("ae.") || fname.contains("vae") {
                            "vae".to_string()
                        } else {
                            "diffusion".to_string()
                        };
                        GgufMeta {
                            max_context_length: 0,
                            total_layers: 0,
                            architecture: arch,
                            quantization: "F16".to_string(),
                        }
                    };
                    models.push(LocalModel {
                        name: path.file_name().unwrap().to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        size_bytes: size,
                        size_display: format_size(size),
                        max_context_length: gguf_meta.max_context_length,
                        total_layers: gguf_meta.total_layers,
                        architecture: gguf_meta.architecture,
                        quantization: gguf_meta.quantization,
                    });
                }
            }
        }
    }
}

pub fn list_local_models(models_dir: &str) -> Vec<LocalModel> {
    let dir = Path::new(models_dir);
    if !dir.exists() {
        return vec![];
    }

    let mut models = Vec::new();
    find_gguf_files_recursive(dir, &mut models, 0);

    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}

/// Search HuggingFace Hub API for GGUF models matching a query.
pub async fn search_huggingface(query: &str) -> Result<Vec<HfModelResult>, String> {
    let trimmed = query.trim();
    let url = if trimmed.is_empty() {
        "https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=100".to_string()
    } else {
        format!(
            "https://huggingface.co/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=100",
            urlencoding::encode(trimmed)
        )
    };

    let client = reqwest::Client::builder()
        .user_agent("Astrolabe-IDE/1.0 (Linux; x86_64)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client.get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("HuggingFace API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HuggingFace returned status {}", resp.status()));
    }

    let results: Vec<HfModelResult> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HuggingFace response: {}", e))?;

    Ok(results)
}

/// Search HuggingFace for GGUF models.
pub async fn search_models(query: &str) -> Result<Vec<HfModelResult>, String> {
    let url = if query.is_empty() {
        "https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=50".to_string()
    } else {
        format!(
            "https://huggingface.co/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=500",
            query
        )
    };

    let client = reqwest::Client::new();
    let resp = client.get(&url)
        .header("User-Agent", "exovon-daemon/0.1.0")
        .send()
        .await
        .map_err(|e| format!("HuggingFace search request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HuggingFace API returned status {}", resp.status()));
    }

    let models: Vec<HfModelResult> = resp.json()
        .await
        .map_err(|e| format!("Failed to parse HuggingFace search response: {}", e))?;

    Ok(models)
}

/// Resolve the final download URL. If a regional mirror is enabled, rewrite huggingface.co to hf-mirror.com.
/// If an authenticated Hugging Face token is provided, perform a 302/307 resolution with redirects disabled
/// to obtain the pre-signed priority AWS S3/CloudFront URL (bypassing anonymous throttles).
pub async fn resolve_download_url(
    raw_url: &str,
    hf_token: Option<&str>,
    use_mirror: bool,
) -> String {
    let mut target_url = raw_url.to_string();

    // If user enabled regional mirror and URL is from huggingface.co, rewrite host
    if use_mirror && target_url.contains("huggingface.co") {
        target_url = target_url.replace("https://huggingface.co", "https://hf-mirror.com");
    }

    // Resolve 302/307 redirect directly so aria2c connects directly to the underlying CDN edge
    if target_url.contains("huggingface.co") || target_url.contains("hf-mirror.com") {
        let client_res = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build();

        if let Ok(c) = client_res {
            let mut req = c.get(&target_url);
            if let Some(token) = hf_token {
                let trimmed_tok = token.trim();
                if !trimmed_tok.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", trimmed_tok));
                }
            }

            if let Ok(resp) = req.send().await {
                if resp.status().is_redirection() {
                    if let Some(loc) = resp.headers().get("location") {
                        if let Ok(loc_str) = loc.to_str() {
                            tracing::info!("Resolved Hugging Face CDN URL: {}", loc_str.split('?').next().unwrap_or(""));
                            return loc_str.to_string();
                        }
                    }
                }
            }
        }
    }

    target_url
}

/// Download a model file from a direct URL to the models directory.
/// Automatically utilizes aria2c with 16 parallel connections for maximum multi-channel throughput,
/// falling back to buffered Range-resuming HTTP streaming if aria2c is not available.
pub async fn download_model(
    url: &str,
    models_dir: &str,
    filename: &str,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    tokio::fs::create_dir_all(models_dir).await
        .map_err(|e| format!("Failed to create models dir: {}", e))?;

    // Check if aria2c is available for 16-channel parallel acceleration
    let has_aria2 = tokio::process::Command::new("which")
        .arg("aria2c")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    if has_aria2 {
        tracing::info!("Accelerating download for {} using production aria2c 16-channel streaming", filename);
        match download_with_aria2(url, models_dir, filename, hf_token, use_mirror, progress_tx.clone()).await {
            Ok(p) => return Ok(p),
            Err(e) => {
                tracing::warn!("aria2c failed ({}), falling back to buffered stream...", e);
            }
        }
    }

    download_with_reqwest(url, models_dir, filename, hf_token, use_mirror, progress_tx).await
}

fn parse_aria2_size_unit(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() { return 0; }
    let s_lower = s.to_lowercase();
    if s_lower.ends_with("gib") {
        let val: f64 = s[..s.len().saturating_sub(3)].trim().parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0 * 1024.0) as u64
    } else if s_lower.ends_with("mib") {
        let val: f64 = s[..s.len().saturating_sub(3)].trim().parse().unwrap_or(0.0);
        (val * 1024.0 * 1024.0) as u64
    } else if s_lower.ends_with("kib") {
        let val: f64 = s[..s.len().saturating_sub(3)].trim().parse().unwrap_or(0.0);
        (val * 1024.0) as u64
    } else if s_lower.ends_with('b') {
        s[..s.len().saturating_sub(1)].trim().parse().unwrap_or(0)
    } else {
        s.parse().unwrap_or(0)
    }
}

fn parse_aria2_progress(line: &str) -> Option<(u64, u64, f64, String, u64, Option<u64>)> {
    // Example: [#53a7df 1.2GiB/4.8GiB(25%) CN:8 DL:48.5MiB ETA:1m15s]
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 { return None; }

    let size_part = parts.get(1)?;
    let slash_idx = size_part.find('/')?;
    let dl_str = &size_part[..slash_idx];
    let rest = &size_part[slash_idx + 1..];

    let (tot_str, pct) = if let Some(open_paren) = rest.find('(') {
        let tot = &rest[..open_paren];
        let pct_str = rest[open_paren + 1..].trim_end_matches("%)").trim_end_matches(']');
        let p: f64 = pct_str.parse().unwrap_or(0.0);
        (tot, p)
    } else {
        (rest, 0.0)
    };

    let dl_bytes = parse_aria2_size_unit(dl_str);
    let tot_bytes = parse_aria2_size_unit(tot_str);

    let mut spd_str = "0 B/s".to_string();
    let mut spd_bps: u64 = 0;
    let mut eta_secs: Option<u64> = None;

    for part in &parts[2..] {
        let p = part.trim_end_matches(']');
        if p.starts_with("DL:") {
            let raw_spd = &p[3..];
            spd_bps = parse_aria2_size_unit(raw_spd);
            spd_str = format!("{}/s", raw_spd.replace("MiB", " MB").replace("KiB", " KB").replace("GiB", " GB"));
        } else if p.starts_with("ETA:") {
            let raw_eta = &p[4..];
            let mut secs: u64 = 0;
            let mut num_buf = String::new();
            for c in raw_eta.chars() {
                if c.is_ascii_digit() {
                    num_buf.push(c);
                } else if c == 'h' {
                    let h: u64 = num_buf.parse().unwrap_or(0);
                    secs += h * 3600;
                    num_buf.clear();
                } else if c == 'm' {
                    let m: u64 = num_buf.parse().unwrap_or(0);
                    secs += m * 60;
                    num_buf.clear();
                } else if c == 's' {
                    let s: u64 = num_buf.parse().unwrap_or(0);
                    secs += s;
                    num_buf.clear();
                }
            }
            if !num_buf.is_empty() {
                secs += num_buf.parse::<u64>().unwrap_or(0);
            }
            if secs > 0 {
                eta_secs = Some(secs);
            }
        }
    }

    Some((dl_bytes, tot_bytes, pct, spd_str, spd_bps, eta_secs))
}

async fn download_with_aria2(
    url: &str,
    models_dir: &str,
    filename: &str,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use std::process::Stdio;

    let dest = PathBuf::from(models_dir).join(filename);
    update_manifest_entry(models_dir, filename, url, 0, "downloading");

    let resolved_url = resolve_download_url(url, hf_token, use_mirror).await;

    let mut cmd = tokio::process::Command::new("aria2c");
    cmd.arg("-s").arg("16")
        .arg("-x").arg("16")
        .arg("-j").arg("16")
        .arg("-k").arg("1M")
        .arg("--min-split-size=1M")
        .arg("--max-connection-per-server=16")
        .arg("--file-allocation=none")
        .arg("--enable-mmap=true")
        .arg("--summary-interval=1")
        .arg("--disk-cache=64M")
        .arg("--conditional-get=true")
        .arg("--async-dns=false")
        .arg("--stream-piece-selector=geom")
        .arg("--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .arg("--auto-file-renaming=false")
        .arg("--allow-overwrite=true")
        .arg("--console-log-level=notice")
        .arg("-d").arg(models_dir)
        .arg("-o").arg(filename);

    // Only attach Authorization header if the resolved URL is direct to Hugging Face
    // (AWS S3/CloudFront presigned URLs return 403 if an Authorization header is attached)
    if let Some(tok) = hf_token {
        let t = tok.trim();
        if !t.is_empty() && resolved_url.contains("huggingface.co") && !resolved_url.contains(".cdn.") {
            cmd.arg(format!("--header=Authorization: Bearer {}", t));
        }
    }

    cmd.arg(&resolved_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn aria2c: {}", e))?;

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture aria2c stdout".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    let mut total_bytes: u64 = 0;
    let mut downloaded_bytes: u64 = 0;
    let mut percent: f64 = 0.0;
    let mut speed_display: Option<String> = None;
    let mut speed_bytes_per_sec: Option<u64> = None;
    let mut eta_seconds: Option<u64> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        let trimmed = line.trim();
        if trimmed.starts_with("[#") && trimmed.contains('/') {
            if let Some((dl_b, tot_b, pct, spd_str, spd_bps, eta_s)) = parse_aria2_progress(trimmed) {
                downloaded_bytes = dl_b;
                if tot_b > 0 {
                    total_bytes = tot_b;
                }
                percent = pct;
                speed_display = Some(spd_str);
                speed_bytes_per_sec = Some(spd_bps);
                eta_seconds = eta_s;

                if let Some(ref tx) = progress_tx {
                    let _ = tx.send(DownloadProgress {
                        model_name: filename.to_string(),
                        downloaded_bytes,
                        total_bytes,
                        percent,
                        speed_bytes_per_sec,
                        speed_display: speed_display.clone(),
                        eta_seconds,
                        status: "downloading".to_string(),
                        url: Some(url.to_string()),
                    });
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("aria2c process error: {}", e))?;
    if !status.success() {
        return Err(format!("aria2c exited with code {:?}", status.code()));
    }

    let final_size = if dest.exists() {
        tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(downloaded_bytes)
    } else {
        downloaded_bytes
    };

    update_manifest_entry(models_dir, filename, url, final_size, "finished");

    if let Some(ref tx) = progress_tx {
        let _ = tx.send(DownloadProgress {
            model_name: filename.to_string(),
            downloaded_bytes: final_size,
            total_bytes: final_size,
            percent: 100.0,
            speed_bytes_per_sec: None,
            speed_display: None,
            eta_seconds: None,
            status: "finished".to_string(),
            url: Some(url.to_string()),
        });
    }

    tracing::info!("Multi-channel download completed: {} ({})", filename, format_size(final_size));
    Ok(dest.to_string_lossy().to_string())
}

async fn download_with_reqwest(
    url: &str,
    models_dir: &str,
    filename: &str,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    let dest = PathBuf::from(models_dir).join(filename);
    let resolved_url = resolve_download_url(url, hf_token, use_mirror).await;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(600))
        .tcp_keepalive(Some(std::time::Duration::from_secs(15)))
        .tcp_nodelay(true)
        .pool_idle_timeout(Some(std::time::Duration::from_secs(90)))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut retries = 0;
    const MAX_RETRIES: u32 = 25;
    let mut total_bytes: u64 = 0;

    let mut last_speed_time = std::time::Instant::now();
    let mut bytes_since_last_tick: u64 = 0;
    let mut smoothed_speed: f64 = 0.0;
    let mut current_speed: u64 = 0;

    loop {
        let existing_size = if dest.exists() {
            tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        if total_bytes > 0 && existing_size >= total_bytes {
            break;
        }

        let mut req = client.get(&resolved_url)
            .header(reqwest::header::ACCEPT, "*/*")
            .header(reqwest::header::ACCEPT_ENCODING, "identity");

        if let Some(tok) = hf_token {
            let t = tok.trim();
            if !t.is_empty() && resolved_url.contains("huggingface.co") && !resolved_url.contains(".cdn.") {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
        }

        if existing_size > 0 {
            tracing::info!("Resuming download of {} from byte {}", filename, existing_size);
            req = req.header("Range", format!("bytes={}-", existing_size));
        }

        let resp_result = req.send().await;
        let resp = match resp_result {
            Ok(r) => {
                if !r.status().is_success() && r.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                    if r.status() == reqwest::StatusCode::NOT_FOUND 
                        || r.status() == reqwest::StatusCode::UNAUTHORIZED 
                        || r.status() == reqwest::StatusCode::FORBIDDEN {
                        return Err(format!("Download failed with status {}", r.status()));
                    }
                    if retries < MAX_RETRIES {
                        retries += 1;
                        tracing::warn!("Download status {}, retrying ({}/{})...", r.status(), retries, MAX_RETRIES);
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        continue;
                    }
                    return Err(format!("Download failed with status {}", r.status()));
                }
                r
            }
            Err(e) => {
                if retries < MAX_RETRIES {
                    retries += 1;
                    tracing::warn!("Download connect error, retrying ({}/{}): {}", retries, MAX_RETRIES, e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    continue;
                }
                return Err(format!("Download request failed: {}", e));
            }
        };

        let is_partial = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let content_len = resp.content_length().unwrap_or(0);

        if total_bytes == 0 {
            if is_partial {
                if let Some(range_hdr) = resp.headers().get(reqwest::header::CONTENT_RANGE) {
                    if let Ok(hdr_str) = range_hdr.to_str() {
                        if let Some(slash_idx) = hdr_str.rfind('/') {
                            if let Ok(tot) = hdr_str[slash_idx + 1..].trim().parse::<u64>() {
                                total_bytes = tot;
                            }
                        }
                    }
                }
                if total_bytes == 0 {
                    total_bytes = existing_size + content_len;
                }
            } else {
                total_bytes = content_len;
            }
            update_manifest_entry(models_dir, filename, url, total_bytes, "downloading");
        }

        let file = if is_partial || existing_size == 0 {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&dest)
                .await
                .map_err(|e| format!("Failed to open file: {}", e))?
        } else {
            tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&dest)
                .await
                .map_err(|e| format!("Failed to open file: {}", e))?
        };

        let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, file);

        let mut downloaded = if is_partial { existing_size } else { 0 };
        let mut stream = resp.bytes_stream();
        let mut stream_error = false;

        use futures::StreamExt;
        while let Some(chunk_res) = stream.next().await {
            match chunk_res {
                Ok(chunk) => {
                    if let Err(e) = writer.write_all(&chunk).await {
                        return Err(format!("Failed to write chunk: {}", e));
                    }
                    let chunk_len = chunk.len() as u64;
                    downloaded += chunk_len;
                    bytes_since_last_tick += chunk_len;

                    let elapsed = last_speed_time.elapsed().as_secs_f64();
                    if elapsed >= 0.8 {
                        let instant_speed = (bytes_since_last_tick as f64 / elapsed) as u64;
                        last_speed_time = std::time::Instant::now();
                        bytes_since_last_tick = 0;

                        smoothed_speed = if smoothed_speed == 0.0 {
                            instant_speed as f64
                        } else {
                            0.35 * (instant_speed as f64) + 0.65 * smoothed_speed
                        };
                        current_speed = smoothed_speed.round() as u64;

                        let speed_display = if current_speed > 0 {
                            Some(format_speed(current_speed))
                        } else {
                            None
                        };

                        let eta_seconds = if current_speed > 0 && total_bytes > downloaded {
                            Some((total_bytes - downloaded) / current_speed)
                        } else {
                            None
                        };

                        if let Some(ref tx) = progress_tx {
                            let _ = tx.send(DownloadProgress {
                                model_name: filename.to_string(),
                                downloaded_bytes: downloaded,
                                total_bytes,
                                percent: if total_bytes > 0 {
                                    (downloaded as f64 / total_bytes as f64) * 100.0
                                } else {
                                    0.0
                                },
                                speed_bytes_per_sec: Some(current_speed),
                                speed_display,
                                eta_seconds,
                                status: "downloading".to_string(),
                                url: Some(url.to_string()),
                            });
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Stream chunk error for {}: {}, attempting auto-resume...", filename, e);
                    stream_error = true;
                    break;
                }
            }
        }

        let _ = writer.flush().await;

        if total_bytes > 0 && downloaded < total_bytes && !stream_error {
            tracing::warn!("Stream ended prematurely at {} / {} bytes. Auto-resuming...", downloaded, total_bytes);
            stream_error = true;
        }

        if !stream_error {
            break;
        } else if retries < MAX_RETRIES {
            retries += 1;
            tracing::info!("Auto-resuming download ({}/{}) for {}", retries, MAX_RETRIES, filename);
            tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        } else {
            return Err(format!("Download stream interrupted after {} retry attempts", MAX_RETRIES));
        }
    }

    update_manifest_entry(models_dir, filename, url, total_bytes, "finished");
    tracing::info!("Download complete: {} ({})", filename, format_size(total_bytes));
    Ok(dest.to_string_lossy().to_string())
}

fn format_speed(bytes_per_sec: u64) -> String {
    const MB: u64 = 1_048_576;
    const KB: u64 = 1024;
    if bytes_per_sec >= MB {
        format!("{:.1} MB/s", bytes_per_sec as f64 / MB as f64)
    } else if bytes_per_sec >= KB {
        format!("{:.1} KB/s", bytes_per_sec as f64 / KB as f64)
    } else {
        format!("{} B/s", bytes_per_sec)
    }
}

fn format_size(bytes: u64) -> String {
    const GB: u64 = 1_073_741_824;
    const MB: u64 = 1_048_576;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    }
}

// Simple URL encoding for query parameters
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut result = String::with_capacity(input.len() * 3);
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                _ => {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        result
    }
}
