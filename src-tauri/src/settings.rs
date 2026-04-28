use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_CONFIG_DIR: &str = "com.tolaria.app";
const LEGACY_APP_CONFIG_DIR: &str = "com.laputa.app";
const SUPPORTED_DEFAULT_AI_AGENTS: &[&str] = &["claude_code", "codex", "opencode", "pi"];
pub const DEFAULT_HIDE_GITIGNORED_FILES: bool = true;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Settings {
    pub auto_pull_interval_minutes: Option<u32>,
    pub autogit_enabled: Option<bool>,
    pub autogit_idle_threshold_seconds: Option<u32>,
    pub autogit_inactive_threshold_seconds: Option<u32>,
    pub auto_advance_inbox_after_organize: Option<bool>,
    pub telemetry_consent: Option<bool>,
    pub crash_reporting_enabled: Option<bool>,
    pub analytics_enabled: Option<bool>,
    pub anonymous_id: Option<String>,
    pub release_channel: Option<String>,
    pub theme_mode: Option<String>,
    pub ui_language: Option<String>,
    pub initial_h1_auto_rename_enabled: Option<bool>,
    pub default_ai_agent: Option<String>,
    pub hide_gitignored_files: Option<bool>,
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_string())
        .filter(|candidate| !candidate.is_empty())
}

fn normalize_optional_positive_u32(value: Option<u32>) -> Option<u32> {
    value.filter(|candidate| *candidate > 0)
}

pub fn normalize_release_channel(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(channel) if channel == "alpha" => Some(channel),
        _ => None,
    }
}

pub fn effective_release_channel(value: Option<&str>) -> &'static str {
    if normalize_release_channel(value).is_some() {
        "alpha"
    } else {
        "stable"
    }
}

pub fn normalize_default_ai_agent(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(agent) if SUPPORTED_DEFAULT_AI_AGENTS.contains(&agent.as_str()) => Some(agent),
        _ => None,
    }
}

pub fn normalize_theme_mode(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(mode) if mode == "light" || mode == "dark" => Some(mode),
        _ => None,
    }
}

pub fn should_hide_gitignored_files(settings: &Settings) -> bool {
    settings
        .hide_gitignored_files
        .unwrap_or(DEFAULT_HIDE_GITIGNORED_FILES)
}

pub fn hide_gitignored_files_enabled() -> bool {
    get_settings()
        .map(|settings| should_hide_gitignored_files(&settings))
        .unwrap_or(DEFAULT_HIDE_GITIGNORED_FILES)
}

fn canonical_language_code(value: &str) -> Option<String> {
    let code = value.trim().replace('_', "-").to_ascii_lowercase();
    if code.is_empty() {
        None
    } else {
        Some(code)
    }
}

fn is_english_language(code: &str) -> bool {
    code == "en" || code.starts_with("en-")
}

fn is_simplified_chinese_language(code: &str) -> bool {
    matches!(code, "zh" | "zh-cn" | "zh-hans" | "zh-sg")
}

pub fn normalize_ui_language(value: Option<&str>) -> Option<String> {
    let language = canonical_language_code(value?)?;
    if is_english_language(&language) {
        return Some("en".to_string());
    }
    if is_simplified_chinese_language(&language) {
        return Some("zh-Hans".to_string());
    }
    None
}

fn normalize_settings(settings: Settings) -> Settings {
    Settings {
        auto_pull_interval_minutes: settings.auto_pull_interval_minutes,
        autogit_enabled: settings.autogit_enabled,
        autogit_idle_threshold_seconds: normalize_optional_positive_u32(
            settings.autogit_idle_threshold_seconds,
        ),
        autogit_inactive_threshold_seconds: normalize_optional_positive_u32(
            settings.autogit_inactive_threshold_seconds,
        ),
        auto_advance_inbox_after_organize: settings.auto_advance_inbox_after_organize,
        telemetry_consent: settings.telemetry_consent,
        crash_reporting_enabled: settings.crash_reporting_enabled,
        analytics_enabled: settings.analytics_enabled,
        anonymous_id: normalize_optional_string(settings.anonymous_id),
        release_channel: normalize_release_channel(settings.release_channel.as_deref()),
        theme_mode: normalize_theme_mode(settings.theme_mode.as_deref()),
        ui_language: normalize_ui_language(settings.ui_language.as_deref()),
        initial_h1_auto_rename_enabled: settings.initial_h1_auto_rename_enabled,
        default_ai_agent: normalize_default_ai_agent(settings.default_ai_agent.as_deref()),
        hide_gitignored_files: settings.hide_gitignored_files,
    }
}

