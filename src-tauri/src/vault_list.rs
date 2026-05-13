use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::commands::expand_tilde;

const APP_CONFIG_DIR: &str = "com.tolaria.app";
const LEGACY_APP_CONFIG_DIR: &str = "com.laputa.app";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct VaultEntry {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    #[serde(rename = "shortLabel")]
    pub short_label: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub mounted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultList {
    pub vaults: Vec<VaultEntry>,
    pub active_vault: Option<String>,
    #[serde(default)]
    pub default_workspace_path: Option<String>,
    #[serde(default)]
    pub hidden_defaults: Vec<String>,
}

fn app_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir().ok_or_else(|| "Could not determine config directory".to_string())
}

fn preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
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

fn vault_list_path() -> Result<PathBuf, String> {
    resolve_existing_or_preferred_app_config_path("vaults.json")
}

fn load_at(path: &PathBuf) -> Result<VaultList, String> {
    if !path.exists() {
        return Ok(VaultList::default());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read vault list: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault list: {}", e))
}

fn save_at(path: &PathBuf, list: &VaultList) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(list)
        .map_err(|e| format!("Failed to serialize vault list: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write vault list: {}", e))
}

fn expand_optional_tilde_path(path: Option<String>) -> Option<String> {
    path.map(|value| expand_tilde(&value).into_owned())
}

fn expand_vault_list_paths(mut list: VaultList) -> VaultList {
    for vault in &mut list.vaults {
        vault.path = expand_tilde(&vault.path).into_owned();
    }
    list.active_vault = expand_optional_tilde_path(list.active_vault);
    list.default_workspace_path = expand_optional_tilde_path(list.default_workspace_path);
    list.hidden_defaults = list
        .hidden_defaults
        .into_iter()
        .map(|path| expand_tilde(&path).into_owned())
        .collect();
    list
}

pub fn load_vault_list() -> Result<VaultList, String> {
    load_at(&vault_list_path()?).map(expand_vault_list_paths)
}

