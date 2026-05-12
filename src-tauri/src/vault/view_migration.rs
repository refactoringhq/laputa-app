use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn is_view_definition_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()) == Some("yml")
}

pub(super) fn migrate_views(vault_path: &Path) {
    let old_dir = legacy_views_dir(vault_path);
    if !old_dir.is_dir() {
        return;
    }

    let Some(yml_files) = legacy_view_files(&old_dir) else {
        return;
    };
    let new_dir = current_views_dir(vault_path);
    if fs::create_dir_all(&new_dir).is_err() {
        log::warn!("Failed to create views/ directory for migration");
        return;
    }

    for entry in yml_files {
        migrate_view_file(&new_dir, entry);
    }

    remove_empty_legacy_views_dir(&old_dir);
}

fn legacy_views_dir(vault_path: &Path) -> PathBuf {
    vault_path.join(".laputa").join("views")
}

fn current_views_dir(vault_path: &Path) -> PathBuf {
    vault_path.join("views")
}

fn legacy_view_files(old_dir: &Path) -> Option<Vec<fs::DirEntry>> {
    let entries = fs::read_dir(old_dir).ok()?;
    let yml_files: Vec<_> = entries
        .flatten()
        .filter(|entry| is_view_definition_file(&entry.path()))
        .collect();

    (!yml_files.is_empty()).then_some(yml_files)
}

fn migrate_view_file(new_dir: &Path, entry: fs::DirEntry) {
    let src = entry.path();
    let dst = new_dir.join(entry.file_name());
    if dst.exists() {
        return;
    }

    if let Err(error) = fs::rename(&src, &dst) {
        log::warn!("Failed to migrate view {:?}: {}", src, error);
    } else {
        log::info!("Migrated view {:?} -> {:?}", src, dst);
    }
}

fn remove_empty_legacy_views_dir(old_dir: &Path) {
    if fs::read_dir(old_dir)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
    {
        let _ = fs::remove_dir(old_dir);
    }
}
