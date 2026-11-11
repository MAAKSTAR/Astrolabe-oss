// =============================================================================
// Diffusion Common DTOs, CLI Builders, Base64 & Prompt Utilities
// =============================================================================

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct ImageGenerationRequest {
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default)]
    pub cfg_scale: Option<f32>,
    #[serde(default)]
    pub clip_path: Option<String>,
    #[serde(default)]
    pub vae_path: Option<String>,
    #[serde(default)]
    pub t5_path: Option<String>,
    #[serde(default)]
    pub lora_path: Option<String>,
    #[serde(default)]
    pub lora_scale: Option<f32>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default)]
    pub strength: Option<f32>,
    #[serde(default, alias = "diffusionFlashAttn", alias = "flashAttn", alias = "flash_attn")]
    pub diffusion_flash_attn: Option<String>,
    #[serde(default, alias = "timeoutSecs")]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct ImageEditRequest {
    pub prompt: String,
    pub image: String,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default)]
    pub cfg_scale: Option<f32>,
    #[serde(default)]
    pub strength: Option<f32>,
    #[serde(default, alias = "diffusionFlashAttn", alias = "flashAttn", alias = "flash_attn")]
    pub diffusion_flash_attn: Option<String>,
    #[serde(default, alias = "timeoutSecs")]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageGenerationResponse {
    pub created: u64,
    pub data: Vec<ImageData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageData {
    pub b64_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revised_prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VideoGenerationRequest {
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default, alias = "cfgScale")]
    pub cfg_scale: Option<f32>,
    #[serde(default)]
    pub sampler: Option<String>,
    #[serde(default, alias = "videoFrames")]
    pub video_frames: Option<u32>,
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default, alias = "flowShift")]
    pub flow_shift: Option<f32>,
    #[serde(default, alias = "vaeTiling")]
    pub vae_tiling: Option<bool>,
    #[serde(default, alias = "temporalTiling")]
    pub temporal_tiling: Option<bool>,
    #[serde(default, alias = "offloadToCpu")]
    pub offload_to_cpu: Option<bool>,
    #[serde(default, alias = "diffusionFlashAttn", alias = "flashAttn", alias = "flash_attn")]
    pub diffusion_flash_attn: Option<String>,
    #[serde(default, alias = "clipPath")]
    pub clip_path: Option<String>,
    #[serde(default, alias = "vaePath")]
    pub vae_path: Option<String>,
    #[serde(default, alias = "t5Path")]
    pub t5_path: Option<String>,
    #[serde(default, alias = "loraPath")]
    pub lora_path: Option<String>,
    #[serde(default, alias = "loraScale")]
    pub lora_scale: Option<f32>,
    #[serde(default, alias = "initImage", alias = "image")]
    pub init_image: Option<String>,
    #[serde(default, alias = "endImage")]
    pub end_image: Option<String>,
    #[serde(default, alias = "timeoutSecs")]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoGenerationResponse {
    pub created: u64,
    pub data: Vec<VideoData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoData {
    pub b64_json: String,
    pub file_path: String,
    pub mime_type: String,
    pub ext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revised_prompt: Option<String>,
}

pub struct TempFileGuard(pub Vec<PathBuf>);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

