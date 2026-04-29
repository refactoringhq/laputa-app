use crate::commands::expand_tilde;
use crate::vault::filename_rules::validate_folder_name;
use crate::vault::{self, FolderNode, VaultEntry};
use std::path::{Path, PathBuf};

use super::boundary::{
    with_boundary, with_existing_paths, with_requested_root, with_validated_path, ValidatedPathMode,
};

fn with_note_path<T>(
    path: &Path,
    vault_path: Option<&Path>,
    mode: ValidatedPathMode,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let raw_path = path.to_string_lossy();
    let raw_vault_path = vault_path.map(|value| value.to_string_lossy());
    with_validated_path(
        &raw_path,
        raw_vault_path.as_deref(),
        mode,
        |validated_path| action(Path::new(validated_path)),
    )
}

fn with_external_file_path<T>(
    path: &Path,
    vault_path: Option<&Path>,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    with_note_path(path, vault_path, ValidatedPathMode::Existing, action)
}

fn with_expanded_vault_root<T>(
    path: &Path,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let raw_path = path.to_string_lossy();
    let expanded = expand_tilde(raw_path.as_ref()).into_owned();
    action(Path::new(&expanded))
}

fn with_requested_root_path<T>(
    vault_path: &Path,
    action: impl FnOnce(&str) -> Result<T, String>,
) -> Result<T, String> {
    let raw_vault_path = vault_path.to_string_lossy();
    with_requested_root(raw_vault_path.as_ref(), action)
}

fn sync_image_asset_scope(
    app_handle: &tauri::AppHandle,
    requested_root: &str,
) -> Result<(), String> {
    #[cfg(desktop)]
    crate::sync_vault_asset_scope(app_handle, Path::new(requested_root))?;
    #[cfg(not(desktop))]
    let _ = requested_root;
    #[cfg(not(desktop))]
    let _ = app_handle;
    Ok(())
}

fn with_image_asset_scope(
    app_handle: &tauri::AppHandle,
    vault_path: &Path,
    action: impl FnOnce(&str) -> Result<String, String>,
) -> Result<String, String> {
    with_requested_root_path(vault_path, |requested_root| {
        let saved_path = action(requested_root)?;
        sync_image_asset_scope(app_handle, requested_root)?;
        Ok(saved_path)
    })
}

#[tauri::command]
pub fn sync_vault_asset_scope_for_window(
    app_handle: tauri::AppHandle,
    vault_path: PathBuf,
) -> Result<(), String> {
    with_requested_root_path(vault_path.as_path(), |requested_root| {
        sync_image_asset_scope(&app_handle, requested_root)
    })
}

#[tauri::command]
pub fn open_vault_file_external(
    app_handle: tauri::AppHandle,
    path: PathBuf,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    with_external_file_path(path.as_path(), vault_path.as_deref(), |validated_path| {
        open_path_with_default_app(&app_handle, validated_path)
    })
}

fn open_path_with_default_app(app_handle: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    app_handle
        .opener()
        .open_path(path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| error.to_string())
}

fn with_writable_note_path<T>(
    path: PathBuf,
    vault_path: Option<PathBuf>,
    action: impl FnOnce(&str) -> Result<T, String>,
) -> Result<T, String> {
    with_validated_path(
        path.to_string_lossy().as_ref(),
        vault_path
            .as_ref()
            .map(|value| value.to_string_lossy())
            .as_deref(),
        ValidatedPathMode::Writable,
        action,
    )
}

#[tauri::command]
pub fn get_note_content(path: PathBuf, vault_path: Option<PathBuf>) -> Result<String, String> {
    with_note_path(
        path.as_path(),
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        vault::get_note_content,
    )
}

#[tauri::command]
pub fn validate_note_content(
    path: PathBuf,
    content: String,
    vault_path: Option<PathBuf>,
) -> Result<bool, String> {
    with_note_path(
        path.as_path(),
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| vault::note_content_matches(validated_path, &content),
    )
}

#[tauri::command]
pub fn save_note_content(
    path: PathBuf,
    content: String,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    with_writable_note_path(path, vault_path, |validated_path| {
        vault::save_note_content(validated_path, &content)
    })
}

#[tauri::command]
pub fn create_note_content(
    path: PathBuf,
    content: String,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    with_writable_note_path(path, vault_path, |validated_path| {
        vault::create_note_content(validated_path, &content)
    })
}

