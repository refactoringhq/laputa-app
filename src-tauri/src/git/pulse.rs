use serde::Serialize;
use std::path::Path;

use super::{git_command, parse_github_repo_path, GitRepoContext};

#[derive(Debug, Serialize, Clone)]
pub struct PulseFile {
    pub path: String,
    pub status: String,
    pub title: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PulseCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub date: i64,
    #[serde(rename = "githubUrl")]
    pub github_url: Option<String>,
    pub files: Vec<PulseFile>,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct LastCommitInfo {
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    #[serde(rename = "commitUrl")]
    pub commit_url: Option<String>,
}

fn title_from_path(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .strip_suffix(".md")
        .unwrap_or(path)
        .replace('-', " ")
}

fn parse_file_status(code: &str) -> &str {
    match code {
        "A" => "added",
        "M" => "modified",
        "D" => "deleted",
        _ => "modified",
    }
}

/// Get the pulse (commit activity feed) for a vault, showing only .md file changes.
/// `skip` offsets into the commit list for pagination; `limit` caps how many to return.
pub fn get_vault_pulse(
    vault_path: &str,
    limit: usize,
    skip: usize,
) -> Result<Vec<PulseCommit>, String> {
    let repo = GitRepoContext::discover(Path::new(vault_path))?;

    let limit_str = limit.to_string();
    let skip_str = skip.to_string();
    let output = git_command()
        .args([
            "log",
            "--name-status",
            "--pretty=format:%H|%h|%s|%aI",
            "--diff-filter=ADM",
            "-n",
            &limit_str,
            "--skip",
            &skip_str,
            "--",
        ])
        .arg(repo.vault_pathspec())
        .current_dir(&repo.worktree_root)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits yet") {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {}", stderr));
    }

    let github_base = get_github_base_url(vault_path);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_pulse_output(&stdout, &github_base, Some(&repo)))
}

fn get_github_base_url(vault_path: &str) -> Option<String> {
    let repo = GitRepoContext::discover(Path::new(vault_path)).ok()?;
    let output = git_command()
        .args(["remote", "get-url", "origin"])
        .current_dir(&repo.worktree_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let repo_path = parse_github_repo_path(&url)?;
    Some(format!("https://github.com/{}", repo_path))
}

fn parse_pulse_output(
    stdout: &str,
    github_base: &Option<String>,
    repo: Option<&GitRepoContext>,
) -> Vec<PulseCommit> {
    let mut commits: Vec<PulseCommit> = Vec::new();
    let mut current: Option<PulseCommit> = None;

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }

        if is_commit_header(line) {
            push_current_commit(&mut commits, &mut current);
            current = parse_commit_header(line, github_base);
            continue;
        }

        if let Some(ref mut commit) = current {
            add_file_change(commit, line, repo);
        }
    }

    push_current_commit(&mut commits, &mut current);

    commits
}

fn is_git_status_line(line: &str) -> bool {
    line.starts_with(|c: char| {
        c.is_ascii_uppercase() && line.len() > 1 && line.as_bytes().get(1) == Some(&b'\t')
    })
}

fn is_commit_header(line: &str) -> bool {
    line.contains('|') && !is_git_status_line(line)
}

fn push_current_commit(commits: &mut Vec<PulseCommit>, current: &mut Option<PulseCommit>) {
    if let Some(commit) = current.take() {
        commits.push(commit);
    }
}

fn parse_commit_header(line: &str, github_base: &Option<String>) -> Option<PulseCommit> {
    let parts: Vec<&str> = line.splitn(4, '|').collect();
    if parts.len() != 4 {
        return None;
    }

    let hash = parts[0];
    let date = chrono::DateTime::parse_from_rfc3339(parts[3])
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let github_url = github_base
        .as_ref()
        .map(|base| format!("{}/commit/{}", base, hash));

    Some(PulseCommit {
        hash: hash.to_string(),
        short_hash: parts[1].to_string(),
        message: parts[2].to_string(),
        date,
        github_url,
        files: Vec::new(),
        added: 0,
        modified: 0,
        deleted: 0,
    })
}

fn add_file_change(commit: &mut PulseCommit, line: &str, repo: Option<&GitRepoContext>) {
    let file_parts: Vec<&str> = line.splitn(2, '\t').collect();
    if file_parts.len() != 2 {
        return;
    }

    let status = parse_file_status(file_parts[0].trim());
    let worktree_path = Path::new(file_parts[1].trim());
    if !worktree_path.to_string_lossy().ends_with(".md") {
        return;
    }
    let path = match repo {
        Some(repo) => {
            let Some(vault_path) = repo.vault_relative_from_worktree_relative(worktree_path) else {
                return;
            };
            vault_path.to_string_lossy().to_string()
        }
        None => file_parts[1].trim().to_string(),
    };
    match status {
        "added" => commit.added += 1,
        "deleted" => commit.deleted += 1,
        _ => commit.modified += 1,
    }
    commit.files.push(PulseFile {
        path: path.to_string(),
        status: status.to_string(),
        title: title_from_path(&path),
    });
}