pub fn find_sd_cli_binary() -> Option<PathBuf> {
    let bin = if cfg!(windows) { "sd-cli.exe" } else { "sd-cli" };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("sd").join(bin));
            candidates.push(parent.join(bin));
            candidates.push(parent.join("bin").join(bin));
        }
    }
    candidates.push(PathBuf::from("daemon/bin/sd").join(bin));
    candidates.push(PathBuf::from("daemon/bin").join(bin));
    candidates.push(PathBuf::from("bin").join(bin));

    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let home_path = PathBuf::from(&home);
        candidates.push(home_path.join(".local/share/astrolabe/resources/app/daemon/sd").join(bin));
        candidates.push(home_path.join(".local/share/astrolabe/resources/app/daemon").join(bin));
        candidates.push(home_path.join(".local/share/astrolabe/daemon/sd").join(bin));
        candidates.push(home_path.join(".local/share/astrolabe/daemon").join(bin));
        candidates.push(home_path.join(".local/share/astrolabe/bin").join(bin));
        candidates.push(home_path.join("AppData/Local/astrolabe/daemon/sd").join(bin));
    }

    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            candidates.push(Path::new(dir).join(bin));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    let bin = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let direct = Path::new("/usr/bin/ffmpeg");
    if direct.is_file() {
        return Some(direct.to_path_buf());
    }
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(sep) {
            let cand = Path::new(dir).join(bin);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let (b0, b1, b2) = (chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0));
        out.push(B64_CHARS[(b0 >> 2) as usize] as char);
        out.push(B64_CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { B64_CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64_CHARS[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if clean.is_empty() {
        return Some(Vec::new());
    }
    let decode_char = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let c0 = decode_char(chunk[0])?;
        let c1 = if chunk.len() > 1 { decode_char(chunk[1])? } else { 0 };
        let c2 = if chunk.len() > 2 && chunk[2] != b'=' { decode_char(chunk[2])? } else { 0 };
        let c3 = if chunk.len() > 3 && chunk[3] != b'=' { decode_char(chunk[3])? } else { 0 };
        out.push((c0 << 2) | (c1 >> 4));
        if chunk.len() > 2 && chunk[2] != b'=' {
            out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
        }
        if chunk.len() > 3 && chunk[3] != b'=' {
            out.push(((c2 & 0x03) << 6) | c3);
        }
    }
    Some(out)
}

pub fn resolve_image_input(input: &str, prefix: &str) -> Result<(PathBuf, bool), String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Image input is empty".to_string());
    }
    let path = Path::new(input);
    if path.is_absolute() && path.exists() {
        return Ok((path.to_path_buf(), false));
    }
    let b64_data = if let Some(idx) = input.find(";base64,") {
        &input[idx + ";base64,".len()..]
    } else if input.starts_with("data:image/") {
        input.find(',').map_or(input, |idx| &input[idx + 1..])
    } else {
        input
    };
    if let Some(bytes) = base64_decode(b64_data).filter(|b| !b.is_empty()) {
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let tmp_path = std::env::temp_dir().join(format!("astrolabe_{}_{}_{}.png", prefix, std::process::id(), now_ms));
        if std::fs::write(&tmp_path, &bytes).is_ok() {
            return Ok((tmp_path, true));
        }
    }
    if path.exists() {
        return Ok((path.to_path_buf(), false));
    }
    Err(format!("Could not resolve image input from '{}'", if input.len() > 60 { &input[..60] } else { input }))
}

pub fn sanitize_generation_prompt(raw: &str) -> Result<String, (StatusCode, String)> {
    let mut prompt = raw.trim().to_string();
    if prompt.contains("You are a project memory summarizer") || prompt.contains("Review the following transcript") {
        return Err((StatusCode::BAD_REQUEST, "Ignoring background summarizer prompt for diffusion".to_string()));
    }
    if let Some(idx) = prompt.find("Developer Action Request:") {
        let mut extracted = prompt[idx + "Developer Action Request:".len()..].trim();
        if ((extracted.starts_with('"') && extracted.ends_with('"')) || (extracted.starts_with('\'') && extracted.ends_with('\''))) && extracted.len() >= 2 {
            extracted = &extracted[1..extracted.len() - 1];
        }
        prompt = extracted.trim().to_string();
    }
    while let Some(start) = prompt.find("[IDE WORKSPACE ACTIVE CONTEXT]") {
        if let Some(end) = prompt[start..].find("[/IDE WORKSPACE ACTIVE CONTEXT]") {
            prompt.replace_range(start..start + end + "[/IDE WORKSPACE ACTIVE CONTEXT]".len(), "");
        } else {
            prompt.truncate(start);
            break;
        }
    }
    let cleaned = prompt.trim().to_string();
    if cleaned.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Prompt cannot be empty".to_string()));
    }
    Ok(cleaned)
}

