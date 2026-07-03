use serde::Serialize;
use std::path::Path;

use super::{git_command_at, parse_github_repo_path};

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

#[derive(Clone, Copy)]
struct CommitHash<'a>(&'a str);

#[derive(Clone, Copy)]
struct GitLogLine<'a>(&'a str);

#[derive(Clone, Copy)]
struct GitLogOutput<'a>(&'a str);

#[derive(Clone, Copy)]
struct GitStatusCode<'a>(&'a str);

struct GitHubBaseUrl(String);

#[derive(Clone, Copy, Eq, PartialEq)]
enum FileChangeStatus {
    Added,
    Modified,
    Deleted,
}

#[derive(Clone, Copy)]
struct VaultRelativePath<'a>(&'a str);

impl<'a> CommitHash<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }
}

impl FileChangeStatus {
    fn as_str(self) -> &'static str {
        match self {
            FileChangeStatus::Added => "added",
            FileChangeStatus::Modified => "modified",
            FileChangeStatus::Deleted => "deleted",
        }
    }
}

impl GitHubBaseUrl {
    fn commit_url(&self, hash: CommitHash<'_>) -> String {
        format!("{}/commit/{}", self.0, hash.as_str())
    }
}

impl<'a> GitLogLine<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }

    fn is_empty(self) -> bool {
        self.0.is_empty()
    }
}

impl<'a> GitLogOutput<'a> {
    fn lines(self) -> impl Iterator<Item = GitLogLine<'a>> {
        self.0.lines().map(GitLogLine)
    }
}

fn title_from_path(path: VaultRelativePath<'_>) -> String {
    path.0
        .rsplit('/')
        .next()
        .unwrap_or(path.0)
        .strip_suffix(".md")
        .unwrap_or(path.0)
        .replace('-', " ")
}

fn parse_file_status(code: GitStatusCode<'_>) -> FileChangeStatus {
    match code.0 {
        "A" => FileChangeStatus::Added,
        "M" => FileChangeStatus::Modified,
        "D" => FileChangeStatus::Deleted,
        _ => FileChangeStatus::Modified,
    }
}

/// Get the pulse (commit activity feed) for a vault, showing only .md file changes.
/// `skip` offsets into the commit list for pagination; `limit` caps how many to return.
pub fn get_vault_pulse(
    vault_path: impl AsRef<Path>,
    limit: usize,
    skip: usize,
) -> Result<Vec<PulseCommit>, String> {
    let vault = vault_path.as_ref();

    if !vault.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let limit_str = limit.to_string();
    let skip_str = skip.to_string();
    let output = git_command_at(vault)
        .and_then(|mut command| {
            command
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
                    "*.md",
                ])
                .output()
        })
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits yet") {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {}", stderr));
    }

    let github_base = get_github_base_url(vault);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_pulse_output(
        GitLogOutput(stdout.as_ref()),
        github_base.as_ref(),
    ))
}

fn get_github_base_url(vault: &Path) -> Option<GitHubBaseUrl> {
    let output = git_command_at(vault)
        .and_then(|mut command| command.args(["remote", "get-url", "origin"]).output())
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let repo_path = parse_github_repo_path(&url)?;
    Some(GitHubBaseUrl(format!("https://github.com/{}", repo_path)))
}

fn parse_pulse_output(
    stdout: GitLogOutput<'_>,
    github_base: Option<&GitHubBaseUrl>,
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
            add_file_change(commit, line);
        }
    }

    push_current_commit(&mut commits, &mut current);

    commits
}

fn is_git_status_line(line: GitLogLine<'_>) -> bool {
    let line = line.as_str();
    line.starts_with(|c: char| {
        c.is_ascii_uppercase() && line.len() > 1 && line.as_bytes().get(1) == Some(&b'\t')
    })
}

fn is_commit_header(line: GitLogLine<'_>) -> bool {
    line.as_str().contains('|') && !is_git_status_line(line)
}

fn push_current_commit(commits: &mut Vec<PulseCommit>, current: &mut Option<PulseCommit>) {
    if let Some(commit) = current.take() {
        commits.push(commit);
    }
}

