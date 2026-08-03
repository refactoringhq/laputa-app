use super::*;
use crate::git::tests::{setup_git_repo, GitConfigEnvGuard};
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
    let _env = GitConfigEnvGuard::isolated();

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

    let email = StdCommand::new("git")
        .args(["config", "--local", "user.email"])
        .current_dir(local.path())
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&email.stdout).trim(),
        "vault@tolaria.default"
    );
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

    let result = git_add_remote(vault.to_str().unwrap(), "https://example.com/other.git").unwrap();

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
