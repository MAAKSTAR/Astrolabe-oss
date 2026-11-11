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
pub struct LoadModelRequest {
    pub model_path: String,
    #[serde(default = "default_ctx")]
    pub ctx_size: u32,
    #[serde(default = "default_gpu_layers")]
    pub n_gpu_layers: i32,
    #[serde(default = "default_zero")]
    pub n_threads: u32,
    #[serde(default = "default_batch")]
    pub n_batch: u32,
    #[serde(default = "default_ubatch")]
    pub n_ubatch: u32,
    pub backend_preference: Option<String>,
    #[serde(default = "default_true")]
    pub use_mmap: bool,
    #[serde(default = "default_true")]
    pub flash_attn: bool,
    #[serde(default)]
    pub offload_context_to_cpu: Option<bool>,
    #[serde(default)]
    pub no_kv_offload: Option<bool>,
}

fn default_ctx() -> u32 { 131072 }
fn default_gpu_layers() -> i32 { -1 }
fn default_zero() -> u32 { 0 }
fn default_batch() -> u32 { 2048 }
fn default_ubatch() -> u32 { 512 }
fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelFamily {
    TextLlm,
    DiffusionFlow,
    AutoregressiveImage,
    PipelineComponent,
}

impl Default for ModelFamily {
    fn default() -> Self {
        ModelFamily::TextLlm
    }
}

pub const CANONICAL_MODALITIES: &[&str] = &["llm", "image", "video", "music", "component"];
pub const CANONICAL_COMPONENT_ROLES: &[&str] = &["vae", "encoders", "mmproj", "loras"];

pub fn normalize_modality(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "llm" | "text" | "chat" => Some("llm"),
        "image" | "images" | "img" => Some("image"),
        "video" | "videos" | "vid" => Some("video"),
        "music" | "audio" | "tts" | "speech" => Some("music"),
        "component" | "components" => Some("component"),
        _ => None,
    }
}

pub fn normalize_component_role(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "vae" | "vaes" | "ae" => Some("vae"),
        "encoder" | "encoders" | "text_encoder" | "text_encoders" | "clip" | "t5" => Some("encoders"),
        "mmproj" | "projector" | "vision_projector" => Some("mmproj"),
        "lora" | "loras" => Some("loras"),
        _ => None,
    }
}

fn is_explicit_llm_arch(arch_lower: &str) -> bool {
    matches!(
        arch_lower,
        "llama"
            | "llama2"
            | "llama3"
            | "llama4"
            | "qwen"
            | "qwen2"
            | "qwen2vl"
            | "qwen2_vl"
            | "qwen2_5_vl"
            | "qwen2moe"
            | "qwen3"
            | "qwen35"
            | "qwen35moe"
            | "qwen3vl"
            | "qwen3moe"
            | "gemma"
            | "gemma2"
            | "gemma3"
            | "gemma3n"
            | "deepseek"
            | "deepseek2"
            | "mistral"
            | "mixtral"
            | "phi2"
            | "phi3"
            | "phi4"
            | "refact"
            | "spark2_5"
            | "spark2_6"
            | "xing4_0"
            | "starcoder"
            | "starcoder2"
            | "command-r"
            | "cohere2"
            | "olmo"
            | "olmo2"
            | "granite"
            | "internlm2"
            | "yi"
            | "baichuan"
            | "falcon"
            | "gpt2"
            | "gptneox"
            | "mpt"
            | "bloom"
            | "smollm3"
            | "seed_oss"
            | "lfm2"
    )
}

pub fn infer_component_role(name_or_path: &str, arch: &str) -> &'static str {
    let lower = name_or_path.to_lowercase();
    let arch_l = arch.to_lowercase();
    let fname = Path::new(&lower)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| lower.clone());

    if fname.contains("mmproj") || lower.contains("/mmproj/") || lower.contains("\\mmproj\\") {
        return "mmproj";
    }
    if fname.contains("lora") || lower.contains("/loras/") || lower.contains("\\loras\\") || arch_l.contains("lora") {
        return "loras";
    }
    if fname.contains("vae")
        || arch_l.contains("vae")
        || arch_l == "ae"
        || fname == "ae.safetensors"
        || fname == "ae.gguf"
        || fname == "ae.sft"
        || fname.starts_with("ae.")
        || fname.contains("-ae.")
        || fname.contains("_ae.")
        || fname.contains(".ae.")
    {
        return "vae";
    }
    if arch_l == "t5encoder"
        || arch_l == "clip"
        || fname.contains("clip_l")
        || fname.contains("clip-l")
        || fname.contains("clip_g")
        || fname.contains("clip-g")
        || fname.contains("clip_vision")
        || fname.contains("t5xxl")
        || fname.contains("t5-v1")
        || fname.contains("umt5")
        || fname.contains("text_encoder")
        || fname.contains("text-encoder")
        || fname.contains("encoder")
    {
        return "encoders";
    }
    "encoders"
}

fn has_component_marker(name_or_path: &str, arch: &str) -> bool {
    let lower = name_or_path.to_lowercase();
    let arch_l = arch.to_lowercase();
    let fname = Path::new(&lower)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| lower.clone());

    fname.contains("mmproj")
        || fname.contains("vae")
        || arch_l.contains("vae")
        || arch_l == "ae"
        || arch_l == "t5encoder"
        || arch_l == "clip"
        || fname == "ae.safetensors"
        || fname == "ae.gguf"
        || fname == "ae.sft"
        || fname.starts_with("ae.")
        || fname.contains("-ae.")
        || fname.contains("_ae.")
        || fname.contains(".ae.")
        || fname.contains("clip_l")
        || fname.contains("clip-l")
        || fname.contains("clip_g")
        || fname.contains("clip-g")
        || fname.contains("clip_vision")
        || fname.contains("t5xxl")
        || fname.contains("t5-v1")
        || fname.contains("umt5")
        || fname.contains("text_encoder")
        || fname.contains("text-encoder")
        || fname.contains("encoder")
        || fname.contains("lora")
        || lower.contains("/components/")
        || lower.contains("\\components\\")
}

