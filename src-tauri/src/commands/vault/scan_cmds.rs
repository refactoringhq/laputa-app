use crate::commands::expand_tilde;
use crate::search::SearchResponse;
use crate::vault::VaultEntry;
use crate::{search, vault, vault_list};
use std::path::{Path, PathBuf};

use super::boundary::{with_validated_path, ValidatedPathMode};

fn collect_registered_vault_roots(vault_list: &vault_list::VaultList) -> Vec<PathBuf> {
    let mut roots = vault_list
        .vaults
        .iter()
        .map(|entry| PathBuf::from(expand_tilde(&entry.path).into_owned()))
        .collect::<Vec<_>>();

    if let Some(active_vault) = &vault_list.active_vault {
        roots.push(PathBuf::from(expand_tilde(active_vault).into_owned()));
    }

    roots
}

fn find_registered_vault_root(path: &Path, registered_roots: &[PathBuf]) -> Option<PathBuf> {
    registered_roots
        .iter()
        .filter_map(|root| {
            let canonical_root = root.canonicalize().ok()?;
            path.starts_with(&canonical_root)
                .then_some((canonical_root.components().count(), root.clone()))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, root)| root)
}

fn resolve_reload_vault_path(
    path: &Path,
    vault_path: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if let Some(vault_path) = vault_path {
        return Ok(Some(vault_path.to_path_buf()));
    }

    if !path.is_absolute() {
        return Ok(None);
    }

    let canonical_path = match path.canonicalize() {
        Ok(canonical_path) => canonical_path,
        Err(_) => return Ok(None),
    };

    let vault_list = vault_list::load_vault_list()?;
    let registered_roots = collect_registered_vault_roots(&vault_list);
    Ok(find_registered_vault_root(
        canonical_path.as_path(),
        &registered_roots,
    ))
}

#[tauri::command]
pub fn reload_vault_entry(
    path: PathBuf,
    vault_path: Option<PathBuf>,
) -> Result<VaultEntry, String> {
    let resolved_vault_path = resolve_reload_vault_path(path.as_path(), vault_path.as_deref())?;
    let raw_path = path.to_string_lossy();
    let raw_vault_path = resolved_vault_path
        .as_ref()
        .map(|value| value.to_string_lossy().into_owned());
    with_validated_path(
        &raw_path,
        raw_vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| vault::reload_entry(Path::new(validated_path)),
    )
}

