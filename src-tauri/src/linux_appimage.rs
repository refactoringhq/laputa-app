#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StartupEnvOverride {
    key: &'static str,
    value: &'static str,
}

const LINUX_APPIMAGE_WEBKIT_OVERRIDES: [StartupEnvOverride; 2] = [
    StartupEnvOverride {
        key: "WEBKIT_DISABLE_DMABUF_RENDERER",
        value: "1",
    },
    StartupEnvOverride {
        key: "WEBKIT_DISABLE_COMPOSITING_MODE",
        value: "1",
    },
];

const WAYLAND_CLIENT_PRELOAD_CANDIDATES: [&str; 7] = [
    "/usr/lib64/libwayland-client.so.0",
    "/usr/lib64/libwayland-client.so",
    "/lib64/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so",
];

#[cfg(target_pointer_width = "64")]
const PROCESS_ELF_CLASS: u8 = 2;

#[cfg(target_pointer_width = "32")]
const PROCESS_ELF_CLASS: u8 = 1;

fn is_linux_appimage_launch<F>(mut get_var: F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    ["APPIMAGE", "APPDIR"]
        .into_iter()
        .any(|key| get_var(key).is_some_and(|value| !value.trim().is_empty()))
}

fn is_wayland_session<F>(mut get_var: F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    get_var("WAYLAND_DISPLAY").is_some_and(|value| !value.trim().is_empty())
        || get_var("XDG_SESSION_TYPE")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("wayland"))
}

fn elf_library_matches_process(path: &std::path::Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };

    let mut header = [0; 5];
    if std::io::Read::read_exact(&mut file, &mut header).is_err() {
        return false;
    }

    header[..4] == *b"\x7FELF" && header[4] == PROCESS_ELF_CLASS
}

#[cfg(all(desktop, target_os = "linux"))]
fn wayland_preload_candidate_matches(path: &str) -> bool {
    let path = std::path::Path::new(path);

    path.is_file() && elf_library_matches_process(path)
}

fn wayland_client_preload_path_with<F, E>(
    mut get_var: F,
    mut candidate_matches: E,
) -> Option<&'static str>
where
    F: FnMut(&str) -> Option<String>,
    E: FnMut(&str) -> bool,
{
    if !is_linux_appimage_launch(&mut get_var) || !is_wayland_session(&mut get_var) {
        return None;
    }

    if get_var("LD_PRELOAD").is_some_and(|value| !value.trim().is_empty())
        || get_var("TOLARIA_APPIMAGE_WAYLAND_PRELOAD_ATTEMPTED").is_some_and(|value| value == "1")
    {
        return None;
    }

    WAYLAND_CLIENT_PRELOAD_CANDIDATES
        .into_iter()
        .find(|path| candidate_matches(path))
}

fn startup_env_overrides_with<F>(mut get_var: F) -> Vec<StartupEnvOverride>
where
    F: FnMut(&str) -> Option<String>,
{
    if !is_linux_appimage_launch(&mut get_var) {
        return Vec::new();
    }

    LINUX_APPIMAGE_WEBKIT_OVERRIDES
        .into_iter()
        .filter(|env_override| {
            !get_var(env_override.key).is_some_and(|value| !value.trim().is_empty())
        })
        .collect()
}

#[cfg(all(desktop, target_os = "linux"))]
pub(crate) fn apply_startup_env_overrides() {
    apply_wayland_client_preload();

    for env_override in startup_env_overrides_with(|key| std::env::var(key).ok()) {
        std::env::set_var(env_override.key, env_override.value);
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn apply_wayland_client_preload() {
    use std::os::unix::process::CommandExt;

    let Some(preload_path) = wayland_client_preload_path_with(
        |key| std::env::var(key).ok(),
        wayland_preload_candidate_matches,
    ) else {
        return;
    };

    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            eprintln!(
                "Tolaria AppImage Wayland preload skipped: failed to resolve executable ({e})"
            );
            return;
        }
    };

    let error = std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .env("LD_PRELOAD", preload_path)
        .env("TOLARIA_APPIMAGE_WAYLAND_PRELOAD_ATTEMPTED", "1")
        .exec();
    eprintln!("Tolaria AppImage Wayland preload skipped: failed to re-exec ({error})");
}

