use super::git_command;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct ModifiedFile {
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub status: String,
    #[serde(rename = "addedLines")]
    pub added_lines: Option<usize>,
    #[serde(rename = "deletedLines")]
    pub deleted_lines: Option<usize>,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct DiffStats {
    added_lines: Option<usize>,
    deleted_lines: Option<usize>,
    binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StatusEntry {
    status_code: String,
    relative_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileChangeStatus {
    Modified,
    Added,
    Deleted,
    Untracked,
    Renamed,
}

impl FileChangeStatus {
    fn from_code(status_code: &str) -> Self {
        match status_code.trim() {
            "A" => Self::Added,
            "D" => Self::Deleted,
            "??" => Self::Untracked,
            "R" | "RM" => Self::Renamed,
            _ => Self::Modified,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Deleted => "deleted",
            Self::Untracked => "untracked",
            Self::Renamed => "renamed",
            Self::Modified => "modified",
        }
    }
}

fn split_nul_fields(output: &[u8]) -> Vec<String> {
    output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .map(|field| String::from_utf8_lossy(field).into_owned())
        .collect()
}

fn status_has_source_path(status_code: &str) -> bool {
    status_code.contains('R') || status_code.contains('C')
}

fn parse_status_field(field: &str) -> Option<StatusEntry> {
    if field.len() < 4 {
        return None;
    }

    Some(StatusEntry {
        status_code: field[..2].to_string(),
        relative_path: field[3..].to_string(),
    })
}

fn parse_status_output(output: &[u8]) -> Vec<StatusEntry> {
    let fields = split_nul_fields(output);
    let mut entries = Vec::new();
    let mut index = 0;

    while index < fields.len() {
        let Some(entry) = parse_status_field(&fields[index]) else {
            index += 1;
            continue;
        };
        let has_source_path = status_has_source_path(&entry.status_code);
        entries.push(entry);
        index += if has_source_path { 2 } else { 1 };
    }

    entries
}

fn parse_numstat_field(field: &str) -> Option<usize> {
    field.parse().ok()
}

fn parse_numstat_header(header: &str) -> Option<(Option<String>, DiffStats)> {
    let mut parts = header.splitn(3, '\t');
    let added = parts.next()?;
    let deleted = parts.next()?;
    let path = parts.next()?;

    let added_lines = parse_numstat_field(added);
    let deleted_lines = parse_numstat_field(deleted);
    let binary = added == "-" || deleted == "-";

    Some((
        (!path.is_empty()).then(|| path.to_string()),
        DiffStats {
            added_lines,
            deleted_lines,
            binary,
        },
    ))
}

fn parse_numstat_output(output: &[u8]) -> HashMap<String, DiffStats> {
    let fields = split_nul_fields(output);
    let mut stats = HashMap::new();
    let mut index = 0;

    while index < fields.len() {
        let Some((path, diff_stats)) = parse_numstat_header(&fields[index]) else {
            index += 1;
            continue;
        };

        match path {
            Some(path) => {
                stats.insert(path, diff_stats);
                index += 1;
            }
            None if index + 2 < fields.len() => {
                stats.insert(fields[index + 2].clone(), diff_stats);
                index += 3;
            }
            None => {
                index += 1;
            }
        }
    }

    stats
}

fn repo_has_head(vault: &Path) -> Result<bool, String> {
    let output = git_command()
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {e}"))?;

    Ok(output.status.success())
}

fn load_diff_stats(vault: &Path) -> Result<HashMap<String, DiffStats>, String> {
    if !repo_has_head(vault)? {
        return Ok(HashMap::new());
    }

    let output = git_command()
        .args(["diff", "--numstat", "-z", "--find-renames", "HEAD", "--"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git diff --numstat: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff --numstat failed: {}", stderr.trim()));
    }

    Ok(parse_numstat_output(&output.stdout))
}

fn count_worktree_lines(vault: &Path, relative_path: &Path) -> DiffStats {
    let full_path = vault.join(relative_path);
    let added_lines = std::fs::read_to_string(full_path)
        .ok()
        .map(|content| content.lines().count());

    DiffStats {
        added_lines,
        deleted_lines: None,
        binary: false,
    }
}

fn resolve_diff_stats(
    vault: &Path,
    relative_path: &Path,
    status: FileChangeStatus,
    diff_stats: &HashMap<String, DiffStats>,
    include_stats: bool,
) -> DiffStats {
    if !include_stats {
        return DiffStats::default();
    }

    if status == FileChangeStatus::Untracked {
        return count_worktree_lines(vault, relative_path);
    }

    let key = relative_path.to_string_lossy();
    diff_stats.get(key.as_ref()).copied().unwrap_or_default()
}

fn ensure_path_within_vault(vault: &Path, relative_path: &Path, abs: &Path) -> Result<(), String> {
    for component in relative_path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("File path is outside the vault".into());
        }
    }

    if !abs.exists() {
        return Ok(());
    }

    let canonical_vault = vault
        .canonicalize()
        .map_err(|e| format!("Cannot resolve vault path: {e}"))?;
    let canonical_file = abs
        .canonicalize()
        .map_err(|e| format!("Cannot resolve file path: {e}"))?;

    if canonical_file.starts_with(&canonical_vault) {
        Ok(())
    } else {
        Err("File path is outside the vault".into())
    }
}

fn load_file_status(vault: &Path, relative_path: &Path) -> Result<String, String> {
    let output = git_command()
        .args(["status", "--porcelain", "--"])
        .arg(relative_path)
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git status: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .find(|line| line.len() >= 4)
        .map(|line| line[..2].trim().to_string())
        .unwrap_or_default())
}

fn restore_tracked_file(vault: &Path, relative_path: &Path) -> Result<(), String> {
    let _ = git_command()
        .args(["reset", "HEAD", "--"])
        .arg(relative_path)
        .current_dir(vault)
        .output();

    let checkout = git_command()
        .args(["checkout", "--"])
        .arg(relative_path)
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git checkout: {e}"))?;

    if checkout.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&checkout.stderr);
    Err(format!("git checkout failed: {}", stderr.trim()))
}

