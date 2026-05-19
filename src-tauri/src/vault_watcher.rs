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
    is_exact_temp_file_name(name) || has_temp_file_prefix(name) || has_temp_file_suffix(name)
}

fn is_exact_temp_file_name(name: &str) -> bool {
    [".DS_Store", ".tolaria-rename-txn"].contains(&name)
}

fn has_temp_file_prefix(name: &str) -> bool {
    [".#", ".gitstatus."]
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

fn has_temp_file_suffix(name: &str) -> bool {
    ["~", ".tmp", ".swp", ".swx", ".icloud"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

/// Resolve the real git directory for `vault_path`. Handles three cases:
/// - regular `.git/` directory
/// - `.git` symlink (e.g. the iCloud `.git -> .git.nosync` workaround)
/// - `.git` file containing `gitdir: <path>` (worktrees, submodules)
fn resolve_git_dir(vault_path: &Path) -> Option<PathBuf> {
    let git_path = vault_path.join(".git");
    if let Ok(target) = std::fs::read_link(&git_path) {
        let resolved = if target.is_absolute() {
            target
        } else {
            vault_path.join(target)
        };
        return Some(resolved);
    }
    if git_path.is_dir() {
        return Some(git_path);
    }
    let content = std::fs::read_to_string(&git_path).ok()?;
    let rest = content.lines().next()?.strip_prefix("gitdir:")?.trim();
    let target = Path::new(rest);
    Some(if target.is_absolute() {
        target.to_path_buf()
    } else {
        vault_path.join(target)
    })
}

fn is_watchable_path(path: &Path, git_dir: Option<&Path>) -> bool {
    if has_ignored_component(path) {
        return false;
    }
    if let Some(git_dir) = git_dir {
        if path.starts_with(git_dir) {
            return false;
        }
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

    use super::{
        is_watchable_path, resolve_git_dir, Path, PathBuf, VaultChangedPayload, VAULT_CHANGED_EVENT,
    };

    struct ActiveVaultWatcher {
        path: PathBuf,
        _watcher: RecommendedWatcher,
    }

    pub struct VaultWatcherState {
        active: Mutex<Vec<ActiveVaultWatcher>>,
    }

    impl Default for VaultWatcherState {
        fn default() -> Self {
            Self::new()
        }
    }

    impl VaultWatcherState {
        pub fn new() -> Self {
            Self {
                active: Mutex::new(Vec::new()),
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

    fn changed_paths(event: Event, git_dir: Option<&Path>) -> Vec<String> {
        if !should_emit_event(&event) {
            return Vec::new();
        }
        event
            .paths
            .into_iter()
            .filter(|path| is_watchable_path(path, git_dir))
            .map(|path| path.to_string_lossy().to_string())
            .collect()
    }

    fn emit_vault_change(
        app: &tauri::AppHandle,
        vault_path: &Path,
        git_dir: Option<&Path>,
        event: Event,
    ) {
        let paths = changed_paths(event, git_dir);
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
        if active.iter().any(|watcher| watcher.path == vault_path) {
            return Ok(());
        }

        let event_vault_path = vault_path.clone();
        let event_git_dir = resolve_git_dir(&vault_path);
        let event_app = app.clone();
        let mut watcher = recommended_watcher(move |event| match event {
            Ok(event) => emit_vault_change(
                &event_app,
                &event_vault_path,
                event_git_dir.as_deref(),
                event,
            ),
            Err(err) => log::warn!("Vault watcher event failed: {}", err),
        })
        .map_err(|err| format!("Failed to create vault watcher: {err}"))?;
        watcher
            .watch(&vault_path, RecursiveMode::Recursive)
            .map_err(|err| format!("Failed to watch {}: {err}", vault_path.display()))?;

        active.push(ActiveVaultWatcher {
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
        active.clear();
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use notify::event::{AccessKind, CreateKind, EventAttributes};
        use notify::{Event, EventKind};

        use super::*;

        fn event(kind: EventKind, paths: &[&str]) -> Event {
            Event {
                kind,
                paths: paths.iter().map(PathBuf::from).collect(),
                attrs: EventAttributes::default(),
            }
        }

        #[test]
        fn validate_vault_path_accepts_existing_directories_only() {
            let dir = tempfile::TempDir::new().unwrap();

            assert_eq!(
                validate_vault_path(dir.path().to_path_buf()).unwrap(),
                dir.path()
            );
            assert_eq!(
                validate_vault_path(PathBuf::new()).unwrap_err(),
                "Vault path is required"
            );
            assert!(validate_vault_path(dir.path().join("missing"))
                .unwrap_err()
                .contains("Vault path is not a directory"));
        }

        #[test]
        fn changed_paths_ignores_access_events() {
            let paths = changed_paths(
                event(EventKind::Access(AccessKind::Read), &["notes/today.md"]),
                None,
            );

            assert!(paths.is_empty());
        }

        #[test]
        fn changed_paths_filters_unwatchable_paths() {
            let paths = changed_paths(
                event(
                    EventKind::Create(CreateKind::File),
                    &[
                        ".git/index.lock",
                        "node_modules/pkg/index.js",
                        "notes/today.md",
                    ],
                ),
                None,
            );

            assert_eq!(paths, vec!["notes/today.md"]);
        }

        #[test]
        fn changed_paths_filters_editor_temporary_files() {
            let paths = changed_paths(
                event(
                    EventKind::Create(CreateKind::File),
                    &[
                        ".DS_Store",
                        ".tolaria-rename-txn",
                        ".#draft.md",
                        "draft.md~",
                        "draft.tmp",
                        "draft.swp",
                        "draft.swx",
                        "notes/keep.md",
                    ],
                ),
                None,
            );

            assert_eq!(paths, vec!["notes/keep.md"]);
        }
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
    use super::{is_watchable_path, resolve_git_dir};
    use std::path::{Path, PathBuf};

    #[test]
    fn ignores_git_and_dependency_directory_changes() {
        assert!(!is_watchable_path(Path::new(".git/index.lock"), None));
        assert!(!is_watchable_path(
            Path::new("node_modules/package/index.js"),
            None
        ));
    }

    #[test]
    fn ignores_common_temporary_files() {
        assert!(!is_watchable_path(Path::new("note.md.tmp"), None));
        assert!(!is_watchable_path(Path::new("note.md.swp"), None));
        assert!(!is_watchable_path(Path::new("draft.md~"), None));
        assert!(!is_watchable_path(Path::new(".DS_Store"), None));
        assert!(!is_watchable_path(Path::new(".tolaria-rename-txn"), None));
        assert!(!is_watchable_path(Path::new(".gitstatus.KASSUJ"), None));
        assert!(!is_watchable_path(Path::new("notes/draft.md.icloud"), None));
    }

    #[test]
    fn keeps_notes_assets_and_saved_views_watchable() {
        assert!(is_watchable_path(Path::new("notes/day.md"), None));
        assert!(is_watchable_path(Path::new("attachments/image.png"), None));
        assert!(is_watchable_path(Path::new(".laputa/views/work.yml"), None));
    }

    #[test]
    fn ignores_paths_inside_resolved_git_dir() {
        // .git -> .git.nosync symlink trick used for iCloud/Dropbox vaults
        let git_dir = PathBuf::from("/vault/.git.nosync");
        assert!(!is_watchable_path(
            Path::new("/vault/.git.nosync/index.lock"),
            Some(&git_dir)
        ));
        assert!(!is_watchable_path(
            Path::new("/vault/.git.nosync/refs/remotes/origin/HEAD"),
            Some(&git_dir)
        ));
        assert!(is_watchable_path(
            Path::new("/vault/notes/day.md"),
            Some(&git_dir)
        ));
    }

    #[test]
    fn resolves_real_git_dir_through_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real_git = dir.path().join(".git.nosync");
        std::fs::create_dir(&real_git).unwrap();
        std::os::unix::fs::symlink(".git.nosync", dir.path().join(".git")).unwrap();

        let resolved = resolve_git_dir(dir.path()).unwrap();
        assert_eq!(resolved, dir.path().join(".git.nosync"));
    }

    #[test]
    fn resolves_real_git_dir_for_regular_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();

        let resolved = resolve_git_dir(dir.path()).unwrap();
        assert_eq!(resolved, dir.path().join(".git"));
    }

    #[test]
    fn resolves_real_git_dir_for_worktree_pointer_file() {
        let dir = tempfile::tempdir().unwrap();
        let worktree_target = dir.path().join("main/.git/worktrees/foo");
        std::fs::create_dir_all(&worktree_target).unwrap();
        std::fs::write(
            dir.path().join(".git"),
            format!("gitdir: {}\n", worktree_target.display()),
        )
        .unwrap();

        let resolved = resolve_git_dir(dir.path()).unwrap();
        assert_eq!(resolved, worktree_target);
    }
}