pub fn determine_model_family(arch: &str, name_or_path: &str) -> ModelFamily {
    let arch_lower = arch.to_lowercase();
    let name_lower = name_or_path.to_lowercase().replace('\\', "/");

    // 0. Directory-first check if full or relative path contains canonical folder
    if name_lower.starts_with("components/") || name_lower.contains("/components/") {
        return ModelFamily::PipelineComponent;
    }
    if name_lower.starts_with("video/") || name_lower.contains("/video/") {
        return ModelFamily::DiffusionFlow;
    }
    if name_lower.starts_with("llm/") || name_lower.contains("/llm/") {
        return ModelFamily::TextLlm;
    }
    if name_lower.starts_with("image/") || name_lower.contains("/image/") {
        let is_ar = ["janus", "chameleon", "emu", "show-o", "llamagen"]
            .iter()
            .any(|k| arch_lower.contains(k) || name_lower.contains(k))
            || arch_lower == "var";
        return if is_ar {
            ModelFamily::AutoregressiveImage
        } else {
            ModelFamily::DiffusionFlow
        };
    }

    // 1. Pipeline component check (mmproj, vae, ae, t5, clip, lora)
    if has_component_marker(&name_lower, &arch_lower) {
        return ModelFamily::PipelineComponent;
    }

    // 2. Explicit LLM architectures take precedence over filename keywords (e.g. qwen3vl text encoder)
    if is_explicit_llm_arch(&arch_lower) {
        return ModelFamily::TextLlm;
    }

    // 3. Diffusion / Flow check
    let is_diffusion = [
        "flux", "sdxl", "sd-", "sd_", "sd1", "sd2", "sd3", "diffusion", "stable-diffusion",
        "wan", "pixart", "auraflow", "cogvideo", "hunyuan", "ltx", "mochi", "dit",
        "qwen-image", "qwen_image",
    ]
    .iter()
    .any(|k| arch_lower.contains(k) || name_lower.contains(k))
        || (name_lower.contains("qwen") && name_lower.contains("image"))
        || (arch_lower.contains("qwen") && arch_lower.contains("image"));

    if is_diffusion {
        return ModelFamily::DiffusionFlow;
    }

    // 4. Autoregressive Image check
    let is_ar = ["janus", "chameleon", "emu", "show-o", "llamagen"]
        .iter()
        .any(|k| arch_lower.contains(k) || name_lower.contains(k))
        || arch_lower == "var"
        || name_lower.contains("var-")
        || name_lower.contains("-var")
        || name_lower.contains("_var")
        || name_lower.contains("var_");

    if is_ar {
        return ModelFamily::AutoregressiveImage;
    }

    ModelFamily::TextLlm
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalModel {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_role: Option<String>,
    pub size_bytes: u64,
    pub size_display: String,
    pub max_context_length: Option<u32>,
    pub total_layers: Option<u32>,
    pub architecture: String,
    pub quantization: String,
    pub model_family: ModelFamily,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality: Option<String>,
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
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub repo_id: Option<String>,
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
    update_manifest_entry_with_meta(models_dir, filename, url, total_bytes, status, None, None, None, None);
}

pub fn update_manifest_entry_with_meta(
    models_dir: &str,
    filename: &str,
    url: &str,
    total_bytes: u64,
    status: &str,
    relative_path: Option<&str>,
    modality: Option<&str>,
    family: Option<&str>,
    repo_id: Option<&str>,
) {
    let mut manifest = load_manifest(models_dir);
    let rec = manifest.entry(filename.to_string()).or_insert_with(|| DownloadRecord {
        filename: filename.to_string(),
        url: url.to_string(),
        total_bytes,
        status: status.to_string(),
        modality: None,
        family: None,
        relative_path: None,
        repo_id: None,
    });
    if !url.is_empty() {
        rec.url = url.to_string();
    }
    if total_bytes > 0 {
        rec.total_bytes = total_bytes;
    }
    if let Some(rp) = relative_path {
        if !rp.is_empty() {
            rec.relative_path = Some(rp.to_string());
        }
    }
    if let Some(m) = modality {
        if !m.is_empty() {
            rec.modality = Some(m.to_string());
        }
    }
    if let Some(f) = family {
        if !f.is_empty() {
            rec.family = Some(f.to_string());
        }
    }
    if let Some(r) = repo_id {
        if !r.is_empty() {
            rec.repo_id = Some(r.to_string());
        }
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
    pub max_context_length: Option<u32>,
    pub total_layers: Option<u32>,
    pub architecture: String,
    pub quantization: String,
    pub general_type: Option<String>,
    pub general_name: Option<String>,
    pub model_family: ModelFamily,
}

fn gguf_file_type_name(ft: u32) -> Option<&'static str> {
    match ft {
        0 => Some("F32"),
        1 => Some("F16"),
        2 => Some("Q4_0"),
        3 => Some("Q4_1"),
        7 => Some("Q8_0"),
        8 => Some("Q5_0"),
        9 => Some("Q5_1"),
        10 => Some("Q2_K"),
        11 => Some("Q3_K_S"),
        12 => Some("Q3_K_M"),
        13 => Some("Q3_K_L"),
        14 => Some("Q4_K_S"),
        15 => Some("Q4_K_M"),
        16 => Some("Q5_K_S"),
        17 => Some("Q5_K_M"),
        18 => Some("Q6_K"),
        19 => Some("IQ2_XXS"),
        20 => Some("IQ2_XS"),
        21 => Some("Q2_K_S"),
        22 => Some("IQ3_XS"),
        23 => Some("IQ3_XXS"),
        24 => Some("IQ1_S"),
        25 => Some("IQ4_NL"),
        26 => Some("IQ3_S"),
        27 => Some("IQ3_M"),
        28 => Some("IQ2_S"),
        29 => Some("IQ2_M"),
        30 => Some("IQ4_XS"),
        31 => Some("IQ1_M"),
        32 => Some("BF16"),
        _ => None,
    }
}

fn extract_block_index_from_tensor_name(name: &str, prefix: &str) -> Option<u32> {
    let mut rest = name;
    while let Some(pos) = rest.find(prefix) {
        let valid_boundary = pos == 0 || rest.as_bytes()[pos - 1] == b'.';
        let after = &rest[pos + prefix.len()..];
        if valid_boundary {
            if let Some(dot_idx) = after.find('.') {
                if let Ok(num) = after[..dot_idx].parse::<u32>() {
                    return Some(num);
                }
            }
        }
        rest = &rest[pos + prefix.len()..];
    }
    None
}

#[derive(Default)]
struct TensorBlockStats {
    max_double_block: Option<u32>,
    max_single_block: Option<u32>,
    max_transformer_block: Option<u32>,
    max_joint_block: Option<u32>,
    max_block: Option<u32>,
    max_blk: Option<u32>,
    max_layer: Option<u32>,
    has_diffusion_model_prefix: bool,
    has_lora_tensors: bool,
}

fn update_max(slot: &mut Option<u32>, val: u32) {
    *slot = Some(slot.map_or(val, |cur| cur.max(val)));
}

impl TensorBlockStats {
    fn observe(&mut self, name: &str) {
        if name.contains("diffusion_model.") {
            self.has_diffusion_model_prefix = true;
        }
        if name.contains(".lora_") || name.starts_with("lora_") {
            self.has_lora_tensors = true;
        }
        if let Some(i) = extract_block_index_from_tensor_name(name, "double_blocks.") {
            update_max(&mut self.max_double_block, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "single_blocks.") {
            update_max(&mut self.max_single_block, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "transformer_blocks.") {
            update_max(&mut self.max_transformer_block, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "joint_blocks.") {
            update_max(&mut self.max_joint_block, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "blocks.") {
            update_max(&mut self.max_block, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "blk.") {
            update_max(&mut self.max_blk, i);
        } else if let Some(i) = extract_block_index_from_tensor_name(name, "layers.") {
            update_max(&mut self.max_layer, i);
        }
    }

    fn total_blocks(&self) -> Option<u32> {
        if self.max_double_block.is_some() || self.max_single_block.is_some() {
            let d = self.max_double_block.map_or(0, |m| m + 1);
            let s = self.max_single_block.map_or(0, |m| m + 1);
            return Some(d + s);
        }
        if let Some(m) = self.max_transformer_block {
            return Some(m + 1);
        }
        if let Some(m) = self.max_joint_block {
            return Some(m + 1);
        }
        if let Some(m) = self.max_block {
            return Some(m + 1);
        }
        if let Some(m) = self.max_blk {
            return Some(m + 1);
        }
        if let Some(m) = self.max_layer {
            return Some(m + 1);
        }
        None
    }
}

pub fn inspect_gguf_metadata(path: &Path) -> GgufMeta {
    use std::fs::File;
    use std::io::{BufReader, Read};

    let file_str = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let initial_family = determine_model_family("", &file_str);

    let mut meta = GgufMeta {
        max_context_length: None,
        total_layers: None,
        architecture: String::new(),
        quantization: extract_quant_from_name(&file_str).unwrap_or_default(),
        general_type: None,
        general_name: None,
        model_family: initial_family,
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
    let tensor_count = u64::from_le_bytes(u64_buf);
    // KV count
    if reader.read_exact(&mut u64_buf).is_err() { return meta; }
    let kv_count = u64::from_le_bytes(u64_buf);

    let mut arch = String::new();
    let mut ctx_len: Option<u32> = None;
    let mut block_cnt: Option<u32> = None;
    let mut file_type_num: Option<u32> = None;
    let mut quant_name = String::new();
    let mut kv_parsed_ok = true;

    for _ in 0..kv_count.min(10000) {
        if reader.read_exact(&mut u64_buf).is_err() { kv_parsed_ok = false; break; }
        let klen = u64::from_le_bytes(u64_buf) as usize;
        if klen > 512 { kv_parsed_ok = false; break; }

        let mut key_buf = vec![0u8; klen];
        if reader.read_exact(&mut key_buf).is_err() { kv_parsed_ok = false; break; }
        let key = String::from_utf8_lossy(&key_buf).to_string();

        if reader.read_exact(&mut u32_buf).is_err() { kv_parsed_ok = false; break; }
        let vtype = u32::from_le_bytes(u32_buf);

        let is_tokenizer = key.starts_with("tokenizer.");

        match vtype {
            0 | 1 | 7 => {
                if reader.seek_relative(1).is_err() { kv_parsed_ok = false; break; }
            }
            2 | 3 => {
                if reader.seek_relative(2).is_err() { kv_parsed_ok = false; break; }
            }
            4 => {
                if reader.read_exact(&mut u32_buf).is_err() { kv_parsed_ok = false; break; }
                if !is_tokenizer {
                    let val = u32::from_le_bytes(u32_buf);
                    if key.ends_with(".context_length") {
                        ctx_len = Some(val);
                    } else if key.ends_with(".block_count") {
                        block_cnt = Some(val);
                    } else if key == "general.file_type" {
                        file_type_num = Some(val);
                    }
                }
            }
            5 | 6 => {
                if reader.seek_relative(4).is_err() { kv_parsed_ok = false; break; }
            }
            8 => {
                if reader.read_exact(&mut u64_buf).is_err() { kv_parsed_ok = false; break; }
                let slen = u64::from_le_bytes(u64_buf);
                if slen > 16 * 1024 * 1024 { kv_parsed_ok = false; break; }
                if is_tokenizer || slen > 4096 {
                    if reader.seek_relative(slen as i64).is_err() { kv_parsed_ok = false; break; }
                } else {
                    let mut sbuf = vec![0u8; slen as usize];
                    if reader.read_exact(&mut sbuf).is_err() { kv_parsed_ok = false; break; }
                    let sval = String::from_utf8_lossy(&sbuf).to_string();
                    if key == "general.architecture" {
                        arch = sval;
                    } else if key == "general.file_type_name" {
                        quant_name = sval;
                    } else if key == "general.type" {
                        meta.general_type = Some(sval);
                    } else if key == "general.name" || (meta.general_name.is_none() && key == "general.basename") {
                        meta.general_name = Some(sval);
                    }
                }
            }
            9 => {
                let mut atype_buf = [0u8; 4];
                if reader.read_exact(&mut atype_buf).is_err() { kv_parsed_ok = false; break; }
                let atype = u32::from_le_bytes(atype_buf);
                if reader.read_exact(&mut u64_buf).is_err() { kv_parsed_ok = false; break; }
                let alen = u64::from_le_bytes(u64_buf);
                if alen > 2_000_000 { kv_parsed_ok = false; break; }

                match atype {
                    8 => {
                        for _ in 0..alen {
                            if reader.read_exact(&mut u64_buf).is_err() { kv_parsed_ok = false; break; }
                            let sl = u64::from_le_bytes(u64_buf);
                            if sl > 16 * 1024 * 1024 { kv_parsed_ok = false; break; }
                            if reader.seek_relative(sl as i64).is_err() { kv_parsed_ok = false; break; }
                        }
                        if !kv_parsed_ok { break; }
                    }
                    0 | 1 | 7 => { if reader.seek_relative(alen as i64).is_err() { kv_parsed_ok = false; break; } }
                    2 | 3 => { if reader.seek_relative((alen * 2) as i64).is_err() { kv_parsed_ok = false; break; } }
                    4 | 5 | 6 => { if reader.seek_relative((alen * 4) as i64).is_err() { kv_parsed_ok = false; break; } }
                    10 | 11 | 12 => { if reader.seek_relative((alen * 8) as i64).is_err() { kv_parsed_ok = false; break; } }
                    _ => { kv_parsed_ok = false; break; }
                }
            }
            10 => {
                if reader.read_exact(&mut u64_buf).is_err() { kv_parsed_ok = false; break; }
                if !is_tokenizer {
                    let val = u64::from_le_bytes(u64_buf) as u32;
                    if key.ends_with(".context_length") {
                        ctx_len = Some(val);
                    } else if key.ends_with(".block_count") {
                        block_cnt = Some(val);
                    }
                }
            }
            11 | 12 => {
                if reader.seek_relative(8).is_err() { kv_parsed_ok = false; break; }
            }
            _ => { kv_parsed_ok = false; break; }
        }
    }

    let mut tensor_layers: Option<u32> = None;
    if kv_parsed_ok && kv_count <= 10000 && (block_cnt.is_none() || arch.is_empty()) && tensor_count > 0 {
        let mut stats = TensorBlockStats::default();
        for _ in 0..tensor_count.min(4000) {
            if reader.read_exact(&mut u64_buf).is_err() { break; }
            let tlen = u64::from_le_bytes(u64_buf) as usize;
            if tlen > 512 { break; }
            let mut tbuf = vec![0u8; tlen];
            if reader.read_exact(&mut tbuf).is_err() { break; }
            let tname = String::from_utf8_lossy(&tbuf);
            stats.observe(&tname);
            if reader.read_exact(&mut u32_buf).is_err() { break; }
            let ndims = u32::from_le_bytes(u32_buf) as i64;
            if ndims > 16 { break; }
            // Skip ndims * u64 + ggml_type (u32) + offset (u64)
            if reader.seek_relative(ndims * 8 + 12).is_err() { break; }
        }
        if arch.is_empty() {
            if stats.max_double_block.is_some() || stats.max_single_block.is_some() {
                arch = "flux".to_string();
            } else if stats.has_diffusion_model_prefix {
                let lower = file_str.to_lowercase();
                if lower.contains("qwen") {
                    arch = "qwen_image".to_string();
                } else {
                    arch = "diffusion".to_string();
                }
            }
        }
        tensor_layers = stats.total_blocks();
    }

    if !arch.is_empty() {
        meta.architecture = arch;
    } else {
        let lower = file_str.to_lowercase();
        if lower.contains("wan") {
            meta.architecture = "wan".to_string();
        } else if lower.contains("flux") {
            meta.architecture = "flux".to_string();
        } else if lower.contains("qwen") && lower.contains("image") {
            meta.architecture = "qwen_image".to_string();
        } else if lower.contains("sdxl") || lower.contains("sd-turbo") || lower.contains("sd3") {
            meta.architecture = "sd".to_string();
        } else {
            meta.architecture = "unknown".to_string();
        }
    }

    meta.max_context_length = ctx_len;
    meta.total_layers = if let Some(blocks) = block_cnt {
        // LLM GGUF block_count counts transformer blocks; llama.cpp reports blocks + 1 output layer
        if is_explicit_llm_arch(&meta.architecture.to_lowercase()) {
            Some(blocks + 1)
        } else {
            Some(blocks)
        }
    } else {
        tensor_layers
    };

    if !quant_name.is_empty() {
        meta.quantization = quant_name;
    } else if meta.quantization.is_empty() {
        if let Some(ft) = file_type_num.and_then(gguf_file_type_name) {
            meta.quantization = ft.to_string();
        } else {
            meta.quantization = "GGUF".to_string();
        }
    }

    meta.model_family = determine_model_family(&meta.architecture, &file_str);
    meta
}

pub fn inspect_safetensors_metadata(path: &Path) -> GgufMeta {
    use std::fs::File;
    use std::io::{BufReader, Read};

    let file_str = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let fname_lower = file_str.to_lowercase();

    let mut meta = GgufMeta {
        max_context_length: None,
        total_layers: None,
        architecture: String::new(),
        quantization: String::new(),
        general_type: None,
        general_name: None,
        model_family: ModelFamily::DiffusionFlow,
    };

    let mut header_json: Option<serde_json::Map<String, serde_json::Value>> = None;
    if let Ok(file) = File::open(path) {
        let mut reader = BufReader::new(file);
        let mut len_buf = [0u8; 8];
        if reader.read_exact(&mut len_buf).is_ok() {
            let header_len = u64::from_le_bytes(len_buf);
            if header_len > 0 && header_len <= 32 * 1024 * 1024 {
                let mut buf = vec![0u8; header_len as usize];
                if reader.read_exact(&mut buf).is_ok() {
                    if let Ok(serde_json::Value::Object(map)) = serde_json::from_slice(&buf) {
                        header_json = Some(map);
                    }
                }
            }
        }
    }

    let mut stats = TensorBlockStats::default();
    let mut detected_dtype: Option<String> = None;

    if let Some(ref map) = header_json {
        if let Some(serde_json::Value::Object(md)) = map.get("__metadata__") {
            if let Some(arch) = md.get("modelspec.architecture").and_then(|v| v.as_str()) {
                meta.architecture = arch.to_string();
            }
            if let Some(title) = md.get("modelspec.title").and_then(|v| v.as_str()) {
                meta.general_name = Some(title.to_string());
            }
            if md.contains_key("ss_network_module") {
                meta.general_type = Some("lora".to_string());
            }
        }

        for (key, val) in map {
            if key == "__metadata__" {
                continue;
            }
            stats.observe(key);
            if detected_dtype.is_none() {
                if let Some(dt) = val.get("dtype").and_then(|v| v.as_str()) {
                    let normalized = match dt {
                        "F8_E4M3" | "F8_E5M2" => "FP8".to_string(),
                        other => other.to_string(),
                    };
                    detected_dtype = Some(normalized);
                }
            }
        }
    }

    if meta.architecture.is_empty() {
        if stats.has_lora_tensors || meta.general_type.as_deref() == Some("lora") {
            meta.architecture = "lora".to_string();
        } else if stats.max_double_block.is_some() || stats.max_single_block.is_some() {
            meta.architecture = "flux".to_string();
        } else if fname_lower.contains("clip_l") || fname_lower.contains("clip-l") || fname_lower.contains("t5xxl") || fname_lower.contains("umt5") {
            meta.architecture = "clip".to_string();
        } else if fname_lower == "ae.safetensors" || fname_lower == "ae.sft" || fname_lower.contains("vae") {
            meta.architecture = "vae".to_string();
        } else if fname_lower.contains("wan") {
            meta.architecture = "wan".to_string();
        } else {
            meta.architecture = "diffusion".to_string();
        }
    }

    meta.total_layers = stats.total_blocks();
    meta.quantization = detected_dtype
        .or_else(|| extract_quant_from_name(&file_str))
        .unwrap_or_else(|| "SafeTensors".to_string());
    meta.model_family = determine_model_family(&meta.architecture, &file_str);
    meta
}

fn extract_quant_from_name(name: &str) -> Option<String> {
    let parts = [
        "Q2_K_S", "Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q3_K",
        "Q4_K_M", "Q4_K_S", "Q4_K", "Q4_0", "Q4_1",
        "Q5_K_M", "Q5_K_S", "Q5_K", "Q5_0", "Q5_1",
        "Q6_K", "Q8_0",
        "IQ1_S", "IQ1_M", "IQ2_XXS", "IQ2_XS", "IQ2_S", "IQ2_M",
        "IQ3_XXS", "IQ3_XS", "IQ3_M", "IQ3_S",
        "IQ4_XS", "IQ4_NL",
        "BF16", "FP16", "F16", "F32", "FP8",
    ];
    let upper = name.to_uppercase();
    for p in parts {
        if upper.contains(p) {
            return Some(p.to_string());
        }
    }
    None
}

static GGUF_CACHE: std::sync::OnceLock<std::sync::RwLock<std::collections::HashMap<PathBuf, (u64, std::time::SystemTime, GgufMeta)>>> = std::sync::OnceLock::new();

fn get_cached_model_metadata(path: &Path, size: u64, mtime: std::time::SystemTime) -> GgufMeta {
    let cache = GGUF_CACHE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()));
    if let Ok(guard) = cache.read() {
        if let Some((cached_size, cached_mtime, cached_meta)) = guard.get(path) {
            if *cached_size == size && *cached_mtime == mtime {
                return cached_meta.clone();
            }
        }
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let meta = if ext == "gguf" {
        inspect_gguf_metadata(path)
    } else {
        inspect_safetensors_metadata(path)
    };
    if let Ok(mut guard) = cache.write() {
        guard.insert(path.to_path_buf(), (size, mtime, meta.clone()));
    }
    meta
}

fn has_video_marker(lower: &str, arch_lower: &str) -> bool {
    arch_lower == "wan"
        || arch_lower.contains("cogvideo")
        || arch_lower.contains("hunyuanvideo")
        || arch_lower.contains("ltx")
        || arch_lower.contains("mochi")
        || lower.contains("wan2")
        || lower.contains("wan-")
        || lower.contains("wan_")
        || lower.contains("cogvideo")
        || lower.contains("hunyuanvideo")
        || lower.contains("ltx-video")
        || lower.contains("ltx2")
        || lower.contains("mochi")
        || lower.contains("ti2v")
        || lower.contains("flf2v")
        || lower.contains("-t2v")
        || lower.contains("_t2v")
        || lower.contains("-i2v")
        || lower.contains("_i2v")
}

fn has_music_marker(lower: &str, arch_lower: &str) -> bool {
    [
        "musicgen", "audiogen", "ace-step", "kokoro", "bark", "whisper", "wav2vec",
        "text-to-audio", "text-to-speech", "audio-vae",
    ]
    .iter()
    .any(|k| lower.contains(k) || arch_lower.contains(k))
}

fn has_image_diffusion_marker(lower: &str, arch_lower: &str) -> bool {
    if is_explicit_llm_arch(arch_lower) {
        return false;
    }
    [
        "flux", "sdxl", "sd-", "sd_", "sd1", "sd2", "sd3", "diffusion", "stable-diffusion",
        "pixart", "auraflow", "dit", "qwen-image", "qwen_image",
    ]
    .iter()
    .any(|k| arch_lower.contains(k) || lower.contains(k))
        || (lower.contains("qwen") && lower.contains("image"))
        || (arch_lower.contains("qwen") && arch_lower.contains("image"))
}

fn has_ar_image_marker(lower: &str, arch_lower: &str) -> bool {
    ["janus", "chameleon", "emu", "show-o", "llamagen"]
        .iter()
        .any(|k| arch_lower.contains(k) || lower.contains(k))
        || arch_lower == "var"
        || lower.contains("var-")
        || lower.contains("-var")
}

/// Directory-first classification for a discovered model file.
/// Canonical top-level folders (`llm/`, `image/`, `video/`, `music/`, `components/{vae,encoders,mmproj,loras}/`)
/// are treated as the authoritative source of truth; manifest/metadata/heuristics apply only for loose files.
pub fn classify_model_entry(
    rel_path: &str,
    meta: &GgufMeta,
    manifest_rec: Option<&DownloadRecord>,
) -> (String, Option<String>, ModelFamily) {
    let rel_norm = rel_path.replace('\\', "/");
    let parts: Vec<&str> = rel_norm.split('/').filter(|s| !s.is_empty()).collect();

    if parts.len() >= 2 {
        let top = parts[0].to_lowercase();
        match top.as_str() {
            "video" => {
                return ("video".to_string(), None, ModelFamily::DiffusionFlow);
            }
            "image" => {
                let arch_l = meta.architecture.to_lowercase();
                let name_l = rel_norm.to_lowercase();
                let family = if has_ar_image_marker(&name_l, &arch_l) {
                    ModelFamily::AutoregressiveImage
                } else {
                    ModelFamily::DiffusionFlow
                };
                return ("image".to_string(), None, family);
            }
            "llm" => {
                return ("llm".to_string(), None, ModelFamily::TextLlm);
            }
            "music" | "audio" => {
                return ("music".to_string(), None, ModelFamily::DiffusionFlow);
            }
            "components" => {
                let role = parts
                    .get(1)
                    .and_then(|s| normalize_component_role(s))
                    .unwrap_or_else(|| infer_component_role(&rel_norm, &meta.architecture));
                return ("component".to_string(), Some(role.to_string()), ModelFamily::PipelineComponent);
            }
            _ => {}
        }
    }

    // Fallback for loose files at root (or legacy non-canonical folders)
    let arch_l = meta.architecture.to_lowercase();
    let name_l = rel_norm.to_lowercase();

    if let Some(rec) = manifest_rec {
        if let Some(ref m_raw) = rec.modality {
            if let Some(m_norm) = normalize_modality(m_raw) {
                return match m_norm {
                    "component" => {
                        let role = infer_component_role(&rel_norm, &meta.architecture);
                        ("component".to_string(), Some(role.to_string()), ModelFamily::PipelineComponent)
                    }
                    "video" => ("video".to_string(), None, ModelFamily::DiffusionFlow),
                    "image" => {
                        let fam = if has_ar_image_marker(&name_l, &arch_l) {
                            ModelFamily::AutoregressiveImage
                        } else {
                            ModelFamily::DiffusionFlow
                        };
                        ("image".to_string(), None, fam)
                    }
                    "music" => ("music".to_string(), None, ModelFamily::DiffusionFlow),
                    _ => ("llm".to_string(), None, ModelFamily::TextLlm),
                };
            }
        }
    }

    if meta.general_type.as_deref() == Some("mmproj") {
        return ("component".to_string(), Some("mmproj".to_string()), ModelFamily::PipelineComponent);
    }
    if meta.general_type.as_deref() == Some("lora") || has_component_marker(&name_l, &arch_l) {
        let role = infer_component_role(&rel_norm, &meta.architecture);
        return ("component".to_string(), Some(role.to_string()), ModelFamily::PipelineComponent);
    }
    if has_video_marker(&name_l, &arch_l) {
        return ("video".to_string(), None, ModelFamily::DiffusionFlow);
    }
    if has_ar_image_marker(&name_l, &arch_l) {
        return ("image".to_string(), None, ModelFamily::AutoregressiveImage);
    }
    if is_explicit_llm_arch(&arch_l) {
        return ("llm".to_string(), None, ModelFamily::TextLlm);
    }
    if has_image_diffusion_marker(&name_l, &arch_l) {
        return ("image".to_string(), None, ModelFamily::DiffusionFlow);
    }
    if has_music_marker(&name_l, &arch_l) {
        return ("music".to_string(), None, ModelFamily::DiffusionFlow);
    }

    // Safetensors without explicit markers are visual/diffusion assets rather than GGUF LLMs
    if name_l.ends_with(".safetensors") || name_l.ends_with(".sft") {
        return ("image".to_string(), None, ModelFamily::DiffusionFlow);
    }

    ("llm".to_string(), None, ModelFamily::TextLlm)
}

/// List all .gguf, .safetensors, and .sft files in the models directory.
pub fn find_gguf_files_recursive(
    root: &Path,
    dir: &Path,
    models: &mut Vec<LocalModel>,
    manifest: &std::collections::HashMap<String, DownloadRecord>,
    depth: usize,
) {
    if depth > 4 { return; } // Limit depth to avoid symlink loops or massive trees
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = path.file_name().unwrap_or_default().to_string_lossy();
            if fname.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                find_gguf_files_recursive(root, &path, models, manifest, depth + 1);
            } else if path.extension().map(|e| e == "gguf" || e == "safetensors" || e == "sft").unwrap_or(false) {
                // Incomplete download guard: if an aria2 control file exists, or incomplete extension, skip!
                let aria2_companion = PathBuf::from(format!("{}.aria2", path.display()));
                if aria2_companion.exists() || fname.ends_with(".part") || fname.ends_with(".tmp") || fname.ends_with(".crdownload") {
                    tracing::warn!("Ignoring incomplete download with active .aria2 control file: {:?}", path);
                    continue;
                }
                if let Ok(meta) = std::fs::metadata(&path) {
                    let size = meta.len();
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    let file_name_str = path.file_name().unwrap().to_string_lossy().to_string();
                    let rel_path = path
                        .strip_prefix(root)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|_| file_name_str.clone());

                    let parsed_meta = get_cached_model_metadata(&path, size, mtime);
                    let manifest_rec = manifest
                        .get(&file_name_str)
                        .or_else(|| manifest.values().find(|r| r.relative_path.as_deref() == Some(rel_path.as_str())));

                    let (modality, component_role, model_family) =
                        classify_model_entry(&rel_path, &parsed_meta, manifest_rec);

                    models.push(LocalModel {
                        name: file_name_str,
                        path: path.to_string_lossy().to_string(),
                        relative_path: Some(rel_path),
                        modality: Some(modality),
                        component_role,
                        size_bytes: size,
                        size_display: format_size(size),
                        max_context_length: parsed_meta.max_context_length,
                        total_layers: parsed_meta.total_layers,
                        architecture: parsed_meta.architecture,
                        quantization: parsed_meta.quantization,
                        model_family,
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

    let manifest = load_manifest(models_dir);
    let mut models = Vec::new();
    find_gguf_files_recursive(dir, dir, &mut models, &manifest, 0);

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

pub fn model_family_as_str(family: &ModelFamily) -> &'static str {
    match family {
        ModelFamily::TextLlm => "text_llm",
        ModelFamily::DiffusionFlow => "diffusion_flow",
        ModelFamily::AutoregressiveImage => "autoregressive_image",
        ModelFamily::PipelineComponent => "pipeline_component",
    }
}

#[derive(Debug, Clone)]
pub struct DownloadRoutePlan {
    pub filename: String,
    pub relative_path: String,
    pub modality: String,
    pub component_role: Option<String>,
    pub family: ModelFamily,
    pub repo_id: Option<String>,
    pub explicit_override: bool,
}

pub fn build_relative_path(modality: &str, component_role: Option<&str>, filename: &str) -> String {
    let clean_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| filename.replace(['/', '\\'], "_"));

    match modality {
        "component" => {
            let role = component_role
                .and_then(normalize_component_role)
                .unwrap_or_else(|| infer_component_role(&clean_name, ""));
            format!("components/{}/{}", role, clean_name)
        }
        "video" => format!("video/{}", clean_name),
        "image" => format!("image/{}", clean_name),
        "music" => format!("music/{}", clean_name),
        _ => format!("llm/{}", clean_name),
    }
}

pub fn extract_repo_id_from_url(raw_url: &str) -> Option<String> {
    let stripped = raw_url
        .trim()
        .strip_prefix("https://")
        .or_else(|| raw_url.trim().strip_prefix("http://"))?;
    let mut parts = stripped.split('/').filter(|s| !s.is_empty());
    let host = parts.next()?.to_lowercase();
    if !host.ends_with("huggingface.co") && !host.ends_with("hf-mirror.com") {
        return None;
    }
    let seg1 = parts.next()?;
    let seg2 = parts.next()?;
    if matches!(seg1, "models" | "datasets" | "spaces" | "api" | "docs" | "settings") {
        return None;
    }
    let clean_repo = seg2.split('?').next().unwrap_or(seg2);
    if seg1.is_empty() || clean_repo.is_empty() {
        return None;
    }
    Some(format!("{}/{}", seg1, clean_repo))
}

#[derive(Default, Debug)]
struct HfRepoRoutingMetadata {
    pipeline_tag: Option<String>,
    tags: Vec<String>,
    class_name: Option<String>,
}

async fn fetch_hf_routing_metadata(
    repo_id: &str,
    hf_token: Option<&str>,
) -> Option<HfRepoRoutingMetadata> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Astrolabe-IDE/1.0")
        .build()
        .ok()?;

    let api_url = format!("https://huggingface.co/api/models/{}", repo_id);
    let mut req = client.get(&api_url).header("Accept", "application/json");
    if let Some(tok) = hf_token {
        let t = tok.trim();
        if !t.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
    }

    let mut meta = HfRepoRoutingMetadata::default();
    let mut has_model_index = false;
    let mut has_config_json = false;

    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(val) = resp.json::<serde_json::Value>().await {
                meta.pipeline_tag = val
                    .get("pipeline_tag")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(arr) = val.get("tags").and_then(|v| v.as_array()) {
                    meta.tags = arr
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                }
                if let Some(siblings) = val.get("siblings").and_then(|v| v.as_array()) {
                    for s in siblings {
                        if let Some(rf) = s.get("rfilename").and_then(|v| v.as_str()) {
                            if rf == "model_index.json" {
                                has_model_index = true;
                            } else if rf == "config.json" {
                                has_config_json = true;
                            }
                        }
                    }
                }
            }
        }
    }

    let raw_files: &[(&str, bool)] = &[
        ("model_index.json", has_model_index || meta.pipeline_tag.is_none()),
        ("config.json", has_config_json || meta.pipeline_tag.is_none()),
    ];
    for (fname, should_try) in raw_files {
        if !*should_try || meta.class_name.is_some() {
            continue;
        }
        let raw_url = format!("https://huggingface.co/{}/raw/main/{}", repo_id, fname);
        let mut r = client.get(&raw_url);
        if let Some(tok) = hf_token {
            let t = tok.trim();
            if !t.is_empty() {
                r = r.header("Authorization", format!("Bearer {}", t));
            }
        }
        if let Ok(resp) = r.send().await {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(cls) = val.get("_class_name").and_then(|v| v.as_str()) {
                        meta.class_name = Some(cls.to_string());
                    } else if let Some(mt) = val.get("model_type").and_then(|v| v.as_str()) {
                        meta.class_name = Some(mt.to_string());
                    } else if let Some(arch) = val
                        .get("architectures")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|v| v.as_str())
                    {
                        meta.class_name = Some(arch.to_string());
                    }
                }
            }
        }
    }

    if meta.pipeline_tag.is_none() && meta.tags.is_empty() && meta.class_name.is_none() {
        None
    } else {
        Some(meta)
    }
}

fn classify_hf_signals(
    filename: &str,
    pipeline_tag: Option<&str>,
    tags: &[String],
    class_name: Option<&str>,
) -> Option<(&'static str, Option<&'static str>, ModelFamily)> {
    let pt = pipeline_tag.unwrap_or("").to_lowercase();
    let cls = class_name.unwrap_or("").to_lowercase();
    let tags_l: Vec<String> = tags.iter().map(|t| t.to_lowercase()).collect();
    let fname_l = filename.to_lowercase();

    let tag_has = |needle: &str| tags_l.iter().any(|t| t == needle || t.contains(needle));

    if pt.contains("video")
        || tag_has("text-to-video")
        || tag_has("image-to-video")
        || tag_has("video-to-video")
        || cls.contains("wan")
        || cls.contains("cogvideo")
        || cls.contains("hunyuanvideo")
        || cls.contains("ltx")
        || cls.contains("mochi")
    {
        return Some(("video", None, ModelFamily::DiffusionFlow));
    }

    if pt.contains("audio")
        || pt.contains("speech")
        || tag_has("text-to-audio")
        || tag_has("text-to-speech")
        || tag_has("musicgen")
        || tag_has("audio-generation")
    {
        return Some(("music", None, ModelFamily::DiffusionFlow));
    }

    if pt.contains("image") && !pt.contains("image-text-to-text")
        || tag_has("text-to-image")
        || tag_has("image-to-image")
        || tag_has("diffusers")
        || cls.contains("flux")
        || cls.contains("stablediffusion")
        || cls.contains("pixart")
        || cls.contains("auraflow")
        || cls.contains("qwenimage")
    {
        let fam = if has_ar_image_marker(&fname_l, &cls) {
            ModelFamily::AutoregressiveImage
        } else {
            ModelFamily::DiffusionFlow
        };
        return Some(("image", None, fam));
    }

    if pt == "text-generation"
        || pt == "image-text-to-text"
        || pt == "conversational"
        || pt == "text2text-generation"
        || is_explicit_llm_arch(&cls)
    {
        return Some(("llm", None, ModelFamily::TextLlm));
    }

    None
}

pub async fn resolve_download_target(
    url: &str,
    raw_filename: &str,
    repo_id: Option<&str>,
    pipeline_tag: Option<&str>,
    tags: Option<&[String]>,
    modality_hint: Option<&str>,
    component_role_hint: Option<&str>,
    hf_token: Option<&str>,
) -> DownloadRoutePlan {
    let clean_name = Path::new(raw_filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| raw_filename.replace(['/', '\\'], "_"));
    let lower_name = clean_name.to_lowercase();

    let resolved_repo = repo_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| extract_repo_id_from_url(url));

    // 1. Explicit component role hint or unmistakable component filename marker always routes to components/{role}/
    if let Some(role) = component_role_hint.and_then(normalize_component_role) {
        let rel = build_relative_path("component", Some(role), &clean_name);
        return DownloadRoutePlan {
            filename: clean_name,
            relative_path: rel,
            modality: "component".to_string(),
            component_role: Some(role.to_string()),
            family: ModelFamily::PipelineComponent,
            repo_id: resolved_repo,
            explicit_override: true,
        };
    }

    if has_component_marker(&lower_name, "") {
        let role = infer_component_role(&clean_name, "");
        let rel = build_relative_path("component", Some(role), &clean_name);
        return DownloadRoutePlan {
            filename: clean_name,
            relative_path: rel,
            modality: "component".to_string(),
            component_role: Some(role.to_string()),
            family: ModelFamily::PipelineComponent,
            repo_id: resolved_repo,
            explicit_override: component_role_hint.is_some(),
        };
    }

    // 2. Explicit modality_hint
    if let Some(m_norm) = modality_hint.and_then(normalize_modality) {
        let (role, family) = match m_norm {
            "component" => {
                let r = infer_component_role(&clean_name, "");
                (Some(r.to_string()), ModelFamily::PipelineComponent)
            }
            "video" => (None, ModelFamily::DiffusionFlow),
            "image" => {
                let fam = if has_ar_image_marker(&lower_name, "") {
                    ModelFamily::AutoregressiveImage
                } else {
                    ModelFamily::DiffusionFlow
                };
                (None, fam)
            }
            "music" => (None, ModelFamily::DiffusionFlow),
            _ => (None, ModelFamily::TextLlm),
        };
        let rel = build_relative_path(m_norm, role.as_deref(), &clean_name);
        return DownloadRoutePlan {
            filename: clean_name,
            relative_path: rel,
            modality: m_norm.to_string(),
            component_role: role,
            family,
            repo_id: resolved_repo,
            explicit_override: true,
        };
    }

    // 3. HuggingFace metadata (client-provided tags/pipeline_tag + remote HF repo API/config lookup)
    let mut eff_pipeline_tag = pipeline_tag.map(|s| s.to_string());
    let mut eff_tags: Vec<String> = tags.map(|t| t.to_vec()).unwrap_or_default();
    let mut eff_class_name: Option<String> = None;

    if eff_pipeline_tag.is_none() || eff_tags.is_empty() {
        if let Some(ref repo) = resolved_repo {
            if let Some(hf_meta) = fetch_hf_routing_metadata(repo, hf_token).await {
                if eff_pipeline_tag.is_none() {
                    eff_pipeline_tag = hf_meta.pipeline_tag;
                }
                if eff_tags.is_empty() {
                    eff_tags = hf_meta.tags;
                }
                eff_class_name = hf_meta.class_name;
            }
        }
    }

    if let Some((modality, role_opt, family)) = classify_hf_signals(
        &clean_name,
        eff_pipeline_tag.as_deref(),
        &eff_tags,
        eff_class_name.as_deref(),
    ) {
        let rel = build_relative_path(modality, role_opt, &clean_name);
        return DownloadRoutePlan {
            filename: clean_name,
            relative_path: rel,
            modality: modality.to_string(),
            component_role: role_opt.map(|s| s.to_string()),
            family,
            repo_id: resolved_repo,
            explicit_override: false,
        };
    }

    // 4. Local filename/repo fallback heuristic
    let hint_subject = if let Some(ref repo) = resolved_repo {
        format!("{}/{}", repo, clean_name)
    } else {
        clean_name.clone()
    };
    let (modality, role_opt, family) = classify_model_entry(&hint_subject, &GgufMeta::default(), None);
    let rel = build_relative_path(&modality, role_opt.as_deref(), &clean_name);
    DownloadRoutePlan {
        filename: clean_name,
        relative_path: rel,
        modality,
        component_role: role_opt,
        family,
        repo_id: resolved_repo,
        explicit_override: false,
    }
}