#[cfg(test)]
mod tests {
    use super::{
        elf_library_matches_process, startup_env_overrides_with, wayland_client_preload_path_with,
        StartupEnvOverride,
    };

    #[test]
    fn startup_env_overrides_are_empty_outside_appimage_launches() {
        let overrides = startup_env_overrides_with(|_| None);

        assert!(overrides.is_empty());
    }

    #[test]
    fn startup_env_overrides_disable_unstable_webkit_rendering_for_appimages() {
        let overrides = startup_env_overrides_with(|key| match key {
            "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
            _ => None,
        });

        assert_eq!(
            overrides,
            vec![
                StartupEnvOverride {
                    key: "WEBKIT_DISABLE_DMABUF_RENDERER",
                    value: "1",
                },
                StartupEnvOverride {
                    key: "WEBKIT_DISABLE_COMPOSITING_MODE",
                    value: "1",
                }
            ]
        );
    }

    #[test]
    fn startup_env_overrides_preserve_explicit_user_setting_per_variable() {
        let overrides = startup_env_overrides_with(|key| match key {
            "APPDIR" => Some("/tmp/.mount_Tolaria".to_string()),
            "WEBKIT_DISABLE_DMABUF_RENDERER" => Some("0".to_string()),
            _ => None,
        });

        assert_eq!(
            overrides,
            vec![StartupEnvOverride {
                key: "WEBKIT_DISABLE_COMPOSITING_MODE",
                value: "1",
            }]
        );
    }

    #[test]
    fn wayland_preload_uses_first_available_system_library() {
        let preload_path = wayland_client_preload_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                "XDG_SESSION_TYPE" => Some("wayland".to_string()),
                _ => None,
            },
            |path| path == "/lib/x86_64-linux-gnu/libwayland-client.so.0",
        );

        assert_eq!(
            preload_path,
            Some("/lib/x86_64-linux-gnu/libwayland-client.so.0")
        );
    }

    #[test]
    fn wayland_preload_prefers_fedora_lib64_over_usr_lib() {
        let preload_path = wayland_client_preload_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                "XDG_SESSION_TYPE" => Some("wayland".to_string()),
                _ => None,
            },
            |path| {
                path == "/usr/lib/libwayland-client.so.0"
                    || path == "/usr/lib64/libwayland-client.so.0"
            },
        );

        assert_eq!(preload_path, Some("/usr/lib64/libwayland-client.so.0"));
    }

    #[test]
    fn preload_library_rejects_wrong_elf_class() {
        let dir = tempfile::tempdir().unwrap();
        let matching = dir.path().join("matching-libwayland-client.so.0");
        let mismatched = dir.path().join("mismatched-libwayland-client.so.0");
        let matching_class = if cfg!(target_pointer_width = "64") {
            2
        } else {
            1
        };
        let mismatched_class = if matching_class == 2 { 1 } else { 2 };

        std::fs::write(&matching, [0x7F, b'E', b'L', b'F', matching_class]).unwrap();
        std::fs::write(&mismatched, [0x7F, b'E', b'L', b'F', mismatched_class]).unwrap();

        assert!(elf_library_matches_process(&matching));
        assert!(!elf_library_matches_process(&mismatched));
        assert!(!elf_library_matches_process(&dir.path().join("missing.so")));
    }

    #[test]
    fn wayland_preload_preserves_explicit_ld_preload() {
        let preload_path = wayland_client_preload_path_with(
            |key| match key {
                "APPDIR" => Some("/tmp/.mount_Tolaria".to_string()),
                "WAYLAND_DISPLAY" => Some("wayland-0".to_string()),
                "LD_PRELOAD" => Some("/custom/libwayland-client.so".to_string()),
                _ => None,
            },
            |_| true,
        );

        assert_eq!(preload_path, None);
    }

    #[test]
    fn wayland_preload_is_empty_for_x11_sessions() {
        let preload_path = wayland_client_preload_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                "XDG_SESSION_TYPE" => Some("x11".to_string()),
                _ => None,
            },
            |_| true,
        );

        assert_eq!(preload_path, None);
    }
}