fn parse_commit_header(
    line: GitLogLine<'_>,
    github_base: Option<&GitHubBaseUrl>,
) -> Option<PulseCommit> {
    let parts: Vec<&str> = line.as_str().splitn(4, '|').collect();
    if parts.len() != 4 {
        return None;
    }

    let hash = CommitHash(parts[0]);
    let date = chrono::DateTime::parse_from_rfc3339(parts[3])
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let github_url = github_base.map(|base| base.commit_url(hash));

    Some(PulseCommit {
        hash: hash.as_str().to_string(),
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

fn add_file_change(commit: &mut PulseCommit, line: GitLogLine<'_>) {
    let file_parts: Vec<&str> = line.as_str().splitn(2, '\t').collect();
    if file_parts.len() != 2 {
        return;
    }

    let status = parse_file_status(GitStatusCode(file_parts[0].trim()));
    let path = file_parts[1].trim();
    match status {
        FileChangeStatus::Added => commit.added += 1,
        FileChangeStatus::Deleted => commit.deleted += 1,
        _ => commit.modified += 1,
    }
    commit.files.push(PulseFile {
        path: path.to_string(),
        status: status.as_str().to_string(),
        title: title_from_path(VaultRelativePath(path)),
    });
}

/// Get the last commit's short hash and a GitHub URL (if remote is GitHub).
pub fn get_last_commit_info(
    vault_path: impl AsRef<Path>,
) -> Result<Option<LastCommitInfo>, String> {
    let vault = vault_path.as_ref();

    let output = git_command_at(vault)
        .and_then(|mut command| command.args(["log", "-1", "--format=%H|%h"]).output())
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

    let commit_url = get_github_commit_url(vault, CommitHash(full_hash));

    Ok(Some(LastCommitInfo {
        short_hash,
        commit_url,
    }))
}

/// Try to build a GitHub commit URL from the origin remote URL.
fn get_github_commit_url(vault: &Path, full_hash: CommitHash<'_>) -> Option<String> {
    get_github_base_url(vault).map(|base| base.commit_url(full_hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::git_commit;
    use crate::git::tests::setup_git_repo;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    #[derive(Clone, Copy)]
    enum GitHubRemote {
        OwnerRepo,
        LaputaVault,
    }

    enum NoteRepoChange {
        ConfigOnlyCommit,
        NoteUpdateCommit,
    }

    enum CommitUrlSource {
        Pulse,
        LastCommitInfo,
    }

    impl GitHubRemote {
        fn url(&self) -> &'static str {
            match self {
                GitHubRemote::OwnerRepo => "https://github.com/owner/repo.git",
                GitHubRemote::LaputaVault => "https://github.com/lucaong/laputa-vault.git",
            }
        }

        fn commit_prefix(&self) -> &'static str {
            match self {
                GitHubRemote::OwnerRepo => "https://github.com/owner/repo/commit/",
                GitHubRemote::LaputaVault => "https://github.com/lucaong/laputa-vault/commit/",
            }
        }
    }

    impl NoteRepoChange {
        fn apply(self, dir: &TempDir) {
            let vault = dir.path();
            let vp = vault_path(dir);

            match self {
                NoteRepoChange::ConfigOnlyCommit => {
                    fs::write(vault.join("config.json"), "{}").unwrap();
                    git_commit(vp, "Add config").unwrap();
                }
                NoteRepoChange::NoteUpdateCommit => {
                    fs::write(vault.join("note.md"), "# Updated\n").unwrap();
                    git_commit(vp, "Update note").unwrap();
                }
            }
        }
    }

    fn vault_path(dir: &TempDir) -> &str {
        dir.path().to_str().unwrap()
    }

    fn repo_with_committed_note() -> TempDir {
        let dir = setup_git_repo();

        fs::write(dir.path().join("note.md"), "# Note\n").unwrap();
        git_commit(vault_path(&dir), "Add note").unwrap();

        dir
    }

    fn add_origin_remote(vault: &Path, remote: GitHubRemote) {
        Command::new("git")
            .args(["remote", "add", "origin", remote.url()])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    fn pulse_after_note_repo_change(change: NoteRepoChange) -> Vec<PulseCommit> {
        let dir = repo_with_committed_note();
        change.apply(&dir);

        get_vault_pulse(vault_path(&dir), 30, 0).unwrap()
    }

    fn commit_url_for(source: CommitUrlSource, remote: GitHubRemote) -> String {
        let dir = repo_with_committed_note();
        add_origin_remote(dir.path(), remote);

        match source {
            CommitUrlSource::Pulse => get_vault_pulse(vault_path(&dir), 30, 0).unwrap()[0]
                .github_url
                .clone()
                .unwrap(),
            CommitUrlSource::LastCommitInfo => get_last_commit_info(vault_path(&dir))
                .unwrap()
                .unwrap()
                .commit_url
                .unwrap(),
        }
    }

    #[test]
    fn test_get_vault_pulse_with_commits() {
        let dir = repo_with_committed_note();
        let vault = dir.path();
        let vp = vault_path(&dir);

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
        let vp = vault_path(&dir);

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse.is_empty());
    }

    #[test]
    fn test_get_vault_pulse_only_md_files() {
        let pulse = pulse_after_note_repo_change(NoteRepoChange::ConfigOnlyCommit);

        assert_eq!(pulse.len(), 1);
        assert_eq!(pulse[0].files.len(), 1);
        assert_eq!(pulse[0].files[0].path, "note.md");
    }

    #[test]
    fn test_get_vault_pulse_respects_limit() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault_path(&dir);

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
        let pulse = pulse_after_note_repo_change(NoteRepoChange::NoteUpdateCommit);

        assert_eq!(pulse[0].message, "Update note");
        assert_eq!(pulse[0].files[0].status, "modified");
        assert_eq!(pulse[0].modified, 1);
    }

    #[test]
    fn test_get_vault_pulse_github_url() {
        let remote = GitHubRemote::OwnerRepo;
        let url = commit_url_for(CommitUrlSource::Pulse, remote);

        assert!(url.starts_with(remote.commit_prefix()));
    }

    #[test]
    fn test_get_vault_pulse_no_github_url_without_remote() {
        let dir = repo_with_committed_note();
        let vp = vault_path(&dir);

        let pulse = get_vault_pulse(vp, 30, 0).unwrap();
        assert!(pulse[0].github_url.is_none());
    }

    #[test]
    fn test_title_from_path() {
        assert_eq!(
            title_from_path(VaultRelativePath("note/my-project.md")),
            "my project"
        );
        assert_eq!(title_from_path(VaultRelativePath("simple.md")), "simple");
        assert_eq!(
            title_from_path(VaultRelativePath("deep/nested/file.md")),
            "file"
        );
    }

    #[test]
    fn test_parse_pulse_output_basic() {
        let stdout =
            "abc123|abc123d|Add notes|2026-03-05T10:00:00+01:00\nA\tnote.md\nM\tproject.md\n";
        let commits = parse_pulse_output(GitLogOutput(stdout), None);

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
        let base = GitHubBaseUrl("https://github.com/o/r".to_string());
        let commits = parse_pulse_output(GitLogOutput(stdout), Some(&base));

        assert_eq!(
            commits[0].github_url.as_deref(),
            Some("https://github.com/o/r/commit/abc123")
        );
    }

    #[test]
    fn test_parse_pulse_output_multiple_commits() {
        let stdout = "aaa|aaa1234|First|2026-03-05T10:00:00+01:00\nA\ta.md\n\nbbb|bbb1234|Second|2026-03-04T10:00:00+01:00\nM\tb.md\nD\tc.md\n";
        let commits = parse_pulse_output(GitLogOutput(stdout), None);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].message, "First");
        assert_eq!(commits[1].message, "Second");
        assert_eq!(commits[1].files.len(), 2);
        assert_eq!(commits[1].deleted, 1);
    }

    #[test]
    fn test_get_last_commit_info_with_commit() {
        let dir = repo_with_committed_note();
        let vp = vault_path(&dir);

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.short_hash.len(), 7);
        assert!(info.commit_url.is_none());
    }

    #[test]
    fn test_get_last_commit_info_no_commits() {
        let dir = setup_git_repo();
        let vp = vault_path(&dir);

        let info = get_last_commit_info(vp).unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_get_last_commit_info_with_github_remote() {
        let remote = GitHubRemote::LaputaVault;
        let url = commit_url_for(CommitUrlSource::LastCommitInfo, remote);

        assert!(url.starts_with(remote.commit_prefix()));
    }
}