pub fn save_vault_list(list: &VaultList) -> Result<(), String> {
    save_at(&preferred_app_config_path("vaults.json")?, list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn save_and_reload(list: &VaultList) -> VaultList {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("vaults.json");
        save_at(&path, list).unwrap();
        load_at(&path).unwrap()
    }

    #[test]
    fn default_vault_list_is_empty() {
        let vl = VaultList::default();
        assert!(vl.vaults.is_empty());
        assert!(vl.active_vault.is_none());
    }

    #[test]
    fn roundtrip_preserves_data() {
        let list = VaultList {
            vaults: vec![
                VaultEntry {
                    label: "My Vault".to_string(),
                    path: "/Users/luca/Laputa".to_string(),
                    ..Default::default()
                },
                VaultEntry {
                    label: "Work".to_string(),
                    path: "/Users/luca/Work".to_string(),
                    ..Default::default()
                },
            ],
            active_vault: Some("/Users/luca/Laputa".to_string()),
            default_workspace_path: None,
            hidden_defaults: vec![],
        };
        let loaded = save_and_reload(&list);
        assert_eq!(loaded.vaults.len(), 2);
        assert_eq!(loaded.vaults[0].label, "My Vault");
        assert_eq!(loaded.vaults[0].path, "/Users/luca/Laputa");
        assert_eq!(loaded.vaults[1].label, "Work");
        assert_eq!(loaded.active_vault.as_deref(), Some("/Users/luca/Laputa"));
    }

    #[test]
    fn load_returns_default_for_missing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = load_at(&path).unwrap();
        assert!(result.vaults.is_empty());
        assert!(result.active_vault.is_none());
    }

    #[test]
    fn load_returns_error_for_malformed_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        fs::write(&path, "not valid json{{{").unwrap();
        let err = load_at(&path).unwrap_err();
        assert!(err.contains("Failed to parse vault list"));
    }

    #[test]
    fn save_creates_parent_directories() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("dir").join("vaults.json");
        let list = VaultList {
            vaults: vec![VaultEntry {
                label: "Test".to_string(),
                path: "/tmp/test".to_string(),
                ..Default::default()
            }],
            active_vault: None,
            default_workspace_path: None,
            hidden_defaults: vec![],
        };
        save_at(&path, &list).unwrap();
        assert!(path.exists());
        let loaded = load_at(&path).unwrap();
        assert_eq!(loaded.vaults.len(), 1);
    }

    #[test]
    fn vault_list_path_returns_ok() {
        let result = vault_list_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        let path = path.to_str().unwrap();
        assert!(path.contains("com.tolaria.app") || path.contains("com.laputa.app"));
    }

    #[test]
    fn preferred_vault_list_path_uses_tolaria_namespace() {
        let result = preferred_app_config_path("vaults.json");
        assert!(result.is_ok());
        assert!(result
            .unwrap()
            .to_str()
            .unwrap()
            .contains("com.tolaria.app"));
    }

    #[test]
    fn empty_vault_list_roundtrip() {
        let list = VaultList::default();
        let loaded = save_and_reload(&list);
        assert!(loaded.vaults.is_empty());
        assert!(loaded.active_vault.is_none());
        assert!(loaded.hidden_defaults.is_empty());
    }

    #[test]
    fn hidden_defaults_roundtrip() {
        let list = VaultList {
            vaults: vec![],
            active_vault: None,
            default_workspace_path: None,
            hidden_defaults: vec!["/Users/luca/Documents/Getting Started".to_string()],
        };
        let loaded = save_and_reload(&list);
        assert_eq!(loaded.hidden_defaults.len(), 1);
        assert_eq!(
            loaded.hidden_defaults[0],
            "/Users/luca/Documents/Getting Started"
        );
    }

    #[test]
    fn workspace_metadata_roundtrip() {
        let list = VaultList {
            vaults: vec![VaultEntry {
                label: "Team Notes".to_string(),
                path: "/tmp/team".to_string(),
                alias: Some("team".to_string()),
                short_label: Some("TN".to_string()),
                color: Some("green".to_string()),
                icon: Some("briefcase".to_string()),
                mounted: Some(false),
            }],
            active_vault: Some("/tmp/personal".to_string()),
            default_workspace_path: Some("/tmp/team".to_string()),
            hidden_defaults: vec![],
        };

        let loaded = save_and_reload(&list);

        assert_eq!(loaded.default_workspace_path.as_deref(), Some("/tmp/team"));
        assert_eq!(loaded.vaults[0].alias.as_deref(), Some("team"));
        assert_eq!(loaded.vaults[0].short_label.as_deref(), Some("TN"));
        assert_eq!(loaded.vaults[0].color.as_deref(), Some("green"));
        assert_eq!(loaded.vaults[0].icon.as_deref(), Some("briefcase"));
        assert_eq!(loaded.vaults[0].mounted, Some(false));
    }

    #[test]
    fn loaded_vault_list_expands_tilde_paths() {
        let home = dirs::home_dir().unwrap();
        let expected_vault = home.join("Workspace/refactoring-vault");
        let expected_hidden = home.join("Workspace/tolaria/demo-vault-v2");
        let list = VaultList {
            vaults: vec![VaultEntry {
                label: "Refactoring".to_string(),
                path: "~/Workspace/refactoring-vault".to_string(),
                ..Default::default()
            }],
            active_vault: Some("~/Workspace/refactoring-vault".to_string()),
            default_workspace_path: Some("~/Workspace/refactoring-vault".to_string()),
            hidden_defaults: vec!["~/Workspace/tolaria/demo-vault-v2".to_string()],
        };

        let loaded = expand_vault_list_paths(list);

        assert_eq!(loaded.vaults[0].path, expected_vault.to_string_lossy());
        assert_eq!(loaded.active_vault.as_deref(), expected_vault.to_str());
        assert_eq!(
            loaded.default_workspace_path.as_deref(),
            expected_vault.to_str()
        );
        assert_eq!(loaded.hidden_defaults[0], expected_hidden.to_string_lossy());
    }

    #[test]
    fn load_legacy_format_without_hidden_defaults() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("legacy.json");
        // Simulate old format without hidden_defaults field
        fs::write(&path, r#"{"vaults":[],"active_vault":null}"#).unwrap();
        let loaded = load_at(&path).unwrap();
        assert!(loaded.hidden_defaults.is_empty());
    }
}