/// Resolve the actual on-disk target path (or partial `.aria2` download) across root and canonical subfolders.
pub fn resolve_download_file_path(
    models_dir: &str,
    filename_or_rel: &str,
    manifest_rec: Option<&DownloadRecord>,
) -> PathBuf {
    let p = Path::new(filename_or_rel);
    if p.is_absolute() {
        return p.to_path_buf();
    }

    let root = Path::new(models_dir);
    let basename = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename_or_rel.to_string());

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(rec) = manifest_rec {
        if let Some(ref rp) = rec.relative_path {
            if !rp.is_empty() {
                candidates.push(root.join(rp));
            }
        }
    }
    if filename_or_rel.contains('/') || filename_or_rel.contains('\\') {
        candidates.push(root.join(filename_or_rel));
    }
    candidates.push(root.join(&basename));
    for folder in [
        "llm",
        "image",
        "video",
        "music",
        "components/vae",
        "components/encoders",
        "components/mmproj",
        "components/loras",
    ] {
        candidates.push(root.join(folder).join(&basename));
    }

    for cand in &candidates {
        let aria2 = PathBuf::from(format!("{}.aria2", cand.display()));
        if cand.exists() || aria2.exists() {
            return cand.clone();
        }
    }

    candidates.into_iter().next().unwrap_or_else(|| root.join(basename))
}

