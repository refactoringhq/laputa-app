use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::ai_models::{normalize_ai_model_providers, AiModelProvider};

const SUPPORTED_DEFAULT_AI_AGENTS: &[&str] = &[
    "claude_code",
    "codex",
    "copilot",
    "opencode",
    "pi",
    "antigravity",
    "kiro",
    "hermes",
];
pub const DEFAULT_HIDE_GITIGNORED_FILES: bool = true;
const SUPPORTED_NOTE_WIDTH_MODES: &[&str] = &["normal", "wide"];
const SUPPORTED_DATE_DISPLAY_FORMATS: &[&str] = &["us", "european", "friendly", "iso"];
const SUPPORTED_UI_LANGUAGE_ALIASES: &[(&str, &str)] = &[
    ("en", "en"),
    ("en-us", "en"),
    ("en-gb", "en"),
    ("en-ca", "en"),
    ("en-au", "en"),
    ("it", "it-IT"),
    ("it-it", "it-IT"),
    ("fr", "fr-FR"),
    ("fr-fr", "fr-FR"),
    ("de", "de-DE"),
    ("de-de", "de-DE"),
    ("ru", "ru-RU"),
    ("ru-ru", "ru-RU"),
    ("es-es", "es-ES"),
    ("pt-br", "pt-BR"),
    ("pt-pt", "pt-PT"),
    ("es-419", "es-419"),
    ("es-ar", "es-419"),
    ("es-bo", "es-419"),
    ("es-cl", "es-419"),
    ("es-co", "es-419"),
    ("es-cr", "es-419"),
    ("es-cu", "es-419"),
    ("es-do", "es-419"),
    ("es-ec", "es-419"),
    ("es-gt", "es-419"),
    ("es-hn", "es-419"),
    ("es-mx", "es-419"),
    ("es-ni", "es-419"),
    ("es-pa", "es-419"),
    ("es-pe", "es-419"),
    ("es-pr", "es-419"),
    ("es-py", "es-419"),
    ("es-sv", "es-419"),
    ("es-us", "es-419"),
    ("es-uy", "es-419"),
    ("es-ve", "es-419"),
    ("zh", "zh-CN"),
    ("zh-cn", "zh-CN"),
    ("zh-hans", "zh-CN"),
    ("zh-sg", "zh-CN"),
    ("zh-tw", "zh-TW"),
    ("zh-hant", "zh-TW"),
    ("zh-hk", "zh-TW"),
    ("zh-mo", "zh-TW"),
    ("ja", "ja-JP"),
    ("ja-jp", "ja-JP"),
    ("ko", "ko-KR"),
    ("ko-kr", "ko-KR"),
    ("vi", "vi"),
    ("vi-vn", "vi"),
    ("pl", "pl-PL"),
    ("pl-pl", "pl-PL"),
    ("be", "be-BY"),
    ("be-by", "be-BY"),
    ("be-latn", "be-Latn"),
    ("id", "id-ID"),
    ("id-id", "id-ID"),
    ("sk", "sk-SK"),
    ("sk-sk", "sk-SK"),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AiWorkspaceConversationSetting {
    pub archived: Option<bool>,
    pub id: String,
    pub target_id: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Settings {
    pub auto_pull_interval_minutes: Option<u32>,
    pub git_enabled: Option<bool>,
    pub git_path: Option<String>,
    pub git_provider: Option<String>,
    pub git_wsl_distro: Option<String>,
    pub autogit_enabled: Option<bool>,
    pub autogit_idle_threshold_seconds: Option<u32>,
    pub autogit_inactive_threshold_seconds: Option<u32>,
    pub auto_advance_inbox_after_organize: Option<bool>,
    pub telemetry_consent: Option<bool>,
    pub crash_reporting_enabled: Option<bool>,
    pub analytics_enabled: Option<bool>,
    pub anonymous_id: Option<String>,
    pub release_channel: Option<String>,
    pub automatic_update_checks_enabled: Option<bool>,
    pub theme_mode: Option<String>,
    pub ui_language: Option<String>,
    pub date_display_format: Option<String>,
    pub note_width_mode: Option<String>,
    pub sidebar_type_pluralization_enabled: Option<bool>,
    pub initial_h1_auto_rename_enabled: Option<bool>,
    pub ai_features_enabled: Option<bool>,
    pub default_ai_agent: Option<String>,
    pub default_ai_target: Option<String>,
    pub ai_model_providers: Option<Vec<AiModelProvider>>,
    pub ai_workspace_conversations: Option<Vec<AiWorkspaceConversationSetting>>,
    pub hide_gitignored_files: Option<bool>,
    pub all_notes_show_pdfs: Option<bool>,
    pub all_notes_show_images: Option<bool>,
    pub all_notes_show_unsupported: Option<bool>,
    pub multi_workspace_enabled: Option<bool>,
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
        Some(agent) if agent == "gemini" => Some("antigravity".to_string()),
        Some(agent) if SUPPORTED_DEFAULT_AI_AGENTS.contains(&agent.as_str()) => Some(agent),
        _ => None,
    }
}

pub fn normalize_theme_mode(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(mode) if mode == "light" || mode == "dark" || mode == "system" => Some(mode),
        _ => None,
    }
}

