use super::{git_command_at, GitWorkspace};
use crate::vault::path_identity::vault_relative_path_string;
use std::path::{Path, PathBuf};
use std::process::Output;

use super::GitCommit;

struct FileHistoryTarget {
    workspace: GitWorkspace,
    relative_path: String,
}

struct AddedFileSource<'a> {
    relative_path: &'a str,
    content: &'a str,
}

#[derive(Clone, Copy)]
struct HistoryLimit(usize);

struct FileSelection {
    vault: PathBuf,
    file: PathBuf,
}

struct CommitRevision(String);

fn history_output(target: &FileHistoryTarget, limit: HistoryLimit) -> Result<Output, String> {
    git_command_at(target.workspace.git_root())
        .and_then(|mut command| {
            command
                .args([
                    "log",
                    "--format=%H|%h|%an|%aI|%s",
                    "-n",
                    &limit.0.to_string(),
                    "--",
                    &target.relative_path,
                ])
                .output()
        })
        .map_err(|error| format!("Failed to run git log: {error}"))
}

fn resolve_file_target(vault: &Path, file: &Path) -> Result<FileHistoryTarget, String> {
    let workspace = GitWorkspace::resolve(vault)?
        .ok_or_else(|| "Vault is not inside a Git work tree".to_string())?;
    let vault_relative = vault_relative_path_string(workspace.vault_root(), file)?;
    let relative_path = workspace.repo_relative_path(Path::new(&vault_relative));
    Ok(FileHistoryTarget {
        workspace,
        relative_path,
    })
}

fn parse_history_commits(output: &Output) -> Vec<GitCommit> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            (parts.len() == 5).then(|| GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                author: parts[2].to_string(),
                date: chrono::DateTime::parse_from_rfc3339(parts[3])
                    .map(|date| date.timestamp())
                    .unwrap_or(0),
                message: parts[4].to_string(),
            })
        })
        .collect()
}

fn added_file_diff(source: AddedFileSource<'_>) -> String {
    let lines: Vec<String> = source
        .content
        .lines()
        .map(|line| format!("+{line}"))
        .collect();
    format!(
        "diff --git a/{0} b/{0}\nnew file\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n{2}",
        source.relative_path,
        lines.len(),
        lines.join("\n")
    )
}

/// Get git log history for a specific file in the vault.
pub fn get_file_history(vault_path: &str, file_path: &str) -> Result<Vec<GitCommit>, String> {
    get_file_history_for(
        FileSelection {
            vault: PathBuf::from(vault_path),
            file: PathBuf::from(file_path),
        },
        HistoryLimit(20),
    )
}

fn get_file_history_for(
    selection: FileSelection,
    limit: HistoryLimit,
) -> Result<Vec<GitCommit>, String> {
    let target = resolve_file_target(&selection.vault, &selection.file)?;

    let output = history_output(&target, limit)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // No commits yet is not an error - just return empty history
        if stderr.contains("does not have any commits yet") {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {}", stderr));
    }

    Ok(parse_history_commits(&output))
}

/// Get git diff for a specific file.
pub fn get_file_diff(vault_path: &str, file_path: &str) -> Result<String, String> {
    get_file_diff_for(FileSelection {
        vault: PathBuf::from(vault_path),
        file: PathBuf::from(file_path),
    })
}

fn get_file_diff_for(selection: FileSelection) -> Result<String, String> {
    let target = resolve_file_target(&selection.vault, &selection.file)?;

    // First try tracked file diff
    let output = git_command_at(target.workspace.git_root())
        .and_then(|mut command| command.args(["diff", "--", &target.relative_path]).output())
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If no diff (maybe staged or untracked), try diff --cached
    if stdout.is_empty() {
        if let Some(fallback) = fallback_file_diff(&target, &selection.file)? {
            return Ok(fallback);
        }
    }

    Ok(stdout)
}

fn fallback_file_diff(target: &FileHistoryTarget, file: &Path) -> Result<Option<String>, String> {
    let cached = git_command_at(target.workspace.git_root())
        .and_then(|mut command| {
            command
                .args(["diff", "--cached", "--", &target.relative_path])
                .output()
        })
        .map_err(|e| format!("Failed to run git diff --cached: {e}"))?;
    let cached_stdout = String::from_utf8_lossy(&cached.stdout).to_string();
    if !cached_stdout.is_empty() {
        return Ok(Some(cached_stdout));
    }

    let status = git_command_at(target.workspace.git_root())
        .and_then(|mut command| {
            command
                .args(["status", "--porcelain", "--", &target.relative_path])
                .output()
        })
        .map_err(|e| format!("Failed to run git status: {e}"))?;
    if !String::from_utf8_lossy(&status.stdout).starts_with("??") {
        return Ok(None);
    }

    let content = std::fs::read_to_string(file).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(Some(added_file_diff(AddedFileSource {
        relative_path: &target.relative_path,
        content: &content,
    })))
}

/// Get git diff for a specific file at a given commit (compared to its parent).
pub fn get_file_diff_at_commit(
    vault_path: &str,
    file_path: &str,
    commit_hash: &str,
) -> Result<String, String> {
    get_file_diff_for_revision(
        FileSelection {
            vault: PathBuf::from(vault_path),
            file: PathBuf::from(file_path),
        },
        CommitRevision(commit_hash.to_string()),
    )
}

fn get_file_diff_for_revision(
    selection: FileSelection,
    revision: CommitRevision,
) -> Result<String, String> {
    let target = resolve_file_target(&selection.vault, &selection.file)?;

    // Show diff between commit^ and commit for this file
    let output = git_command_at(target.workspace.git_root())
        .and_then(|mut command| {
            command
                .args([
                    "diff",
                    &format!("{}^", revision.0),
                    &revision.0,
                    "--",
                    &target.relative_path,
                ])
                .output()
        })
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If diff is empty, it might be the initial commit (no parent).
    // Fall back to showing the full file content as added.
    if stdout.is_empty() {
        let show = git_command_at(target.workspace.git_root())
            .and_then(|mut command| {
                command
                    .args(["show", &format!("{}:{}", revision.0, target.relative_path)])
                    .output()
            })
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if show.status.success() {
            let content = String::from_utf8_lossy(&show.stdout);
            return Ok(added_file_diff(AddedFileSource {
                relative_path: &target.relative_path,
                content: &content,
            }));
        }
    }

    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
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

    #[test]
    fn nested_vault_history_and_initial_diff_use_repository_relative_path() {
        let dir = setup_git_repo();
        let repository = dir.path();
        let vault = repository.join("docs");
        fs::create_dir(&vault).unwrap();
        let file =
            write_and_commit_file(repository, "docs/guide.md", "# Guide\n", "Add nested guide");
        fs::write(repository.join("outside.md"), "# Outside\n").unwrap();
        git_command()
            .args(["add", "outside.md"])
            .current_dir(repository)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Outside change"])
            .current_dir(repository)
            .output()
            .unwrap();

        let history = get_file_history(vault.to_str().unwrap(), file.to_str().unwrap()).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].message, "Add nested guide");

        let initial_hash = history[0].hash.clone();
        let diff = get_file_diff_at_commit(
            vault.to_str().unwrap(),
            file.to_str().unwrap(),
            &initial_hash,
        )
        .unwrap();
        assert!(diff.contains("+++ b/docs/guide.md"), "{diff}");
        assert!(diff.contains("+# Guide"), "{diff}");
    }
}
