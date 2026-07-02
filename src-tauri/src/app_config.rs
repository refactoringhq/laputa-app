use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const APP_CONFIG_POLICY_JSON: &str = include_str!("../../mcp-server/app-config-policy.json");

#[derive(Debug, Deserialize)]
struct AppConfigPolicy {
    current_namespace: String,
    legacy_namespace: String,
    namespace_read_order: Vec<AppConfigNamespace>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AppConfigNamespace {
    Current,
    Legacy,
}

impl AppConfigPolicy {
    fn current_namespace(&self) -> &str {
        &self.current_namespace
    }

    fn namespace_read_order(&self) -> &[AppConfigNamespace] {
        &self.namespace_read_order
    }

    fn namespace_dir(&self, namespace: &AppConfigNamespace) -> &str {
        match namespace {
            AppConfigNamespace::Current => &self.current_namespace,
            AppConfigNamespace::Legacy => &self.legacy_namespace,
        }
    }
}

fn app_config_policy() -> &'static AppConfigPolicy {
    static POLICY: OnceLock<AppConfigPolicy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(APP_CONFIG_POLICY_JSON)
            .expect("mcp-server/app-config-policy.json must be valid")
    })
}

fn app_config_dir() -> Result<PathBuf, String> {
    primary_config_dir().ok_or_else(|| "Could not determine config directory".to_string())
}

fn primary_config_dir() -> Option<PathBuf> {
    primary_config_dir_from_sources(
        explicit_xdg_config_home(),
        dirs::home_dir(),
        dirs::config_dir(),
    )
}

fn primary_config_dir_from_sources(
    explicit_xdg: Option<PathBuf>,
    home: Option<PathBuf>,
    platform: Option<PathBuf>,
) -> Option<PathBuf> {
    explicit_xdg
        .and_then(absolute_path)
        .or_else(|| default_xdg_config_home(home))
        .or(platform)
}

fn explicit_xdg_config_home() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("XDG_CONFIG_HOME")?))
}

fn default_xdg_config_home(home: Option<PathBuf>) -> Option<PathBuf> {
    if cfg!(windows) {
        None
    } else {
        home.and_then(absolute_path)
            .map(|path| path.join(".config"))
    }
}

