// =============================================================================
// llama.cpp Archive Extraction, Atomic Symlink-Safe Swap & Rollback
// =============================================================================

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::llama_server::LlamaServerEngine;
use crate::llama_updater_match::parse_llama_build_number;

pub fn probe_llama_server_version(bin_path: &Path) -> (Option<String>, Option<u64>) {
    let mut cmd = Command::new(bin_path);
    cmd.arg("--version");
    if let Some(parent) = bin_path.parent() {
        prepend_lib_path(&mut cmd, parent);
    }
    let Ok(output) = cmd.output() else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let raw = combined
        .lines()
        .find(|line| line.to_ascii_lowercase().contains("version:"))
        .or_else(|| combined.lines().find(|line| !line.trim().is_empty()))
        .map(|s| s.trim().to_string());
    let build = parse_llama_build_number(&combined);
    (raw, build)
}

fn prepend_lib_path(cmd: &mut Command, dir: &Path) {
    #[cfg(target_os = "linux")]
    let var = "LD_LIBRARY_PATH";
    #[cfg(target_os = "macos")]
    let var = "DYLD_LIBRARY_PATH";
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let var = "";

    if !var.is_empty() {
        let dir_str = dir.to_string_lossy();
        let next = match std::env::var(var) {
            Ok(prev) if !prev.is_empty() => format!("{}:{}", dir_str, prev),
            _ => dir_str.to_string(),
        };
        cmd.env(var, next);
    }
}

pub fn extract_and_find_bin_dir(archive: &Path, stage_dir: &Path) -> Result<PathBuf, String> {
    let unpack_dir = stage_dir.join("unpacked");
    fs::create_dir_all(&unpack_dir).map_err(|e| format!("Create unpack dir failed: {}", e))?;

    let mut cmd = Command::new("tar");
    if archive.to_string_lossy().ends_with(".zip") {
        cmd.arg("-xf");
    } else {
        cmd.arg("-xzf");
    }
    let status = cmd
        .arg(archive)
        .arg("-C")
        .arg(&unpack_dir)
        .status()
        .map_err(|e| format!("Failed to invoke tar: {}", e))?;

    if !status.success() {
        return Err(format!("Archive extraction exited with status {:?}", status.code()));
    }

    find_server_dir(&unpack_dir, 0)
        .ok_or_else(|| format!("{} not found inside extracted archive.", LlamaServerEngine::binary_name()))
}

fn find_server_dir(dir: &Path, depth: usize) -> Option<PathBuf> {
    let bin = LlamaServerEngine::binary_name();
    if dir.join(bin).exists() {
        return Some(dir.to_path_buf());
    }
    if depth >= 3 {
        return None;
    }
    for entry in fs::read_dir(dir).ok()?.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(found) = find_server_dir(&entry.path(), depth + 1) {
                return Some(found);
            }
        }
    }
    None
}

pub fn swap_runtime_files(
    src_dir: &Path,
    target_dir: &Path,
    backup_dir: &Path,
) -> Result<(Option<String>, Option<u64>), String> {
    fs::create_dir_all(backup_dir).map_err(|e| format!("Failed to create backup dir: {}", e))?;
    let mut moved_names: Vec<OsString> = Vec::new();

    for entry in fs::read_dir(src_dir).map_err(|e| format!("Read extracted dir failed: {}", e))?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with("LICENSE") || name_str.starts_with("README") {
            continue;
        }
        let src_path = entry.path();
        if src_path.symlink_metadata().map(|m| m.is_dir()).unwrap_or(false) {
            continue;
        }
        let dst_path = target_dir.join(&name);
        if dst_path.symlink_metadata().is_ok() {
            let bak_path = backup_dir.join(&name);
            if let Err(e) = fs::rename(&dst_path, &bak_path) {
                rollback_files(&moved_names, target_dir, backup_dir);
                return Err(format!("Failed backing up {}: {}", name_str, e));
            }
        }
        if let Err(e) = fs::rename(&src_path, &dst_path) {
            rollback_files(&moved_names, target_dir, backup_dir);
            if backup_dir.join(&name).symlink_metadata().is_ok() {
                let _ = fs::rename(backup_dir.join(&name), &dst_path);
            }
            return Err(format!("Failed installing {}: {}", name_str, e));
        }
        ensure_executable_if_binary(&dst_path);
        moved_names.push(name);
    }

    let installed_bin = target_dir.join(LlamaServerEngine::binary_name());
    let (raw, build) = probe_llama_server_version(&installed_bin);
    if build.is_none() && raw.is_none() {
        rollback_files(&moved_names, target_dir, backup_dir);
        return Err("Installed llama-server failed `--version` smoke check; rolled back previous binaries.".into());
    }
    Ok((raw, build))
}

fn rollback_files(moved: &[OsString], target_dir: &Path, backup_dir: &Path) {
    for name in moved {
        let dst = target_dir.join(name);
        let bak = backup_dir.join(name);
        let _ = fs::remove_file(&dst);
        if bak.symlink_metadata().is_ok() {
            let _ = fs::rename(&bak, &dst);
        }
    }
}

fn ensure_executable_if_binary(_path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::symlink_metadata(_path) {
            if meta.file_type().is_file() {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(_path, perms);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn swaps_binaries_and_rolls_back_on_smoke_check_failure() {
        let root = std::env::temp_dir().join(format!("exovon_swap_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let target = root.join("target");
        let stage_ok = root.join("stage_ok");
        let stage_bad = root.join("stage_bad");
        let backup = root.join("backup");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&stage_ok).unwrap();
        fs::create_dir_all(&stage_bad).unwrap();

        let bin = LlamaServerEngine::binary_name();
        fs::write(target.join(bin), "#!/bin/sh\necho 'version: 0.9.0 (build 100, commit aaa)'\n").unwrap();
        ensure_executable_if_binary(&target.join(bin));
        fs::write(target.join("exovon-daemon"), "keep-me").unwrap();

        fs::write(stage_ok.join(bin), "#!/bin/sh\necho 'version: 0.9.0 (build 200, commit bbb)'\n").unwrap();
        let (raw, build) = swap_runtime_files(&stage_ok, &target, &backup).unwrap();
        assert_eq!(build, Some(200));
        assert!(raw.unwrap().contains("200"));
        assert_eq!(fs::read_to_string(target.join("exovon-daemon")).unwrap(), "keep-me");

        // Now simulate a corrupt binary -> must fail and roll back cleanly to build 200
        let backup2 = root.join("backup2");
        fs::write(stage_bad.join(bin), "#!/bin/sh\nexit 1\n").unwrap();
        assert!(swap_runtime_files(&stage_bad, &target, &backup2).is_err());
        let (_, rolled_build) = probe_llama_server_version(&target.join(bin));
        assert_eq!(rolled_build, Some(200));
        let _ = fs::remove_dir_all(&root);
    }
}