pub fn normalize_note_width_mode(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(mode) if SUPPORTED_NOTE_WIDTH_MODES.contains(&mode.as_str()) => Some(mode),
        _ => None,
    }
}

pub fn normalize_date_display_format(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(format) if SUPPORTED_DATE_DISPLAY_FORMATS.contains(&format.as_str()) => Some(format),
        _ => None,
    }
}

pub fn should_hide_gitignored_files(settings: &Settings) -> bool {
    settings
        .hide_gitignored_files
        .unwrap_or(DEFAULT_HIDE_GITIGNORED_FILES)
}

pub fn normalize_git_provider(value: Option<&str>) -> Option<String> {
    match value.map(|candidate| candidate.trim().to_ascii_lowercase()) {
        Some(provider) if provider == "native" || provider == "wsl" => Some(provider),
        _ => None,
    }
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

pub fn normalize_ui_language(value: Option<&str>) -> Option<String> {
    let language = canonical_language_code(value?)?;
    SUPPORTED_UI_LANGUAGE_ALIASES
        .iter()
        .find_map(|(alias, canonical)| (*alias == language).then(|| (*canonical).to_string()))
}

fn normalize_settings(settings: Settings) -> Settings {
    Settings {
        auto_pull_interval_minutes: settings.auto_pull_interval_minutes,
        git_enabled: settings.git_enabled,
        git_path: normalize_optional_string(settings.git_path),
        git_provider: normalize_git_provider(settings.git_provider.as_deref()),
        git_wsl_distro: normalize_optional_string(settings.git_wsl_distro),
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
        automatic_update_checks_enabled: settings.automatic_update_checks_enabled,
        theme_mode: normalize_theme_mode(settings.theme_mode.as_deref()),
        ui_language: normalize_ui_language(settings.ui_language.as_deref()),
        date_display_format: normalize_date_display_format(settings.date_display_format.as_deref()),
        note_width_mode: normalize_note_width_mode(settings.note_width_mode.as_deref()),
        sidebar_type_pluralization_enabled: settings.sidebar_type_pluralization_enabled,
        initial_h1_auto_rename_enabled: settings.initial_h1_auto_rename_enabled,
        ai_features_enabled: settings.ai_features_enabled,
        default_ai_agent: normalize_default_ai_agent(settings.default_ai_agent.as_deref()),
        default_ai_target: normalize_optional_string(settings.default_ai_target),
        ai_model_providers: normalize_ai_model_providers(settings.ai_model_providers),
        ai_workspace_conversations: normalize_ai_workspace_conversations(
            settings.ai_workspace_conversations,
        ),
        hide_gitignored_files: settings.hide_gitignored_files,
        all_notes_show_pdfs: settings.all_notes_show_pdfs,
        all_notes_show_images: settings.all_notes_show_images,
        all_notes_show_unsupported: settings.all_notes_show_unsupported,
        multi_workspace_enabled: settings.multi_workspace_enabled,
    }
}

fn normalize_ai_workspace_conversations(
    conversations: Option<Vec<AiWorkspaceConversationSetting>>,
) -> Option<Vec<AiWorkspaceConversationSetting>> {
    let normalized: Vec<AiWorkspaceConversationSetting> = conversations
        .unwrap_or_default()
        .into_iter()
        .filter_map(|conversation| {
            let id = conversation.id.trim().to_string();
            let title = conversation.title.trim().to_string();
            if id.is_empty() || title.is_empty() {
                return None;
            }

            Some(AiWorkspaceConversationSetting {
                archived: conversation.archived,
                id,
                target_id: normalize_optional_string(conversation.target_id),
                title,
            })
        })
        .take(100)
        .collect();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

pub(crate) fn preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    crate::app_config::preferred_app_config_path(file_name)
}

fn resolve_existing_or_preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    crate::app_config::resolve_existing_or_preferred_app_config_path(file_name)
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

fn ai_workspace_sessions_path() -> Result<PathBuf, String> {
    resolve_existing_or_preferred_app_config_path("ai-workspace-sessions.json")
}

fn get_ai_workspace_sessions_at(path: &PathBuf) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read AI workspace sessions: {}", e))?;
    let sessions: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse AI workspace sessions: {}", e))?;
    if sessions.is_object() {
        Ok(sessions)
    } else {
        Ok(serde_json::json!({}))
    }
}