#[tauri::command]
pub fn delete_note(path: PathBuf) -> Result<String, String> {
    with_validated_path(
        path.to_string_lossy().as_ref(),
        None,
        ValidatedPathMode::Existing,
        vault::delete_note,
    )
}

#[tauri::command]
pub fn batch_delete_notes(paths: Vec<PathBuf>) -> Result<Vec<String>, String> {
    let raw_paths = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    with_existing_paths(&raw_paths, None, |validated_paths| {
        vault::batch_delete_notes(&validated_paths)
    })
}

#[tauri::command]
pub fn create_vault_folder(vault_path: PathBuf, folder_name: PathBuf) -> Result<String, String> {
    let raw_vault_path = vault_path.to_string_lossy();
    with_boundary(Some(raw_vault_path.as_ref()), |boundary| {
        let folder_name = folder_name.to_string_lossy();
        let folder_path = boundary.child_path(folder_name.as_ref())?;
        validate_folder_name(folder_name.as_ref())?;
        ensure_missing_folder(&folder_path, folder_name.as_ref())?;
        std::fs::create_dir_all(&folder_path)
            .map_err(|e| format!("Failed to create folder: {}", e))?;
        Ok(folder_name.into_owned())
    })
}

fn ensure_missing_folder(folder_path: &Path, folder_name: &str) -> Result<(), String> {
    if folder_path.exists() {
        return Err(format!("Folder '{}' already exists", folder_name));
    }
    Ok(())
}

fn scan_visible_vault_entries(vault_path: &Path) -> Result<Vec<VaultEntry>, String> {
    let entries = vault::scan_vault_cached(vault_path)?;
    Ok(vault::filter_gitignored_entries(
        vault_path,
        entries,
        crate::settings::hide_gitignored_files_enabled(),
    ))
}

fn scan_visible_vault_folders(vault_path: &Path) -> Result<Vec<FolderNode>, String> {
    let folders = vault::scan_vault_folders(vault_path)?;
    Ok(vault::filter_gitignored_folders(
        vault_path,
        folders,
        crate::settings::hide_gitignored_files_enabled(),
    ))
}

/// Sync the `title` frontmatter field with the filename on note open.
/// Returns `true` if the file was modified (title was absent or desynced).
#[tauri::command]
pub fn sync_note_title(path: PathBuf, vault_path: Option<PathBuf>) -> Result<bool, String> {
    use vault::SyncAction;

    with_note_path(
        path.as_path(),
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| {
            let action = vault::sync_title_on_open(validated_path)?;
            Ok(matches!(action, SyncAction::Updated { .. }))
        },
    )
}

#[tauri::command]
pub fn save_image(
    app_handle: tauri::AppHandle,
    vault_path: PathBuf,
    filename: String,
    data: String,
) -> Result<String, String> {
    with_image_asset_scope(&app_handle, vault_path.as_path(), |requested_root| {
        vault::save_image(requested_root, &filename, &data)
    })
}

#[tauri::command]
pub fn copy_image_to_vault(
    app_handle: tauri::AppHandle,
    vault_path: PathBuf,
    source_path: PathBuf,
) -> Result<String, String> {
    with_image_asset_scope(&app_handle, vault_path.as_path(), |requested_root| {
        vault::copy_image_to_vault(requested_root, source_path.to_string_lossy().as_ref())
    })
}

#[tauri::command]
pub fn list_vault(path: PathBuf) -> Result<Vec<VaultEntry>, String> {
    with_expanded_vault_root(path.as_path(), scan_visible_vault_entries)
}

