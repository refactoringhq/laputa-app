use std::path::Path;

use super::{ensure_author_config, git_command_at, run_git, GitWorkspace};

#[derive(Clone, Copy)]
enum GitStatePath {
    MergeHead,
    RebaseApply,
    RebaseMerge,
}

#[derive(Clone, Copy)]
enum ConflictStrategy {
    Ours,
    Theirs,
}

impl ConflictStrategy {
    fn checkout_flag(self) -> &'static str {
        match self {
            Self::Ours => "--ours",
            Self::Theirs => "--theirs",
        }
    }
}

impl GitStatePath {
    fn as_str(self) -> &'static str {
        match self {
            Self::MergeHead => "MERGE_HEAD",
            Self::RebaseApply => "rebase-apply",
            Self::RebaseMerge => "rebase-merge",
        }
    }
}

/// List files with merge conflicts (unmerged paths).
///
/// Uses `git ls-files --unmerged` instead of `git diff --diff-filter=U` because
/// ls-files reliably detects unmerged index entries even when the merge state is
/// stale (e.g. after a reboot or when MERGE_HEAD is missing).
pub fn get_conflict_files(vault_path: impl AsRef<Path>) -> Result<Vec<String>, String> {
    let vault = vault_path.as_ref();
    let workspace = GitWorkspace::resolve(vault)?
        .ok_or_else(|| "Vault is not inside a Git work tree".to_string())?;
    let output = git_command_at(workspace.git_root())
        .and_then(|mut command| {
            command
                .args(["ls-files", "--unmerged", "--", workspace.vault_pathspec()])
                .output()
        })
        .map_err(|e| format!("Failed to check conflicts: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Each unmerged file appears multiple times (once per stage: base/ours/theirs).
    // Format: "<mode> <hash> <stage>\t<path>"
    let mut files: Vec<String> = stdout
        .lines()
        .filter_map(|line| line.split('\t').nth(1))
        .filter_map(|path| workspace.vault_relative_path(path))
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

/// Resolve a single conflict file by choosing "ours" or "theirs" strategy,
/// then stage the result.
pub fn git_resolve_conflict(
    vault_path: impl AsRef<Path>,
    file: impl AsRef<Path>,
    strategy: &str,
) -> Result<(), String> {
    let vault = vault_path.as_ref();
    let workspace = GitWorkspace::resolve(vault)?
        .ok_or_else(|| "Vault is not inside a Git work tree".to_string())?;
    let repo_relative_file = workspace.repo_relative_path(file.as_ref());

    let strategy = match strategy {
        "ours" => ConflictStrategy::Ours,
        "theirs" => ConflictStrategy::Theirs,
        _ => {
            return Err(format!(
                "Invalid strategy '{}': must be 'ours' or 'theirs'",
                strategy
            ))
        }
    };

    run_git(
        workspace.git_root(),
        &[
            "checkout",
            strategy.checkout_flag(),
            "--",
            &repo_relative_file,
        ],
    )?;
    run_git(workspace.git_root(), &["add", "--", &repo_relative_file])?;

    Ok(())
}

/// Check whether a rebase is currently in progress.
pub fn is_rebase_in_progress(vault_path: impl AsRef<Path>) -> bool {
    let Ok(Some(workspace)) = GitWorkspace::resolve(vault_path.as_ref()) else {
        return false;
    };
    git_state_path_exists(
        &workspace,
        &[GitStatePath::RebaseMerge, GitStatePath::RebaseApply],
    )
}

/// Check whether a merge is currently in progress.
pub fn is_merge_in_progress(vault_path: impl AsRef<Path>) -> bool {
    let Ok(Some(workspace)) = GitWorkspace::resolve(vault_path.as_ref()) else {
        return false;
    };
    git_state_path_exists(&workspace, &[GitStatePath::MergeHead])
}

fn git_state_path_exists(workspace: &GitWorkspace, state_paths: &[GitStatePath]) -> bool {
    state_paths.iter().any(|state_path| {
        git_state_path(workspace.git_root(), *state_path)
            .map(|path| path.exists())
            .unwrap_or(false)
    })
}

fn git_state_path(git_root: &Path, state_path: GitStatePath) -> Result<std::path::PathBuf, String> {
    let output = git_command_at(git_root)
        .and_then(|mut command| {
            command
                .args(["rev-parse", "--git-path", state_path.as_str()])
                .output()
        })
        .map_err(|error| format!("Failed to resolve Git state path: {error}"))?;
    if !output.status.success() {
        return Err("Git state path resolution failed".to_string());
    }
    let path = std::path::PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    Ok(if path.is_absolute() {
        path
    } else {
        git_root.join(path)
    })
}

/// Returns the current conflict mode: "rebase", "merge", or "none".
pub fn get_conflict_mode(vault_path: impl AsRef<Path>) -> String {
    let vault_path = vault_path.as_ref();
    if is_rebase_in_progress(vault_path) {
        "rebase".to_string()
    } else if is_merge_in_progress(vault_path) {
        "merge".to_string()
    } else {
        "none".to_string()
    }
}

/// Commit after all conflicts have been resolved.
/// Detects whether the repo is in a merge or rebase state and uses the
/// appropriate command (`git commit` vs `git rebase --continue`).
pub fn git_commit_conflict_resolution(vault_path: impl AsRef<Path>) -> Result<String, String> {
    let vault = vault_path.as_ref();
    let workspace = GitWorkspace::resolve(vault)?
        .ok_or_else(|| "Vault is not inside a Git work tree".to_string())?;

    ensure_no_remaining_conflicts(vault)?;
    ensure_author_config(workspace.git_root())?;

    let mode = get_conflict_mode(vault);
    let output = run_conflict_resolution(&workspace, &mode)?;
    if !output.status.success() {
        return Err(conflict_resolution_failure(&output, &mode));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn ensure_no_remaining_conflicts(vault: &Path) -> Result<(), String> {
    let remaining = get_conflict_files(vault)?;
    if !remaining.is_empty() {
        return Err(format!(
            "Cannot commit: {} file(s) still have unresolved conflicts",
            remaining.len()
        ));
    }
    Ok(())
}

fn run_conflict_resolution(
    workspace: &GitWorkspace,
    mode: &str,
) -> Result<std::process::Output, String> {
    match mode {
        "rebase" => git_command_at(workspace.git_root())
            .and_then(|mut command| {
                command
                    .args(["rebase", "--continue"])
                    .env("GIT_EDITOR", "true")
                    .output()
            })
            .map_err(|e| format!("Failed to run git rebase --continue: {e}")),
        _ => git_command_at(workspace.git_root())
            .and_then(|mut command| {
                command
                    .args(["commit", "-m", "Resolve merge conflicts"])
                    .output()
            })
            .map_err(|e| format!("Failed to run git commit: {e}")),
    }
}

fn conflict_resolution_failure(output: &std::process::Output, mode: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    let command = if mode == "rebase" {
        "git rebase --continue"
    } else {
        "git commit"
    };
    format!("{command} failed: {}", detail.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
    use crate::git::tests::{setup_git_repo, setup_remote_pair, GitConfigEnvGuard};
    use crate::git::{git_commit, git_pull, git_push};
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn unset_local_author_config(vault: &Path) {
        for key in ["user.name", "user.email"] {
            let status = git_command()
                .args(["config", "--local", "--unset-all", key])
                .current_dir(vault)
                .status()
                .unwrap();
            assert!(status.success(), "failed to unset {key}");
        }
    }

    fn local_config_value(vault: &Path, key: &str) -> Option<String> {
        let output = git_command()
            .args(["config", "--local", key])
            .current_dir(vault)
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn create_nested_conflicts(repository: &Path, vault: &Path) {
        fs::create_dir(vault).unwrap();
        fs::write(vault.join("conflict.md"), "base\n").unwrap();
        fs::write(repository.join("outside.md"), "base\n").unwrap();
        git_command()
            .args(["add", "-A"])
            .current_dir(repository)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "base"])
            .current_dir(repository)
            .output()
            .unwrap();
        git_command()
            .args(["checkout", "-b", "feature"])
            .current_dir(repository)
            .output()
            .unwrap();
        write_conflicting_versions(repository, vault, "feature");
        git_command()
            .args(["checkout", "main"])
            .current_dir(repository)
            .output()
            .unwrap();
        write_conflicting_versions(repository, vault, "main");
    }

    fn write_conflicting_versions(repository: &Path, vault: &Path, version: &str) {
        fs::write(vault.join("conflict.md"), format!("{version}\n")).unwrap();
        fs::write(repository.join("outside.md"), format!("{version}\n")).unwrap();
        git_command()
            .args(["commit", "-am", version])
            .current_dir(repository)
            .output()
            .unwrap();
    }

    #[test]
    fn test_get_conflict_files_empty_when_clean() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        let conflicts = get_conflict_files(vp).unwrap();
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_resolve_conflict_invalid_strategy() {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        let result = git_resolve_conflict(vp_b, "conflict.md", "invalid");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid strategy"));
    }

    #[test]
    fn test_conflict_mode_none_for_clean_repo() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        assert_eq!(get_conflict_mode(vp), "none");
        assert!(!is_rebase_in_progress(vp));
        assert!(!is_merge_in_progress(vp));
    }

    /// Set up a pair of clones that have a merge conflict on the same file.
    /// Returns (bare, clone_a, clone_b) where clone_b has an unresolved conflict.
    fn setup_conflict_pair() -> (TempDir, TempDir, TempDir) {
        let (bare_dir, clone_a_dir, clone_b_dir) = setup_remote_pair();

        let vp_a = clone_a_dir.path().to_str().unwrap();
        let vp_b = clone_b_dir.path().to_str().unwrap();

        // A creates the file and pushes
        fs::write(clone_a_dir.path().join("conflict.md"), "# Original\n").unwrap();
        git_commit(vp_a, "create conflict.md").unwrap();
        git_push(vp_a).unwrap();

        // B pulls to get the file
        git_pull(vp_b).unwrap();

        // A modifies and pushes
        fs::write(clone_a_dir.path().join("conflict.md"), "# Version A\n").unwrap();
        git_commit(vp_a, "A's change").unwrap();
        git_push(vp_a).unwrap();

        // B modifies the same file locally and commits
        fs::write(clone_b_dir.path().join("conflict.md"), "# Version B\n").unwrap();
        git_commit(vp_b, "B's change").unwrap();

        // B pulls — this causes a merge conflict
        let result = git_pull(vp_b).unwrap();
        assert_eq!(result.status, "conflict");

        (bare_dir, clone_a_dir, clone_b_dir)
    }

    fn assert_resolve_conflict_strategy(strategy: ConflictStrategy) {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        let conflicts = get_conflict_files(vp_b).unwrap();
        assert!(conflicts.contains(&"conflict.md".to_string()));

        git_resolve_conflict(
            vp_b,
            "conflict.md",
            match strategy {
                ConflictStrategy::Ours => "ours",
                ConflictStrategy::Theirs => "theirs",
            },
        )
        .unwrap();

        let remaining = get_conflict_files(vp_b).unwrap();
        assert!(remaining.is_empty());

        let content = fs::read_to_string(clone_b.path().join("conflict.md")).unwrap();
        let expected_content = match strategy {
            ConflictStrategy::Ours => "# Version B\n",
            ConflictStrategy::Theirs => "# Version A\n",
        };
        assert_eq!(content, expected_content);
    }

    #[test]
    fn test_resolve_conflict_ours() {
        assert_resolve_conflict_strategy(ConflictStrategy::Ours);
    }

    #[test]
    fn test_resolve_conflict_theirs() {
        assert_resolve_conflict_strategy(ConflictStrategy::Theirs);
    }

    #[test]
    fn test_commit_conflict_resolution() {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        git_resolve_conflict(vp_b, "conflict.md", "ours").unwrap();

        let result = git_commit_conflict_resolution(vp_b);
        assert!(result.is_ok());

        let log = git_command()
            .args(["log", "--oneline", "-1"])
            .current_dir(clone_b.path())
            .output()
            .unwrap();
        let log_str = String::from_utf8_lossy(&log.stdout);
        assert!(log_str.contains("Resolve merge conflicts"));
    }

    #[test]
    fn test_commit_conflict_resolution_fails_with_unresolved() {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        let result = git_commit_conflict_resolution(vp_b);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("still have unresolved conflicts"));
    }

    #[test]
    fn test_conflict_mode_merge_during_merge_conflict() {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        assert_eq!(get_conflict_mode(vp_b), "merge");
        assert!(is_merge_in_progress(vp_b));
        assert!(!is_rebase_in_progress(vp_b));
    }

    #[test]
    fn test_commit_conflict_resolution_merge_mode() {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        assert_eq!(get_conflict_mode(vp_b), "merge");

        git_resolve_conflict(vp_b, "conflict.md", "ours").unwrap();
        let result = git_commit_conflict_resolution(vp_b);
        assert!(result.is_ok());

        assert_eq!(get_conflict_mode(vp_b), "none");
    }

    #[test]
    fn test_commit_conflict_resolution_sets_missing_local_author_identity() {
        let _env = GitConfigEnvGuard::isolated();

        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vault = clone_b.path();
        let vp_b = vault.to_str().unwrap();

        git_resolve_conflict(vp_b, "conflict.md", "ours").unwrap();
        unset_local_author_config(vault);

        let result = git_commit_conflict_resolution(vp_b);
        assert!(
            result.is_ok(),
            "conflict commit should set local fallback identity: {result:?}"
        );
        assert_eq!(
            local_config_value(vault, "user.name").as_deref(),
            Some("Tolaria")
        );
        assert_eq!(
            local_config_value(vault, "user.email").as_deref(),
            Some("vault@tolaria.default")
        );
    }

    /// Set up a rebase conflict: clone_b has diverged from origin and
    /// `git pull --rebase` causes a conflict.
    fn setup_rebase_conflict_pair() -> (TempDir, TempDir, TempDir) {
        let (bare_dir, clone_a_dir, clone_b_dir) = setup_remote_pair();

        let vp_a = clone_a_dir.path().to_str().unwrap();
        let vp_b = clone_b_dir.path().to_str().unwrap();

        fs::write(clone_a_dir.path().join("conflict.md"), "# Original\n").unwrap();
        git_commit(vp_a, "create conflict.md").unwrap();
        git_push(vp_a).unwrap();

        git_pull(vp_b).unwrap();

        fs::write(clone_a_dir.path().join("conflict.md"), "# Version A\n").unwrap();
        git_commit(vp_a, "A's change").unwrap();
        git_push(vp_a).unwrap();

        fs::write(clone_b_dir.path().join("conflict.md"), "# Version B\n").unwrap();
        git_commit(vp_b, "B's change").unwrap();

        let output = git_command()
            .args(["pull", "--rebase"])
            .current_dir(clone_b_dir.path())
            .output()
            .unwrap();

        assert!(
            !output.status.success(),
            "Expected rebase conflict, but pull succeeded"
        );

        (bare_dir, clone_a_dir, clone_b_dir)
    }

    #[test]
    fn test_conflict_mode_rebase_during_rebase_conflict() {
        let (_bare, _clone_a, clone_b) = setup_rebase_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        assert_eq!(get_conflict_mode(vp_b), "rebase");
        assert!(is_rebase_in_progress(vp_b));
        assert!(!is_merge_in_progress(vp_b));
    }

    #[test]
    fn test_get_conflict_files_during_rebase() {
        let (_bare, _clone_a, clone_b) = setup_rebase_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        let conflicts = get_conflict_files(vp_b).unwrap();
        assert!(
            conflicts.contains(&"conflict.md".to_string()),
            "Should detect conflict.md during rebase, got: {:?}",
            conflicts
        );
    }

    #[test]
    fn test_resolve_and_continue_rebase() {
        let (_bare, _clone_a, clone_b) = setup_rebase_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        assert_eq!(get_conflict_mode(vp_b), "rebase");

        git_resolve_conflict(vp_b, "conflict.md", "theirs").unwrap();
        let remaining = get_conflict_files(vp_b).unwrap();
        assert!(remaining.is_empty());

        let result = git_commit_conflict_resolution(vp_b);
        assert!(result.is_ok(), "rebase --continue failed: {:?}", result);

        assert_eq!(get_conflict_mode(vp_b), "none");
    }

    #[test]
    fn nested_vault_conflicts_are_scoped_and_vault_relative() {
        let dir = setup_git_repo();
        let repository = dir.path();
        let vault = repository.join("docs");
        create_nested_conflicts(repository, &vault);
        let merge = git_command()
            .args(["merge", "feature"])
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(!merge.status.success());

        assert_eq!(get_conflict_mode(vault.to_str().unwrap()), "merge");
        assert_eq!(
            get_conflict_files(vault.to_str().unwrap()).unwrap(),
            vec!["conflict.md"]
        );
    }
}