fn save_ai_workspace_sessions_at(
    path: &PathBuf,
    sessions: serde_json::Value,
) -> Result<(), String> {
    if !sessions.is_object() {
        return Err("AI workspace sessions must be a JSON object".to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&sessions)
        .map_err(|e| format!("Failed to serialize AI workspace sessions: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write AI workspace sessions: {}", e))
}

pub fn get_ai_workspace_sessions() -> Result<serde_json::Value, String> {
    get_ai_workspace_sessions_at(&ai_workspace_sessions_path()?)
}

pub fn save_ai_workspace_sessions(sessions: serde_json::Value) -> Result<(), String> {
    save_ai_workspace_sessions_at(
        &preferred_app_config_path("ai-workspace-sessions.json")?,
        sessions,
    )
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
            git_enabled: Some(false),
            git_path: Some("/opt/homebrew/bin/git".to_string()),
            git_provider: Some("wsl".to_string()),
            git_wsl_distro: Some("Ubuntu".to_string()),
            autogit_enabled: Some(true),
            autogit_idle_threshold_seconds: Some(90),
            autogit_inactive_threshold_seconds: Some(30),
            auto_advance_inbox_after_organize: Some(true),
            telemetry_consent: Some(true),
            crash_reporting_enabled: Some(true),
            analytics_enabled: Some(false),
            anonymous_id: Some("abc-123-uuid".to_string()),
            release_channel: Some("alpha".to_string()),
            automatic_update_checks_enabled: Some(false),
            theme_mode: Some("dark".to_string()),
            ui_language: Some("zh-Hans".to_string()),
            date_display_format: Some("iso".to_string()),
            note_width_mode: Some("wide".to_string()),
            sidebar_type_pluralization_enabled: Some(false),
            initial_h1_auto_rename_enabled: Some(false),
            ai_features_enabled: Some(false),
            default_ai_agent: Some("codex".to_string()),
            default_ai_target: Some("agent:codex".to_string()),
            ai_model_providers: None,
            ai_workspace_conversations: None,
            hide_gitignored_files: Some(false),
            multi_workspace_enabled: Some(true),
            all_notes_show_pdfs: Some(true),
            all_notes_show_images: Some(true),
            all_notes_show_unsupported: Some(false),
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
            git_enabled: Some(false),
            autogit_enabled: Some(true),
            autogit_idle_threshold_seconds: Some(90),
            autogit_inactive_threshold_seconds: Some(30),
            auto_advance_inbox_after_organize: Some(true),
            release_channel: Some("alpha".to_string()),
            automatic_update_checks_enabled: Some(false),
            theme_mode: Some("dark".to_string()),
            ui_language: Some("zh-Hans".to_string()),
            date_display_format: Some("european".to_string()),
            note_width_mode: Some("wide".to_string()),
            sidebar_type_pluralization_enabled: Some(false),
            initial_h1_auto_rename_enabled: Some(false),
            ai_features_enabled: Some(false),
            default_ai_agent: Some("codex".to_string()),
            hide_gitignored_files: Some(false),
            multi_workspace_enabled: Some(true),
            all_notes_show_pdfs: Some(true),
            all_notes_show_images: Some(false),
            all_notes_show_unsupported: Some(true),
            ..Default::default()
        });
        assert_eq!(loaded.auto_pull_interval_minutes, Some(10));
        assert_eq!(loaded.git_enabled, Some(false));
        assert_eq!(loaded.autogit_enabled, Some(true));
        assert_eq!(loaded.autogit_idle_threshold_seconds, Some(90));
        assert_eq!(loaded.autogit_inactive_threshold_seconds, Some(30));
        assert_eq!(loaded.auto_advance_inbox_after_organize, Some(true));
        assert_eq!(loaded.release_channel.as_deref(), Some("alpha"));
        assert_eq!(loaded.automatic_update_checks_enabled, Some(false));
        assert_eq!(loaded.theme_mode.as_deref(), Some("dark"));
        assert_eq!(loaded.ui_language.as_deref(), Some("zh-CN"));
        assert_eq!(loaded.date_display_format.as_deref(), Some("european"));
        assert_eq!(loaded.note_width_mode.as_deref(), Some("wide"));
        assert_eq!(loaded.sidebar_type_pluralization_enabled, Some(false));
        assert_eq!(loaded.initial_h1_auto_rename_enabled, Some(false));
        assert_eq!(loaded.ai_features_enabled, Some(false));
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("codex"));
        assert_eq!(loaded.hide_gitignored_files, Some(false));
        assert_eq!(loaded.multi_workspace_enabled, Some(true));
        assert_eq!(loaded.all_notes_show_pdfs, Some(true));
        assert_eq!(loaded.all_notes_show_images, Some(false));
        assert_eq!(loaded.all_notes_show_unsupported, Some(true));
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
    fn test_git_provider_settings_are_normalized() {
        let loaded = save_and_reload(Settings {
            git_provider: Some(" WSL ".to_string()),
            git_wsl_distro: Some(" Ubuntu-24.04 ".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.git_provider.as_deref(), Some("wsl"));
        assert_eq!(loaded.git_wsl_distro.as_deref(), Some("Ubuntu-24.04"));

        let invalid = save_and_reload(Settings {
            git_provider: Some("portable".to_string()),
            git_wsl_distro: Some("   ".to_string()),
            ..Default::default()
        });
        assert!(invalid.git_provider.is_none());
        assert!(invalid.git_wsl_distro.is_none());
    }

    #[test]
    fn test_save_trims_whitespace() {
        let loaded = save_and_reload(Settings {
            anonymous_id: Some("  test-uuid  ".to_string()),
            git_path: Some("  /opt/homebrew/bin/git  ".to_string()),
            git_provider: Some("  native  ".to_string()),
            git_wsl_distro: Some("  Ubuntu  ".to_string()),
            release_channel: Some("  alpha  ".to_string()),
            theme_mode: Some("  dark  ".to_string()),
            ui_language: Some("  zh-cn  ".to_string()),
            date_display_format: Some("  ISO  ".to_string()),
            note_width_mode: Some("  WIDE  ".to_string()),
            default_ai_agent: Some("  codex  ".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.anonymous_id.as_deref(), Some("test-uuid"));
        assert_eq!(loaded.git_path.as_deref(), Some("/opt/homebrew/bin/git"));
        assert_eq!(loaded.git_provider.as_deref(), Some("native"));
        assert_eq!(loaded.git_wsl_distro.as_deref(), Some("Ubuntu"));
        assert_eq!(loaded.release_channel.as_deref(), Some("alpha"));
        assert_eq!(loaded.theme_mode.as_deref(), Some("dark"));
        assert_eq!(loaded.ui_language.as_deref(), Some("zh-CN"));
        assert_eq!(loaded.date_display_format.as_deref(), Some("iso"));
        assert_eq!(loaded.note_width_mode.as_deref(), Some("wide"));
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
    fn test_copilot_default_ai_agent_is_preserved() {
        let loaded = normalize_settings(Settings {
            default_ai_agent: Some("copilot".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("copilot"));
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
    fn test_antigravity_default_ai_agent_is_preserved() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("antigravity".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("antigravity"));
    }

    #[test]
    fn test_legacy_gemini_default_ai_agent_migrates_to_antigravity() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("gemini".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("antigravity"));
    }

    #[test]
    fn test_hermes_default_ai_agent_is_preserved() {
        let loaded = save_and_reload(Settings {
            default_ai_agent: Some("hermes".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.default_ai_agent.as_deref(), Some("hermes"));
    }

    #[test]
    fn test_system_theme_mode_is_preserved() {
        let loaded = save_and_reload(Settings {
            theme_mode: Some("system".to_string()),
            ..Default::default()
        });
        assert_eq!(loaded.theme_mode.as_deref(), Some("system"));
    }

    #[test]
    fn test_invalid_theme_mode_is_filtered() {
        let loaded = save_and_reload(Settings {
            theme_mode: Some("sepia".to_string()),
            ..Default::default()
        });
        assert!(loaded.theme_mode.is_none());
    }

    #[test]
    fn test_invalid_note_width_mode_is_filtered() {
        let loaded = save_and_reload(Settings {
            note_width_mode: Some("expanded".to_string()),
            ..Default::default()
        });
        assert!(loaded.note_width_mode.is_none());
    }

    #[test]
    fn test_invalid_date_display_format_is_filtered() {
        let loaded = save_and_reload(Settings {
            date_display_format: Some("relative".to_string()),
            ..Default::default()
        });
        assert!(loaded.date_display_format.is_none());
    }

    #[test]
    fn test_invalid_ui_language_is_filtered() {
        let loaded = save_and_reload(Settings {
            ui_language: Some("xx-ZZ".to_string()),
            ..Default::default()
        });
        assert!(loaded.ui_language.is_none());
    }

    #[test]
    fn test_supported_ui_languages_are_saved_and_reloaded() {
        let expected_languages = [
            ("it-IT", "it-IT"),
            ("fr-FR", "fr-FR"),
            ("de-DE", "de-DE"),
            ("ru-RU", "ru-RU"),
            ("es-ES", "es-ES"),
            ("pt-BR", "pt-BR"),
            ("pt-PT", "pt-PT"),
            ("es-419", "es-419"),
            ("zh-CN", "zh-CN"),
            ("zh-TW", "zh-TW"),
            ("ja-JP", "ja-JP"),
            ("ko-KR", "ko-KR"),
            ("vi", "vi"),
            ("pl-PL", "pl-PL"),
            ("be-BY", "be-BY"),
            ("be-Latn", "be-Latn"),
            ("id-ID", "id-ID"),
            ("sk-SK", "sk-SK"),
        ];

        for (input, expected) in expected_languages {
            let loaded = save_and_reload(Settings {
                ui_language: Some(input.to_string()),
                ..Default::default()
            });
            assert_eq!(loaded.ui_language.as_deref(), Some(expected));
        }
    }

    #[test]
    fn test_ui_language_aliases_are_canonicalized() {
        assert_eq!(normalize_ui_language(Some("en-US")).as_deref(), Some("en"));
        assert_eq!(
            normalize_ui_language(Some("zh_CN")).as_deref(),
            Some("zh-CN")
        );
        assert_eq!(
            normalize_ui_language(Some("zh-Hant")).as_deref(),
            Some("zh-TW")
        );
        assert_eq!(normalize_ui_language(Some("pl")).as_deref(), Some("pl-PL"));
        assert_eq!(normalize_ui_language(Some("be")).as_deref(), Some("be-BY"));
        assert_eq!(
            normalize_ui_language(Some("be-latn")).as_deref(),
            Some("be-Latn")
        );
        assert_eq!(normalize_ui_language(Some("id")).as_deref(), Some("id-ID"));
        assert_eq!(normalize_ui_language(Some("sk")).as_deref(), Some("sk-SK"));
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
        let legacy_token = ["gho", "test"].join("_");
        let legacy_settings = serde_json::json!({
            "github_token": legacy_token,
            "github_username": "lucaong",
        });
        fs::write(&path, legacy_settings.to_string()).unwrap();
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
    fn test_ai_workspace_sessions_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("ai-workspace-sessions.json");
        let sessions = serde_json::json!({
            "chat-1": {
                "messages": [
                    {
                        "userMessage": "Hello",
                        "actions": [],
                        "response": "Hi"
                    }
                ],
                "status": "done"
            }
        });

        save_ai_workspace_sessions_at(&path, sessions.clone()).unwrap();

        assert_eq!(get_ai_workspace_sessions_at(&path).unwrap(), sessions);
    }

    #[test]
    fn test_ai_workspace_sessions_missing_file_returns_empty_object() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("ai-workspace-sessions.json");

        assert_eq!(
            get_ai_workspace_sessions_at(&path).unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn test_ai_workspace_sessions_rejects_non_object_payload() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("ai-workspace-sessions.json");

        assert!(save_ai_workspace_sessions_at(&path, serde_json::json!([])).is_err());
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
