use serde::{Deserialize, Serialize};
use std::path::Path;

use super::command::{git_output, git_output_result, stderr_text, stdout_text};
use super::conflict::get_conflict_files;
use super::remote_config::has_configured_remote;

const NO_REMOTE_STATUS: &str = "no_remote";
const NO_REMOTE_MESSAGE: &str = "No remote configured";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GitPullResult {
    pub status: String, // "up_to_date" | "updated" | "conflict" | "no_remote" | "error"
    pub message: String,
    #[serde(rename = "updatedFiles")]
    pub updated_files: Vec<String>,
    #[serde(rename = "conflictFiles")]
    pub conflict_files: Vec<String>,
}

/// Check whether the vault repo has at least one remote configured.
pub fn has_remote(vault_path: impl AsRef<Path>) -> Result<bool, String> {
    let vault = vault_path.as_ref();
    has_configured_remote(vault)
}

/// Pull latest changes from remote. Uses --no-rebase to merge.
/// Returns a structured result with status and affected files.
pub fn git_pull(vault_path: impl AsRef<Path>) -> Result<GitPullResult, String> {
    let vault = vault_path.as_ref();

    if !has_remote(vault)? {
        return Ok(GitPullResult {
            status: NO_REMOTE_STATUS.to_string(),
            message: NO_REMOTE_MESSAGE.to_string(),
            updated_files: vec![],
            conflict_files: vec![],
        });
    }

    let output = git_output(vault, &["pull", "--no-rebase"])
        .map_err(|e| format!("Failed to run git pull: {}", e))?;

    let stdout = stdout_text(&output);
    let stderr = stderr_text(&output);

    if output.status.success() {
        if stdout.contains("Already up to date") || stdout.contains("Already up-to-date") {
            return Ok(GitPullResult {
                status: "up_to_date".to_string(),
                message: "Already up to date".to_string(),
                updated_files: vec![],
                conflict_files: vec![],
            });
        }
        let updated = parse_updated_files(&stdout);
        return Ok(GitPullResult {
            status: "updated".to_string(),
            message: format!("{} file(s) updated", updated.len()),
            updated_files: updated,
            conflict_files: vec![],
        });
    }

    // Check for merge conflicts
    let vault_text = vault.to_string_lossy();
    let conflicts = get_conflict_files(vault_text.as_ref()).unwrap_or_default();
    if !conflicts.is_empty() {
        return Ok(GitPullResult {
            status: "conflict".to_string(),
            message: format!("Merge conflict in {} file(s)", conflicts.len()),
            updated_files: vec![],
            conflict_files: conflicts,
        });
    }

    // Network error or other failure — report as error
    let detail = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };
    Ok(GitPullResult {
        status: "error".to_string(),
        message: detail,
        updated_files: vec![],
        conflict_files: vec![],
    })
}

/// Parse `git pull` output to extract updated file paths.
fn parse_updated_files(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            // Lines like " path/to/file.md | 5 ++-" in diffstat
            if trimmed.contains('|') {
                let path = trimmed.split('|').next()?.trim();
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
            None
        })
        .collect()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GitRemoteStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    #[serde(rename = "hasRemote")]
    pub has_remote: bool,
}

/// Get the current branch name, and how many commits ahead/behind the upstream.
pub fn git_remote_status(vault_path: impl AsRef<Path>) -> Result<GitRemoteStatus, String> {
    let vault = vault_path.as_ref();

    if !has_remote(vault)? {
        let branch = current_branch(vault)?;
        return Ok(GitRemoteStatus {
            branch,
            ahead: 0,
            behind: 0,
            has_remote: false,
        });
    }

    // Fetch latest remote refs (silent, best-effort)
    let _ = git_output(vault, &["fetch", "--quiet"]);

    let branch = current_branch(vault)?;

    let output = git_output_result(
        vault,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )?;

    if !output.status.success() {
        // No upstream set — report 0/0
        return Ok(GitRemoteStatus {
            branch,
            ahead: 0,
            behind: 0,
            has_remote: true,
        });
    }

    let stdout = stdout_text(&output);
    let parts: Vec<&str> = stdout.split('\t').collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok(GitRemoteStatus {
        branch,
        ahead,
        behind,
        has_remote: true,
    })
}