#[tauri::command]
pub async fn reload_vault(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<Vec<crate::vault::VaultEntry>, String> {
    let path = expand_tilde(&path).into_owned();
    crate::sync_vault_asset_scope(&app_handle, Path::new(&path))?;
    tokio::task::spawn_blocking(move || {
        let vault_path = Path::new(&path);
        vault::invalidate_cache(vault_path);
        let entries = vault::scan_vault_cached(vault_path)?;
        Ok(vault::filter_gitignored_entries(
            vault_path,
            entries,
            crate::settings::hide_gitignored_files_enabled(),
        ))
    })
    .await
    .map_err(|e| format!("Task panicked: {e}"))?
}

#[tauri::command]
pub async fn search_vault(
    vault_path: String,
    query: String,
    mode: String,
    limit: Option<usize>,
) -> Result<SearchResponse, String> {
    let vault_path = expand_tilde(&vault_path).into_owned();
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || search::search_vault(&vault_path, &query, &mode, limit))
        .await
        .map_err(|e| format!("Search task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::{
        collect_registered_vault_roots, find_registered_vault_root, reload_vault_entry,
        resolve_reload_vault_path, search_vault,
    };
    use crate::vault_list::{VaultEntry as VaultListEntry, VaultList};
    use std::path::{Path, PathBuf};

    fn write_note(root: &Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = root.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn finds_registered_vault_root_for_an_absolute_note_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_root = dir.path().join("vault");
        let note_path = vault_root.join("note.md");
        std::fs::create_dir_all(&vault_root).unwrap();
        std::fs::write(&note_path, "# Note\n").unwrap();

        let vault_list = VaultList {
            vaults: vec![VaultListEntry {
                label: "Test".to_string(),
                path: vault_root.to_string_lossy().into_owned(),
            }],
            active_vault: None,
            hidden_defaults: vec![],
        };

        let registered_roots = collect_registered_vault_roots(&vault_list);
        let canonical_note_path = note_path.canonicalize().unwrap();

        assert_eq!(
            find_registered_vault_root(canonical_note_path.as_path(), &registered_roots),
            Some(vault_root),
        );
    }

    #[test]
    fn prefers_the_deepest_registered_vault_root() {
        let dir = tempfile::TempDir::new().unwrap();
        let parent_root = dir.path().join("vault");
        let nested_root = parent_root.join("projects");
        let note_path = nested_root.join("note.md");
        std::fs::create_dir_all(&nested_root).unwrap();
        std::fs::write(&note_path, "# Note\n").unwrap();

        let vault_list = VaultList {
            vaults: vec![
                VaultListEntry {
                    label: "Parent".to_string(),
                    path: parent_root.to_string_lossy().into_owned(),
                },
                VaultListEntry {
                    label: "Nested".to_string(),
                    path: nested_root.to_string_lossy().into_owned(),
                },
            ],
            active_vault: None,
            hidden_defaults: vec![],
        };

        let registered_roots = collect_registered_vault_roots(&vault_list);
        let canonical_note_path = note_path.canonicalize().unwrap();

        assert_eq!(
            find_registered_vault_root(canonical_note_path.as_path(), &registered_roots),
            Some(nested_root),
        );
    }

    #[test]
    fn find_registered_vault_root_ignores_missing_registered_roots() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_root = dir.path().join("vault");
        std::fs::create_dir_all(&vault_root).unwrap();
        let note_path = write_note(&vault_root, "note.md", "# Note\n");
        let registered_roots = vec![dir.path().join("missing"), vault_root.clone()];
        let canonical_note_path = note_path.canonicalize().unwrap();

        assert_eq!(
            find_registered_vault_root(canonical_note_path.as_path(), &registered_roots),
            Some(vault_root),
        );
    }

    #[test]
    fn collect_registered_vault_roots_includes_active_vault() {
        let vault_list = VaultList {
            vaults: vec![VaultListEntry {
                label: "Listed".to_string(),
                path: "/listed".to_string(),
            }],
            active_vault: Some("/active".to_string()),
            hidden_defaults: vec![],
        };

        let roots = collect_registered_vault_roots(&vault_list);

        assert_eq!(
            roots,
            vec![PathBuf::from("/listed"), PathBuf::from("/active")]
        );
    }

    #[test]
    fn resolve_reload_vault_path_uses_explicit_vault_path() {
        let explicit = Path::new("/tmp/vault");

        assert_eq!(
            resolve_reload_vault_path(Path::new("note.md"), Some(explicit)).unwrap(),
            Some(explicit.to_path_buf()),
        );
    }

    #[test]
    fn resolve_reload_vault_path_skips_relative_note_paths() {
        assert_eq!(
            resolve_reload_vault_path(Path::new("note.md"), None).unwrap(),
            None,
        );
    }

    #[test]
    fn reload_vault_entry_command_reads_note_inside_vault() {
        let dir = tempfile::TempDir::new().unwrap();
        let note_path = write_note(dir.path(), "note.md", "# Reloaded Title\n\nBody");

        let entry = reload_vault_entry(note_path, Some(dir.path().to_path_buf())).unwrap();

        assert_eq!(entry.title, "Reloaded Title");
    }

    #[tokio::test]
    async fn search_vault_command_uses_default_limit_and_returns_results() {
        let dir = tempfile::Builder::new()
            .prefix("scan-search-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        write_note(dir.path(), "search.md", "# Searchable\n\nneedle");

        let response = search_vault(
            dir.path().to_string_lossy().into_owned(),
            "needle".to_string(),
            "keyword".to_string(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "Searchable");
        assert_eq!(response.mode, "keyword");
    }

    #[tokio::test]
    async fn search_vault_command_honors_explicit_limit() {
        let dir = tempfile::Builder::new()
            .prefix("scan-search-limit-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        write_note(dir.path(), "first.md", "# First\n\nneedle");
        write_note(dir.path(), "second.md", "# Second\n\nneedle");

        let response = search_vault(
            dir.path().to_string_lossy().into_owned(),
            "needle".to_string(),
            "keyword".to_string(),
            Some(1),
        )
        .await
        .unwrap();

        assert_eq!(response.results.len(), 1);
    }
}