fn absolute_path(path: PathBuf) -> Option<PathBuf> {
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn preferred_path_in(config_dir: &Path, file_name: &str) -> PathBuf {
    config_dir
        .join(app_config_policy().current_namespace())
        .join(file_name)
}

fn existing_or_preferred_path_in_dirs(config_dirs: &[PathBuf], file_name: &str) -> PathBuf {
    let policy = app_config_policy();
    for config_dir in config_dirs {
        for namespace in policy.namespace_read_order() {
            let candidate = config_dir
                .join(policy.namespace_dir(namespace))
                .join(file_name);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    preferred_path_in(&config_dirs[0], file_name)
}

fn app_config_read_dirs() -> Result<Vec<PathBuf>, String> {
    let primary = app_config_dir()?;
    let mut dirs = vec![primary.clone()];
    if let Some(platform) = dirs::config_dir() {
        if platform != primary {
            dirs.push(platform);
        }
    }
    Ok(dirs)
}

pub(crate) fn preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(preferred_path_in(&app_config_dir()?, file_name))
}

pub(crate) fn resolve_existing_or_preferred_app_config_path(
    file_name: &str,
) -> Result<PathBuf, String> {
    Ok(existing_or_preferred_path_in_dirs(
        &app_config_read_dirs()?,
        file_name,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute_temp_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(name)
    }

    #[test]
    fn absolute_xdg_config_home_is_accepted() {
        let path = absolute_temp_dir("tolaria-xdg-config");
        assert_eq!(absolute_path(path.clone()), Some(path));
    }

    #[test]
    fn relative_xdg_config_home_is_ignored() {
        assert!(absolute_path(PathBuf::from("relative-config")).is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn default_unix_config_home_uses_home_dot_config() {
        let home = absolute_temp_dir("tolaria-home");
        let platform = absolute_temp_dir("tolaria-platform-config");

        assert_eq!(
            primary_config_dir_from_sources(None, Some(home.clone()), Some(platform)),
            Some(home.join(".config"))
        );
    }

    #[test]
    fn explicit_xdg_config_home_wins_over_default_and_platform_paths() {
        let explicit = absolute_temp_dir("tolaria-explicit-xdg");
        let home = absolute_temp_dir("tolaria-home");
        let platform = absolute_temp_dir("tolaria-platform-config");

        assert_eq!(
            primary_config_dir_from_sources(Some(explicit.clone()), Some(home), Some(platform)),
            Some(explicit)
        );
    }

    #[test]
    fn relative_xdg_config_home_falls_back_to_platform_when_no_home_is_available() {
        let platform = absolute_temp_dir("tolaria-platform-config");

        assert_eq!(
            primary_config_dir_from_sources(
                Some(PathBuf::from("relative-config")),
                None,
                Some(platform.clone())
            ),
            Some(platform)
        );
    }

    #[test]
    fn preferred_path_uses_tolaria_namespace() {
        let config_dir = absolute_temp_dir("tolaria-config-root");
        let path = preferred_path_in(&config_dir, "settings.json");
        assert_eq!(
            path,
            config_dir.join("com.tolaria.app").join("settings.json")
        );
    }

    #[test]
    fn existing_preferred_path_wins_over_legacy_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let preferred = dir
            .path()
            .join(app_config_policy().current_namespace())
            .join("settings.json");
        let legacy = dir
            .path()
            .join(app_config_policy().legacy_namespace.as_str())
            .join("settings.json");
        std::fs::create_dir_all(preferred.parent().unwrap()).unwrap();
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        std::fs::write(&preferred, "{}").unwrap();
        std::fs::write(&legacy, "{}").unwrap();

        assert_eq!(
            existing_or_preferred_path_in_dirs(&[dir.path().to_path_buf()], "settings.json"),
            preferred
        );
    }

    #[test]
    fn legacy_path_is_read_when_preferred_path_is_absent() {
        let dir = tempfile::TempDir::new().unwrap();
        let legacy = dir
            .path()
            .join(app_config_policy().legacy_namespace.as_str())
            .join("vaults.json");
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        std::fs::write(&legacy, r#"{"vaults":[]}"#).unwrap();

        assert_eq!(
            existing_or_preferred_path_in_dirs(&[dir.path().to_path_buf()], "vaults.json"),
            legacy
        );
    }

    #[test]
    fn settings_and_vault_registry_share_namespace_fallback_order() {
        let dir = tempfile::TempDir::new().unwrap();

        for file_name in ["settings.json", "vaults.json"] {
            let legacy = dir
                .path()
                .join(app_config_policy().legacy_namespace.as_str())
                .join(file_name);
            std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
            std::fs::write(&legacy, "{}").unwrap();

            assert_eq!(
                existing_or_preferred_path_in_dirs(&[dir.path().to_path_buf()], file_name),
                legacy
            );
        }
    }

    #[test]
    fn previous_platform_config_dir_is_read_when_primary_dir_is_empty() {
        let primary = tempfile::TempDir::new().unwrap();
        let platform = tempfile::TempDir::new().unwrap();
        let existing = platform
            .path()
            .join(app_config_policy().current_namespace())
            .join("settings.json");
        std::fs::create_dir_all(existing.parent().unwrap()).unwrap();
        std::fs::write(&existing, "{}").unwrap();

        assert_eq!(
            existing_or_preferred_path_in_dirs(
                &[primary.path().to_path_buf(), platform.path().to_path_buf()],
                "settings.json"
            ),
            existing
        );
    }

    #[test]
    fn missing_files_use_preferred_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let expected = dir
            .path()
            .join(app_config_policy().current_namespace())
            .join("last-vault.txt");

        assert_eq!(
            existing_or_preferred_path_in_dirs(&[dir.path().to_path_buf()], "last-vault.txt"),
            expected
        );
    }
}
