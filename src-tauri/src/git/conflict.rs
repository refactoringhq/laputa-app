use std::path::Path;

use super::{ensure_author_config, git_command, run_git};

/// List files with merge conflicts (unmerged paths).
///
/// Uses `git ls-files --unmerged` instead of `git diff --diff-filter=U` because
/// ls-files reliably detects unmerged index entries even when the merge state is
/// stale (e.g. after a reboot or when MERGE_HEAD is missing).
pub fn get_conflict_files(vault_path: &str) -> Result<Vec<String>, String> {
    let vault = Path::new(vault_path);
    let output = git_command()
        .args(["ls-files", "--unmerged"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to check conflicts: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Each unmerged file appears multiple times (once per stage: base/ours/theirs).
    // Format: "<mode> <hash> <stage>\t<path>"
    let mut files: Vec<String> = stdout
        .lines()
        .filter_map(|line| line.split('\t').nth(1).map(|s| s.to_string()))
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

/// Resolve a single conflict file by choosing "ours" or "theirs" strategy,
/// then stage the result.
pub fn git_resolve_conflict(vault_path: &str, file: &str, strategy: &str) -> Result<(), String> {
    let vault = Path::new(vault_path);

    let checkout_flag = match strategy {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => {
            return Err(format!(
                "Invalid strategy '{}': must be 'ours' or 'theirs'",
                strategy
            ))
        }
    };

    run_git(vault, &["checkout", checkout_flag, "--", file])?;
    run_git(vault, &["add", "--", file])?;

    Ok(())
}

/// Check whether a rebase is currently in progress.
pub fn is_rebase_in_progress(vault_path: &str) -> bool {
    let vault = Path::new(vault_path);
    let git_dir = vault.join(".git");
    git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists()
}

/// Check whether a merge is currently in progress.
pub fn is_merge_in_progress(vault_path: &str) -> bool {
    Path::new(vault_path)
        .join(".git")
        .join("MERGE_HEAD")
        .exists()
}

/// Returns the current conflict mode: "rebase", "merge", or "none".
pub fn get_conflict_mode(vault_path: &str) -> String {
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
pub fn git_commit_conflict_resolution(vault_path: &str) -> Result<String, String> {
    let vault = Path::new(vault_path);

    // Verify no remaining conflicts
    let remaining = get_conflict_files(vault_path)?;
    if !remaining.is_empty() {
        return Err(format!(
            "Cannot commit: {} file(s) still have unresolved conflicts",
            remaining.len()
        ));
    }

    ensure_author_config(vault)?;

    let mode = get_conflict_mode(vault_path);
    let output = match mode.as_str() {
        "rebase" => git_command()
            .args(["rebase", "--continue"])
            .env("GIT_EDITOR", "true")
            .current_dir(vault)
            .output()
            .map_err(|e| format!("Failed to run git rebase --continue: {}", e))?,
        _ => git_command()
            .args(["commit", "-m", "Resolve merge conflicts"])
            .current_dir(vault)
            .output()
            .map_err(|e| format!("Failed to run git commit: {}", e))?,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        let cmd_name = if mode == "rebase" {
            "git rebase --continue"
        } else {
            "git commit"
        };
        return Err(format!("{} failed: {}", cmd_name, detail.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{setup_git_repo, setup_remote_pair};
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

    fn assert_resolve_conflict_strategy(strategy: &str, expected_content: &str) {
        let (_bare, _clone_a, clone_b) = setup_conflict_pair();
        let vp_b = clone_b.path().to_str().unwrap();

        let conflicts = get_conflict_files(vp_b).unwrap();
        assert!(conflicts.contains(&"conflict.md".to_string()));

        git_resolve_conflict(vp_b, "conflict.md", strategy).unwrap();

        let remaining = get_conflict_files(vp_b).unwrap();
        assert!(remaining.is_empty());

        let content = fs::read_to_string(clone_b.path().join("conflict.md")).unwrap();
        assert_eq!(content, expected_content);
    }

    #[test]
    fn test_resolve_conflict_ours() {
        assert_resolve_conflict_strategy("ours", "# Version B\n");
    }

    #[test]
    fn test_resolve_conflict_theirs() {
        assert_resolve_conflict_strategy("theirs", "# Version A\n");
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
            Some("vault@tolaria.md")
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
}