fn app_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir().ok_or_else(|| "Could not determine config directory".to_string())
}

pub(crate) fn preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(app_config_dir()?.join(APP_CONFIG_DIR).join(file_name))
}

fn resolve_existing_or_preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    let preferred = preferred_app_config_path(file_name)?;
    if preferred.exists() {
        return Ok(preferred);
    }

    let legacy = app_config_dir()?
        .join(LEGACY_APP_CONFIG_DIR)
        .join(file_name);
    if legacy.exists() {
        return Ok(legacy);
    }

    Ok(preferred)
}

fn settings_path() -> Result<PathBuf, String> {
    resolve_existing_or_preferred_app_config_path("settings.json")
}

fn get_settings_at(path: &PathBuf) -> Result<Settings, String> {
    if !path.exists() {
        return Ok(Settings::default());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read settings: {}", e))?;
    let settings =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))?;
    Ok(normalize_settings(settings))
}

fn save_settings_at(path: &PathBuf, settings: Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let cleaned = normalize_settings(settings);

    let json = serde_json::to_string_pretty(&cleaned)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write settings: {}", e))
}

pub fn get_settings() -> Result<Settings, String> {
    get_settings_at(&settings_path()?)
}

pub fn save_settings(settings: Settings) -> Result<(), String> {
    save_settings_at(&preferred_app_config_path("settings.json")?, settings)
}

fn last_vault_file() -> Result<PathBuf, String> {
    resolve_existing_or_preferred_app_config_path("last-vault.txt")
}

fn get_last_vault_at(path: &PathBuf) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn set_last_vault_at(path: &PathBuf, vault_path: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    fs::write(path, vault_path.trim())
        .map_err(|e| format!("Failed to write last vault path: {}", e))
}

pub fn get_last_vault() -> Option<String> {
    last_vault_file().ok().and_then(|p| get_last_vault_at(&p))
}

