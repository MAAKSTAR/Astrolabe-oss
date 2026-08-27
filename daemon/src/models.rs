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
use tokio::io::AsyncWriteExt;

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
    let resp = reqwest::get(&url)
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

/// List all .gguf files in the models directory.
fn find_gguf_files_recursive(dir: &Path, models: &mut Vec<LocalModel>, depth: usize) {
    if depth > 3 { return; } // Limit depth to avoid symlink loops or massive trees
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_gguf_files_recursive(&path, models, depth + 1);
            } else if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                if let Ok(meta) = std::fs::metadata(&path) {
                    let size = meta.len();
                    let gguf_meta = inspect_gguf_metadata(&path);
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
    // We fetch a larger limit to ensure we have enough diverse models to pick from.
    let url = format!(
        "https://huggingface.co/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=500",
        urlencoding::encode(query)
    );

    let resp = reqwest::get(&url)
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

/// Download a GGUF model file from a direct URL to the models directory.
/// Emits progress events if a channel is provided.
pub async fn download_model(
    url: &str,
    models_dir: &str,
    filename: &str,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    // Resume support: check if partial download exists
    let dest = PathBuf::from(models_dir).join(filename);
    let existing_size = if dest.exists() {
        tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let client = reqwest::Client::new();
    let mut req = client.get(url);

    // If we have a partial download, request only the remaining bytes
    if existing_size > 0 {
        tracing::info!("📥 Resuming download from byte {}", existing_size);
        req = req.header("Range", format!("bytes={}-", existing_size));
    }

    let resp = req.send().await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("Download failed with status {}", resp.status()));
    }

    let content_len = resp.content_length().unwrap_or(0);
    let total_bytes = if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        existing_size + content_len
    } else {
        content_len
    };

    tokio::fs::create_dir_all(models_dir).await
        .map_err(|e| format!("Failed to create models dir: {}", e))?;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&dest)
        .await
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut downloaded = existing_size;
    let mut stream = resp.bytes_stream();

    let mut last_speed_time = std::time::Instant::now();
    let mut bytes_since_last_tick: u64 = 0;
    let mut current_speed: u64 = 0;

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        let chunk_len = chunk.len() as u64;
        downloaded += chunk_len;
        bytes_since_last_tick += chunk_len;

        let elapsed = last_speed_time.elapsed().as_secs_f64();
        if elapsed >= 0.5 {
            current_speed = (bytes_since_last_tick as f64 / elapsed) as u64;
            last_speed_time = std::time::Instant::now();
            bytes_since_last_tick = 0;
        }

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
            });
        }
    }

    file.flush().await.map_err(|e| format!("Flush failed: {}", e))?;

    tracing::info!("✅ Download complete: {} ({})", filename, format_size(downloaded));

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
