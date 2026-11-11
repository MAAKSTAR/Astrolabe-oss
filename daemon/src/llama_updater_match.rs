// =============================================================================
// llama.cpp Release Matching & Version Parsing
// =============================================================================

use serde::Deserialize;

use crate::hardware::HardwareInfo;

#[derive(Debug, Clone, Deserialize)]
pub struct GhAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhRelease {
    pub tag_name: String,
    pub html_url: String,
    pub body: Option<String>,
    #[serde(default)]
    pub assets: Vec<GhAsset>,
}

/// Extract numeric build id from `llama-server --version` stdout/stderr
/// (e.g. `"version: 0.9.0-dev (build 12255, commit 940a30ee3)"` -> `Some(12255)`).
pub fn parse_llama_build_number(version_output: &str) -> Option<u64> {
    let lower = version_output.to_ascii_lowercase();
    if let Some(idx) = lower.find("build ") {
        let rest = &lower[idx + 6..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u64>() {
            return Some(n);
        }
    }
    for token in lower.split_whitespace() {
        let trimmed = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        if let Some(num_str) = trimmed.strip_prefix('b') {
            if !num_str.is_empty() && num_str.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = num_str.parse::<u64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

/// Parse upstream tag such as `"b12283"` -> `Some(12283)`.
pub fn parse_release_tag_build(tag: &str) -> Option<u64> {
    let digits = tag.trim().strip_prefix('b')?;
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u64>().ok()
}

/// Determine platform/backend label and ordered release asset substring preferences.
pub fn select_platform_patterns(os: &str, arch: &str, hw: &HardwareInfo) -> (&'static str, Vec<&'static str>) {
    let gpu_lower = hw.gpu_description.to_ascii_lowercase();
    let backend_lower = hw.backend_recommendation.to_ascii_lowercase();
    let has_discrete_or_igpu =
        gpu_lower != "cpu only" && !gpu_lower.is_empty() && !gpu_lower.contains("unknown");

    match (os, arch) {
        ("linux", "x86_64") => {
            if hw.has_nvidia {
                ("linux-cuda-x64", vec!["-bin-ubuntu-cuda-", "-bin-ubuntu-vulkan-x64.tar.gz", "-bin-ubuntu-x64.tar.gz"])
            } else if backend_lower.contains("rocm") {
                ("linux-rocm-x64", vec!["-bin-ubuntu-rocm-", "-bin-ubuntu-vulkan-x64.tar.gz", "-bin-ubuntu-x64.tar.gz"])
            } else if has_discrete_or_igpu || backend_lower.contains("vulkan") {
                ("linux-vulkan-x64", vec!["-bin-ubuntu-vulkan-x64.tar.gz", "-bin-ubuntu-x64.tar.gz"])
            } else {
                ("linux-cpu-x64", vec!["-bin-ubuntu-x64.tar.gz"])
            }
        }
        ("linux", "aarch64") => ("linux-arm64", vec!["-bin-ubuntu-arm64.tar.gz", "-bin-linux-arm64.tar.gz"]),
        ("windows", "x86_64") => {
            if hw.has_nvidia {
                ("win-cuda-x64", vec!["-bin-win-cuda-", "-bin-win-vulkan-x64.zip", "-bin-win-cpu-x64.zip"])
            } else if backend_lower.contains("rocm") {
                ("win-rocm-x64", vec!["-bin-win-rocm-", "-bin-win-vulkan-x64.zip", "-bin-win-cpu-x64.zip"])
            } else if has_discrete_or_igpu || backend_lower.contains("vulkan") {
                ("win-vulkan-x64", vec!["-bin-win-vulkan-x64.zip", "-bin-win-cpu-x64.zip"])
            } else {
                ("win-cpu-x64", vec!["-bin-win-cpu-x64.zip"])
            }
        }
        ("windows", "aarch64") => ("win-arm64", vec!["-bin-win-cpu-arm64.zip", "-bin-win-arm64.zip"]),
        ("macos", "aarch64") => ("macos-arm64", vec!["-bin-macos-arm64.tar.gz"]),
        ("macos", "x86_64") => ("macos-x64", vec!["-bin-macos-x64.tar.gz"]),
        _ => ("unsupported", vec![]),
    }
}

fn is_supported_archive(name: &str) -> bool {
    (name.ends_with(".tar.gz") || name.ends_with(".tgz") || name.ends_with(".zip"))
        && !name.contains("cudart")
}

/// Select the highest `b<N>` release that contains a matching downloadable binary archive.
pub fn select_best_release<'a>(
    releases: &'a [GhRelease],
    patterns: &[&str],
) -> Option<(&'a GhRelease, u64, &'a GhAsset)> {
    let mut best: Option<(&GhRelease, u64, &GhAsset)> = None;
    for rel in releases {
        let Some(build_num) = parse_release_tag_build(&rel.tag_name) else {
            continue;
        };
        let Some(asset) = match_asset(&rel.assets, patterns) else {
            continue;
        };
        if best.map_or(true, |(_, prev_build, _)| build_num > prev_build) {
            best = Some((rel, build_num, asset));
        }
    }
    best
}

fn match_asset<'a>(assets: &'a [GhAsset], patterns: &[&str]) -> Option<&'a GhAsset> {
    for pat in patterns {
        let mut matching: Vec<&GhAsset> = assets
            .iter()
            .filter(|a| is_supported_archive(&a.name) && a.name.contains(pat))
            .collect();
        // Sort reverse lexicographically so newer CUDA/ROCm versions (e.g. 12.8 > 12.4) win cleanly.
        matching.sort_by(|a, b| b.name.cmp(&a.name));
        if let Some(first) = matching.first() {
            return Some(*first);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_hw(has_nvidia: bool, gpu_description: &str, backend: &str) -> HardwareInfo {
        HardwareInfo {
            cpu_name: "Test CPU".into(),
            cpu_threads: 8,
            total_memory_gb: 16.0,
            gpu_description: gpu_description.into(),
            has_nvidia,
            backend_recommendation: backend.into(),
            unified_memory: false,
        }
    }

    #[test]
    fn parses_llama_server_version_and_release_tags() {
        let out = "version: 0.9.0-dev (build 12255, commit 940a30ee3)\nbuilt with GNU 13.3.0\n";
        assert_eq!(parse_llama_build_number(out), Some(12255));
        assert_eq!(parse_llama_build_number("llama-server version: b12301 (deadbeef)"), Some(12301));
        assert_eq!(parse_release_tag_build("b12283"), Some(12283));
        assert_eq!(parse_release_tag_build("v0.9.0"), None);
    }

    #[test]
    fn selects_hardware_appropriate_release_and_skips_tag_without_binaries() {
        let releases = vec![
            GhRelease {
                tag_name: "v0.9.0".into(),
                html_url: "https://example.com/v0.9.0".into(),
                body: None,
                assets: vec![GhAsset {
                    name: "nightly-tag.txt".into(),
                    browser_download_url: "https://example.com/nightly-tag.txt".into(),
                    size: 8,
                }],
            },
            GhRelease {
                tag_name: "b12283".into(),
                html_url: "https://example.com/b12283".into(),
                body: Some("notes".into()),
                assets: vec![
                    GhAsset {
                        name: "llama-b12283-bin-ubuntu-vulkan-x64.tar.gz".into(),
                        browser_download_url: "https://example.com/vulkan.tar.gz".into(),
                        size: 50_000_000,
                    },
                    GhAsset {
                        name: "llama-b12283-bin-ubuntu-cuda-12.8-x64.tar.gz".into(),
                        browser_download_url: "https://example.com/cuda.tar.gz".into(),
                        size: 90_000_000,
                    },
                    GhAsset {
                        name: "cudart-llama-bin-win-cuda-12.4-x64.zip".into(),
                        browser_download_url: "https://example.com/cudart.zip".into(),
                        size: 10_000_000,
                    },
                ],
            },
        ];

        let amd = fake_hw(false, "AMD Radeon RX 6700 XT", "Vulkan");
        let (label, pats) = select_platform_patterns("linux", "x86_64", &amd);
        assert_eq!(label, "linux-vulkan-x64");
        let (_, build, asset) = select_best_release(&releases, &pats).unwrap();
        assert_eq!(build, 12283);
        assert_eq!(asset.name, "llama-b12283-bin-ubuntu-vulkan-x64.tar.gz");

        let nv = fake_hw(true, "NVIDIA RTX 4070", "CUDA");
        let (nv_label, nv_pats) = select_platform_patterns("linux", "x86_64", &nv);
        assert_eq!(nv_label, "linux-cuda-x64");
        let (_, _, nv_asset) = select_best_release(&releases, &nv_pats).unwrap();
        assert_eq!(nv_asset.name, "llama-b12283-bin-ubuntu-cuda-12.8-x64.tar.gz");
    }
}