/// Get the last commit's short hash and a GitHub URL (if remote is GitHub).
pub fn get_last_commit_info(vault_path: &str) -> Result<Option<LastCommitInfo>, String> {
    let vault = Path::new(vault_path);

    let output = git_command()
        .args(["log", "-1", "--format=%H|%h"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits yet") {
            return Ok(None);
        }
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim();
    if line.is_empty() {
        return Ok(None);
    }

    let parts: Vec<&str> = line.splitn(2, '|').collect();
    if parts.len() != 2 {
        return Ok(None);
    }

    let full_hash = parts[0];
    let short_hash = parts[1].to_string();

    let commit_url = get_github_commit_url(vault_path, full_hash);

    Ok(Some(LastCommitInfo {
        short_hash,
        commit_url,
    }))
}

/// Try to build a GitHub commit URL from the origin remote URL.
fn get_github_commit_url(vault_path: &str, full_hash: &str) -> Option<String> {
    get_github_base_url(vault_path).map(|base| format!("{}/commit/{}", base, full_hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_commit;
    use crate::git::tests::setup_git_repo;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn test_get_vault_pulse_with_commits() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        fs::write(vault.join("project.md"), "# Project\n").unwrap();
        git_commit(vp, "Add project").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();

        assert_eq!(pulse.len(), 2);
        assert_eq!(pulse[0].message, "Add project");
        assert_eq!(pulse[1].message, "Add note");
        assert_eq!(pulse[0].files.len(), 1);
        assert_eq!(pulse[0].files[0].path, "project.md");
        assert_eq!(pulse[0].files[0].status, "added");
        assert_eq!(pulse[0].added, 1);
        assert_eq!(pulse[0].modified, 0);
        assert!(!pulse[0].short_hash.is_empty());
    }

    #[test]
    fn test_get_vault_pulse_no_git() {
        let dir = TempDir::new().unwrap();
        let vp = dir.path().to_str().unwrap();

        let result = get_vault_pulse(vp, 30, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a git repository"));
    }

    #[test]
    fn test_get_vault_pulse_empty_repo() {
        let dir = setup_git_repo();
        let vp = dir.path().to_str().unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse.is_empty());
    }

    #[test]
    fn test_get_vault_pulse_only_md_files() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        fs::write(vault.join("config.json"), "{}").unwrap();
        git_commit(vp, "Add files").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert_eq!(pulse.len(), 1);
        assert_eq!(pulse[0].files.len(), 1);
        assert_eq!(pulse[0].files[0].path, "note.md");
    }

    #[test]
    fn test_get_vault_pulse_respects_limit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        for i in 0..5 {
            fs::write(
                vault.join(format!("note{}.md", i)),
                format!("# Note {}\n", i),
            )
            .unwrap();
            git_commit(vp, &format!("Add note {}", i)).unwrap();
        }

        let pulse = get_vault_pulse(vp, 3, 0).unwrap();
        assert_eq!(pulse.len(), 3);
    }

    #[test]
    fn test_get_vault_pulse_modified_and_deleted() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        fs::write(vault.join("note.md"), "# Updated\n").unwrap();
        git_commit(vp, "Update note").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert_eq!(pulse[0].message, "Update note");
        assert_eq!(pulse[0].files[0].status, "modified");
        assert_eq!(pulse[0].modified, 1);
    }

    #[test]
    fn test_get_vault_pulse_github_url() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/owner/repo.git",
            ])
            .current_dir(vault)
            .output()
            .unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse[0].github_url.is_some());
        let url = pulse[0].github_url.as_ref().unwrap();
        assert!(url.starts_with("https://github.com/owner/repo/commit/"));
    }

    #[test]
    fn test_get_vault_pulse_no_github_url_without_remote() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "Add note").unwrap();

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse[0].github_url.is_none());
    }

    #[test]
    fn test_title_from_path() {
        assert_eq!(title_from_path("note/my-project.md"), "my project");
        assert_eq!(title_from_path("simple.md"), "simple");
        assert_eq!(title_from_path("deep/nested/file.md"), "file");
    }

    #[test]
    fn test_parse_pulse_output_basic() {
        let stdout =
            "abc123|abc123d|Add notes|2026-03-05T10:00:00+01:00\nA\tnote.md\nM\tproject.md\n";
        let commits = parse_pulse_output(stdout, &None, None);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "Add notes");
        assert_eq!(commits[0].files.len(), 2);
        assert_eq!(commits[0].files[0].status, "added");
        assert_eq!(commits[0].files[1].status, "modified");
        assert_eq!(commits[0].added, 1);
        assert_eq!(commits[0].modified, 1);
        assert!(commits[0].github_url.is_none());
    }

    #[test]
    fn test_parse_pulse_output_with_github() {
        let stdout = "abc123|abc123d|Msg|2026-03-05T10:00:00+01:00\nA\tnote.md\n";
        let base = Some("https://github.com/o/r".to_string());
        let commits = parse_pulse_output(stdout, &base, None);

        assert_eq!(
            commits[0].github_url.as_deref(),
            Some("https://github.com/o/r/commit/abc123")
        );
    }

    #[test]
    fn test_parse_pulse_output_multiple_commits() {
        let stdout = "aaa|aaa1234|First|2026-03-05T10:00:00+01:00\nA\ta.md\n\nbbb|bbb1234|Second|2026-03-04T10:00:00+01:00\nM\tb.md\nD\tc.md\n";
        let commits = parse_pulse_output(stdout, &None, None);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].message, "First");
        assert_eq!(commits[1].message, "Second");
        assert_eq!(commits[1].files.len(), 2);
        assert_eq!(commits[1].deleted, 1);
    }

    #[test]
    fn test_get_last_commit_info_with_commit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.short_hash.len(), 7);
        assert!(info.commit_url.is_none());
    }

    #[test]
    fn test_get_last_commit_info_no_commits() {
        let dir = setup_git_repo();
        let vp = dir.path().to_str().unwrap();

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_get_last_commit_info_with_github_remote() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_commit(vp, "initial").unwrap();

        Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/lucaong/laputa-vault.git",
            ])
            .current_dir(vault)
            .output()
            .unwrap();

        let info = get_last_commit_info(vp).unwrap().unwrap();
        assert!(info.commit_url.is_some());
        let url = info.commit_url.unwrap();
        assert!(url.starts_with("https://github.com/lucaong/laputa-vault/commit/"));
    }
}