pub fn apply_sd_sampler_arg(cmd: &mut tokio::process::Command, sampler: Option<&str>, is_flow_model: bool) {
    if let Some(s) = sampler {
        let s_lower = s.to_lowercase();
        if s_lower.contains("euler_a") || s_lower.contains("euler a") {
            cmd.arg("--sampling-method").arg(if is_flow_model { "euler" } else { "euler_a" });
        } else if s_lower.contains("euler") {
            cmd.arg("--sampling-method").arg("euler");
        } else if s_lower.contains("dpm++ 2m") || s_lower.contains("dpm++2m") {
            cmd.arg("--sampling-method").arg("dpm++2m");
        } else if !s_lower.trim().is_empty() {
            cmd.arg("--sampling-method").arg(s.trim());
        }
    } else if is_flow_model {
        cmd.arg("--sampling-method").arg("euler");
    }
}

pub fn normalize_sd_flash_attn(raw: Option<&str>) -> &'static str {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("on") | Some("true") | Some("1") | Some("enabled") => "on",
        Some("off") | Some("false") | Some("0") | Some("disabled") => "off",
        _ => "auto",
    }
}

pub fn sd_flash_attn_cli_value(raw: Option<&str>) -> Option<&'static str> {
    match normalize_sd_flash_attn(raw) {
        "on" => Some("on"),
        "off" => Some("off"),
        _ => None,
    }
}

pub fn apply_sd_flash_attn_arg(cmd: &mut tokio::process::Command, mode: Option<&str>) {
    if let Some(val) = sd_flash_attn_cli_value(mode) {
        cmd.arg("--flash-attn").arg(val);
    }
}

pub fn format_sd_cli_failure(stderr: &str, exit_code: Option<i32>, default_missing_hint: &str) -> String {
    let relevant_err = stderr
        .lines()
        .filter(|l| l.contains("[E]") || l.contains("[W]") || l.contains("ASSERT") || l.contains("failed") || l.contains("error"))
        .take(5)
        .collect::<Vec<_>>()
        .join(" | ");
    if relevant_err.contains("t5xxl") || relevant_err.contains("conditioner") {
        default_missing_hint.to_string()
    } else if !relevant_err.is_empty() {
        format!("sd-cli execution failed: {}", relevant_err)
    } else {
        format!("sd-cli process exited with code {:?}", exit_code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sd_flash_attn_cli_value_defaults_to_none_for_auto() {
        assert_eq!(sd_flash_attn_cli_value(None), None);
        assert_eq!(sd_flash_attn_cli_value(Some("auto")), None);
        assert_eq!(sd_flash_attn_cli_value(Some("  AUTO ")), None);
        assert_eq!(sd_flash_attn_cli_value(Some("unknown")), None);
        assert_eq!(sd_flash_attn_cli_value(Some("on")), Some("on"));
        assert_eq!(sd_flash_attn_cli_value(Some("true")), Some("on"));
        assert_eq!(sd_flash_attn_cli_value(Some("off")), Some("off"));
        assert_eq!(sd_flash_attn_cli_value(Some("false")), Some("off"));
    }

    #[test]
    fn test_video_generation_request_accepts_flash_attn_aliases() {
        let req1: VideoGenerationRequest =
            serde_json::from_str(r#"{"prompt":"test","diffusionFlashAttn":"off","timeoutSecs":0}"#).unwrap();
        assert_eq!(req1.diffusion_flash_attn.as_deref(), Some("off"));
        assert_eq!(req1.timeout_secs, Some(0));

        let req2: VideoGenerationRequest =
            serde_json::from_str(r#"{"prompt":"test","flashAttn":"on"}"#).unwrap();
        assert_eq!(req2.diffusion_flash_attn.as_deref(), Some("on"));
    }
}
