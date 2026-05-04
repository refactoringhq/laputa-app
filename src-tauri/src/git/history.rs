use super::git_command;
use crate::vault::path_identity::vault_relative_path_string;
use std::path::Path;

use super::GitCommit;

/// Get git log history for a specific file in the vault.
pub fn get_file_history(vault_path: &str, file_path: &str) -> Result<Vec<GitCommit>, String> {
    let vault = Path::new(vault_path);
    let file = Path::new(file_path);
    let relative_str = vault_relative_path_string(vault, file)?;

    let output = git_command()
        .args([
            "log",
            "--format=%H|%h|%an|%aI|%s",
            "-n",
            "20",
            "--",
            &relative_str,
        ])
        .current_dir(vault)
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
    let vault = Path::new(vault_path);
    let file = Path::new(file_path);
    let relative_str = vault_relative_path_string(vault, file)?;

    // First try tracked file diff
    let output = git_command()
        .args(["diff", "--", &relative_str])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If no diff (maybe staged or untracked), try diff --cached
    if stdout.is_empty() {
        let cached = git_command()
            .args(["diff", "--cached", "--", &relative_str])
            .current_dir(vault)
            .output()
            .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;

        let cached_stdout = String::from_utf8_lossy(&cached.stdout).to_string();
        if !cached_stdout.is_empty() {
            return Ok(cached_stdout);
        }

        // Try showing untracked file as all-new
        let status = git_command()
            .args(["status", "--porcelain", "--", &relative_str])
            .current_dir(vault)
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
    let vault = Path::new(vault_path);
    let file = Path::new(file_path);
    let relative_str = vault_relative_path_string(vault, file)?;

    // Show diff between commit^ and commit for this file
    let output = git_command()
        .args([
            "diff",
            &format!("{}^", commit_hash),
            commit_hash,
            "--",
            &relative_str,
        ])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If diff is empty, it might be the initial commit (no parent).
    // Fall back to showing the full file content as added.
    if stdout.is_empty() {
        let show = git_command()
            .args(["show", &format!("{}:{}", commit_hash, relative_str)])
            .current_dir(vault)
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
    use std::{fs, path::PathBuf};

    fn force_quoted_git_paths(vault: &Path) {
        git_command()
            .args(["config", "core.quotePath", "true"])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    fn write_and_commit_file(
        vault: &Path,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> PathBuf {
        let file = vault.join(relative_path);
        fs::write(&file, content).unwrap();
        git_command()
            .args(["add", relative_path])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", message])
            .current_dir(vault)
            .output()
            .unwrap();
        file
    }

    fn head_hash(vault: &Path) -> String {
        let log = git_command()
            .args(["log", "--format=%H", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        String::from_utf8_lossy(&log.stdout).trim().to_string()
    }

    #[test]
    fn test_get_file_history_with_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();

        let file = write_and_commit_file(vault, "test.md", "# Initial\n", "Initial commit");
        write_and_commit_file(vault, "test.md", "# Updated\n\nNew content.", "Update test");

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

        let file = write_and_commit_file(
            vault,
            "diff-test.md",
            "# Test\n\nOriginal content.",
            "Add diff-test",
        );

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

        let file = write_and_commit_file(
            vault,
            "diff-at-commit.md",
            "# First\n\nOriginal content.",
            "First commit",
        );
        write_and_commit_file(
            vault,
            "diff-at-commit.md",
            "# First\n\nModified content.",
            "Second commit",
        );

        let hash = head_hash(vault);

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

        let file = write_and_commit_file(
            vault,
            "initial.md",
            "# Initial\n\nHello world.",
            "Initial commit",
        );

        let hash = head_hash(vault);

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(!diff.is_empty());
        assert!(diff.contains("+# Initial"));
        assert!(diff.contains("+Hello world."));
    }

    #[test]
    fn test_get_file_diff_at_commit_preserves_chinese_filename_and_content() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let relative_path = "中文笔记.md";
        let file = vault.join(relative_path);

        force_quoted_git_paths(vault);
        write_and_commit_file(
            vault,
            relative_path,
            "# 初始\n\n第一行\n",
            "Add Chinese note",
        );
        write_and_commit_file(
            vault,
            relative_path,
            "# 初始\n\n第二行\n",
            "Update Chinese note",
        );
        let hash = head_hash(vault);

        let diff = get_file_diff_at_commit(vault.to_str().unwrap(), file.to_str().unwrap(), &hash)
            .unwrap();

        assert!(diff.contains("diff --git a/中文笔记.md b/中文笔记.md"));
        assert!(diff.contains("-第一行"));
        assert!(diff.contains("+第二行"));
        assert!(!diff.contains("\\344"));
    }
}