fn verify_gguf_route_and_relocate(
    models_dir: &str,
    dest: &Path,
    plan: &DownloadRoutePlan,
) -> (PathBuf, String, String, ModelFamily) {
    let mut final_dest = dest.to_path_buf();
    let mut final_rel = plan.relative_path.clone();
    let mut final_modality = plan.modality.clone();
    let mut final_family = plan.family.clone();

    if !plan.filename.to_lowercase().ends_with(".gguf") || !dest.exists() {
        return (final_dest, final_rel, final_modality, final_family);
    }

    let meta = inspect_gguf_metadata(dest);
    let arch_l = meta.architecture.to_lowercase();
    let gt = meta.general_type.as_deref().unwrap_or("").to_lowercase();

    let verified: Option<(&str, Option<&str>, ModelFamily)> = if gt == "mmproj" {
        Some(("component", Some("mmproj"), ModelFamily::PipelineComponent))
    } else if gt == "lora" {
        Some(("component", Some("loras"), ModelFamily::PipelineComponent))
    } else if arch_l == "t5encoder" || arch_l == "clip" {
        Some(("component", Some("encoders"), ModelFamily::PipelineComponent))
    } else if arch_l.contains("vae") || arch_l == "ae" {
        Some(("component", Some("vae"), ModelFamily::PipelineComponent))
    } else if !arch_l.is_empty() && arch_l != "unknown" {
        if has_video_marker(&plan.filename.to_lowercase(), &arch_l) && arch_l != "qwen3vl" {
            Some(("video", None, ModelFamily::DiffusionFlow))
        } else if is_explicit_llm_arch(&arch_l) {
            Some(("llm", None, ModelFamily::TextLlm))
        } else if has_ar_image_marker(&plan.filename.to_lowercase(), &arch_l) {
            Some(("image", None, ModelFamily::AutoregressiveImage))
        } else if has_image_diffusion_marker("", &arch_l) {
            Some(("image", None, ModelFamily::DiffusionFlow))
        } else {
            None
        }
    } else {
        None
    };

    if let Some((v_mod, v_role, v_fam)) = verified {
        let should_relocate = !plan.explicit_override || gt == "mmproj" || gt == "lora";
        if should_relocate && v_mod != final_modality {
            let new_rel = build_relative_path(v_mod, v_role, &plan.filename);
            let new_dest = PathBuf::from(models_dir).join(&new_rel);
            if !new_dest.exists() {
                if let Some(parent) = new_dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if std::fs::rename(dest, &new_dest).is_ok() {
                    tracing::info!(
                        "Verified GGUF architecture '{}' ({}) — relocated '{}' -> '{}'",
                        meta.architecture,
                        v_mod,
                        final_rel,
                        new_rel
                    );
                    final_dest = new_dest;
                    final_rel = new_rel;
                    final_modality = v_mod.to_string();
                    final_family = v_fam;
                }
            }
        }
    }

    (final_dest, final_rel, final_modality, final_family)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrganizeMoveItem {
    pub filename: String,
    pub from: String,
    pub to: String,
    pub modality: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_role: Option<String>,
    pub family: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrganizeResult {
    pub dry_run: bool,
    pub moved_count: usize,
    pub skipped_count: usize,
    pub moves: Vec<OrganizeMoveItem>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MoveModelResult {
    pub filename: String,
    pub from: String,
    pub to: String,
    pub path: String,
    pub modality: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_role: Option<String>,
    pub family: String,
}

fn move_file_preserving(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create target directory '{}': {}", parent.display(), e))?;
    }
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Fallback only if rename failed across mountpoints
            if e.raw_os_error() == Some(18) {
                std::fs::copy(src, dest)
                    .map_err(|ce| format!("Failed to copy '{}' to '{}': {}", src.display(), dest.display(), ce))?;
                std::fs::remove_file(src)
                    .map_err(|re| format!("Failed to remove source '{}' after copy: {}", src.display(), re))?;
                Ok(())
            } else {
                Err(format!("Failed to move '{}' to '{}': {}", src.display(), dest.display(), e))
            }
        }
    }
}

