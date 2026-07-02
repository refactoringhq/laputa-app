use serde::{Deserialize, Serialize};
use std::path::Path;

use super::command::{git_output, git_output_result, stdout_text};
use super::remote_config::has_configured_remote;
use super::upstream::{branch_label, sync_target};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GitRemoteStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    #[serde(rename = "hasRemote")]
    pub has_remote: bool,
    #[serde(rename = "hasUpstream")]
    pub has_upstream: bool,
    pub upstream: Option<String>,
}

/// Get the current branch name, and how many commits ahead/behind the upstream.
pub fn git_remote_status(vault_path: impl AsRef<Path>) -> Result<GitRemoteStatus, String> {
    let vault = vault_path.as_ref();
    let branch = branch_label(vault)?;

    if !has_configured_remote(vault)? {
        return Ok(status_without_remote(branch));
    }

    // Fetch latest remote refs (silent, best-effort)
    let _ = git_output(vault, &["fetch", "--quiet"]);

    let Some(target) = sync_target(vault)? else {
        return Ok(status_without_upstream(branch));
    };

    let output = git_output_result(
        vault,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...{}", target.display),
        ],
    )?;

    let (ahead, behind) = if output.status.success() {
        parse_ahead_behind(&stdout_text(&output))
    } else {
        (0, 0)
    };

    Ok(status_with_upstream(branch, target.display, ahead, behind))
}

fn status_without_remote(branch: String) -> GitRemoteStatus {
    GitRemoteStatus {
        branch,
        ahead: 0,
        behind: 0,
        has_remote: false,
        has_upstream: false,
        upstream: None,
    }
}

fn status_without_upstream(branch: String) -> GitRemoteStatus {
    GitRemoteStatus {
        branch,
        ahead: 0,
        behind: 0,
        has_remote: true,
        has_upstream: false,
        upstream: None,
    }
}

fn status_with_upstream(
    branch: String,
    upstream: String,
    ahead: u32,
    behind: u32,
) -> GitRemoteStatus {
    GitRemoteStatus {
        branch,
        ahead,
        behind,
        has_remote: true,
        has_upstream: true,
        upstream: Some(upstream),
    }
}

fn parse_ahead_behind(stdout: &str) -> (u32, u32) {
    let parts: Vec<&str> = stdout.split('\t').collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{setup_git_repo, setup_remote_pair};
    use crate::git::{git_commit, git_pull, git_push};
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    struct RemotePair {
        _bare: TempDir,
        clone_a: TempDir,
        clone_b: TempDir,
    }

    impl RemotePair {
        fn seeded() -> Self {
            let (_bare, clone_a, clone_b) = setup_remote_pair();
            commit_default_note(clone_a.path());
            git_push(path_text(clone_a.path())).unwrap();
            Self {
                _bare,
                clone_a,
                clone_b,
            }
        }

        fn vault_a(&self) -> &str {
            path_text(self.clone_a.path())
        }

        fn sync_b(&self) {
            git_pull(path_text(self.clone_b.path())).unwrap();
        }

        fn update_a_note(&self) {
            fs::write(self.clone_a.path().join("note.md"), "# Updated\n").unwrap();
            git_commit(self.vault_a(), "update").unwrap();
        }

        fn update_b_note(&self) {
            fs::write(self.clone_b.path().join("note.md"), "# B update\n").unwrap();
            git_commit(path_text(self.clone_b.path()), "from B").unwrap();
        }

        fn push_b(&self) {
            git_push(path_text(self.clone_b.path())).unwrap();
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
        git_commit(path_text(vault_path), "initial").unwrap();
    }

    #[test]
    fn git_remote_status_no_remote() {
        let dir = local_repo_with_note();
        let status = git_remote_status(path_text(dir.path())).unwrap();
        assert!(!status.has_remote);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn git_remote_status_up_to_date() {
        let pair = RemotePair::seeded();
        let status = git_remote_status(pair.vault_a()).unwrap();
        assert!(status.has_remote);
        assert!(status.has_upstream);
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn git_remote_status_ahead() {
        let pair = RemotePair::seeded();
        pair.update_a_note();
        let status = git_remote_status(pair.vault_a()).unwrap();
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn git_remote_status_behind() {
        let pair = RemotePair::seeded();
        pair.sync_b();
        pair.update_b_note();
        pair.push_b();
        let status = git_remote_status(pair.vault_a()).unwrap();
        assert_eq!(status.behind, 1);
        assert_eq!(status.ahead, 0);
    }

    #[test]
    fn git_remote_status_serialization() {
        let status = GitRemoteStatus {
            branch: "main".to_string(),
            ahead: 2,
            behind: 1,
            has_remote: true,
            has_upstream: true,
            upstream: Some("origin/main".to_string()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"hasRemote\""));
        assert!(json.contains("\"hasUpstream\""));
        let parsed: GitRemoteStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.branch, "main");
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
    }
}
