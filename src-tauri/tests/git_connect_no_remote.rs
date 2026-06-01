use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;
use tolaria_lib::git::{git_add_remote, git_commit, git_remote_status};

fn run_git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn setup_repo() -> TempDir {
    let dir = TempDir::new().unwrap();
    run_git(dir.path(), &["init", "-b", "main"]);
    dir
}

fn setup_bare_repo() -> TempDir {
    let dir = TempDir::new().unwrap();
    run_git(dir.path(), &["init", "--bare"]);
    dir
}

#[test]
fn git_add_remote_ignores_name_only_origin_config() {
    let local = setup_repo();
    fs::write(local.path().join("note.md"), "# Note\n").unwrap();
    git_commit(local.path().to_str().unwrap(), "initial").unwrap();

    run_git(local.path(), &["config", "remote.origin.prune", "true"]);
    let remote_names = Command::new("git")
        .args(["remote"])
        .current_dir(local.path())
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&remote_names.stdout).contains("origin"));

    let bare = setup_bare_repo();
    let result = git_add_remote(
        local.path().to_str().unwrap(),
        bare.path().to_str().unwrap(),
    )
    .unwrap();

    assert_eq!(result.status, "connected");
    assert!(
        git_remote_status(local.path().to_str().unwrap())
            .unwrap()
            .has_remote
    );
}
