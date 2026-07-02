use std::fs;
use std::path::Path;

use super::git_command;
use super::tests::setup_remote_pair;
use super::{git_commit, git_pull, git_push, git_remote_status};
use tempfile::TempDir;

struct RemotePair {
    _bare: TempDir,
    clone_a: TempDir,
    clone_b: TempDir,
}

impl RemotePair {
    fn seeded() -> Self {
        let (_bare, clone_a, clone_b) = setup_remote_pair();
        fs::write(clone_a.path().join("note.md"), "# Note\n").unwrap();
        git_commit(path_text(clone_a.path()), "initial").unwrap();
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

    fn vault_b(&self) -> &str {
        path_text(self.clone_b.path())
    }
}

fn path_text(path: &Path) -> &str {
    path.to_str().unwrap()
}

fn run_git(vault_path: &Path, args: &[&str]) {
    let output = git_command()
        .args(args)
        .current_dir(vault_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn git_pull_and_push_use_configured_upstream_branch() {
    let pair = RemotePair::seeded();

    run_git(pair.clone_a.path(), &["checkout", "-b", "local-draft"]);
    run_git(
        pair.clone_a.path(),
        &["push", "-u", "origin", "HEAD:refs/heads/review-target"],
    );
    run_git(pair.clone_b.path(), &["fetch", "origin"]);
    run_git(
        pair.clone_b.path(),
        &["checkout", "-b", "review-copy", "origin/review-target"],
    );

    fs::write(
        pair.clone_a.path().join("branch-note.md"),
        "# Branch note\n",
    )
    .unwrap();
    git_commit(pair.vault_a(), "branch update").unwrap();

    let push = git_push(pair.vault_a()).unwrap();
    assert_eq!(push.status, "ok");

    let pull = git_pull(pair.vault_b()).unwrap();
    assert_eq!(pull.status, "updated");
    assert_eq!(
        fs::read_to_string(pair.clone_b.path().join("branch-note.md")).unwrap(),
        "# Branch note\n"
    );
}

#[test]
fn git_remote_status_reports_missing_upstream() {
    let pair = RemotePair::seeded();
    run_git(pair.clone_a.path(), &["checkout", "-b", "local-only"]);

    let status = git_remote_status(pair.vault_a()).unwrap();
    assert!(status.has_remote);
    assert_eq!(status.branch, "local-only");
    assert!(!status.has_upstream);
    assert_eq!(status.upstream, None);

    let pull = git_pull(pair.vault_a()).unwrap();
    assert_eq!(pull.status, "error");
    assert!(pull.message.contains("No upstream branch configured"));

    let push = git_push(pair.vault_a()).unwrap();
    assert_eq!(push.status, "error");
    assert!(push.message.contains("No upstream branch configured"));
}
