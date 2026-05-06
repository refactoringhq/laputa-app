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

const FCITX_GTK_IM_MODULE_OVERRIDE: StartupEnvOverride = StartupEnvOverride {
    key: "GTK_IM_MODULE",
    value: "fcitx",
};
const FCITX_ENV_HINT_KEYS: [&str; 4] = [
    "XMODIFIERS",
    "INPUT_METHOD",
    "QT_IM_MODULE",
    "SDL_IM_MODULE",
];
const COLRV1_EMOJI_FONT_FILE: &str = "Noto-COLRv1.ttf";
#[cfg(all(desktop, target_os = "linux"))]
const TOLARIA_COLRV1_FONTCONFIG_FILE: &str = "tolaria-appimage-no-colrv1-emoji.conf";

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

fn has_non_empty_env<F>(get_var: &mut F, key: &str) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    get_var(key).is_some_and(|value| !value.trim().is_empty())
}

fn has_env<F>(get_var: &mut F, key: &str) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    get_var(key).is_some()
}

fn has_explicit_fontconfig_env<F>(get_var: &mut F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    ["FONTCONFIG_FILE", "FONTCONFIG_PATH"]
        .into_iter()
        .any(|key| has_non_empty_env(get_var, key))
}

fn can_apply_colrv1_font_guard<F>(get_var: &mut F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    if !is_linux_appimage_launch(&mut *get_var) {
        return false;
    }

    !has_explicit_fontconfig_env(get_var)
}

fn env_mentions_fcitx(value: &str) -> bool {
    value.to_ascii_lowercase().contains("fcitx")
}

fn has_fcitx_env_hint<F>(get_var: &mut F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    FCITX_ENV_HINT_KEYS
        .into_iter()
        .any(|key| get_var(key).is_some_and(|value| env_mentions_fcitx(&value)))
}

fn fcitx_gtk_im_module_override_with<F>(get_var: &mut F) -> Option<StartupEnvOverride>
where
    F: FnMut(&str) -> Option<String>,
{
    if !is_linux_appimage_launch(&mut *get_var) {
        return None;
    }
    if !is_wayland_session(&mut *get_var) {
        return None;
    }
    if has_env(get_var, "GTK_IM_MODULE") {
        return None;
    }
    if !has_fcitx_env_hint(get_var) {
        return None;
    }

    Some(FCITX_GTK_IM_MODULE_OVERRIDE)
}

fn is_wayland_session<F>(mut get_var: F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    has_non_empty_env(&mut get_var, "WAYLAND_DISPLAY")
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

    if has_non_empty_env(&mut get_var, "LD_PRELOAD")
        || get_var("TOLARIA_APPIMAGE_WAYLAND_PRELOAD_ATTEMPTED").is_some_and(|value| value == "1")
    {
        return None;
    }

    WAYLAND_CLIENT_PRELOAD_CANDIDATES
        .into_iter()
        .find(|path| candidate_matches(path))
}