pub fn organize_root_models(models_dir: &str, dry_run: bool) -> Result<OrganizeResult, String> {
    let root = Path::new(models_dir);
    if !root.exists() {
        return Err(format!("Models directory does not exist: {}", models_dir));
    }

    let mut manifest = load_manifest(models_dir);
    let mut manifest_changed = false;
    let mut moves = Vec::new();
    let mut errors = Vec::new();
    let mut skipped_count = 0usize;

    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("Failed to read models directory '{}': {}", models_dir, e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if fname.starts_with('.') {
            continue;
        }
        let is_supported = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "gguf" | "safetensors" | "sft"))
            .unwrap_or(false);
        if !is_supported {
            continue;
        }
        let aria2_companion = PathBuf::from(format!("{}.aria2", path.display()));
        if aria2_companion.exists() {
            skipped_count += 1;
            continue;
        }

        let meta = match std::fs::metadata(&path) {
            Ok(fs_meta) => get_cached_model_metadata(
                &path,
                fs_meta.len(),
                fs_meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            ),
            Err(_) => GgufMeta::default(),
        };
        let manifest_rec = manifest.get(&fname);
        let (modality, component_role, family) = classify_model_entry(&fname, &meta, manifest_rec);
        let target_rel = build_relative_path(&modality, component_role.as_deref(), &fname);
        let dest = root.join(&target_rel);

        if dest == path {
            continue;
        }
        if dest.exists() {
            skipped_count += 1;
            errors.push(format!("Skipped '{}': target '{}' already exists", fname, target_rel));
            continue;
        }

        let fam_str = model_family_as_str(&family).to_string();
        if !dry_run {
            if let Err(e) = move_file_preserving(&path, &dest) {
                errors.push(e);
                continue;
            }
            if let Some(rec) = manifest.get_mut(&fname) {
                rec.relative_path = Some(target_rel.clone());
                rec.modality = Some(modality.clone());
                rec.family = Some(fam_str.clone());
                manifest_changed = true;
            }
        }

        moves.push(OrganizeMoveItem {
            filename: fname.clone(),
            from: fname,
            to: target_rel,
            modality,
            component_role,
            family: fam_str,
        });
    }

    if !dry_run && manifest_changed {
        save_manifest(models_dir, &manifest);
    }

    Ok(OrganizeResult {
        dry_run,
        moved_count: moves.len(),
        skipped_count,
        moves,
        errors,
    })
}

