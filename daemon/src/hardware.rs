// =============================================================================
// Hardware Detection Module
// =============================================================================
// Detects GPU capabilities to route to the correct inference backend:
// - NVIDIA → recommend CUDA / SGLang
// - AMD / Intel / Other → recommend Vulkan / llama.cpp
// =============================================================================

use sysinfo::System;

#[derive(Debug, Clone)]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub cpu_threads: usize,
    pub total_memory_gb: f64,
    pub gpu_description: String,
    pub has_nvidia: bool,
    pub backend_recommendation: String,
    pub unified_memory: bool,
}

use std::sync::OnceLock;

static CACHED_HARDWARE: OnceLock<HardwareInfo> = OnceLock::new();

/// Detect the system hardware and recommend the best inference backend.
/// Caches the result in a OnceLock so subsequent calls return instantly without blocking.
pub fn detect() -> HardwareInfo {
    CACHED_HARDWARE
        .get_or_init(|| {
            let mut sys = System::new_all();
            sys.refresh_all();

            let cpu_name = sys
                .cpus()
                .first()
                .map(|c| c.brand().to_string())
                .unwrap_or_else(|| "Unknown CPU".to_string());

            let cpu_threads = {
                let n = sys.cpus().len();
                if n > 0 {
                    n
                } else {
                    std::thread::available_parallelism()
                        .map(|p| p.get())
                        .unwrap_or(1)
                }
            };

            let total_memory_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);

            // Attempt GPU detection via vendor tools, DRM sysfs, Vulkan, and OS APIs
            let (gpu_description, has_nvidia, unified_memory) = detect_gpu();

            let backend_recommendation = if has_nvidia {
                "CUDA (SGLang recommended)".to_string()
            } else if cfg!(target_os = "macos") {
                "Metal (llama.cpp recommended)".to_string()
            } else {
                "Vulkan (llama.cpp recommended)".to_string()
            };

            HardwareInfo {
                cpu_name,
                cpu_threads,
                total_memory_gb,
                gpu_description,
                has_nvidia,
                backend_recommendation,
                unified_memory,
            }
        })
        .clone()
}

/// Detect GPU by checking NVIDIA tools, Linux DRM sysfs, Vulkan, lspci, or macOS unified memory.
fn detect_gpu() -> (String, bool, bool) {
    // Check for nvidia-smi (Linux/Windows)
    if let Ok(output) = std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=name,memory.total")
        .arg("--format=csv,noheader,nounits")
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let desc = stdout.trim().to_string();
            if !desc.is_empty() {
                return (format!("NVIDIA {}", desc), true, false);
            }
        }
    }

    // Check /proc/driver/nvidia (Linux kernel module)
    if std::path::Path::new("/proc/driver/nvidia").exists() {
        return ("NVIDIA GPU (driver detected)".to_string(), true, false);
    }

    // macOS Apple Silicon / Metal unified memory
    #[cfg(target_os = "macos")]
    {
        return ("Apple Silicon / Metal GPU (Unified Memory)".to_string(), false, true);
    }

    // Check for Vulkan-capable devices via vulkaninfo
    if let Ok(output) = std::process::Command::new("vulkaninfo")
        .arg("--summary")
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("deviceName") {
                    let name = line.split('=').nth(1).unwrap_or("Vulkan GPU").trim();
                    let is_nvidia = name.to_lowercase().contains("nvidia");
                    return (name.to_string(), is_nvidia, false);
                }
            }
        }
    }

    // Linux DRM sysfs vendor/driver inspection (works without vulkaninfo/lspci)
    #[cfg(target_os = "linux")]
    if let Some(desc) = detect_drm_gpu_description() {
        let lower = desc.to_lowercase();
        let is_nvidia = lower.contains("nvidia");
        return (desc, is_nvidia, false);
    }

    // Fallback: check lspci for AMD/Intel/NVIDIA graphics
    if let Ok(output) = std::process::Command::new("lspci").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga compatible controller") || lower.contains("3d controller") || lower.contains("display controller") {
                    if lower.contains("amd") || lower.contains("radeon") || lower.contains("ati") {
                        return ("AMD Radeon Graphics (Vulkan supported)".to_string(), false, false);
                    }
                    if lower.contains("intel") {
                        return ("Intel Graphics (Vulkan supported)".to_string(), false, false);
                    }
                    if lower.contains("nvidia") {
                        return ("NVIDIA Graphics (CUDA supported)".to_string(), true, false);
                    }
                }
            }
        }
    }

    ("CPU-only (no GPU detected)".to_string(), false, false)
}

