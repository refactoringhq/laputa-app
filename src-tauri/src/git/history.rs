use super::{git_command, GitRepoContext};
use std::path::Path;

use super::GitCommit;

/// Get git log history for a specific file in the vault.
pub fn get_file_history(vault_path: &str, file_path: &str) -> Result<Vec<GitCommit>, String> {
    let repo = GitRepoContext::discover(Path::new(vault_path))?;
    let relative = repo.worktree_relative_for_file(Path::new(file_path))?;

    let relative_str = relative
        .to_str()
        .ok_or_else(|| "Invalid UTF-8 in path".to_string())?;

    let output = git_command()
        .args([
            "log",
            "--format=%H|%h|%an|%aI|%s",
            "-n",
            "20",
            "--",
            relative_str,
        ])
        .current_dir(&repo.worktree_root)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // No commits yet is not an error - just return empty history
        if stderr.contains("does not have any commits yet") {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            // Format: hash|short_hash|author|date|message
            // Use splitn(5) so message (last) can contain '|'
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() != 5 {
                return None;
            }
            let date = chrono::DateTime::parse_from_rfc3339(parts[3])
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            Some(GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                author: parts[2].to_string(),
                date,
                message: parts[4].to_string(),
            })
        })
        .collect();

    Ok(commits)
}

/// Get git diff for a specific file.
pub fn get_file_diff(vault_path: &str, file_path: &str) -> Result<String, String> {
    let file = Path::new(file_path);
    let repo = GitRepoContext::discover(Path::new(vault_path))?;
    let relative = repo.worktree_relative_for_file(file)?;

    let relative_str = relative
        .to_str()
        .ok_or_else(|| "Invalid UTF-8 in path".to_string())?;

    // First try tracked file diff
    let output = git_command()
        .args(["diff", "--", relative_str])
        .current_dir(&repo.worktree_root)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If no diff (maybe staged or untracked), try diff --cached
    if stdout.is_empty() {
        let cached = git_command()
            .args(["diff", "--cached", "--", relative_str])
            .current_dir(&repo.worktree_root)
            .output()
            .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;

        let cached_stdout = String::from_utf8_lossy(&cached.stdout).to_string();
        if !cached_stdout.is_empty() {
            return Ok(cached_stdout);
        }

        // Try showing untracked file as all-new
        let status = git_command()
            .args(["status", "--porcelain", "--", relative_str])
            .current_dir(&repo.worktree_root)
            .output()
            .map_err(|e| format!("Failed to run git status: {}", e))?;

        let status_out = String::from_utf8_lossy(&status.stdout);
        if status_out.starts_with("??") {
            // Untracked file: show entire content as added
            let content =
                std::fs::read_to_string(file).map_err(|e| format!("Failed to read file: {}", e))?;
            let lines: Vec<String> = content.lines().map(|l| format!("+{}", l)).collect();
            return Ok(format!(
                "diff --git a/{0} b/{0}\nnew file\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n{2}",
                relative_str,
                lines.len(),
                lines.join("\n")
            ));
        }
    }

    Ok(stdout)
}

/// Get git diff for a specific file at a given commit (compared to its parent).
pub fn get_file_diff_at_commit(
    vault_path: &str,
    file_path: &str,
    commit_hash: &str,
) -> Result<String, String> {
    let repo = GitRepoContext::discover(Path::new(vault_path))?;
    let relative = repo.worktree_relative_for_file(Path::new(file_path))?;

    let relative_str = relative
        .to_str()
        .ok_or_else(|| "Invalid UTF-8 in path".to_string())?;

    // Show diff between commit^ and commit for this file
    let output = git_command()
        .args([
            "diff",
            &format!("{}^", commit_hash),
            commit_hash,
            "--",
            relative_str,
        ])
        .current_dir(&repo.worktree_root)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If diff is empty, it might be the initial commit (no parent).
    // Fall back to showing the full file content as added.
    if stdout.is_empty() {
        let show = git_command()
            .args(["show", &format!("{}:{}", commit_hash, relative_str)])
            .current_dir(&repo.worktree_root)
            .output()
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if show.status.success() {
            let content = String::from_utf8_lossy(&show.stdout);
            let lines: Vec<String> = content.lines().map(|l| format!("+{}", l)).collect();
            return Ok(format!(
                "diff --git a/{0} b/{0}\nnew file\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n{2}",
                relative_str,
                lines.len(),
                lines.join("\n")
            ));
        }
    }

    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::git_command;
    use super::*;
    use crate::git::tests::setup_git_repo;
    use std::fs;

    #[test]
    fn test_get_file_history_with_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("test.md");

        fs::write(&file, "# Initial\n").unwrap();
        git_command()
            .args(["add", "test.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Initial commit"])
            .current_dir(vault)
            .output()
            .unwrap();

        fs::write(&file, "# Updated\n\nNew content.").unwrap();
        git_command()
            .args(["add", "test.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Update test"])
            .current_dir(vault)
            .output()
            .unwrap();

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].message, "Update test");
        assert_eq!(history[1].message, "Initial commit");
        assert_eq!(history[0].author, "Test User");
        assert!(!history[0].hash.is_empty());
        assert!(!history[0].short_hash.is_empty());
    }

    #[test]
    fn test_get_file_history_no_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("new.md");
        fs::write(&file, "# New\n").unwrap();

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(history.is_empty());
    }

    #[test]
    fn test_get_file_diff() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("diff-test.md");

        fs::write(&file, "# Test\n\nOriginal content.").unwrap();
        git_command()
            .args(["add", "diff-test.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Add diff-test"])
            .current_dir(vault)
            .output()
            .unwrap();

        fs::write(&file, "# Test\n\nModified content.").unwrap();

        let diff = get_file_diff(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("-Original content."));
        assert!(diff.contains("+Modified content."));
    }

    #[test]
    fn test_get_file_diff_at_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("diff-at-commit.md");

        fs::write(&file, "# First\n\nOriginal content.").unwrap();
        git_command()
            .args(["add", "diff-at-commit.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "First commit"])
            .current_dir(vault)
            .output()
            .unwrap();

        fs::write(&file, "# First\n\nModified content.").unwrap();
        git_command()
            .args(["add", "diff-at-commit.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Second commit"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Get hash of second commit
        let log = git_command()
            .args(["log", "--format=%H", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&log.stdout).trim().to_string();

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("-Original content."));
        assert!(diff.contains("+Modified content."));
    }

    #[test]
    fn test_get_file_diff_at_initial_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let file = vault.join("initial.md");

        fs::write(&file, "# Initial\n\nHello world.").unwrap();
        git_command()
            .args(["add", "initial.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Initial commit"])
            .current_dir(vault)
            .output()
            .unwrap();

        let log = git_command()
            .args(["log", "--format=%H", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        let hash = String::from_utf8_lossy(&log.stdout).trim().to_string();

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("+# Initial"));
        assert!(diff.contains("+Hello world."));
    }
}