pub fn move_model_file(
    models_dir: &str,
    id_or_path: &str,
    target_modality: &str,
    component_role: Option<&str>,
) -> Result<MoveModelResult, String> {
    let root = Path::new(models_dir);
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("Invalid models directory '{}': {}", models_dir, e))?;

    let norm_modality = normalize_modality(target_modality)
        .ok_or_else(|| format!("Invalid target_modality '{}'; expected llm, image, video, music, or component", target_modality))?;

    let mut resolved_source: Option<PathBuf> = None;
    let candidate = Path::new(id_or_path);
    if candidate.is_absolute() && candidate.exists() {
        resolved_source = Some(candidate.to_path_buf());
    } else {
        let joined = root.join(id_or_path);
        if joined.exists() {
            resolved_source = Some(joined);
        } else {
            let local = list_local_models(models_dir);
            if let Some(found) = local.into_iter().find(|m| {
                m.relative_path.as_deref() == Some(id_or_path)
                    || m.name == id_or_path
                    || m.path == id_or_path
            }) {
                resolved_source = Some(PathBuf::from(found.path));
            }
        }
    }

    let source_path = resolved_source
        .ok_or_else(|| format!("Model '{}' not found under '{}'", id_or_path, models_dir))?;
    let canon_src = source_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve source '{}': {}", source_path.display(), e))?;
    if !canon_src.starts_with(&canon_root) {
        return Err(format!("Refusing to move file outside models directory: {}", source_path.display()));
    }
    if PathBuf::from(format!("{}.aria2", source_path.display())).exists() {
        return Err("Cannot move model while download is still active (.aria2 exists)".to_string());
    }

    let filename = source_path
        .file_name()
        .ok_or_else(|| "Invalid model filename".to_string())?
        .to_string_lossy()
        .to_string();
    let from_rel = source_path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| filename.clone());

    let fs_meta = std::fs::metadata(&source_path)
        .map_err(|e| format!("Failed to stat '{}': {}", source_path.display(), e))?;
    let parsed_meta = get_cached_model_metadata(
        &source_path,
        fs_meta.len(),
        fs_meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
    );

    let resolved_role: Option<String> = if norm_modality == "component" {
        let r = component_role
            .and_then(normalize_component_role)
            .unwrap_or_else(|| infer_component_role(&filename, &parsed_meta.architecture));
        Some(r.to_string())
    } else {
        None
    };

    let target_rel = build_relative_path(norm_modality, resolved_role.as_deref(), &filename);
    let dest_path = root.join(&target_rel);

    if dest_path != source_path {
        if dest_path.exists() {
            return Err(format!("Target path already exists: {}", target_rel));
        }
        move_file_preserving(&source_path, &dest_path)?;
    }

    let (_, _, family) = classify_model_entry(&target_rel, &parsed_meta, None);
    let fam_str = model_family_as_str(&family).to_string();

    let mut manifest = load_manifest(models_dir);
    if let Some(rec) = manifest.get_mut(&filename) {
        rec.relative_path = Some(target_rel.clone());
        rec.modality = Some(norm_modality.to_string());
        rec.family = Some(fam_str.clone());
        save_manifest(models_dir, &manifest);
    }

    Ok(MoveModelResult {
        filename,
        from: from_rel,
        to: target_rel,
        path: dest_path.to_string_lossy().to_string(),
        modality: norm_modality.to_string(),
        component_role: resolved_role,
        family: fam_str,
    })
}