/// Get list of modified/added/deleted files in the vault (uncommitted changes).
pub fn get_modified_files(vault_path: impl AsRef<Path>) -> Result<Vec<ModifiedFile>, String> {
    get_modified_files_impl(vault_path.as_ref(), false)
}

/// Get list of modified/added/deleted files with line-level diff statistics.
pub fn get_modified_files_with_stats(
    vault_path: impl AsRef<Path>,
) -> Result<Vec<ModifiedFile>, String> {
    get_modified_files_impl(vault_path.as_ref(), true)
}

fn get_modified_files_impl(vault: &Path, include_stats: bool) -> Result<Vec<ModifiedFile>, String> {
    let output = git_command()
        .args(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        .current_dir(vault)
        .output()
        .map_err(|e| format!("Failed to run git status: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr.trim()));
    }

    let diff_stats = if include_stats {
        load_diff_stats(vault)?
    } else {
        HashMap::new()
    };
    let files = parse_status_output(&output.stdout)
        .into_iter()
        .filter_map(|entry| {
            // Only include markdown files
            if !entry.relative_path.ends_with(".md") {
                return None;
            }

            let status = FileChangeStatus::from_code(&entry.status_code);
            let full_path = vault
                .join(&entry.relative_path)
                .to_string_lossy()
                .to_string();
            let stats = resolve_diff_stats(
                vault,
                Path::new(&entry.relative_path),
                status,
                &diff_stats,
                include_stats,
            );

            Some(ModifiedFile {
                path: full_path,
                relative_path: entry.relative_path,
                status: status.label().to_string(),
                added_lines: stats.added_lines,
                deleted_lines: stats.deleted_lines,
                binary: stats.binary,
            })
        })
        .collect();

    Ok(files)
}

/// Discard uncommitted changes to a single file.
///
/// - **Modified / Deleted**: `git checkout -- <file>` restores the last committed version.
/// - **Untracked / Added**: the file is removed from disk.
///
/// The `relative_path` must be relative to `vault_path` (the same format
/// returned by [`get_modified_files`]).
pub fn discard_file_changes(vault_path: &str, relative_path: &str) -> Result<(), String> {
    let vault = Path::new(vault_path);
    let relative = Path::new(relative_path);
    let abs = vault.join(relative);

    ensure_path_within_vault(vault, relative, &abs)?;
    let status_code = load_file_status(vault, relative)?;

    match status_code.as_str() {
        "??" => {
            std::fs::remove_file(&abs)
                .map_err(|e| format!("Failed to delete untracked file: {e}"))?;
        }
        _ => {
            restore_tracked_file(vault, relative)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::git_command;
    use super::*;
    use crate::git::git_commit;
    use crate::git::tests::setup_git_repo;
    use std::fs;

    fn write_and_commit_markdown(vault: &Path, vp: &str, relative_path: &str, content: &str) {
        fs::write(vault.join(relative_path), content).unwrap();
        git_commit(vp, "initial").unwrap();
    }

    fn force_quoted_git_paths(vault: &Path) {
        git_command()
            .args(["config", "core.quotePath", "true"])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    fn expect_modified_file(vp: &str, relative_path: &str, status: &str) -> ModifiedFile {
        let modified = get_modified_files_with_stats(vp).unwrap();
        let file = modified
            .iter()
            .find(|file| file.relative_path == relative_path)
            .unwrap_or_else(|| panic!("{relative_path} should be reported as {status}"));

        assert_eq!(file.status, status);
        assert!(file.path.ends_with(relative_path));
        file.clone()
    }

    fn expect_changed_file_after(
        relative_path: &str,
        status: &str,
        change: impl FnOnce(&Path, &str),
    ) -> ModifiedFile {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        change(vault, vp);

        expect_modified_file(vp, relative_path, status)
    }

    #[test]
    fn test_get_modified_files_with_stats() {
        let dir = setup_git_repo();
        let vault = dir.path();

        // Create and commit a file
        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_command()
            .args(["add", "note.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Add note"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Modify it
        fs::write(vault.join("note.md"), "# Note\n\nUpdated.").unwrap();
        // Add an untracked file
        fs::write(vault.join("new.md"), "# New\n").unwrap();

        let modified = get_modified_files_with_stats(vault.to_str().unwrap()).unwrap();

        assert!(modified.len() >= 2);
        let statuses: Vec<&str> = modified.iter().map(|f| f.status.as_str()).collect();
        assert!(statuses.contains(&"modified"));
        assert!(statuses.contains(&"untracked"));

        let modified_entry = modified
            .iter()
            .find(|file| file.relative_path == "note.md")
            .unwrap();
        assert!(modified_entry.added_lines.is_some());
        assert!(!modified_entry.binary);

        let untracked_entry = modified
            .iter()
            .find(|file| file.relative_path == "new.md")
            .unwrap();
        assert_eq!(untracked_entry.added_lines, Some(1));
        assert_eq!(untracked_entry.deleted_lines, None);
    }

    #[test]
    fn test_get_modified_files_omits_stats_by_default() {
        let dir = setup_git_repo();
        let vault = dir.path();

        fs::write(vault.join("note.md"), "# Note\n").unwrap();
        git_command()
            .args(["add", "note.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Add note"])
            .current_dir(vault)
            .output()
            .unwrap();

        fs::write(vault.join("note.md"), "# Note\n\nUpdated.").unwrap();
        fs::write(vault.join("new.md"), "# New\n").unwrap();

        let modified = get_modified_files(vault.to_str().unwrap()).unwrap();

        assert!(modified.len() >= 2);
        assert!(modified.iter().all(|file| file.added_lines.is_none()
            && file.deleted_lines.is_none()
            && !file.binary));
    }

    #[test]
    fn test_get_modified_files_untracked_in_subdirectory() {
        let dir = setup_git_repo();
        let vault = dir.path();

        // Create initial commit so git is initialized
        fs::write(vault.join("init.md"), "# Init\n").unwrap();
        git_command()
            .args(["add", "init.md"])
            .current_dir(vault)
            .output()
            .unwrap();
        git_command()
            .args(["commit", "-m", "Initial"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Create a new untracked file in a subdirectory (simulates new note creation)
        fs::create_dir_all(vault.join("note")).unwrap();
        fs::write(vault.join("note/brand-new.md"), "# Brand New\n").unwrap();

        let modified = get_modified_files_with_stats(vault.to_str().unwrap()).unwrap();

        assert_eq!(modified.len(), 1);
        assert_eq!(modified[0].status, "untracked");
        assert_eq!(modified[0].relative_path, "note/brand-new.md");
        assert_eq!(modified[0].added_lines, Some(1));
        assert!(
            modified[0].path.ends_with("/note/brand-new.md"),
            "Full path should end with relative path: {}",
            modified[0].path
        );
    }

    #[test]
    fn test_get_modified_files_preserves_chinese_markdown_path() {
        let relative_path = "中文笔记.md";

        let file = expect_changed_file_after(relative_path, "modified", |vault, vp| {
            force_quoted_git_paths(vault);
            write_and_commit_markdown(vault, vp, relative_path, "# 初始\n");
            fs::write(vault.join(relative_path), "# 初始\n\n更新\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(2));
    }

    #[test]
    fn test_get_modified_files_preserves_untracked_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "untracked", |vault, vp| {
            write_and_commit_markdown(vault, vp, "init.md", "# Init\n");
            fs::write(vault.join(relative_path), "# Test\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(1));
    }

    #[test]
    fn test_get_modified_files_preserves_modified_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "modified", |vault, vp| {
            write_and_commit_markdown(vault, vp, relative_path, "# Test\n");
            fs::write(vault.join(relative_path), "# Test\n\nUpdated\n").unwrap();
        });
        assert_eq!(file.added_lines, Some(2));
    }

    #[test]
    fn test_get_modified_files_preserves_renamed_markdown_path_with_spaces() {
        let relative_path = "test note.md";

        let file = expect_changed_file_after(relative_path, "renamed", |vault, vp| {
            write_and_commit_markdown(vault, vp, "alpha.md", "# Alpha\n");
            git_command()
                .args(["mv", "alpha.md", relative_path])
                .current_dir(vault)
                .output()
                .unwrap();
        });
        assert_eq!(file.added_lines, Some(0));
        assert_eq!(file.deleted_lines, Some(0));
    }

    #[test]
    fn test_commit_flow_modified_files_then_commit_clears() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        // Create and commit initial file
        fs::write(vault.join("flow.md"), "# Original\n").unwrap();
        git_commit(vp, "initial").unwrap();

        // Modify the file on disk
        fs::write(vault.join("flow.md"), "# Modified\n").unwrap();

        // get_modified_files should detect the change
        let modified = get_modified_files(vp).unwrap();
        assert!(
            modified.iter().any(|f| f.relative_path == "flow.md"),
            "Modified file should be detected after write"
        );

        // Commit the change
        let result = git_commit(vp, "update flow").unwrap();
        assert!(
            result.contains("1 file changed") || result.contains("flow.md"),
            "Commit output should reference the changed file: {}",
            result
        );

        // After commit, get_modified_files should return empty
        let after = get_modified_files(vp).unwrap();
        assert!(
            after.is_empty(),
            "No modified files should remain after commit, found: {:?}",
            after
        );
    }

    #[test]
    fn test_discard_modified_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "note.md", "# Original\n");

        // Modify the file
        fs::write(vault.join("note.md"), "# Changed\n").unwrap();
        assert_eq!(get_modified_files(vp).unwrap().len(), 1);

        // Discard
        discard_file_changes(vp, "note.md").unwrap();

        let content = fs::read_to_string(vault.join("note.md")).unwrap();
        assert_eq!(content, "# Original\n");
        assert!(get_modified_files(vp).unwrap().is_empty());
    }

    #[test]
    fn test_discard_untracked_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "init.md", "# Init\n");

        // Create an untracked file
        fs::write(vault.join("new.md"), "# New\n").unwrap();
        assert!(vault.join("new.md").exists());

        discard_file_changes(vp, "new.md").unwrap();

        assert!(!vault.join("new.md").exists());
        assert!(get_modified_files(vp).unwrap().is_empty());
    }

    #[test]
    fn test_discard_deleted_file() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "note.md", "# Original\n");

        // Delete the file
        fs::remove_file(vault.join("note.md")).unwrap();
        assert!(!vault.join("note.md").exists());

        discard_file_changes(vp, "note.md").unwrap();

        assert!(vault.join("note.md").exists());
        let content = fs::read_to_string(vault.join("note.md")).unwrap();
        assert_eq!(content, "# Original\n");
    }

    #[test]
    fn test_discard_rejects_path_outside_vault() {
        let dir = setup_git_repo();
        let vault = dir.path();
        let vp = vault.to_str().unwrap();

        write_and_commit_markdown(vault, vp, "init.md", "# Init\n");

        let result = discard_file_changes(vp, "../../../etc/passwd");
        assert!(
            result.is_err(),
            "Should reject path outside vault, got: {:?}",
            result
        );
        assert!(
            result.unwrap_err().contains("outside the vault"),
            "Error should mention 'outside the vault'"
        );
    }
}
