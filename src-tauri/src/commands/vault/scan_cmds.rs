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
    use super::{collect_registered_vault_roots, find_registered_vault_root};
    use crate::vault_list::{VaultEntry as VaultListEntry, VaultList};

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
}
