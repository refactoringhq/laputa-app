use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Output;

use super::credentials::request_remote_credentials;
use super::{ensure_author_config, git_command};

const DEFAULT_REMOTE_NAME: &str = "origin";

#[derive(Clone, Copy)]
enum ConnectStatus {
    Connected,
    AlreadyConfigured,
    IncompatibleHistory,
    AuthError,
    NetworkError,
    Error,
}

impl ConnectStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Connected => "connected",
            Self::AlreadyConfigured => "already_configured",
            Self::IncompatibleHistory => "incompatible_history",
            Self::AuthError => "auth_error",
            Self::NetworkError => "network_error",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GitAddRemoteResult {
    pub status: String, // "connected" | "already_configured" | "incompatible_history" | "auth_error" | "network_error" | "error"
    pub message: String,
}

struct RemoteConnection {
    branch: String,
    remote_branch: String,
}

impl RemoteConnection {
    fn new(branch: String) -> Self {
        let remote_branch = format!("{DEFAULT_REMOTE_NAME}/{branch}");
        Self {
            branch,
            remote_branch,
        }
    }

    fn pushed_history_message(&self) -> String {
        format!(
            "Remote connected. Tolaria pushed your local commits and is now tracking {}.",
            self.remote_branch
        )
    }

    fn tracking_message(&self) -> String {
        format!(
            "Remote connected. This vault now tracks {}.",
            self.remote_branch
        )
    }
}

pub fn disconnect_all_remotes(vault_path: &str) -> Result<(), String> {
    let vault = Path::new(vault_path);

    for remote in list_remotes(vault)? {
        run_git(vault, &["remote", "remove", &remote])?;
    }

    unset_upstream(vault);
    Ok(())
}

pub fn git_add_remote(vault_path: &str, remote_url: &str) -> Result<GitAddRemoteResult, String> {
    let vault = Path::new(vault_path);

    if remote_url.trim().is_empty() {
        return Ok(connect_result(
            ConnectStatus::Error,
            "Enter a repository URL before connecting a remote.",
        ));
    }

    if !list_remotes(vault)?.is_empty() {
        return Ok(connect_result(
            ConnectStatus::AlreadyConfigured,
            "This vault already has a remote configured.",
        ));
    }

    ensure_author_config(vault)?;

    let branch = current_branch(vault)?;
    if branch.is_empty() {
        return Ok(connect_result(
            ConnectStatus::Error,
            "Tolaria could not determine the current branch for this vault.",
        ));
    }
    let connection = RemoteConnection::new(branch);

    let trimmed_url = remote_url.trim();
    run_git(vault, &["remote", "add", DEFAULT_REMOTE_NAME, trimmed_url])?;
    request_remote_credentials(vault, trimmed_url);

    let result = finish_remote_connection(vault, &connection);
    if result.status != "connected" {
        let _ = disconnect_all_remotes(vault_path);
    }

    Ok(result)
}

fn finish_remote_connection(vault: &Path, connection: &RemoteConnection) -> GitAddRemoteResult {
    if let Err(stderr) = fetch_remote(vault) {
        return classify_connect_error(&stderr);
    }

    let remote_branches = match list_remote_branches(vault) {
        Ok(branches) => branches,
        Err(err) => return connect_result(ConnectStatus::Error, err),
    };

    if remote_branches.is_empty() {
        return push_with_tracking(vault, connection, connection.pushed_history_message());
    }

    if !remote_branches
        .iter()
        .any(|candidate| candidate == &connection.remote_branch)
    {
        return connect_result(
            ConnectStatus::IncompatibleHistory,
            format!(
                "This repository already has git branches, but not '{}'. Use an empty repository or one created from this vault.",
                connection.branch
            ),
        );
    }

    if !histories_share_base(vault, connection) {
        return connect_result(
            ConnectStatus::IncompatibleHistory,
            "This repository has unrelated history. Use an empty repository or one created from this vault.",
        );
    }

    let (_, behind) = match ahead_behind_counts(vault, connection) {
        Ok(counts) => counts,
        Err(err) => return connect_result(ConnectStatus::Error, err),
    };

    if behind > 0 {
        return connect_result(
            ConnectStatus::IncompatibleHistory,
            format!(
                "This repository already has commits on '{}' that are not in this vault. Tolaria will not connect it automatically.",
                connection.branch
            ),
        );
    }

    push_with_tracking(vault, connection, connection.tracking_message())
}

fn connect_result(status: ConnectStatus, message: impl Into<String>) -> GitAddRemoteResult {
    GitAddRemoteResult {
        status: status.as_str().to_string(),
        message: message.into(),
    }
}

fn current_branch(vault: &Path) -> Result<String, String> {
    let output = git_output(vault, &["branch", "--show-current"])?;

    if output.status.success() {
        return Ok(stdout_text(&output));
    }

    Err(command_error("git branch --show-current", &output))
}

