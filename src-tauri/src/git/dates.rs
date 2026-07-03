use super::git_command_at;
use chrono::DateTime;
use std::collections::HashMap;
use std::path::Path;

/// Git-derived creation and modification timestamps for a file.
#[derive(Debug, Clone)]
pub struct GitDates {
    pub created_at: u64,
    pub modified_at: u64,
}

/// Run a single `git log` to collect creation and modification dates for all
/// tracked files in the repository. Returns a map from relative path to dates.
///
/// - **modified_at** = author date of the most recent commit touching the file
/// - **created_at** = author date of the oldest commit touching the file
///
/// Files not yet committed (untracked / only staged) will not appear in the map;
/// callers should fall back to filesystem metadata for those.
pub fn get_all_file_dates(vault_path: &Path) -> HashMap<String, GitDates> {
    let output = match git_command_at(vault_path).and_then(|mut command| {
        command
            .args(["log", "--format=COMMIT %aI", "--name-only"])
            .output()
    }) {
        Ok(o) if o.status.success() => o,
        _ => return HashMap::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_git_log_output(&stdout)
}

/// Parse the output of `git log --format="COMMIT %aI" --name-only`.
///
/// Output looks like:
/// ```text
/// COMMIT 2026-03-15T10:00:00+02:00
///
/// file-a.md
/// file-b.md
///
/// COMMIT 2026-03-10T08:00:00+02:00
///
/// file-a.md
/// ```
///
/// Commits are ordered newest-first. For each file:
/// - First occurrence → sets `modified_at`
/// - Every subsequent occurrence overwrites `created_at` (last one = oldest commit wins)
fn parse_git_log_output(stdout: &str) -> HashMap<String, GitDates> {
    let mut map: HashMap<String, GitDates> = HashMap::new();
    let mut current_ts: Option<u64> = None;

    for line in stdout.lines() {
        if let Some(date_str) = line.strip_prefix("COMMIT ") {
            current_ts = parse_author_date(date_str);
            continue;
        }

        let path = line.trim();
        if path.is_empty() || current_ts.is_none() {
            continue;
        }
        // Only process .md files
        if !path.ends_with(".md") {
            continue;
        }

        let ts = current_ts.unwrap();
        map.entry(path.to_string())
            .and_modify(|d| d.created_at = ts)
            .or_insert(GitDates {
                created_at: ts,
                modified_at: ts,
            });
    }

    map
}

fn parse_author_date(s: &str) -> Option<u64> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|dt| dt.timestamp() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_git_log_single_commit() {
        let output = "\
COMMIT 2026-03-15T10:00:00+00:00

file-a.md
file-b.md
";
        let map = parse_git_log_output(output);
        assert_eq!(map.len(), 2);
        assert_eq!(map["file-a.md"].created_at, 1773568800);
        assert_eq!(map["file-a.md"].modified_at, 1773568800);
    }

    #[test]
    fn test_parse_git_log_multiple_commits() {
        let output = "\
COMMIT 2026-03-15T10:00:00+00:00

file-a.md

COMMIT 2026-03-10T08:00:00+00:00

file-a.md
file-b.md
";
        let map = parse_git_log_output(output);
        assert_eq!(map.len(), 2);
        // file-a: modified = newest (2026-03-15), created = oldest (2026-03-10)
        assert_eq!(map["file-a.md"].modified_at, 1773568800);
        assert_eq!(map["file-a.md"].created_at, 1773129600);
        // file-b: only in second commit
        assert_eq!(map["file-b.md"].modified_at, 1773129600);
        assert_eq!(map["file-b.md"].created_at, 1773129600);
    }

    #[test]
    fn test_non_md_files_filtered_out() {
        let output = "\
COMMIT 2026-03-15T10:00:00+00:00

README.txt
note.md
image.png
";
        let map = parse_git_log_output(output);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("note.md"));
    }

    #[test]
    fn test_empty_output() {
        let map = parse_git_log_output("");
        assert!(map.is_empty());
    }

    #[test]
    fn test_subdirectory_paths() {
        let output = "\
COMMIT 2026-03-15T10:00:00+00:00

docs/adr/0001-stack.md
notes/daily.md
";
        let map = parse_git_log_output(output);
        assert_eq!(map.len(), 2);
        assert!(map.contains_key("docs/adr/0001-stack.md"));
        assert!(map.contains_key("notes/daily.md"));
    }

    #[test]
    fn test_get_all_file_dates_in_real_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault = dir.path();

        // Init repo
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(vault)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(vault)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(vault)
            .output()
            .unwrap();

        // First commit with one file
        std::fs::write(vault.join("first.md"), "# First\n").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(vault)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "first"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Second commit with another file + modify first
        std::fs::write(vault.join("first.md"), "# First\nUpdated.\n").unwrap();
        std::fs::write(vault.join("second.md"), "# Second\n").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(vault)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "second"])
            .current_dir(vault)
            .output()
            .unwrap();

        let map = get_all_file_dates(vault);
        assert_eq!(map.len(), 2);
        assert!(map.contains_key("first.md"));
        assert!(map.contains_key("second.md"));

        // first.md: created in commit 1, modified in commit 2
        // So modified_at > created_at (or equal if commits are same second)
        assert!(map["first.md"].modified_at >= map["first.md"].created_at);
        // second.md: only in commit 2
        assert_eq!(map["second.md"].modified_at, map["second.md"].created_at);
    }

    #[test]
    fn test_get_all_file_dates_no_git_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let map = get_all_file_dates(dir.path());
        assert!(map.is_empty());
    }
}
