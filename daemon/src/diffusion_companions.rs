// =============================================================================
// Diffusion Pipeline Companion Scanner (VAE, CLIP, UMT5/T5XXL, LLM, LoRA)
// =============================================================================

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::AppState;

pub struct ResolvedCompanions {
    pub vae: Option<PathBuf>,
    pub clip: Option<PathBuf>,
    pub t5: Option<PathBuf>,
    pub llm_encoder: Option<PathBuf>,
    pub lora_dir: PathBuf,
    pub lora_name: Option<String>,
}

pub async fn collect_downloading_files(state: &AppState) -> HashSet<String> {
    let dl = state.active_downloads.read().await;
    dl.values()
        .filter(|d| d.status == "downloading" || d.status == "starting" || d.status == "paused")
        .map(|d| d.model_name.to_lowercase())
        .collect()
}

pub fn is_incomplete_model_file(p: &Path, downloading_files: &HashSet<String>) -> bool {
    let fname = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    downloading_files.contains(&fname)
        || PathBuf::from(format!("{}.aria2", p.display())).exists()
        || fname.ends_with(".part")
        || fname.ends_with(".tmp")
        || fname.ends_with(".crdownload")
}

fn is_model_weight_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_lowercase().as_str(), "gguf" | "safetensors" | "sft"))
        .unwrap_or(false)
}

fn walk_completed_model_files(dir: &Path, downloading_files: &HashSet<String>, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 || !dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut items: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        items.sort();
        for path in items {
            let fname = path.file_name().unwrap_or_default().to_string_lossy();
            if fname.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk_completed_model_files(&path, downloading_files, out, depth + 1);
            } else if is_model_weight_ext(&path) && !is_incomplete_model_file(&path, downloading_files) {
                out.push(path);
            }
        }
    }
}

fn collect_root_model_files(dir: &Path, downloading_files: &HashSet<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut items: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        items.sort();
        for path in items {
            if !path.is_file() {
                continue;
            }
            let fname = path.file_name().unwrap_or_default().to_string_lossy();
            if !fname.starts_with('.') && is_model_weight_ext(&path) && !is_incomplete_model_file(&path, downloading_files) {
                out.push(path);
            }
        }
    }
    out
}

fn find_exact_name(pool: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .find_map(|target| {
            pool.iter().find(|p| {
                p.file_name()
                    .map(|f| f.to_string_lossy().eq_ignore_ascii_case(target))
                    .unwrap_or(false)
            })
        })
        .cloned()
}

pub fn resolve_explicit_component_path(
    models_dir: &str,
    explicit: Option<&str>,
    search_pool: &[PathBuf],
    downloading_files: &HashSet<String>,
) -> Option<Option<PathBuf>> {
    match explicit {
        Some("none") => Some(None),
        Some(v) if v != "auto" && !v.trim().is_empty() => {
            let p = Path::new(v.trim());
            if p.is_absolute() && p.exists() && !is_incomplete_model_file(p, downloading_files) {
                return Some(Some(p.to_path_buf()));
            }
            let direct = Path::new(models_dir).join(v.trim());
            if direct.exists() && !is_incomplete_model_file(&direct, downloading_files) {
                return Some(Some(direct));
            }
            if let Some(fname) = p.file_name().map(|s| s.to_string_lossy().to_lowercase()) {
                if let Some(found) = search_pool.iter().find(|cand| {
                    cand.file_name()
                        .map(|f| f.to_string_lossy().to_lowercase() == fname)
                        .unwrap_or(false)
                }) {
                    return Some(Some(found.clone()));
                }
            }
            Some(None)
        }
        _ => None,
    }
}