#[cfg(target_os = "linux")]
fn is_drm_card_dir(name: &str) -> bool {
    name.strip_prefix("card")
        .map(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn detect_drm_gpu_description() -> Option<String> {
    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    let mut best: Option<(u64, String)> = None;

    for entry in entries.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        if !is_drm_card_dir(&fname) {
            continue;
        }
        let dev_dir = entry.path().join("device");
        let vram_bytes = std::fs::read_to_string(dev_dir.join("mem_info_vram_total"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let uevent = std::fs::read_to_string(dev_dir.join("uevent")).unwrap_or_default();
        let vendor = std::fs::read_to_string(dev_dir.join("vendor")).unwrap_or_default();
        let driver = uevent
            .lines()
            .find_map(|l| l.strip_prefix("DRIVER="))
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let vendor_l = vendor.trim().to_lowercase();

        let desc = if driver == "amdgpu" || vendor_l == "0x1002" {
            Some("AMD Radeon Graphics (Vulkan supported)".to_string())
        } else if driver == "i915" || driver == "xe" || vendor_l == "0x8086" {
            Some("Intel Graphics (Vulkan supported)".to_string())
        } else if driver == "nvidia" || driver == "nouveau" || vendor_l == "0x10de" {
            Some("NVIDIA Graphics (Vulkan/CUDA supported)".to_string())
        } else {
            None
        };

        if let Some(d) = desc {
            match &best {
                Some((best_vram, _)) if *best_vram >= vram_bytes => {}
                _ => best = Some((vram_bytes, d)),
            }
        }
    }

    best.map(|(_, d)| d)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LiveSystemMetrics {
    pub cpu_name: String,
    pub cpu_threads: usize,
    pub total_memory_gb: f64,
    pub used_memory_gb: f64,
    pub available_memory_gb: Option<f64>,
    pub memory_percent: f64,
    pub cpu_temp: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub max_temp: f32,
    pub gpu_description: String,
    pub backend_recommendation: String,
    pub is_thermal_throttled: bool,
    pub vram_total_mb: Option<u64>,
    pub vram_used_mb: Option<u64>,
    pub vram_free_mb: Option<u64>,
    pub unified_memory: bool,
}

/// Query live hardware telemetry: CPU/GPU temps, RAM/VRAM pools, threads, and thermal state
pub fn get_live_metrics() -> LiveSystemMetrics {
    let hw = detect();

    let (used_memory_gb, total_memory_gb, available_memory_gb, memory_percent) = read_memory_stats(&hw);

    let (vram_total_mb, vram_used_mb, vram_free_mb, unified_memory) =
        detect_vram_pool(&hw, total_memory_gb, used_memory_gb, available_memory_gb);

    // Read CPU & GPU temperatures from /sys/class/hwmon
    let (cpu_temp, gpu_temp) = read_temperatures();
    let max_temp = match (cpu_temp, gpu_temp) {
        (Some(c), Some(g)) => c.max(g),
        (Some(c), None) => c,
        (None, Some(g)) => g,
        (None, None) => 0.0,
    };

    let is_thermal_throttled = max_temp >= 90.0;

    LiveSystemMetrics {
        cpu_name: hw.cpu_name,
        cpu_threads: hw.cpu_threads,
        total_memory_gb: (total_memory_gb * 10.0).round() / 10.0,
        used_memory_gb: (used_memory_gb * 10.0).round() / 10.0,
        available_memory_gb: available_memory_gb.map(|a| (a * 10.0).round() / 10.0),
        memory_percent: (memory_percent * 10.0).round() / 10.0,
        cpu_temp: cpu_temp.map(|t| (t * 10.0).round() / 10.0),
        gpu_temp: gpu_temp.map(|t| (t * 10.0).round() / 10.0),
        max_temp: (max_temp * 10.0).round() / 10.0,
        gpu_description: hw.gpu_description,
        backend_recommendation: hw.backend_recommendation,
        is_thermal_throttled,
        vram_total_mb,
        vram_used_mb,
        vram_free_mb,
        unified_memory,
    }
}

fn read_memory_stats(hw: &HardwareInfo) -> (f64, f64, Option<f64>, f64) {
    if let Some((used, total, avail, pct)) = read_meminfo() {
        return (used, total, Some(avail), pct);
    }

    // Cross-platform fallback via sysinfo (macOS, Windows, BSD, etc.)
    let mut sys = System::new();
    sys.refresh_memory();
    let total_bytes = sys.total_memory();
    let avail_bytes = {
        let a = sys.available_memory();
        if a > 0 { a } else { sys.free_memory() }
    };

    if total_bytes > 0 {
        let total_gb = total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        let avail_gb = avail_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
        let used_gb = (total_bytes.saturating_sub(avail_bytes)) as f64 / (1024.0 * 1024.0 * 1024.0);
        let pct = (used_gb / total_gb) * 100.0;
        (used_gb, total_gb, Some(avail_gb), pct)
    } else {
        (0.0, hw.total_memory_gb, None, 0.0)
    }
}

fn detect_vram_pool(
    hw: &HardwareInfo,
    total_memory_gb: f64,
    used_memory_gb: f64,
    available_memory_gb: Option<f64>,
) -> (Option<u64>, Option<u64>, Option<u64>, bool) {
    // 1. NVIDIA via nvidia-smi (if NVIDIA detected or on non-Linux where sysfs doesn't exist)
    if hw.has_nvidia || !cfg!(target_os = "linux") {
        if let Some((tot, used, free)) = query_nvidia_smi_vram() {
            return (Some(tot), used, free, false);
        }
    }

    // 2. Linux DRM sysfs across ALL /sys/class/drm/card* directories dynamically
    #[cfg(target_os = "linux")]
    if let Some((tot, used, free)) = query_drm_sysfs_vram() {
        return (Some(tot), used, free, false);
    }

    // 3. macOS unified memory pool
    #[cfg(target_os = "macos")]
    {
        let total_mb = (total_memory_gb * 1024.0).round() as u64;
        let used_mb = (used_memory_gb * 1024.0).round() as u64;
        let free_mb = available_memory_gb
            .map(|a| (a * 1024.0).round() as u64)
            .unwrap_or_else(|| total_mb.saturating_sub(used_mb));
        return (Some(total_mb), Some(used_mb), Some(free_mb), true);
    }

    // 4. Vulkan fallback: parse vulkaninfo VkPhysicalDeviceMemoryProperties device-local heaps
    if !hw.gpu_description.starts_with("CPU-only") {
        if let Some((tot, used, free)) = query_vulkaninfo_vram_cached() {
            return (Some(tot), used, free, hw.unified_memory);
        }
        return (None, None, None, hw.unified_memory);
    }

    // 5. CPU-only fallback
    let _ = (total_memory_gb, used_memory_gb, available_memory_gb);
    (Some(0), Some(0), Some(0), false)
}

fn query_nvidia_smi_vram() -> Option<(u64, Option<u64>, Option<u64>)> {
    let output = std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=memory.total,memory.used,memory.free")
        .arg("--format=csv,noheader,nounits")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut best: Option<(u64, Option<u64>, Option<u64>)> = None;

    for line in stdout.lines() {
        let cols: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if cols.len() >= 1 {
            if let Ok(total_f) = cols[0].parse::<f64>() {
                let total_mb = total_f.round() as u64;
                if total_mb == 0 {
                    continue;
                }
                let used_mb = cols.get(1).and_then(|s| s.parse::<f64>().ok()).map(|v| v.round() as u64);
                let free_mb = cols
                    .get(2)
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(|v| v.round() as u64)
                    .or_else(|| used_mb.map(|u| total_mb.saturating_sub(u)));

                match best {
                    Some((best_tot, _, _)) if best_tot >= total_mb => {}
                    _ => best = Some((total_mb, used_mb, free_mb)),
                }
            }
        }
    }

    best
}

#[cfg(target_os = "linux")]
fn query_drm_sysfs_vram() -> Option<(u64, Option<u64>, Option<u64>)> {
    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    let mut best: Option<(u64, Option<u64>)> = None;

    for entry in entries.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        if !is_drm_card_dir(&fname) {
            continue;
        }
        let dev_dir = entry.path().join("device");
        let total_bytes = match std::fs::read_to_string(dev_dir.join("mem_info_vram_total")) {
            Ok(s) => match s.trim().parse::<u64>() {
                Ok(v) if v > 0 => v,
                _ => continue,
            },
            Err(_) => continue,
        };

        let used_bytes = std::fs::read_to_string(dev_dir.join("mem_info_vram_used"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok());

        match best {
            Some((best_tot, _)) if best_tot >= total_bytes => {}
            _ => best = Some((total_bytes, used_bytes)),
        }
    }

    let (total_bytes, used_bytes) = best?;
    let total_mb = total_bytes / (1024 * 1024);
    let used_mb = used_bytes.map(|u| u / (1024 * 1024));
    let free_mb = used_mb.map(|u| total_mb.saturating_sub(u));
    Some((total_mb, used_mb, free_mb))
}

static CACHED_VULKAN_VRAM: OnceLock<Option<(u64, Option<u64>, Option<u64>)>> = OnceLock::new();

fn query_vulkaninfo_vram_cached() -> Option<(u64, Option<u64>, Option<u64>)> {
    *CACHED_VULKAN_VRAM.get_or_init(query_vulkaninfo_vram)
}

fn query_vulkaninfo_vram() -> Option<(u64, Option<u64>, Option<u64>)> {
    let output = std::process::Command::new("vulkaninfo").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_vulkaninfo_device_local_vram(&stdout)
}

fn parse_vulkaninfo_device_local_vram(stdout: &str) -> Option<(u64, Option<u64>, Option<u64>)> {
    let mut in_mem_props = false;
    let mut current_size: Option<u64> = None;
    let mut current_usage: Option<u64> = None;
    let mut current_budget: Option<u64> = None;
    let mut is_device_local = false;
    let mut best: Option<(u64, Option<u64>, Option<u64>)> = None;

    let flush_heap = |size: &mut Option<u64>,
                      usage: &mut Option<u64>,
                      budget: &mut Option<u64>,
                      device_local: &mut bool,
                      best: &mut Option<(u64, Option<u64>, Option<u64>)>| {
        if *device_local {
            if let Some(sz_bytes) = *size {
                let tot_mb = sz_bytes / (1024 * 1024);
                if tot_mb > 0 {
                    let used_mb = usage.map(|u| u / (1024 * 1024));
                    let free_mb = budget
                        .zip(*usage)
                        .map(|(b, u)| b.saturating_sub(u) / (1024 * 1024))
                        .or_else(|| used_mb.map(|u| tot_mb.saturating_sub(u)));
                    match *best {
                        Some((best_tot, _, _)) if best_tot >= tot_mb => {}
                        _ => *best = Some((tot_mb, used_mb, free_mb)),
                    }
                }
            }
        }
        *size = None;
        *usage = None;
        *budget = None;
        *device_local = false;
    };

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("VkPhysicalDeviceMemoryProperties") {
            flush_heap(&mut current_size, &mut current_usage, &mut current_budget, &mut is_device_local, &mut best);
            in_mem_props = true;
            continue;
        }
        if !in_mem_props {
            continue;
        }
        if trimmed.starts_with("VkPhysicalDevice") && !trimmed.starts_with("VkPhysicalDeviceMemoryProperties") {
            flush_heap(&mut current_size, &mut current_usage, &mut current_budget, &mut is_device_local, &mut best);
            in_mem_props = false;
            continue;
        }
        if trimmed.starts_with("memoryHeaps[") {
            flush_heap(&mut current_size, &mut current_usage, &mut current_budget, &mut is_device_local, &mut best);
            continue;
        }
        if trimmed.starts_with("memoryTypes[") {
            flush_heap(&mut current_size, &mut current_usage, &mut current_budget, &mut is_device_local, &mut best);
            continue;
        }
        if trimmed.starts_with("size") && trimmed.contains('=') {
            if let Some(val_str) = trimmed.split('=').nth(1).and_then(|s| s.split_whitespace().next()) {
                current_size = val_str.parse::<u64>().ok();
            }
        } else if trimmed.starts_with("usage") && trimmed.contains('=') {
            if let Some(val_str) = trimmed.split('=').nth(1).and_then(|s| s.split_whitespace().next()) {
                current_usage = val_str.parse::<u64>().ok();
            }
        } else if trimmed.starts_with("budget") && trimmed.contains('=') {
            if let Some(val_str) = trimmed.split('=').nth(1).and_then(|s| s.split_whitespace().next()) {
                current_budget = val_str.parse::<u64>().ok();
            }
        } else if trimmed.contains("MEMORY_HEAP_DEVICE_LOCAL_BIT") {
            is_device_local = true;
        }
    }

    flush_heap(&mut current_size, &mut current_usage, &mut current_budget, &mut is_device_local, &mut best);
    best
}

fn read_temperatures() -> (Option<f32>, Option<f32>) {
    let mut cpu_temp: Option<f32> = None;
    let mut gpu_temp: Option<f32> = None;

    if let Ok(entries) = std::fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let path = entry.path();
            let name_path = path.join("name");
            if let Ok(name) = std::fs::read_to_string(&name_path) {
                let name = name.trim();
                // Check for CPU sensors (AMD k10temp, Intel coretemp, zenpower, etc.)
                if name.contains("k10temp") || name.contains("coretemp") || name.contains("zenpower") || name.contains("cpu") {
                    if let Some(t) = read_hwmon_temp(&path) {
                        cpu_temp = Some(t);
                    }
                }
                // Check for GPU sensors (amdgpu, nvidia, nouveau)
                else if name.contains("amdgpu") || name.contains("nvidia") || name.contains("nouveau") {
                    if let Some(t) = read_hwmon_temp(&path) {
                        gpu_temp = Some(t);
                    }
                }
            }
        }
    }

    // Fallback for CPU if not found in hwmon: /sys/class/thermal/thermal_zone0/temp
    if cpu_temp.is_none() {
        if let Ok(content) = std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp") {
            if let Ok(milli) = content.trim().parse::<f32>() {
                cpu_temp = Some(milli / 1000.0);
            }
        }
    }

    (cpu_temp, gpu_temp)
}