fn colrv1_emoji_font_path_with<F, M>(mut get_var: F, mut match_emoji_font: M) -> Option<String>
where
    F: FnMut(&str) -> Option<String>,
    M: FnMut() -> Option<String>,
{
    if !can_apply_colrv1_font_guard(&mut get_var) {
        return None;
    }

    let font_path = match_emoji_font()?;

    std::path::Path::new(font_path.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(COLRV1_EMOJI_FONT_FILE))
        .then(|| font_path.trim().to_string())
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn colrv1_emoji_fontconfig_contents(rejected_font_path: &str) -> String {
    format!(
        r#"<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <selectfont>
    <rejectfont>
      <pattern>
        <patelt name="file">
          <string>{}</string>
        </patelt>
      </pattern>
    </rejectfont>
  </selectfont>
</fontconfig>
"#,
        escape_xml_text(rejected_font_path)
    )
}

fn startup_env_overrides_with<F>(mut get_var: F) -> Vec<StartupEnvOverride>
where
    F: FnMut(&str) -> Option<String>,
{
    if !is_linux_appimage_launch(&mut get_var) {
        return Vec::new();
    }

    let mut overrides: Vec<_> = LINUX_APPIMAGE_WEBKIT_OVERRIDES
        .into_iter()
        .filter(|env_override| !has_non_empty_env(&mut get_var, env_override.key))
        .collect();

    if let Some(env_override) = fcitx_gtk_im_module_override_with(&mut get_var) {
        overrides.push(env_override);
    }

    overrides
}

#[cfg(all(desktop, target_os = "linux"))]
pub(crate) fn apply_startup_env_overrides() {
    apply_wayland_client_preload();
    apply_colrv1_emoji_font_guard();

    for env_override in startup_env_overrides_with(|key| std::env::var(key).ok()) {
        std::env::set_var(env_override.key, env_override.value);
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn apply_colrv1_emoji_font_guard() {
    let Some(font_path) =
        colrv1_emoji_font_path_with(|key| std::env::var(key).ok(), match_emoji_font_path)
    else {
        return;
    };
    let Some(config_path) = colrv1_fontconfig_file_path() else {
        eprintln!("Tolaria AppImage COLRv1 font guard skipped: failed to resolve cache directory");
        return;
    };
    let Some(parent) = config_path.parent() else {
        return;
    };

    if let Err(error) = std::fs::create_dir_all(parent) {
        eprintln!("Tolaria AppImage COLRv1 font guard skipped: failed to prepare cache ({error})");
        return;
    }

    if let Err(error) = std::fs::write(&config_path, colrv1_emoji_fontconfig_contents(&font_path)) {
        eprintln!("Tolaria AppImage COLRv1 font guard skipped: failed to write config ({error})");
        return;
    }

    std::env::set_var("FONTCONFIG_FILE", config_path.as_os_str());
}

#[cfg(all(desktop, target_os = "linux"))]
fn match_emoji_font_path() -> Option<String> {
    let output = std::process::Command::new("fc-match")
        .args(["-f", "%{file}\n", "emoji"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(all(desktop, target_os = "linux"))]
fn colrv1_fontconfig_file_path() -> Option<std::path::PathBuf> {
    let cache_dir =
        dirs::cache_dir().or_else(|| dirs::home_dir().map(|home| home.join(".cache")))?;

    Some(
        cache_dir
            .join("tolaria")
            .join(TOLARIA_COLRV1_FONTCONFIG_FILE),
    )
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
        colrv1_emoji_font_path_with, colrv1_emoji_fontconfig_contents, elf_library_matches_process,
        startup_env_overrides_with, wayland_client_preload_path_with, StartupEnvOverride,
    };

    fn default_webkit_overrides() -> Vec<StartupEnvOverride> {
        vec![
            StartupEnvOverride {
                key: "WEBKIT_DISABLE_DMABUF_RENDERER",
                value: "1",
            },
            StartupEnvOverride {
                key: "WEBKIT_DISABLE_COMPOSITING_MODE",
                value: "1",
            },
        ]
    }

    fn default_webkit_and_fcitx_overrides() -> Vec<StartupEnvOverride> {
        let mut overrides = default_webkit_overrides();
        overrides.push(StartupEnvOverride {
            key: "GTK_IM_MODULE",
            value: "fcitx",
        });
        overrides
    }

    fn appimage_wayland_fcitx_env(key: &str, gtk_im_module: Option<&str>) -> Option<String> {
        match key {
            "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
            "WAYLAND_DISPLAY" => Some("wayland-1".to_string()),
            "XMODIFIERS" => Some("@im=fcitx".to_string()),
            "GTK_IM_MODULE" => gtk_im_module.map(ToOwned::to_owned),
            _ => None,
        }
    }

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

        assert_eq!(overrides, default_webkit_overrides());
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
    fn startup_env_overrides_enable_fcitx_gtk_module_for_wayland_appimage() {
        let overrides = startup_env_overrides_with(|key| appimage_wayland_fcitx_env(key, None));

        assert_eq!(overrides, default_webkit_and_fcitx_overrides());
    }

    #[test]
    fn startup_env_overrides_preserve_explicit_gtk_im_module() {
        let overrides =
            startup_env_overrides_with(|key| appimage_wayland_fcitx_env(key, Some("wayland")));

        assert_eq!(overrides, default_webkit_overrides());
    }

    #[test]
    fn startup_env_overrides_leave_non_fcitx_wayland_appimage_input_unchanged() {
        let overrides = startup_env_overrides_with(|key| match key {
            "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
            "WAYLAND_DISPLAY" => Some("wayland-1".to_string()),
            _ => None,
        });

        assert_eq!(overrides, default_webkit_overrides());
    }

    #[test]
    fn colrv1_font_guard_targets_reported_appimage_emoji_font() {
        let font_path = colrv1_emoji_font_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                _ => None,
            },
            || Some("/usr/share/fonts/google-noto-color-emoji-fonts/Noto-COLRv1.ttf".to_string()),
        );

        assert_eq!(
            font_path.as_deref(),
            Some("/usr/share/fonts/google-noto-color-emoji-fonts/Noto-COLRv1.ttf")
        );
    }

    #[test]
    fn colrv1_font_guard_preserves_explicit_fontconfig_settings() {
        let font_path = colrv1_emoji_font_path_with(
            |key| match key {
                "APPDIR" => Some("/tmp/.mount_Tolaria".to_string()),
                "FONTCONFIG_FILE" => Some("/tmp/custom-fontconfig.conf".to_string()),
                _ => None,
            },
            || Some("/usr/share/fonts/google-noto-color-emoji-fonts/Noto-COLRv1.ttf".to_string()),
        );

        assert_eq!(font_path, None);
    }

    #[test]
    fn colrv1_font_guard_ignores_other_emoji_fonts() {
        let font_path = colrv1_emoji_font_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                _ => None,
            },
            || Some("/usr/share/fonts/noto/NotoColorEmoji.ttf".to_string()),
        );

        assert_eq!(font_path, None);
    }

    #[test]
    fn colrv1_fontconfig_includes_system_fonts_and_rejects_matched_file() {
        let contents = colrv1_emoji_fontconfig_contents("/tmp/fonts/A&B/Noto-COLRv1.ttf");

        assert!(
            contents.contains("<include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>")
        );
        assert!(contents.contains("<patelt name=\"file\">"));
        assert!(contents.contains("<string>/tmp/fonts/A&amp;B/Noto-COLRv1.ttf</string>"));
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