#[tauri::command]
pub fn list_vault_folders(path: PathBuf) -> Result<Vec<FolderNode>, String> {
    with_expanded_vault_root(path.as_path(), scan_visible_vault_folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn vault_root(dir: &TempDir) -> PathBuf {
        dir.path().to_path_buf()
    }

    fn note_path(dir: &TempDir, name: &str) -> PathBuf {
        dir.path().join(name)
    }

    #[test]
    fn note_content_commands_roundtrip_with_requested_vault() {
        let dir = TempDir::new().unwrap();
        let root = vault_root(&dir);
        let note = note_path(&dir, "notes/command-note.md");

        create_note_content(
            note.clone(),
            "# Command Note\n".to_string(),
            Some(root.clone()),
        )
        .unwrap();
        assert_eq!(
            get_note_content(note.clone(), Some(root.clone())).unwrap(),
            "# Command Note\n"
        );

        save_note_content(
            note.clone(),
            "---\ntitle: Command Note\n---\n# Command Note\nBody\n".to_string(),
            Some(root.clone()),
        )
        .unwrap();
        assert!(!sync_note_title(note.clone(), Some(root.clone())).unwrap());

        save_note_content(
            note.clone(),
            "# Updated Command Note\n".to_string(),
            Some(root.clone()),
        )
        .unwrap();
        assert!(sync_note_title(note.clone(), Some(root.clone())).unwrap());
        assert!(get_note_content(note, Some(root))
            .unwrap()
            .contains("title: Command Note"));
    }

    #[test]
    fn note_content_commands_accept_windows_sensitive_valid_segments() {
        let dir = TempDir::new().unwrap();
        let root = vault_root(&dir);
        let note = root
            .join("@raflymln")
            .join("notes with spaces")
            .join("résumé note.md");

        save_note_content(
            note.clone(),
            "# Windows-Sensitive Path\n\nBody\n".to_string(),
            Some(root.clone()),
        )
        .unwrap();

        assert_eq!(
            get_note_content(note, Some(root)).unwrap(),
            "# Windows-Sensitive Path\n\nBody\n"
        );
    }

    #[test]
    fn folder_and_listing_commands_use_expanded_vault_root() {
        let dir = TempDir::new().unwrap();
        let root = vault_root(&dir);
        fs::write(dir.path().join("root.md"), "# Root\n").unwrap();

        assert_eq!(
            create_vault_folder(root.clone(), PathBuf::from("Projects")).unwrap(),
            "Projects"
        );
        fs::write(dir.path().join("Projects/project.md"), "# Project\n").unwrap();

        let entries = list_vault(root.clone()).unwrap();
        assert!(entries.iter().any(|entry| entry.filename == "root.md"));
        assert!(entries.iter().any(|entry| entry.filename == "project.md"));

        let folders = list_vault_folders(root).unwrap();
        assert!(folders.iter().any(|folder| folder.name == "Projects"));
    }

    #[test]
    fn commands_reject_paths_outside_requested_vault() {
        let vault = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let outside_note = outside.path().join("outside.md");
        fs::write(&outside_note, "# Outside\n").unwrap();

        let error = get_note_content(outside_note, Some(vault.path().to_path_buf())).unwrap_err();
        assert!(error.contains("Path must stay inside the active vault"));

        let folder_error =
            create_vault_folder(vault.path().to_path_buf(), PathBuf::from("../escape"))
                .unwrap_err();
        assert!(folder_error.contains("Path must stay inside the active vault"));
    }

    #[test]
    fn external_file_paths_accept_files_inside_requested_vault() {
        let dir = TempDir::new().unwrap();
        let root = vault_root(&dir);
        let attachment = note_path(&dir, "attachments/photo.png");
        fs::create_dir_all(attachment.parent().unwrap()).unwrap();
        fs::write(&attachment, "image-bytes").unwrap();

        let validated = with_external_file_path(
            attachment.as_path(),
            Some(root.as_path()),
            |validated_path| Ok(validated_path.to_path_buf()),
        )
        .unwrap();

        assert_eq!(validated, attachment);
    }

    #[test]
    fn external_file_paths_reject_files_outside_requested_vault() {
        let vault = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let outside_file = outside.path().join("photo.png");
        fs::write(&outside_file, "image-bytes").unwrap();

        let error = with_external_file_path(
            outside_file.as_path(),
            Some(vault.path()),
            |validated_path| Ok(validated_path.to_path_buf()),
        )
        .unwrap_err();

        assert!(error.contains("Path must stay inside the active vault"));
    }

    #[test]
    fn validate_note_content_compares_against_disk() {
        let dir = TempDir::new().unwrap();
        let root = vault_root(&dir);
        let note = note_path(&dir, "note.md");
        fs::write(&note, "# Fresh\n").unwrap();

        assert!(
            validate_note_content(note.clone(), "# Fresh\n".to_string(), Some(root.clone()),)
                .unwrap()
        );
        assert!(!validate_note_content(note, "# Stale\n".to_string(), Some(root)).unwrap());
    }
}
