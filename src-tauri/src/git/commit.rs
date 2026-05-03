use super::{git_command, GitRepoContext};
use std::path::Path;

struct CommitFailure {
    stdout: String,
    stderr: String,
}

/// Commit all changes with a message.
pub fn git_commit(vault_path: &str, message: &str) -> Result<String, String> {
    let repo = GitRepoContext::discover(Path::new(vault_path))?;

    // Stage all changes
    let add = git_command()
        .args(["add", "-A", "--"])
        .arg(repo.vault_pathspec())
        .current_dir(&repo.worktree_root)
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !add.status.success() {
        let stderr = String::from_utf8_lossy(&add.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    match run_commit(&repo.worktree_root, message, false) {
        Ok(stdout) => Ok(stdout),
        Err(failure) if is_commit_signing_failure(&failure.detail()) => {
            run_commit(&repo.worktree_root, message, true).map_err(|retry_failure| {
                format!(
                    "git commit signing failed; retried without signing but git commit still failed: {}",
                    retry_failure.detail()
                )
            })
        }
        Err(failure) => Err(format!("git commit failed: {}", failure.detail())),
    }
}

fn run_commit(vault: &Path, message: &str, disable_signing: bool) -> Result<String, CommitFailure> {
    let mut command = git_command();
    if disable_signing {
        command.args(["-c", "commit.gpgsign=false"]);
    }

    let commit = command
        .args(["commit", "-m", message])
        .current_dir(vault)
        .output()
        .map_err(|e| CommitFailure {
            stdout: String::new(),
            stderr: format!("Failed to run git commit: {}", e),
        })?;

    if commit.status.success() {
        return Ok(String::from_utf8_lossy(&commit.stdout).to_string());
    }

    Err(CommitFailure {
        stdout: String::from_utf8_lossy(&commit.stdout).to_string(),
        stderr: String::from_utf8_lossy(&commit.stderr).to_string(),
    })
}

impl CommitFailure {
    fn detail(&self) -> String {
        // git writes "nothing to commit" to stdout, not stderr.
        let detail = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        detail.trim().to_string()
    }
}

fn is_commit_signing_failure(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("cannot run gpg")
        || lower.contains("gpg failed to sign")
        || lower.contains("failed to sign the data")
        || lower.contains("gpg.ssh")
        || (lower.contains("failed to write commit object")
            && (lower.contains("sign") || lower.contains("gpg")))
}

#[cfg(test)]
mod tests {
    use super::git_command;
    use super::*;
    use crate::git::tests::setup_git_repo;
    use std::fs;

    #[test]
    fn test_git_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();

        fs::write(vault.join("commit-test.md"), "# Test\n").unwrap();

        let result = git_commit(vault.to_str().unwrap(), "Test commit");
        assert!(result.is_ok());

        // Verify the commit exists
        let log = git_command()
            .args(["log", "--oneline", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        let log_str = String::from_utf8_lossy(&log.stdout);
        assert!(log_str.contains("Test commit"));
    }

    #[test]
    fn test_commit_nothing_to_commit_returns_error() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        // Create and commit, so working tree is clean
        fs::write(vault.join("clean.md"), "# Clean\n").unwrap();
        git_commit(vp, "initial").unwrap();

        // Committing again with no changes should fail
        let result = git_commit(vp, "nothing here");
        assert!(result.is_err(), "Commit should fail when nothing to commit");
        assert!(
            result.unwrap_err().contains("nothing to commit"),
            "Error should mention 'nothing to commit'"
        );
    }

    #[test]
    fn test_git_commit_retries_without_signing_when_gpg_is_missing() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        git_command()
            .args(["config", "commit.gpgsign", "true"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["config", "gpg.program", "/missing/tolaria-test-gpg"])
            .current_dir(vault)
            .output()
            .unwrap();
        fs::write(vault.join("signed-config.md"), "# Signed config\n").unwrap();

        let result = git_commit(vp, "Commit with broken signing config");
        assert!(
            result.is_ok(),
            "commit should retry unsigned when signing helper is missing: {result:?}"
        );

        let log = git_command()
            .args(["log", "--oneline", "-1"])
            .current_dir(vault)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("Commit with broken signing config"));

        let config = git_command()
            .args(["config", "commit.gpgsign"])
            .current_dir(vault)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&config.stdout).trim(), "true");
    }

    #[test]
    fn test_commit_signing_failure_detection_is_specific() {
        assert!(is_commit_signing_failure(
            "error: cannot run gpg: No such file or directory\nfatal: failed to write commit object"
        ));
        assert!(!is_commit_signing_failure(
            "On branch main\nnothing to commit, working tree clean"
        ));
    }
}