/// Download a model file from a direct URL into its routed modality subfolder under `models_dir`.
/// Automatically utilizes aria2c with 16 parallel connections for maximum multi-channel throughput,
/// falling back to buffered Range-resuming HTTP streaming if aria2c is not available.
pub async fn download_model(
    url: &str,
    models_dir: &str,
    route: &DownloadRoutePlan,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    let dest = PathBuf::from(models_dir).join(&route.relative_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await
            .map_err(|e| format!("Failed to create target model dir: {}", e))?;
    }

    // Check if aria2c is available for 16-channel parallel acceleration
    let has_aria2 = tokio::process::Command::new("which")
        .arg("aria2c")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    if has_aria2 {
        tracing::info!("Accelerating download for {} ({}) using production aria2c 16-channel streaming", route.filename, route.relative_path);
        match download_with_aria2(url, models_dir, route, hf_token, use_mirror, progress_tx.clone()).await {
            Ok(p) => return Ok(p),
            Err(e) => {
                tracing::warn!("aria2c failed ({}), falling back to buffered stream...", e);
            }
        }
    }

    download_with_reqwest(url, models_dir, route, hf_token, use_mirror, progress_tx).await
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
    route: &DownloadRoutePlan,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use std::process::Stdio;

    let dest = PathBuf::from(models_dir).join(&route.relative_path);
    let dest_dir = dest.parent().unwrap_or_else(|| Path::new(models_dir));
    tokio::fs::create_dir_all(dest_dir)
        .await
        .map_err(|e| format!("Failed to create target dir '{}': {}", dest_dir.display(), e))?;

    let fam_str = model_family_as_str(&route.family);
    update_manifest_entry_with_meta(
        models_dir,
        &route.filename,
        url,
        0,
        "downloading",
        Some(&route.relative_path),
        Some(&route.modality),
        Some(fam_str),
        route.repo_id.as_deref(),
    );

    let target_url = if use_mirror && url.contains("huggingface.co") {
        url.replace("https://huggingface.co", "https://hf-mirror.com")
    } else {
        url.to_string()
    };

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
        .arg("--stream-piece-selector=geom")
        .arg("--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .arg("--auto-file-renaming=false")
        .arg("--allow-overwrite=true")
        .arg("--console-log-level=notice")
        .arg("-d").arg(dest_dir)
        .arg("-o").arg(&route.filename);

    if let Some(tok) = hf_token {
        let t = tok.trim();
        if !t.is_empty() {
            cmd.arg(format!("--header=Authorization: Bearer {}", t));
        }
    }

    cmd.arg(&target_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn aria2c: {}", e))?;

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture aria2c stdout".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    let mut total_bytes: u64 = 0;
    let mut downloaded_bytes: u64 = 0;

    while let Ok(Some(line)) = reader.next_line().await {
        let trimmed = line.trim();
        if trimmed.starts_with("[#") && trimmed.contains('/') {
            if let Some((dl_b, tot_b, pct, spd_str, spd_bps, eta_s)) = parse_aria2_progress(trimmed) {
                downloaded_bytes = dl_b;
                if tot_b > 0 {
                    total_bytes = tot_b;
                }

                if let Some(ref tx) = progress_tx {
                    let _ = tx.send(DownloadProgress {
                        model_name: route.filename.clone(),
                        downloaded_bytes,
                        total_bytes,
                        percent: pct,
                        speed_bytes_per_sec: Some(spd_bps),
                        speed_display: Some(spd_str),
                        eta_seconds: eta_s,
                        status: "downloading".to_string(),
                        url: Some(url.to_string()),
                        relative_path: Some(route.relative_path.clone()),
                        modality: Some(route.modality.clone()),
                    });
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("aria2c process error: {}", e))?;
    if !status.success() {
        return Err(format!("aria2c exited with code {:?}", status.code()));
    }

    let aria2_companion = PathBuf::from(format!("{}.aria2", dest.display()));
    if aria2_companion.exists() {
        return Err("Download incomplete: aria2 control file (.aria2) still exists".to_string());
    }

    let (final_dest, final_rel, final_modality, final_family) =
        verify_gguf_route_and_relocate(models_dir, &dest, route);

    let final_size = if final_dest.exists() {
        tokio::fs::metadata(&final_dest).await.map(|m| m.len()).unwrap_or(downloaded_bytes)
    } else {
        downloaded_bytes
    };

    update_manifest_entry_with_meta(
        models_dir,
        &route.filename,
        url,
        final_size,
        "finished",
        Some(&final_rel),
        Some(&final_modality),
        Some(model_family_as_str(&final_family)),
        route.repo_id.as_deref(),
    );

    if let Some(ref tx) = progress_tx {
        let _ = tx.send(DownloadProgress {
            model_name: route.filename.clone(),
            downloaded_bytes: final_size,
            total_bytes: final_size,
            percent: 100.0,
            speed_bytes_per_sec: None,
            speed_display: None,
            eta_seconds: None,
            status: "finished".to_string(),
            url: Some(url.to_string()),
            relative_path: Some(final_rel),
            modality: Some(final_modality),
        });
    }

    tracing::info!("Multi-channel download completed: {} ({})", route.filename, format_size(final_size));
    Ok(final_dest.to_string_lossy().to_string())
}

async fn download_with_reqwest(
    url: &str,
    models_dir: &str,
    route: &DownloadRoutePlan,
    hf_token: Option<&str>,
    use_mirror: bool,
    progress_tx: Option<tokio::sync::watch::Sender<DownloadProgress>>,
) -> Result<String, String> {
    let dest = PathBuf::from(models_dir).join(&route.relative_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create target dir '{}': {}", parent.display(), e))?;
    }
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
    let fam_str = model_family_as_str(&route.family);

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
            tracing::info!("Resuming download of {} from byte {}", route.filename, existing_size);
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
            update_manifest_entry_with_meta(
                models_dir,
                &route.filename,
                url,
                total_bytes,
                "downloading",
                Some(&route.relative_path),
                Some(&route.modality),
                Some(fam_str),
                route.repo_id.as_deref(),
            );
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
                        let current_speed = smoothed_speed.round() as u64;

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
                                model_name: route.filename.clone(),
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
                                relative_path: Some(route.relative_path.clone()),
                                modality: Some(route.modality.clone()),
                            });
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Stream chunk error for {}: {}, attempting auto-resume...", route.filename, e);
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
            tracing::info!("Auto-resuming download ({}/{}) for {}", retries, MAX_RETRIES, route.filename);
            tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        } else {
            return Err(format!("Download stream interrupted after {} retry attempts", MAX_RETRIES));
        }
    }

    let (final_dest, final_rel, final_modality, final_family) =
        verify_gguf_route_and_relocate(models_dir, &dest, route);
    let final_size = if final_dest.exists() {
        tokio::fs::metadata(&final_dest).await.map(|m| m.len()).unwrap_or(total_bytes)
    } else {
        total_bytes
    };

    update_manifest_entry_with_meta(
        models_dir,
        &route.filename,
        url,
        final_size,
        "finished",
        Some(&final_rel),
        Some(&final_modality),
        Some(model_family_as_str(&final_family)),
        route.repo_id.as_deref(),
    );

    if let Some(ref tx) = progress_tx {
        let _ = tx.send(DownloadProgress {
            model_name: route.filename.clone(),
            downloaded_bytes: final_size,
            total_bytes: final_size,
            percent: 100.0,
            speed_bytes_per_sec: None,
            speed_display: None,
            eta_seconds: None,
            status: "finished".to_string(),
            url: Some(url.to_string()),
            relative_path: Some(final_rel),
            modality: Some(final_modality),
        });
    }

    tracing::info!("Download complete: {} ({})", route.filename, format_size(final_size));
    Ok(final_dest.to_string_lossy().to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn push_gguf_str(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u64).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    fn build_synthetic_gguf(kvs: Vec<(&str, u32, Vec<u8>)>, tensor_names: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"GGUF");
        buf.extend_from_slice(&3u32.to_le_bytes());
        buf.extend_from_slice(&(tensor_names.len() as u64).to_le_bytes());
        buf.extend_from_slice(&(kvs.len() as u64).to_le_bytes());
        for (k, vtype, vbytes) in kvs {
            push_gguf_str(&mut buf, k);
            buf.extend_from_slice(&vtype.to_le_bytes());
            buf.extend_from_slice(&vbytes);
        }
        for tname in tensor_names {
            push_gguf_str(&mut buf, tname);
            buf.extend_from_slice(&1u32.to_le_bytes()); // n_dims = 1
            buf.extend_from_slice(&4u64.to_le_bytes()); // dim[0]
            buf.extend_from_slice(&0u32.to_le_bytes()); // type
            buf.extend_from_slice(&0u64.to_le_bytes()); // offset
        }
        buf
    }

    fn kv_str(s: &str) -> Vec<u8> {
        let mut b = Vec::new();
        push_gguf_str(&mut b, s);
        b
    }

    #[test]
    fn directory_first_classification_is_authoritative() {
        let mut meta = GgufMeta::default();
        meta.architecture = "llama".to_string();

        let (m, r, f) = classify_model_entry("video/unusual_model_name.gguf", &meta, None);
        assert_eq!(m, "video");
        assert_eq!(r, None);
        assert_eq!(f, ModelFamily::DiffusionFlow);

        let (m2, r2, f2) = classify_model_entry("components/vae/ae.safetensors", &GgufMeta::default(), None);
        assert_eq!(m2, "component");
        assert_eq!(r2.as_deref(), Some("vae"));
        assert_eq!(f2, ModelFamily::PipelineComponent);

        let (m3, r3, f3) = classify_model_entry("image/custom.gguf", &GgufMeta::default(), None);
        assert_eq!(m3, "image");
        assert_eq!(r3, None);
        assert_eq!(f3, ModelFamily::DiffusionFlow);
    }

    #[test]
    fn gguf_parser_reads_past_tokenizer_and_extracts_tensor_blocks_without_faking_defaults() {
        let dir = std::env::temp_dir().join(format!("exovon_models_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);

        // 1. Test LLM GGUF where tokenizer array comes BEFORE architecture block/context count
        let mut arr_bytes = Vec::new();
        arr_bytes.extend_from_slice(&8u32.to_le_bytes()); // element type STRING = 8
        arr_bytes.extend_from_slice(&2u64.to_le_bytes()); // count = 2
        push_gguf_str(&mut arr_bytes, "tok0");
        push_gguf_str(&mut arr_bytes, "tok1");

        let llm_bytes = build_synthetic_gguf(
            vec![
                ("general.architecture", 8, kv_str("qwen3vl")),
                ("tokenizer.ggml.tokens", 9, arr_bytes),
                ("qwen3vl.block_count", 4, 36u32.to_le_bytes().to_vec()),
                ("qwen3vl.context_length", 4, 262144u32.to_le_bytes().to_vec()),
            ],
            &[],
        );
        let llm_path = dir.join("qwen3vl_test.gguf");
        std::fs::write(&llm_path, &llm_bytes).unwrap();
        let llm_meta = inspect_gguf_metadata(&llm_path);
        assert_eq!(llm_meta.architecture, "qwen3vl");
        assert_eq!(llm_meta.total_layers, Some(37)); // 36 transformer blocks + 1 output layer
        assert_eq!(llm_meta.max_context_length, Some(262144));

        // 2. Test Flux GGUF with 0 context KV and tensor block names
        let flux_bytes = build_synthetic_gguf(
            vec![],
            &[
                "double_blocks.0.img_attn.weight",
                "double_blocks.18.txt_mlp.weight",
                "single_blocks.0.linear1.weight",
                "single_blocks.37.linear2.weight",
            ],
        );
        let flux_path = dir.join("flux_test.gguf");
        std::fs::write(&flux_path, &flux_bytes).unwrap();
        let flux_meta = inspect_gguf_metadata(&flux_path);
        assert_eq!(flux_meta.max_context_length, None);
        assert_eq!(flux_meta.total_layers, Some(57)); // 19 double + 38 single

        // 3. Test Safetensors header parsing without fake 8192/32 defaults
        let st_json = br#"{"blocks.0.attn.weight":{"dtype":"BF16","shape":[16],"data_offsets":[0,32]},"blocks.29.mlp.weight":{"dtype":"BF16","shape":[16],"data_offsets":[32,64]}}"#;
        let mut st_buf = Vec::new();
        st_buf.extend_from_slice(&(st_json.len() as u64).to_le_bytes());
        st_buf.extend_from_slice(st_json);
        let st_path = dir.join("wan_test.safetensors");
        std::fs::write(&st_path, &st_buf).unwrap();
        let st_meta = inspect_safetensors_metadata(&st_path);
        assert_eq!(st_meta.max_context_length, None);
        assert_eq!(st_meta.total_layers, Some(30));

        // 4. Test organize_root_models (dry_run + real) + move_model_file
        let dry = organize_root_models(dir.to_str().unwrap(), true).unwrap();
        assert_eq!(dry.moved_count, 3);
        assert!(llm_path.exists());

        let applied = organize_root_models(dir.to_str().unwrap(), false).unwrap();
        assert_eq!(applied.moved_count, 3);
        assert!(dir.join("llm/qwen3vl_test.gguf").exists());
        assert!(dir.join("image/flux_test.gguf").exists());
        assert!(dir.join("video/wan_test.safetensors").exists());

        let mv = move_model_file(dir.to_str().unwrap(), "qwen3vl_test.gguf", "component", Some("encoders")).unwrap();
        assert_eq!(mv.to, "components/encoders/qwen3vl_test.gguf");
        assert!(dir.join("components/encoders/qwen3vl_test.gguf").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repo_extraction_and_hf_classification_work() {
        assert_eq!(
            extract_repo_id_from_url("https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf").as_deref(),
            Some("QuantStack/Wan2.2-TI2V-5B-GGUF")
        );
        let (m, _, f) = classify_hf_signals("model.gguf", Some("text-to-video"), &[], None).unwrap();
        assert_eq!(m, "video");
        assert_eq!(f, ModelFamily::DiffusionFlow);
    }
}