pub fn set_last_vault(vault_path: &str) -> Result<(), String> {
    set_last_vault_at(&preferred_app_config_path("last-vault.txt")?, vault_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_empty_settings(settings: &Settings) {
        assert_eq!(settings, &Settings::default());
    }

    /// Helper: save settings to a temp file and reload them.
    fn save_and_reload(settings: Settings) -> Settings {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        save_settings_at(&path, settings).unwrap();
        get_settings_at(&path).unwrap()
    }

    fn create_last_vault_path(path_parts: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::TempDir::new().unwrap();
        let path = path_parts
            .iter()
            .fold(dir.path().to_path_buf(), |acc, part| acc.join(part));
        (dir, path)
    }

    fn write_and_assert_last_vault(path: &PathBuf, value: &str) {
        set_last_vault_at(path, value).unwrap();
        assert_eq!(get_last_vault_at(path).as_deref(), Some(value));
    }

    #[test]
    fn test_default_settings_all_none() {
        assert_empty_settings(&Settings::default());
    }

    #[test]
    fn test_settings_json_roundtrip() {
        let settings = Settings {
            auto_pull_interval_minutes: Some(10),
            autogit_enabled: Some(true),
            autogit_idle_threshold_seconds: Some(90),
            autogit_inactive_threshold_seconds: Some(30),
            auto_advance_inbox_after_organize: Some(true),
            telemetry_consent: Some(true),
            crash_reporting_enabled: Some(true),
            analytics_enabled: Some(false),
            anonymous_id: Some("abc-123-uuid".to_string()),
            release_channel: Some("alpha".to_string()),
            theme_mode: Some("dark".to_string()),
            ui_language: Some("zh-Hans".to_string()),
            initial_h1_auto_rename_enabled: Some(false),
            default_ai_agent: Some("codex".to_string()),
            hide_gitignored_files: Some(false),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, settings);
    }

    #[test]
    fn test_get_settings_returns_default_for_missing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = get_settings_at(&path).unwrap();
        assert!(result.auto_pull_interval_minutes.is_none());
    }

    #[test]
    fn test_save_and_load_preserves_values() {
        let loaded = save_and_reload(Settings {
            auto_pull_interval_minutes: Some(10),
            autogit_enabled: Some(true),
            autogit_idle_threshold_seconds: Some(90),
            autogit_inactive_threshold_seconds: Some(30),
            auto_advance_inbox_after_organize: Some(true),
            release_channel: Some("alpha".to_string()),
            theme_mode: Some("dark".to_string()),
            ui_language: Some("zh-Hans".to_string()),
            initial_h1_auto_rename_enabled: Some(false),
            default_ai_agent: Some("codex".to_string()),
            hide_gitignored_files: Some(false),
            ..Default::default()
        });
        assert_eq!(loaded.auto_pull_interval_minutes, Some(10));
        assert_eq!(loaded.autogit_enabled, Some(true));
        assert_eq!(loaded.autogit_idle_threshold_seconds, Some(90));
        assert_eq!(loaded.autogit_inactive_threshold_seconds, Some(30));
        assert_eq!(loaded.auto_advance_inbox_after_organize, Some(true));
        assert_eq!(loaded.release_channel.as_deref(), Some("alpha"));
        assert_eq!(loaded.theme_mode.as_deref(), Some("dark"));
        assert_eq!(loaded.ui_language.as_deref(), Some("zh-Hans"));
        assert_eq!(loaded.initial_h1_auto_rename_enabled, Some(false));
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("codex"));
        assert_eq!(loaded.hide_gitignored_files, Some(false));
    }

    #[test]
    fn test_gitignored_files_are_hidden_by_default() {
        assert!(should_hide_gitignored_files(&Settings::default()));
        assert!(should_hide_gitignored_files(&Settings {
            hide_gitignored_files: Some(true),
            ..Default::default()
        }));
        assert!(!should_hide_gitignored_files(&Settings {
            hide_gitignored_files: Some(false),
            ..Default::default()
        }));
    }

    #[test]
    fn test_save_trims_whitespace() {
        let loaded = save_and_reload(Settings {
            anonymous_id: Some("  test-uuid  ".to_string()),
            release_channel: Some("  alpha  ".to_string()),
            theme_mode: Some("  dark  ".to_string()),
            ui_language: Some("  zh-cn  ".to_string()),
            default_ai_agent: Some("  codex  ".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.anonymous_id.as_deref(), Some("test-uuid"));
        assert_eq!(loaded.release_channel.as_deref(), Some("alpha"));
        assert_eq!(loaded.theme_mode.as_deref(), Some("dark"));
        assert_eq!(loaded.ui_language.as_deref(), Some("zh-Hans"));
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("codex"));
    }

    #[test]
    fn test_save_filters_empty_and_whitespace_only() {
        let loaded = save_and_reload(Settings {
            release_channel: Some("".to_string()),
            ..Default::default()
        });
        assert!(loaded.release_channel.is_none());
    }

    #[test]
    fn test_non_positive_autogit_thresholds_are_filtered() {
        let loaded = save_and_reload(Settings {
            autogit_idle_threshold_seconds: Some(0),
            autogit_inactive_threshold_seconds: Some(0),
            ..Default::default()
        });
        assert!(loaded.autogit_idle_threshold_seconds.is_none());
        assert!(loaded.autogit_inactive_threshold_seconds.is_none());
    }

    #[test]
    fn test_non_alpha_release_channels_normalize_to_stable() {
        let loaded = save_and_reload(Settings {
            release_channel: Some("beta".to_string()),
            ..Default::default()
        });
        assert!(loaded.release_channel.is_none());
    }

    #[test]
    fn test_invalid_default_ai_agent_is_filtered() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("cursor".to_string()),
            ..Default::default()
        });
        assert!(loaded.default_ai_agent.is_none());
    }

    #[test]
    fn test_opencode_default_ai_agent_is_preserved() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("opencode".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("opencode"));
    }

    #[test]
    fn test_pi_default_ai_agent_is_preserved() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("pi".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("pi"));
    }

    #[test]
    fn test_invalid_theme_mode_is_filtered() {
        let loaded = save_and_reload(Settings {
            theme_mode: Some("system".to_string()),
            ..Default::default()
        });
        assert!(loaded.theme_mode.is_none());
    }

    #[test]
    fn test_invalid_ui_language_is_filtered() {
        let loaded = save_and_reload(Settings {
            ui_language: Some("fr-FR".to_string()),
            ..Default::default()
        });
        assert!(loaded.ui_language.is_none());
    }

    #[test]
    fn test_ui_language_aliases_are_canonicalized() {
        assert_eq!(normalize_ui_language(Some("en-US")).as_deref(), Some("en"));
        assert_eq!(
            normalize_ui_language(Some("zh_CN")).as_deref(),
            Some("zh-Hans")
        );
    }

    #[test]
    fn test_get_settings_normalizes_legacy_beta_channel() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"release_channel":"beta"}"#).unwrap();

        let loaded = get_settings_at(&path).unwrap();
        assert!(loaded.release_channel.is_none());
    }

    #[test]
    fn test_save_creates_parent_directories() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("dir").join("settings.json");

        save_settings_at(
            &path,
            Settings {
                anonymous_id: Some("test-uuid".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(path.exists());
        assert_eq!(
            get_settings_at(&path).unwrap().anonymous_id.as_deref(),
            Some("test-uuid")
        );
    }

    #[test]
    fn test_get_settings_malformed_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        fs::write(&path, "not valid json{{{").unwrap();

        let err = get_settings_at(&path).unwrap_err();
        assert!(err.contains("Failed to parse settings"));
    }

    #[test]
    fn test_telemetry_fields_roundtrip() {
        let loaded = save_and_reload(Settings {
            telemetry_consent: Some(true),
            crash_reporting_enabled: Some(true),
            analytics_enabled: Some(false),
            anonymous_id: Some("test-uuid-v4".to_string()),
            ..Default::default()
        });
        assert_eq!(
            loaded,
            Settings {
                telemetry_consent: Some(true),
                crash_reporting_enabled: Some(true),
                analytics_enabled: Some(false),
                anonymous_id: Some("test-uuid-v4".to_string()),
                ..Default::default()
            }
        );
    }

    #[test]
    fn test_old_settings_json_missing_telemetry_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        // Simulate an old settings.json that still contains removed GitHub auth fields.
        fs::write(
            &path,
            r#"{"github_token":"gho_test","github_username":"lucaong"}"#,
        )
        .unwrap();
        let loaded = get_settings_at(&path).unwrap();
        assert_empty_settings(&loaded);
    }

    #[test]
    fn test_settings_path_returns_ok() {
        let result = settings_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        let path = path.to_str().unwrap();
        assert!(path.contains("com.tolaria.app") || path.contains("com.laputa.app"));
    }

    #[test]
    fn test_preferred_settings_path_uses_tolaria_namespace() {
        let result = preferred_app_config_path("settings.json");
        assert!(result.is_ok());
        assert!(result
            .unwrap()
            .to_str()
            .unwrap()
            .contains("com.tolaria.app"));
    }

    #[test]
    fn test_get_last_vault_returns_none_for_missing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("last-vault.txt");
        assert!(get_last_vault_at(&path).is_none());
    }

    #[test]
    fn test_set_and_get_last_vault_roundtrip() {
        let (_dir, path) = create_last_vault_path(&["last-vault.txt"]);
        write_and_assert_last_vault(&path, "/Users/test/MyVault");
    }

    #[test]
    fn test_set_last_vault_trims_whitespace() {
        let (_dir, path) = create_last_vault_path(&["last-vault.txt"]);
        write_and_assert_last_vault(&path, "/Users/test/Vault");
    }

    #[test]
    fn test_get_last_vault_returns_none_for_empty_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("last-vault.txt");
        fs::write(&path, "   \n  ").unwrap();
        assert!(get_last_vault_at(&path).is_none());
    }

    #[test]
    fn test_set_last_vault_creates_parent_directories() {
        let (_dir, path) = create_last_vault_path(&["nested", "dir", "last-vault.txt"]);
        write_and_assert_last_vault(&path, "/Users/test/Vault");
        assert!(path.exists());
    }

    #[test]
    fn test_set_last_vault_overwrites_previous() {
        let (_dir, path) = create_last_vault_path(&["last-vault.txt"]);
        write_and_assert_last_vault(&path, "/Users/test/OldVault");
        write_and_assert_last_vault(&path, "/Users/test/NewVault");
    }
}
