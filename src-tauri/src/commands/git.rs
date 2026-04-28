use crate::git::{
    GitCommit, GitPullResult, GitPushResult, GitRemoteStatus, LastCommitInfo, ModifiedFile,
    PulseCommit,
};

use super::expand_tilde;

type VaultPathArg = String;
type NotePathArg = String;
type CommitHashArg = String;
type CommitMessageArg = String;
type ConflictStrategyArg = String;
type RemoteUrlArg = String;
type LocalPathArg = String;

// ── Git commands (desktop) ──────────────────────────────────────────────────

#[cfg(desktop)]
#[tauri::command]
pub fn get_file_history(
    vault_path: VaultPathArg,
    path: NotePathArg,
) -> Result<Vec<GitCommit>, String> {
    let vault_path = expand_tilde(&vault_path);
    let path = expand_tilde(&path);
    crate::git::get_file_history(&vault_path, &path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_modified_files(vault_path: VaultPathArg) -> Result<Vec<ModifiedFile>, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::get_modified_files(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_file_diff(vault_path: VaultPathArg, path: NotePathArg) -> Result<String, String> {
    let vault_path = expand_tilde(&vault_path);
    let path = expand_tilde(&path);
    crate::git::get_file_diff(&vault_path, &path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_file_diff_at_commit(
    vault_path: VaultPathArg,
    path: NotePathArg,
    commit_hash: CommitHashArg,
) -> Result<String, String> {
    let vault_path = expand_tilde(&vault_path);
    let path = expand_tilde(&path);
    crate::git::get_file_diff_at_commit(&vault_path, &path, &commit_hash)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_vault_pulse(
    vault_path: VaultPathArg,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<PulseCommit>, String> {
    let vault_path = expand_tilde(&vault_path);
    let limit = limit.unwrap_or(20);
    let skip = skip.unwrap_or(0);
    crate::git::get_vault_pulse(&vault_path, limit, skip)
}

#[cfg(desktop)]
#[tauri::command]
pub fn git_commit(vault_path: VaultPathArg, message: CommitMessageArg) -> Result<String, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::git_commit(&vault_path, &message)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_last_commit_info(vault_path: VaultPathArg) -> Result<Option<LastCommitInfo>, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::get_last_commit_info(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn git_pull(vault_path: VaultPathArg) -> Result<GitPullResult, String> {
    let vault_path = expand_tilde(&vault_path).into_owned();
    tokio::task::spawn_blocking(move || crate::git::git_pull(&vault_path))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_conflict_files(vault_path: VaultPathArg) -> Result<Vec<String>, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::get_conflict_files(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_conflict_mode(vault_path: VaultPathArg) -> String {
    let vault_path = expand_tilde(&vault_path);
    crate::git::get_conflict_mode(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn git_resolve_conflict(
    vault_path: VaultPathArg,
    file: NotePathArg,
    strategy: ConflictStrategyArg,
) -> Result<(), String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::git_resolve_conflict(&vault_path, &file, &strategy)
}

#[cfg(desktop)]
#[tauri::command]
pub fn git_commit_conflict_resolution(vault_path: VaultPathArg) -> Result<String, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::git_commit_conflict_resolution(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn git_push(vault_path: VaultPathArg) -> Result<GitPushResult, String> {
    let vault_path = expand_tilde(&vault_path).into_owned();
    tokio::task::spawn_blocking(move || crate::git::git_push(&vault_path))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn git_remote_status(vault_path: VaultPathArg) -> Result<GitRemoteStatus, String> {
    let vault_path = expand_tilde(&vault_path).into_owned();
    tokio::task::spawn_blocking(move || crate::git::git_remote_status(&vault_path))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

#[cfg(desktop)]
#[tauri::command]
pub fn git_discard_file(
    vault_path: VaultPathArg,
    relative_path: NotePathArg,
) -> Result<(), String> {
    let vault_path = expand_tilde(&vault_path);
    crate::git::discard_file_changes(&vault_path, &relative_path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn is_git_repo(vault_path: VaultPathArg) -> bool {
    let vault_path = expand_tilde(&vault_path);
    std::path::Path::new(vault_path.as_ref())
        .join(".git")
        .is_dir()
}

#[cfg(desktop)]
fn validate_git_init_target(vault_path: &str) -> Result<(), String> {
    let path = std::path::Path::new(vault_path);
    if !path.exists() {
        return Err("Choose an existing vault folder before initializing Git".to_string());
    }
    if !path.is_dir() {
        return Err("Choose a folder before initializing Git".to_string());
    }

    if is_broad_personal_folder(path) && !has_tolaria_vault_marker(path) {
        return Err(format!(
            "Choose a dedicated vault folder before initializing Git. '{}' looks like a broad personal folder; create or select a subfolder such as '{}' instead.",
            path.display(),
            path.join("Tolaria").display()
        ));
    }

    Ok(())
}

#[cfg(desktop)]
fn is_broad_personal_folder(path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    matches!(
        name.to_ascii_lowercase().as_str(),
        "desktop"
            | "documents"
            | "downloads"
            | "movies"
            | "music"
            | "pictures"
            | "public"
            | "templates"
            | "videos"
    )
}

#[cfg(desktop)]
fn has_tolaria_vault_marker(path: &std::path::Path) -> bool {
    ["AGENTS.md", "CLAUDE.md", "type.md", "note.md"]
        .iter()
        .any(|file| path.join(file).is_file())
        || ["attachments", "type", "views"]
            .iter()
            .any(|dir| path.join(dir).is_dir())
}

#[cfg(desktop)]
#[tauri::command]
pub fn init_git_repo(vault_path: VaultPathArg) -> Result<(), String> {
    let vault_path = expand_tilde(&vault_path);
    validate_git_init_target(&vault_path)?;
    crate::git::init_repo(&vault_path)
}

#[cfg(desktop)]
#[tauri::command]
pub fn clone_repo(url: RemoteUrlArg, local_path: LocalPathArg) -> Result<String, String> {
    let local_path = expand_tilde(&local_path);
    crate::git::clone_repo(&url, &local_path)
}

// ── Git commands (mobile stubs) ─────────────────────────────────────────────

#[cfg(mobile)]
#[tauri::command]
pub fn get_file_history(
    _vault_path: VaultPathArg,
    _path: NotePathArg,
) -> Result<Vec<GitCommit>, String> {
    Err("Git history is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_modified_files(_vault_path: VaultPathArg) -> Result<Vec<ModifiedFile>, String> {
    Ok(vec![])
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_file_diff(_vault_path: VaultPathArg, _path: NotePathArg) -> Result<String, String> {
    Err("Git diff is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_file_diff_at_commit(
    _vault_path: VaultPathArg,
    _path: NotePathArg,
    _commit_hash: CommitHashArg,
) -> Result<String, String> {
    Err("Git diff is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_vault_pulse(
    _vault_path: VaultPathArg,
    _limit: Option<usize>,
    _skip: Option<usize>,
) -> Result<Vec<PulseCommit>, String> {
    Ok(vec![])
}

#[cfg(mobile)]
#[tauri::command]
pub fn git_commit(_vault_path: VaultPathArg, _message: CommitMessageArg) -> Result<String, String> {
    Err("Git commit is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_last_commit_info(_vault_path: VaultPathArg) -> Result<Option<LastCommitInfo>, String> {
    Ok(None)
}

#[cfg(mobile)]
#[tauri::command]
pub async fn git_pull(_vault_path: VaultPathArg) -> Result<GitPullResult, String> {
    Err("Git pull is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_conflict_files(_vault_path: VaultPathArg) -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_conflict_mode(_vault_path: VaultPathArg) -> String {
    "none".to_string()
}

#[cfg(mobile)]
#[tauri::command]
pub fn git_resolve_conflict(
    _vault_path: VaultPathArg,
    _file: NotePathArg,
    _strategy: ConflictStrategyArg,
) -> Result<(), String> {
    Err("Git conflict resolution is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn git_commit_conflict_resolution(_vault_path: VaultPathArg) -> Result<String, String> {
    Err("Git conflict resolution is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn git_push(_vault_path: VaultPathArg) -> Result<GitPushResult, String> {
    Err("Git push is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn git_remote_status(_vault_path: VaultPathArg) -> Result<GitRemoteStatus, String> {
    Ok(GitRemoteStatus {
        branch: String::new(),
        has_remote: false,
        ahead: 0,
        behind: 0,
    })
}

#[cfg(mobile)]
#[tauri::command]
pub fn git_discard_file(
    _vault_path: VaultPathArg,
    _relative_path: NotePathArg,
) -> Result<(), String> {
    Err("Git discard is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn is_git_repo(_vault_path: VaultPathArg) -> bool {
    false
}

#[cfg(mobile)]
#[tauri::command]
pub fn init_git_repo(_vault_path: VaultPathArg) -> Result<(), String> {
    Err("Git init is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn clone_repo(_url: RemoteUrlArg, _local_path: LocalPathArg) -> Result<String, String> {
    Err("Git clone is not available on mobile".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn vault_path(dir: &TempDir) -> String {
        dir.path().to_string_lossy().into_owned()
    }

    fn note_path(dir: &TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().into_owned()
    }

    fn create_initialized_vault() -> (TempDir, String) {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("note.md"), "# Note\n").unwrap();
        let vault = vault_path(&dir);
        init_git_repo(vault.clone()).unwrap();
        (dir, vault)
    }

    #[test]
    fn desktop_git_commands_route_to_git_backend() {
        let (dir, vault) = create_initialized_vault();
        let note = note_path(&dir, "note.md");

        assert!(is_git_repo(vault.clone()));

        fs::write(dir.path().join("note.md"), "# Updated\n").unwrap();
        let modified = get_modified_files(vault.clone()).unwrap();
        assert!(modified.iter().any(|file| file.relative_path == "note.md"));

        let diff = get_file_diff(vault.clone(), note.clone()).unwrap();
        assert!(diff.contains("# Updated"));

        git_commit(vault.clone(), "Update note".to_string()).unwrap();
        let history = get_file_history(vault.clone(), note.clone()).unwrap();
        assert!(history.iter().any(|commit| commit.message == "Update note"));

        let last_commit = get_last_commit_info(vault.clone()).unwrap().unwrap();
        assert!(!last_commit.short_hash.is_empty());

        let commit_diff = get_file_diff_at_commit(
            vault.clone(),
            note.clone(),
            history.first().unwrap().hash.clone(),
        )
        .unwrap();
        assert!(commit_diff.contains("# Updated"));

        let pulse = get_vault_pulse(vault.clone(), Some(5), Some(0)).unwrap();
        assert!(!pulse.is_empty());

        fs::write(dir.path().join("note.md"), "# Discard me\n").unwrap();
        git_discard_file(vault.clone(), "note.md".to_string()).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("note.md")).unwrap(),
            "# Updated\n"
        );

        assert!(get_conflict_files(vault.clone()).unwrap().is_empty());
        assert_eq!(get_conflict_mode(vault.clone()), "none");
        assert!(
            git_resolve_conflict(vault.clone(), "note.md".to_string(), "invalid".to_string(),)
                .is_err()
        );
    }

    #[test]
    fn init_git_repo_rejects_broad_personal_folders() {
        let dir = TempDir::new().unwrap();
        let documents = dir.path().join("Documents");
        fs::create_dir_all(&documents).unwrap();
        fs::write(documents.join("unrelated.txt"), "not a vault").unwrap();

        let err = init_git_repo(documents.to_string_lossy().into_owned())
            .expect_err("expected Documents itself to be rejected before git init");

        assert!(err.contains("dedicated vault folder"));
        assert!(!documents.join(".git").exists());
    }

    #[test]
    fn init_git_repo_allows_named_vault_subfolder_under_documents() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("Documents").join("Tolaria");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        let vault = vault.to_string_lossy().into_owned();

        init_git_repo(vault.clone()).unwrap();

        assert!(is_git_repo(vault));
    }

    #[tokio::test]
    async fn desktop_remote_commands_report_no_remote() {
        let (_dir, vault) = create_initialized_vault();

        let pull = git_pull(vault.clone()).await.unwrap();
        assert_eq!(pull.status, "no_remote");

        let push = git_push(vault.clone()).await.unwrap();
        assert_eq!(push.status, "error");

        let status = git_remote_status(vault.clone()).await.unwrap();
        assert!(!status.has_remote);
        assert_eq!((status.ahead, status.behind), (0, 0));
    }
}
