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
    pub total_memory_gb: f64,
    pub gpu_description: String,
    pub has_nvidia: bool,
    pub backend_recommendation: String,
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

            let total_memory_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);

            // Attempt GPU detection via environment and common paths
            let (gpu_description, has_nvidia) = detect_gpu();

            let backend_recommendation = if has_nvidia {
                "CUDA (SGLang recommended)".to_string()
            } else {
                "Vulkan (llama.cpp recommended)".to_string()
            };

            HardwareInfo {
                cpu_name,
                total_memory_gb,
                gpu_description,
                has_nvidia,
                backend_recommendation,
            }
        })
        .clone()
}

/// Detect GPU by checking for NVIDIA tools and /proc/driver/nvidia.
fn detect_gpu() -> (String, bool) {
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
                return (format!("NVIDIA {}", desc), true);
            }
        }
    }

    // Check /proc/driver/nvidia (Linux kernel module)
    if std::path::Path::new("/proc/driver/nvidia").exists() {
        return ("NVIDIA GPU (driver detected)".to_string(), true);
    }

    // Fallback 1: check for Vulkan-capable devices via vulkaninfo
    if let Ok(output) = std::process::Command::new("vulkaninfo")
        .arg("--summary")
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Extract device name
            for line in stdout.lines() {
                if line.contains("deviceName") {
                    let name = line.split('=').nth(1).unwrap_or("Vulkan GPU").trim();
                    let is_nvidia = name.to_lowercase().contains("nvidia");
                    return (name.to_string(), is_nvidia);
                }
            }
        }
    }

    // Fallback 2: check lspci for AMD/Intel graphics
    if let Ok(output) = std::process::Command::new("lspci").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga compatible controller") || lower.contains("3d controller") {
                    if lower.contains("amd") || lower.contains("radeon") {
                        return ("AMD Radeon Graphics (Vulkan supported)".to_string(), false);
                    }
                    if lower.contains("intel") {
                        return ("Intel Integrated Graphics (Vulkan supported)".to_string(), false);
                    }
                    if lower.contains("nvidia") {
                        return ("NVIDIA Graphics (CUDA supported)".to_string(), true);
                    }
                }
            }
        }
    }

    ("CPU-only (no GPU detected)".to_string(), false)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LiveSystemMetrics {
    pub cpu_name: String,
    pub total_memory_gb: f64,
    pub used_memory_gb: f64,
    pub memory_percent: f64,
    pub cpu_temp: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub max_temp: f32,
    pub gpu_description: String,
    pub backend_recommendation: String,
    pub is_thermal_throttled: bool,
}

/// Query live hardware telemetry: CPU/GPU temps, RAM usage, and thermal state
pub fn get_live_metrics() -> LiveSystemMetrics {
    let hw = detect();
    
    // Read RAM directly from /proc/meminfo in microseconds
    let (used_memory_gb, total_memory_gb, memory_percent) = read_meminfo()
        .unwrap_or_else(|| (0.0, hw.total_memory_gb, 0.0));

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
        total_memory_gb: (total_memory_gb * 10.0).round() / 10.0,
        used_memory_gb: (used_memory_gb * 10.0).round() / 10.0,
        memory_percent: (memory_percent * 10.0).round() / 10.0,
        cpu_temp: cpu_temp.map(|t| (t * 10.0).round() / 10.0),
        gpu_temp: gpu_temp.map(|t| (t * 10.0).round() / 10.0),
        max_temp: (max_temp * 10.0).round() / 10.0,
        gpu_description: hw.gpu_description,
        backend_recommendation: hw.backend_recommendation,
        is_thermal_throttled,
    }
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

fn read_meminfo() -> Option<(f64, f64, f64)> {
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
        let total_gb = total / (1024.0 * 1024.0);
        let used_gb = (total - avail) / (1024.0 * 1024.0);
        let percent = (used_gb / total_gb) * 100.0;
        Some((used_gb, total_gb, percent))
    } else {
        None
    }
}