fn read_hwmon_temp(hwmon_dir: &std::path::Path) -> Option<f32> {
    for i in 1..=5 {
        let temp_file = hwmon_dir.join(format!("temp{}_input", i));
        if let Ok(content) = std::fs::read_to_string(&temp_file) {
            if let Ok(milli) = content.trim().parse::<f32>() {
                if milli > 0.0 {
                    return Some(milli / 1000.0);
                }
            }
        }
    }
    None
}

fn read_meminfo() -> Option<(f64, f64, f64, f64)> {
    let content = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb: Option<f64> = None;
    let mut avail_kb: Option<f64> = None;

    for line in content.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = line.split_whitespace().nth(1).and_then(|s| s.parse::<f64>().ok());
        } else if line.starts_with("MemAvailable:") {
            avail_kb = line.split_whitespace().nth(1).and_then(|s| s.parse::<f64>().ok());
        }
        if total_kb.is_some() && avail_kb.is_some() {
            break;
        }
    }

    if let (Some(total), Some(avail)) = (total_kb, avail_kb) {
        if total <= 0.0 {
            return None;
        }
        let total_gb = total / (1024.0 * 1024.0);
        let avail_gb = avail / (1024.0 * 1024.0);
        let used_gb = (total - avail).max(0.0) / (1024.0 * 1024.0);
        let percent = (used_gb / total_gb) * 100.0;
        Some((used_gb, total_gb, avail_gb, percent))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vulkaninfo_device_local_heap_ignoring_host_heap() {
        let sample = r#"
VkPhysicalDeviceMemoryProperties:
=================================
memoryHeaps: count = 2
	memoryHeaps[0]:
		size   = 17179869184 (0x400000000) (16.00 GiB)
		budget = 16106127360 (0x3c0000000) (15.00 GiB)
		usage  = 2147483648 (0x80000000) (2.00 GiB)
		flags: count = 1
			MEMORY_HEAP_DEVICE_LOCAL_BIT
	memoryHeaps[1]:
		size   = 34359738368 (0x800000000) (32.00 GiB)
		flags: None
memoryTypes: count = 1
"#;
        let parsed = parse_vulkaninfo_device_local_vram(sample).expect("should parse device local heap");
        assert_eq!(parsed.0, 16384);
        assert_eq!(parsed.1, Some(2048));
        assert_eq!(parsed.2, Some(13312));
    }

    #[test]
    fn live_metrics_discovers_cpu_ram_and_pool_dynamically() {
        let metrics = get_live_metrics();
        assert!(metrics.cpu_threads >= 1);
        assert!(metrics.total_memory_gb > 0.0);
        #[cfg(target_os = "linux")]
        assert!(metrics.available_memory_gb.is_some());
    }
}