pub fn resolve_pipeline_companions(
    models_dir: &str,
    resolved_model: &Path,
    vae_explicit: Option<&str>,
    clip_explicit: Option<&str>,
    t5_explicit: Option<&str>,
    lora_explicit: Option<&str>,
    is_video: bool,
    downloading_files: &HashSet<String>,
) -> ResolvedCompanions {
    let root = Path::new(models_dir);
    let model_name_lower = resolved_model.file_name().unwrap_or_default().to_string_lossy().to_lowercase();

    let mut component_files = Vec::new();
    walk_completed_model_files(&root.join("components"), downloading_files, &mut component_files, 0);
    let root_files = collect_root_model_files(root, downloading_files);
    let mut llm_files = Vec::new();
    walk_completed_model_files(&root.join("llm"), downloading_files, &mut llm_files, 0);

    let mut search_pool = Vec::with_capacity(component_files.len() + root_files.len());
    search_pool.extend(component_files.iter().cloned());
    search_pool.extend(root_files.iter().cloned());
    let mut full_pool = search_pool.clone();
    full_pool.extend(llm_files.iter().cloned());

    let vae = if let Some(explicit_res) =
        resolve_explicit_component_path(models_dir, vae_explicit, &search_pool, downloading_files)
    {
        explicit_res
    } else if is_video || model_name_lower.contains("wan") {
        search_pool
            .iter()
            .find(|p| {
                let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                n.contains("wan") && n.contains("vae")
            })
            .cloned()
            .or_else(|| find_exact_name(&search_pool, &["vae.safetensors", "vae.gguf", "ae.safetensors", "ae.gguf"]))
    } else if model_name_lower.contains("qwen") {
        find_exact_name(
            &search_pool,
            &["qwen_image_2.1_vae_bf16.safetensors", "qwen_vae.safetensors", "qwen_vae.gguf", "ae.safetensors"],
        )
        .or_else(|| {
            search_pool
                .iter()
                .find(|p| {
                    let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    n.contains("qwen") && n.contains("vae")
                })
                .cloned()
        })
    } else {
        find_exact_name(&search_pool, &["ae.safetensors", "ae.gguf", "vae.safetensors", "vae.gguf"])
    };

    let clip = if let Some(explicit_res) =
        resolve_explicit_component_path(models_dir, clip_explicit, &search_pool, downloading_files)
    {
        explicit_res
    } else {
        find_exact_name(&search_pool, &["clip_l.safetensors", "clip_l.gguf", "clip-l.safetensors", "clip-l.gguf"])
    };

    let t5 = if let Some(explicit_res) =
        resolve_explicit_component_path(models_dir, t5_explicit, &search_pool, downloading_files)
    {
        explicit_res
    } else if is_video || model_name_lower.contains("wan") {
        search_pool
            .iter()
            .find(|p| p.file_name().unwrap_or_default().to_string_lossy().to_lowercase().contains("umt5"))
            .cloned()
            .or_else(|| {
                search_pool
                    .iter()
                    .find(|p| {
                        let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                        n.contains("t5") && n.contains("xxl")
                    })
                    .cloned()
            })
    } else if model_name_lower.contains("flux") {
        search_pool
            .iter()
            .find(|p| {
                let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                n.contains("t5") && n.contains("xxl") && !n.contains("umt5")
            })
            .cloned()
    } else {
        search_pool
            .iter()
            .find(|p| {
                let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                n.contains("t5") && n.contains("xxl")
            })
            .cloned()
    };

    let llm_encoder = full_pool
        .iter()
        .find(|p| {
            if *p == resolved_model {
                return false;
            }
            let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            n.contains("qwen") && (n.contains("encoder") || n.contains("uncensored") || n.contains("vl"))
        })
        .cloned();

    let components_loras_dir = root.join("components").join("loras");
    let mut lora_dir = if components_loras_dir.is_dir()
        && std::fs::read_dir(&components_loras_dir).map(|mut d| d.next().is_some()).unwrap_or(false)
    {
        components_loras_dir
    } else {
        root.to_path_buf()
    };
    let mut lora_name: Option<String> = None;

    if let Some(lora_raw) = lora_explicit {
        let lora = lora_raw.trim();
        if lora != "none" && !lora.is_empty() {
            if let Some(Some(resolved_lora)) =
                resolve_explicit_component_path(models_dir, Some(lora), &search_pool, downloading_files)
            {
                if let Some(parent) = resolved_lora.parent() {
                    lora_dir = parent.to_path_buf();
                }
                lora_name = resolved_lora.file_stem().map(|s| s.to_string_lossy().to_string());
            } else {
                lora_name = Path::new(lora).file_stem().map(|s| s.to_string_lossy().to_string());
            }
        }
    }

    ResolvedCompanions { vae, clip, t5, llm_encoder, lora_dir, lora_name }
}
