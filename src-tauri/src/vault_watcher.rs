use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const VAULT_CHANGED_EVENT: &str = "vault-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChangedPayload {
    vault_path: String,
    paths: Vec<String>,
}

fn has_ignored_component(path: &Path) -> bool {
    path.components().any(|part| {
        let component = part.as_os_str();
        component == OsStr::new(".git") || component == OsStr::new("node_modules")
    })
}

fn is_temp_file_name(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name == ".DS_Store"
        || name == ".tolaria-rename-txn"
        || name.starts_with(".#")
        || name.ends_with('~')
        || name.ends_with(".tmp")
        || name.ends_with(".swp")
        || name.ends_with(".swx")
}

fn is_watchable_path(path: &Path) -> bool {
    if has_ignored_component(path) {
        return false;
    }
    match path.file_name() {
        Some(name) => !is_temp_file_name(name),
        None => true,
    }
}

#[cfg(desktop)]
mod desktop {
    use std::sync::Mutex;

    use notify::{
        recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    };
    use tauri::Emitter;

    use super::{is_watchable_path, Path, PathBuf, VaultChangedPayload, VAULT_CHANGED_EVENT};

    struct ActiveVaultWatcher {
        path: PathBuf,
        _watcher: RecommendedWatcher,
    }

    pub struct VaultWatcherState {
        active: Mutex<Option<ActiveVaultWatcher>>,
    }

    impl Default for VaultWatcherState {
        fn default() -> Self {
            Self::new()
        }
    }

    impl VaultWatcherState {
        pub fn new() -> Self {
            Self {
                active: Mutex::new(None),
            }
        }
    }

    fn validate_vault_path(vault_path: PathBuf) -> Result<PathBuf, String> {
        if vault_path.as_os_str().is_empty() {
            return Err("Vault path is required".to_string());
        }
        if !vault_path.is_dir() {
            return Err(format!(
                "Vault path is not a directory: {}",
                vault_path.display()
            ));
        }
        Ok(vault_path)
    }

    fn should_emit_event(event: &Event) -> bool {
        !matches!(event.kind, EventKind::Access(_))
    }

    fn changed_paths(event: Event) -> Vec<String> {
        if !should_emit_event(&event) {
            return Vec::new();
        }
        event
            .paths
            .into_iter()
            .filter(|path| is_watchable_path(path))
            .map(|path| path.to_string_lossy().to_string())
            .collect()
    }

    fn emit_vault_change(app: &tauri::AppHandle, vault_path: &Path, event: Event) {
        let paths = changed_paths(event);
        if paths.is_empty() {
            return;
        }
        let payload = VaultChangedPayload {
            vault_path: vault_path.to_string_lossy().to_string(),
            paths,
        };
        if let Err(err) = app.emit(VAULT_CHANGED_EVENT, payload) {
            log::warn!("Failed to emit vault watcher event: {}", err);
        }
    }

    pub fn start(
        app: tauri::AppHandle,
        state: tauri::State<'_, VaultWatcherState>,
        path: PathBuf,
    ) -> Result<(), String> {
        let vault_path = validate_vault_path(path)?;
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Failed to lock vault watcher state".to_string())?;
        if active
            .as_ref()
            .is_some_and(|watcher| watcher.path == vault_path)
        {
            return Ok(());
        }

        let event_vault_path = vault_path.clone();
        let event_app = app.clone();
        let mut watcher = recommended_watcher(move |event| match event {
            Ok(event) => emit_vault_change(&event_app, &event_vault_path, event),
            Err(err) => log::warn!("Vault watcher event failed: {}", err),
        })
        .map_err(|err| format!("Failed to create vault watcher: {err}"))?;
        watcher
            .watch(&vault_path, RecursiveMode::Recursive)
            .map_err(|err| format!("Failed to watch {}: {err}", vault_path.display()))?;

        *active = Some(ActiveVaultWatcher {
            path: vault_path,
            _watcher: watcher,
        });
        Ok(())
    }

    pub fn stop(state: tauri::State<'_, VaultWatcherState>) -> Result<(), String> {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Failed to lock vault watcher state".to_string())?;
        *active = None;
        Ok(())
    }
}

#[cfg(not(desktop))]
mod mobile {
    use super::PathBuf;

    pub struct VaultWatcherState;

    impl Default for VaultWatcherState {
        fn default() -> Self {
            Self::new()
        }
    }

    impl VaultWatcherState {
        pub fn new() -> Self {
            Self
        }
    }

    pub fn start(_path: PathBuf) -> Result<(), String> {
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(desktop)]
pub use desktop::VaultWatcherState;
#[cfg(not(desktop))]
pub use mobile::VaultWatcherState;

#[cfg(desktop)]
#[tauri::command]
pub fn start_vault_watcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultWatcherState>,
    path: PathBuf,
) -> Result<(), String> {
    desktop::start(app, state, path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn stop_vault_watcher(state: tauri::State<'_, VaultWatcherState>) -> Result<(), String> {
    desktop::stop(state)
}

#[cfg(not(desktop))]
#[tauri::command]
pub fn start_vault_watcher(path: PathBuf) -> Result<(), String> {
    mobile::start(path)
}

#[cfg(not(desktop))]
#[tauri::command]
pub fn stop_vault_watcher() -> Result<(), String> {
    mobile::stop()
}

#[cfg(test)]
mod tests {
    use super::is_watchable_path;
    use std::path::Path;

    #[test]
    fn ignores_git_and_dependency_directory_changes() {
        assert!(!is_watchable_path(Path::new(".git/index.lock")));
        assert!(!is_watchable_path(Path::new(
            "node_modules/package/index.js"
        )));
    }

    #[test]
    fn ignores_common_temporary_files() {
        assert!(!is_watchable_path(Path::new("note.md.tmp")));
        assert!(!is_watchable_path(Path::new("note.md.swp")));
        assert!(!is_watchable_path(Path::new("draft.md~")));
        assert!(!is_watchable_path(Path::new(".DS_Store")));
        assert!(!is_watchable_path(Path::new(".tolaria-rename-txn")));
    }

    #[test]
    fn keeps_notes_assets_and_saved_views_watchable() {
        assert!(is_watchable_path(Path::new("notes/day.md")));
        assert!(is_watchable_path(Path::new("attachments/image.png")));
        assert!(is_watchable_path(Path::new(".laputa/views/work.yml")));
    }
}