fn list_remotes(vault: &Path) -> Result<Vec<String>, String> {
    let output = git_output(vault, &["remote"])?;

    if !output.status.success() {
        return Err(command_error("git remote", &output));
    }

    Ok(stdout_lines(&output))
}

fn unset_upstream(vault: &Path) {
    let _ = git_command()
        .args(["branch", "--unset-upstream"])
        .current_dir(vault)
        .output();
}

fn run_git(vault: &Path, args: &[&str]) -> Result<(), String> {
    let output = git_command()
        .args(args)
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git {}: {e}", args[0]))?;

    if output.status.success() {
        return Ok(());
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

fn fetch_remote(vault: &Path) -> Result<(), String> {
    run_git(vault, &["fetch", DEFAULT_REMOTE_NAME, "--prune"])
}

fn list_remote_branches(vault: &Path) -> Result<Vec<String>, String> {
    let output = git_output(
        vault,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes/origin",
        ],
    )?;

    if !output.status.success() {
        return Err(command_error("git for-each-ref", &output));
    }

    Ok(stdout_lines(&output)
        .into_iter()
        .filter(|line| line != "origin/HEAD")
        .collect())
}

fn histories_share_base(vault: &Path, connection: &RemoteConnection) -> bool {
    git_command()
        .args(["merge-base", "HEAD", connection.remote_branch.as_str()])
        .current_dir(vault)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn ahead_behind_counts(vault: &Path, connection: &RemoteConnection) -> Result<(u32, u32), String> {
    let revision_range = format!("HEAD...{}", connection.remote_branch);
    let output = git_output(
        vault,
        &["rev-list", "--left-right", "--count", &revision_range],
    )?;

    if !output.status.success() {
        return Err(command_error("git rev-list", &output));
    }

    let counts = stdout_text(&output);
    let parts: Vec<&str> = counts.trim().split('\t').collect();
    let ahead = parts
        .first()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .get(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Ok((ahead, behind))
}

fn push_with_tracking(
    vault: &Path,
    connection: &RemoteConnection,
    success_message: String,
) -> GitAddRemoteResult {
    match run_git(
        vault,
        &[
            "push",
            "-u",
            DEFAULT_REMOTE_NAME,
            connection.branch.as_str(),
        ],
    ) {
        Ok(()) => connect_result(ConnectStatus::Connected, success_message),
        Err(stderr) => classify_connect_error(&stderr),
    }
}

fn classify_connect_error(stderr: &str) -> GitAddRemoteResult {
    let lower = stderr.to_lowercase();

    if is_auth_error(&lower) {
        return connect_result(
            ConnectStatus::AuthError,
            "Could not connect to that remote because git reported an authentication error. Check your credentials and try again.",
        );
    }

    if is_network_error(&lower) {
        return connect_result(
            ConnectStatus::NetworkError,
            "Could not reach that remote. Check your connection and repository URL, then try again.",
        );
    }

    connect_result(
        ConnectStatus::Error,
        format!(
            "Could not connect that remote: {}",
            concise_git_detail(stderr)
        ),
    )
}

fn git_output(vault: &Path, args: &[&str]) -> Result<Output, String> {
    git_command()
        .args(args)
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git {}: {e}", args[0]))
}

fn command_error(command: &str, output: &Output) -> String {
    format!("{command} failed: {}", stderr_text(output))
}

fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn stdout_lines(output: &Output) -> Vec<String> {
    stdout_text(output)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn is_auth_error(lower: &str) -> bool {
    [
        "authentication failed",
        "could not read username",
        "permission denied",
        "the requested url returned error: 403",
        "invalid credentials",
        "repository not found",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_network_error(lower: &str) -> bool {
    [
        "could not resolve host",
        "unable to access",
        "connection refused",
        "network is unreachable",
        "timed out",
        "couldn't connect",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn concise_git_detail(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("git reported an unknown error")
        .trim_start_matches("fatal:")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::setup_git_repo;
    use crate::git::{git_commit, git_remote_status};
    use std::fs;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_bare_remote(path: &Path) {
        StdCommand::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    fn configure_author(path: &Path, email: &str, name: &str) {
        StdCommand::new("git")
            .args(["config", "user.email", email])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.name", name])
            .current_dir(path)
            .output()
            .unwrap();
    }

    fn seed_remote_history(bare_path: &Path) {
        let working = TempDir::new().unwrap();

        StdCommand::new("git")
            .args(["clone", bare_path.to_str().unwrap(), "."])
            .current_dir(working.path())
            .output()
            .unwrap();
        configure_author(working.path(), "remote@test.com", "Remote User");
        fs::write(working.path().join("remote.md"), "# Remote\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(working.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Seed remote"])
            .current_dir(working.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["push", "origin", "main"])
            .current_dir(working.path())
            .output()
            .unwrap();
    }

    fn create_local_commit(path: &Path, filename: &str, title: &str, message: &str) {
        fs::write(path.join(filename), format!("# {title}\n")).unwrap();
        git_commit(path.to_str().unwrap(), message).unwrap();
    }

    fn clear_local_author(path: &Path) {
        for key in ["user.name", "user.email"] {
            StdCommand::new("git")
                .args(["config", "--local", "--unset-all", key])
                .current_dir(path)
                .output()
                .unwrap();
        }
    }

    fn local_author_is_configured(path: &Path) -> bool {
        ["user.name", "user.email"].into_iter().all(|key| {
            let output = StdCommand::new("git")
                .args(["config", "--local", key])
                .current_dir(path)
                .output()
                .unwrap();

            output.status.success() && !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        })
    }

    #[test]
    fn disconnect_all_remotes_removes_every_remote() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vault_path = vault.to_str().unwrap();

        StdCommand::new("git")
            .args(["remote", "add", "origin", "https://example.com/one.git"])
            .current_dir(vault)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["remote", "add", "backup", "https://example.com/two.git"])
            .current_dir(vault)
            .output()
            .unwrap();

        disconnect_all_remotes(vault_path).unwrap();

        assert!(list_remotes(vault).unwrap().is_empty());
    }

    #[test]
    fn git_add_remote_connects_an_empty_remote_and_pushes_local_history() {
        let local = setup_git_repo();
        configure_author(local.path(), "local@test.com", "Local User");
        create_local_commit(local.path(), "note.md", "Local", "Initial local commit");

        let bare = TempDir::new().unwrap();
        init_bare_remote(bare.path());

        let result = git_add_remote(
            local.path().to_str().unwrap(),
            bare.path().to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(result.status, "connected");
        assert!(result.message.contains("tracking"));

        let status = git_remote_status(local.path().to_str().unwrap()).unwrap();
        assert!(status.has_remote);
        assert_eq!((status.ahead, status.behind), (0, 0));
    }

    #[test]
    fn git_add_remote_sets_local_identity_when_existing_repo_has_none() {
        let local = setup_git_repo();
        create_local_commit(local.path(), "note.md", "Local", "Initial local commit");
        clear_local_author(local.path());
        assert!(!local_author_is_configured(local.path()));

        let bare = TempDir::new().unwrap();
        init_bare_remote(bare.path());

        let result = git_add_remote(
            local.path().to_str().unwrap(),
            bare.path().to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(result.status, "connected");
        assert!(local_author_is_configured(local.path()));
    }

    #[test]
    fn git_add_remote_pushes_when_remote_is_the_local_branch_ancestor() {
        let local = setup_git_repo();
        configure_author(local.path(), "local@test.com", "Local User");
        create_local_commit(local.path(), "note.md", "Base", "Base commit");

        let bare = TempDir::new().unwrap();
        StdCommand::new("git")
            .args([
                "clone",
                "--bare",
                local.path().to_str().unwrap(),
                bare.path().to_str().unwrap(),
            ])
            .output()
            .unwrap();

        create_local_commit(local.path(), "next.md", "Next", "Local follow-up");

        let result = git_add_remote(
            local.path().to_str().unwrap(),
            bare.path().to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(result.status, "connected");

        let status = git_remote_status(local.path().to_str().unwrap()).unwrap();
        assert!(status.has_remote);
        assert_eq!((status.ahead, status.behind), (0, 0));
    }

    #[test]
    fn git_add_remote_rejects_unrelated_remote_history_and_cleans_up() {
        let local = setup_git_repo();
        configure_author(local.path(), "local@test.com", "Local User");
        create_local_commit(local.path(), "note.md", "Local", "Local commit");

        let bare = TempDir::new().unwrap();
        init_bare_remote(bare.path());
        seed_remote_history(bare.path());

        let result = git_add_remote(
            local.path().to_str().unwrap(),
            bare.path().to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(result.status, "incompatible_history");
        assert!(result.message.contains("unrelated history"));
        assert!(list_remotes(local.path()).unwrap().is_empty());
    }

    #[test]
    fn git_add_remote_reports_when_the_vault_is_already_remote_backed() {
        let local = setup_git_repo();
        let vault = local.path();

        StdCommand::new("git")
            .args(["remote", "add", "origin", "https://example.com/repo.git"])
            .current_dir(vault)
            .output()
            .unwrap();

        let result =
            git_add_remote(vault.to_str().unwrap(), "https://example.com/other.git").unwrap();

        assert_eq!(result.status, "already_configured");
    }

    #[test]
    fn classify_connect_error_maps_auth_failures() {
        let result = classify_connect_error(
            "fatal: unable to access 'https://github.com/org/repo.git/': The requested URL returned error: 403",
        );

        assert_eq!(result.status, "auth_error");
    }

    #[test]
    fn classify_connect_error_maps_network_failures() {
        let result = classify_connect_error(
            "fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host: github.com",
        );

        assert_eq!(result.status, "network_error");
    }
}
