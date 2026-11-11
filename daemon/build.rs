use std::collections::hash_map::DefaultHasher;
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=LLAMA_LIB_PROFILE");
    println!("cargo:rerun-if-env-changed=LOCALAPPDATA");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };
    let Some(build_dir) = Path::new(&out_dir).parent().and_then(Path::parent) else {
        return;
    };

    let custom_profile = env::var("LLAMA_LIB_PROFILE").ok();
    let cache_bases = windows_cache_bases(
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
        env::var_os("TEMP").map(PathBuf::from),
        env::var_os("TMP").map(PathBuf::from),
    );

    if let Some(cmake_root) = find_llama_cmake_root(build_dir, &cache_bases) {
        if let Some(httplib_dir) = find_lib_dir(
            &cmake_root.join("build").join("vendor").join("cpp-httplib"),
            "cpp-httplib.lib",
            custom_profile.as_deref(),
        ) {
            println!("cargo:rustc-link-search=native={}", httplib_dir.display());
            println!("cargo:rustc-link-lib=static=cpp-httplib");
        } else {
            println!(
                "cargo:warning=exovon-daemon build.rs found llama CMake root {}, but cpp-httplib.lib was not found under build/vendor/cpp-httplib",
                cmake_root.display()
            );
        }

        let common_root = cmake_root.join("build").join("common");
        if !common_root.join("llama-common-base.lib").is_file() {
            if let Some(common_dir) = find_lib_dir(
                &common_root,
                "llama-common-base.lib",
                custom_profile.as_deref(),
            ) {
                println!("cargo:rustc-link-search=native={}", common_dir.display());
            }
        }
    } else {
        println!(
            "cargo:warning=exovon-daemon build.rs could not locate llama-cpp-sys-4 CMake output directory under {}",
            build_dir.display()
        );
    }
}

fn windows_cache_bases(
    local_app_data: Option<PathBuf>,
    temp: Option<PathBuf>,
    tmp: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    for candidate in [local_app_data, temp, tmp, Some(PathBuf::from(r"C:\Temp"))] {
        if let Some(path) = candidate {
            if !path.as_os_str().is_empty() && !bases.contains(&path) {
                bases.push(path);
            }
        }
    }
    bases
}

fn hash_out_dir(out_dir: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    out_dir.to_string_lossy().as_ref().hash(&mut hasher);
    format!("{:08x}", hasher.finish() as u32)
}

fn parse_llcb_root_from_output(output_file: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(output_file).ok()?;
    for line in content.lines() {
        let Some(raw_spec) = line.strip_prefix("cargo:rustc-link-search=") else {
            continue;
        };
        let raw_path = raw_spec
            .strip_prefix("native=")
            .or_else(|| raw_spec.strip_prefix("all="))
            .unwrap_or(raw_spec)
            .trim();
        if raw_path.is_empty() {
            continue;
        }
        let path = Path::new(raw_path);
        // Strip known search suffixes back to the CMake build cache root.
        if let Some(root) = strip_llcb_suffix(path) {
            if root.join("build").is_dir() {
                return Some(root);
            }
        }
    }
    None
}

fn strip_llcb_suffix(path: &Path) -> Option<PathBuf> {
    let raw = path.to_string_lossy();
    let uses_backslash = raw.contains('\\');
    let normalized = raw.replace('\\', "/").trim_end_matches('/').to_string();

    if let Some(idx) = normalized.find("/llcb/") {
        let after_llcb = &normalized[idx + "/llcb/".len()..];
        if let Some(hash_seg) = after_llcb.split('/').next().filter(|s| !s.is_empty()) {
            let root_str = format!("{}/llcb/{}", &normalized[..idx], hash_seg);
            return Some(PathBuf::from(if uses_backslash {
                root_str.replace('/', "\\")
            } else {
                root_str
            }));
        }
    }

    for suffix in ["/build/common", "/lib64", "/lib"] {
        if let Some(prefix) = normalized.strip_suffix(suffix) {
            if !prefix.is_empty() {
                return Some(PathBuf::from(if uses_backslash {
                    prefix.replace('/', "\\")
                } else {
                    prefix.to_string()
                }));
            }
        }
    }

    None
}