fn current_branch(vault: &Path) -> Result<String, String> {
    let output = git_output(vault, &["branch", "--show-current"])
        .map_err(|e| format!("Failed to get branch: {}", e))?;
    Ok(stdout_text(&output))
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GitPushResult {
    pub status: String, // "ok" | "rejected" | "auth_error" | "network_error" | "no_remote" | "error"
    pub message: String,
}

/// Classify a git push stderr message into a user-friendly status and message.
pub fn classify_push_error(stderr: &str) -> GitPushResult {
    let lower = stderr.to_lowercase();

    if is_rejected_push_error(&lower) {
        return push_error(
            "rejected",
            "Push rejected: remote has new commits. Pull first, then push.",
        );
    }

    if is_auth_push_error(&lower) {
        return push_error(
            "auth_error",
            "Push failed: authentication error. Check your credentials.",
        );
    }

    if is_network_push_error(&lower) {
        return push_error(
            "network_error",
            "Push failed: network error. Check your connection and try again.",
        );
    }

    if is_no_remote_push_error(&lower) {
        return push_error("no_remote", "No remote configured");
    }

    push_error(
        "error",
        format!("Push failed: {}", push_error_detail(stderr)),
    )
}

fn push_error(status: &str, message: impl Into<String>) -> GitPushResult {
    GitPushResult {
        status: status.to_string(),
        message: message.into(),
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn is_rejected_push_error(lower: &str) -> bool {
    contains_any(lower, &["non-fast-forward", "[rejected]", "fetch first"])
        || (lower.contains("failed to push some refs")
            && contains_any(lower, &["updates were rejected", "non-fast-forward"]))
}

fn is_auth_push_error(lower: &str) -> bool {
    contains_any(
        lower,
        &[
            "authentication failed",
            "could not read username",
            "permission denied",
            "403",
            "invalid credentials",
        ],
    )
}

fn is_network_push_error(lower: &str) -> bool {
    contains_any(
        lower,
        &[
            "could not resolve host",
            "unable to access",
            "connection refused",
            "network is unreachable",
            "timed out",
        ],
    )
}

fn is_no_remote_push_error(lower: &str) -> bool {
    contains_any(
        lower,
        &[
            "no configured push destination",
            "does not appear to be a git repository",
            "no such remote",
            "no upstream branch",
        ],
    )
}

fn push_error_detail(stderr: &str) -> String {
    let hint_line = stderr
        .lines()
        .find(|line| line.trim_start().starts_with("hint:"))
        .map(|line| {
            line.trim_start()
                .strip_prefix("hint:")
                .unwrap_or(line)
                .trim()
        })
        .unwrap_or("")
        .to_string();

    if hint_line.is_empty() {
        stderr.trim().to_string()
    } else {
        hint_line
    }
}

/// Push to remote.
pub fn git_push(vault_path: impl AsRef<Path>) -> Result<GitPushResult, String> {
    let vault = vault_path.as_ref();

    if !has_remote(vault)? {
        return Ok(GitPushResult {
            status: NO_REMOTE_STATUS.to_string(),
            message: NO_REMOTE_MESSAGE.to_string(),
        });
    }

    let output =
        git_output(vault, &["push"]).map_err(|e| format!("Failed to run git push: {}", e))?;

    if !output.status.success() {
        let stderr = stderr_text(&output);
        return Ok(classify_push_error(&stderr));
    }

    Ok(GitPushResult {
        status: "ok".to_string(),
        message: "Pushed to remote".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_command;
    use crate::git::git_commit;
    use crate::git::tests::{setup_git_repo, setup_remote_pair};
    use std::fs;
    use tempfile::TempDir;

    struct RemotePair {
        _bare: TempDir,
        clone_a: TempDir,
        clone_b: TempDir,
    }

    impl RemotePair {
        fn new() -> Self {
            let (_bare, clone_a, clone_b) = setup_remote_pair();

            Self {
                _bare,
                clone_a,
                clone_b,
            }
        }

        fn seeded() -> Self {
            let pair = Self::new();
            commit_default_note(pair.clone_a.path());
            git_push(pair.vault_a()).unwrap();
            pair
        }

        fn vault_a(&self) -> &str {
            path_text(self.clone_a.path())
        }

        fn vault_b(&self) -> &str {
            path_text(self.clone_b.path())
        }

        fn sync_b(&self) {
            git_pull(self.vault_b()).unwrap();
        }

        fn update_a_note(&self) {
            fs::write(self.clone_a.path().join("note.md"), "# Updated\n").unwrap();
            git_commit(self.vault_a(), "update").unwrap();
        }

        fn update_b_note(&self) {
            fs::write(self.clone_b.path().join("note.md"), "# B update\n").unwrap();
            git_commit(self.vault_b(), "from B").unwrap();
        }

        fn push_a(&self) {
            git_push(self.vault_a()).unwrap();
        }

        fn push_b(&self) {
            git_push(self.vault_b()).unwrap();
        }
    }

    fn path_text(path: &Path) -> &str {
        path.to_str().unwrap()
    }

    fn local_repo_with_note() -> TempDir {
        let dir = setup_git_repo();
        commit_default_note(dir.path());
        dir
    }

    fn commit_default_note(vault_path: &Path) {
        fs::write(vault_path.join("note.md"), "# Note\n").unwrap();
        git_commit(vault_path.to_str().unwrap(), "initial").unwrap();
    }

    #[test]
    fn test_has_remote_returns_false_for_local_repo() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = path_text(vault);

        assert!(!has_remote(vp).unwrap());
    }

    #[test]
    fn test_has_remote_returns_true_when_remote_exists() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = path_text(vault);

        git_command()
            .args(["remote", "add", "origin", "https://example.com/repo.git"])
            .current_dir(vault)
            .output()
            .unwrap();

        assert!(has_remote(vp).unwrap());
    }

    #[test]
    fn test_has_remote_ignores_name_only_remote_without_url() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = path_text(vault);

        git_command()
            .args(["config", "remote.origin.prune", "true"])
            .current_dir(vault)
            .output()
            .unwrap();

        let remote_names = git_command()
            .args(["remote"])
            .current_dir(vault)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&remote_names.stdout).contains("origin"));
        assert!(!has_remote(vp).unwrap());
    }

    #[test]
    fn test_git_pull_no_remote_returns_no_remote() {
        let dir = local_repo_with_note();
        let vp = path_text(dir.path());

        let result = git_pull(vp).unwrap();
        assert_eq!(result.status, "no_remote");
        assert!(result.updated_files.is_empty());
        assert!(result.conflict_files.is_empty());
    }

    #[test]
    fn test_git_pull_up_to_date() {
        let pair = RemotePair::seeded();

        let result = git_pull(pair.vault_a()).unwrap();
        assert_eq!(result.status, "up_to_date");
    }

    #[test]
    fn test_git_pull_updated_files() {
        let pair = RemotePair::seeded();
        pair.sync_b();
        pair.update_a_note();
        pair.push_a();

        let result = git_pull(pair.vault_b()).unwrap();
        assert_eq!(result.status, "updated");
        assert!(result.conflict_files.is_empty());
    }

    #[test]
    fn test_parse_updated_files_diffstat() {
        let stdout =
            " Fast-forward\n note.md | 2 +-\n project/plan.md | 4 ++--\n 2 files changed\n";
        let files = parse_updated_files(stdout);
        assert_eq!(files, vec!["note.md", "project/plan.md"]);
    }

    #[test]
    fn test_parse_updated_files_empty() {
        let stdout = "Already up to date.\n";
        let files = parse_updated_files(stdout);
        assert!(files.is_empty());
    }

    #[test]
    fn test_classify_push_error_non_fast_forward() {
        let stderr = r#"To github.com:user/repo.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'github.com:user/repo.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally."#;
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "rejected");
        assert!(result.message.contains("Pull first"));
    }

    #[test]
    fn test_classify_push_error_fetch_first() {
        let stderr = "error: failed to push some refs\nhint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. Integrate the remote changes (e.g.\nhint: 'git pull ...') before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.\n ! [rejected]        main -> main (fetch first)\n";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "rejected");
    }

    #[test]
    fn test_classify_push_error_auth_failure() {
        let stderr = "remote: Permission denied to user/repo.git\nfatal: unable to access 'https://github.com/user/repo.git/': The requested URL returned error: 403";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "auth_error");
        assert!(result.message.contains("authentication"));
    }

    #[test]
    fn test_classify_push_error_network() {
        let stderr = "fatal: unable to access 'https://github.com/user/repo.git/': Could not resolve host: github.com";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "network_error");
        assert!(result.message.contains("network"));
    }

    #[test]
    fn test_classify_push_error_no_remote() {
        let stderr = "fatal: No configured push destination.";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "no_remote");
        assert!(result.message.contains("No remote"));
    }

    #[test]
    fn test_classify_push_error_unknown() {
        let stderr = "error: something unexpected happened\nhint: Try again later";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "error");
        assert!(result.message.contains("Try again later"));
    }

    #[test]
    fn test_classify_push_error_unknown_no_hint() {
        let stderr = "error: something totally weird";
        let result = classify_push_error(stderr);
        assert_eq!(result.status, "error");
        assert!(result.message.contains("something totally weird"));
    }

    #[test]
    fn test_git_push_result_serialization() {
        let result = GitPushResult {
            status: "rejected".to_string(),
            message: "Push rejected".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rejected\""));
        let parsed: GitPushResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, "rejected");
    }

    #[test]
    fn test_git_push_success_returns_ok() {
        let pair = RemotePair::new();

        commit_default_note(pair.clone_a.path());
        let result = git_push(pair.vault_a()).unwrap();
        assert_eq!(result.status, "ok");
    }

    #[test]
    fn test_git_push_no_remote_returns_no_remote() {
        let dir = local_repo_with_note();
        let vp = path_text(dir.path());

        let result = git_push(vp).unwrap();
        assert_eq!(result.status, "no_remote");
    }

    #[test]
    fn test_git_push_rejected_returns_rejected() {
        let pair = RemotePair::new();
        let vp_a = pair.vault_a();
        let vp_b = pair.vault_b();

        // Both clones commit and push — second push should be rejected
        fs::write(pair.clone_a.path().join("note.md"), "# A\n").unwrap();
        git_commit(vp_a, "from A").unwrap();
        git_push(vp_a).unwrap();

        git_pull(vp_b).unwrap();
        fs::write(pair.clone_b.path().join("note.md"), "# B\n").unwrap();
        git_commit(vp_b, "from B").unwrap();
        git_push(vp_b).unwrap();

        // Now A has a new commit but hasn't pulled B's changes
        fs::write(pair.clone_a.path().join("other.md"), "# Other\n").unwrap();
        git_commit(vp_a, "from A again").unwrap();
        let result = git_push(vp_a).unwrap();
        assert_eq!(result.status, "rejected");
        assert!(result.message.contains("Pull first"));
    }

    #[test]
    fn test_git_remote_status_no_remote() {
        let dir = local_repo_with_note();
        let vp = path_text(dir.path());

        let status = git_remote_status(vp).unwrap();
        assert!(!status.has_remote);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn test_git_remote_status_up_to_date() {
        let pair = RemotePair::seeded();

        let status = git_remote_status(pair.vault_a()).unwrap();
        assert!(status.has_remote);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn test_git_remote_status_ahead() {
        let pair = RemotePair::seeded();

        // Make a new commit without pushing
        pair.update_a_note();

        let status = git_remote_status(pair.vault_a()).unwrap();
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn test_git_remote_status_behind() {
        let pair = RemotePair::seeded();
        pair.sync_b();
        pair.update_b_note();
        pair.push_b();

        // A is now behind by 1
        let status = git_remote_status(pair.vault_a()).unwrap();
        assert_eq!(status.behind, 1);
        assert_eq!(status.ahead, 0);
    }

    #[test]
    fn test_git_remote_status_serialization() {
        let status = GitRemoteStatus {
            branch: "main".to_string(),
            ahead: 2,
            behind: 1,
            has_remote: true,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"hasRemote\""));
        let parsed: GitRemoteStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.branch, "main");
        assert_eq!(parsed.ahead, 2);
    }

    #[test]
    fn test_git_pull_result_serialization() {
        let result = GitPullResult {
            status: "updated".to_string(),
            message: "2 file(s) updated".to_string(),
            updated_files: vec!["note.md".to_string()],
            conflict_files: vec![],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"updatedFiles\""));
        assert!(json.contains("\"conflictFiles\""));

        let parsed: GitPullResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, "updated");
        assert_eq!(parsed.updated_files.len(), 1);
    }
}