fn find_llama_cmake_root(build_dir: &Path, cache_bases: &[PathBuf]) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(build_dir) else {
        return None;
    };

    let mut pkg_dirs: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let name_str = name.to_str()?;
            if !name_str.starts_with("llama-cpp-sys-4-") {
                return None;
            }
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, path))
        })
        .collect();

    pkg_dirs.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, pkg_dir) in &pkg_dirs {
        let output_file = pkg_dir.join("output");
        if let Some(root) = parse_llcb_root_from_output(&output_file) {
            return Some(root);
        }

        let pkg_out = pkg_dir.join("out");
        let hash8 = hash_out_dir(&pkg_out);
        for base in cache_bases {
            let candidate = base.join("llcb").join(&hash8);
            if candidate.join("build").is_dir() {
                return Some(candidate);
            }
        }
    }

    None
}

fn find_lib_dir(base_dir: &Path, lib_filename: &str, custom_profile: Option<&str>) -> Option<PathBuf> {
    let mut subdirs: Vec<&str> = Vec::new();
    if let Some(profile) = custom_profile.filter(|p| !p.is_empty()) {
        subdirs.push(profile);
    }
    for default_sub in ["Release", "", "RelWithDebInfo", "Debug"] {
        if !subdirs.contains(&default_sub) {
            subdirs.push(default_sub);
        }
    }

    for sub in subdirs {
        let dir = if sub.is_empty() {
            base_dir.to_path_buf()
        } else {
            base_dir.join(sub)
        };
        if dir.join(lib_filename).is_file() {
            return Some(dir);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_nanos();
        let dir = env::temp_dir().join(format!("exovon_build_rs_{}_{}", name, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_cpp_httplib_via_output_and_msbuild_release_dir() {
        let root = temp_root("output_msbuild");
        let build_dir = root.join("target/release/build");
        let pkg_dir = build_dir.join("llama-cpp-sys-4-abc123");
        let cache_root = root.join("local/llcb/d6899aef");
        let httplib_dir = cache_root.join("build/vendor/cpp-httplib/Release");

        fs::create_dir_all(pkg_dir.join("out")).unwrap();
        fs::create_dir_all(&httplib_dir).unwrap();
        fs::write(httplib_dir.join("cpp-httplib.lib"), b"lib").unwrap();
        fs::write(
            pkg_dir.join("output"),
            format!(
                "cargo:rerun-if-env-changed=LLAMA_LIB_PROFILE\ncargo:warning=test line\ncargo:rustc-link-search=native={}/lib\n",
                cache_root.display()
            ),
        )
        .unwrap();

        let found_root = find_llama_cmake_root(&build_dir, &[]).expect("cmake root");
        assert_eq!(found_root, cache_root);

        let found_lib = find_lib_dir(
            &found_root.join("build/vendor/cpp-httplib"),
            "cpp-httplib.lib",
            None,
        )
        .expect("httplib dir");
        assert_eq!(found_lib, httplib_dir);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_cpp_httplib_via_hashed_out_dir_and_ninja_flat_dir() {
        let root = temp_root("hash_ninja");
        let build_dir = root.join("target/release/build");
        let pkg_out = build_dir.join("llama-cpp-sys-4-def456/out");
        let cache_base = root.join("local");
        let hash8 = hash_out_dir(&pkg_out);
        let cache_root = cache_base.join("llcb").join(&hash8);
        let httplib_dir = cache_root.join("build/vendor/cpp-httplib");

        fs::create_dir_all(&pkg_out).unwrap();
        fs::create_dir_all(&httplib_dir).unwrap();
        fs::write(httplib_dir.join("cpp-httplib.lib"), b"lib").unwrap();

        let found_root = find_llama_cmake_root(&build_dir, &[cache_base]).expect("cmake root");
        assert_eq!(found_root, cache_root);

        let found_lib = find_lib_dir(
            &found_root.join("build/vendor/cpp-httplib"),
            "cpp-httplib.lib",
            None,
        )
        .expect("httplib dir");
        assert_eq!(found_lib, httplib_dir);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn strips_windows_llcb_suffixes() {
        let p = Path::new(r"C:\Users\runneradmin\AppData\Local\llcb\d6899aef\build\common");
        assert_eq!(
            strip_llcb_suffix(p),
            Some(PathBuf::from(r"C:\Users\runneradmin\AppData\Local\llcb\d6899aef"))
        );
    }
}
