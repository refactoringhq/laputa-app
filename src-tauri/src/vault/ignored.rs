use super::{FolderNode, VaultEntry};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use walkdir::{DirEntry, WalkDir};

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string()
}

fn relative_path(vault_path: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(vault_path).ok()?;
    let normalized = normalize_relative_path(relative.to_string_lossy().as_ref());
    (!normalized.is_empty()).then_some(normalized)
}

fn should_descend_for_gitignore(entry: &DirEntry) -> bool {
    entry.depth() == 0 || entry.file_name().to_string_lossy() != ".git"
}

fn has_gitignore_file(vault_path: &Path) -> bool {
    if vault_path.join(".gitignore").is_file() {
        return true;
    }

    WalkDir::new(vault_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_descend_for_gitignore)
        .filter_map(Result::ok)
        .any(|entry| {
            entry.file_type().is_file() && entry.file_name().to_string_lossy() == ".gitignore"
        })
}

fn run_git_check_ignore(vault_path: &Path, relative_paths: &[String]) -> Option<String> {
    let mut child = crate::hidden_command("git")
        .args(["check-ignore", "--no-index", "--stdin"])
        .current_dir(vault_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdin = child.stdin.take()?;
    let paths = relative_paths.to_vec();
    let writer = std::thread::spawn(move || -> std::io::Result<()> {
        for path in paths {
            writeln!(stdin, "{path}")?;
        }
        Ok(())
    });

    let output = child.wait_with_output().ok()?;
    writer.join().ok()?.ok()?;
    if output.status.success() || output.status.code() == Some(1) {
        return Some(String::from_utf8_lossy(&output.stdout).to_string());
    }
    None
}

fn ignored_relative_paths(vault_path: &Path, relative_paths: &[String]) -> HashSet<String> {
    if relative_paths.is_empty() || !has_gitignore_file(vault_path) {
        return HashSet::new();
    }

    let mut candidates = relative_paths
        .iter()
        .map(|path| normalize_relative_path(path))
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.dedup();

    run_git_check_ignore(vault_path, &candidates)
        .unwrap_or_default()
        .lines()
        .map(normalize_relative_path)
        .filter(|path| !path.is_empty())
        .collect()
}

fn filter_gitignored_items<T>(
    vault_path: &Path,
    items: Vec<T>,
    hide_enabled: bool,
    relative_for: impl Fn(&T) -> Option<String>,
) -> Vec<T> {
    if !hide_enabled || items.is_empty() {
        return items;
    }

    let relative_paths = items.iter().filter_map(&relative_for).collect::<Vec<_>>();
    let ignored = ignored_relative_paths(vault_path, &relative_paths);
    if ignored.is_empty() {
        return items;
    }

    items
        .into_iter()
        .filter(|item| {
            relative_for(item)
                .map(|relative| !ignored.contains(&relative))
                .unwrap_or(true)
        })
        .collect()
}

pub fn filter_gitignored_paths(
    vault_path: &Path,
    paths: Vec<PathBuf>,
    hide_enabled: bool,
) -> Vec<PathBuf> {
    filter_gitignored_items(vault_path, paths, hide_enabled, |path| {
        relative_path(vault_path, path)
    })
}

pub fn filter_gitignored_entries(
    vault_path: &Path,
    entries: Vec<VaultEntry>,
    hide_enabled: bool,
) -> Vec<VaultEntry> {
    filter_gitignored_items(vault_path, entries, hide_enabled, |entry| {
        relative_path(vault_path, Path::new(&entry.path))
    })
}

fn collect_folder_queries(nodes: &[FolderNode], queries: &mut Vec<String>) {
    for node in nodes {
        let relative = normalize_relative_path(&node.path);
        if !relative.is_empty() {
            queries.push(relative.clone());
            queries.push(format!("{relative}/"));
        }
        collect_folder_queries(&node.children, queries);
    }
}

fn path_or_parent_is_ignored(relative_path: &str, ignored: &HashSet<String>) -> bool {
    if ignored.contains(relative_path) {
        return true;
    }
    let mut current = relative_path;
    while let Some((parent, _)) = current.rsplit_once('/') {
        if ignored.contains(parent) {
            return true;
        }
        current = parent;
    }
    false
}

fn filter_folder_nodes(nodes: Vec<FolderNode>, ignored: &HashSet<String>) -> Vec<FolderNode> {
    nodes
        .into_iter()
        .filter_map(|mut node| {
            let relative = normalize_relative_path(&node.path);
            if path_or_parent_is_ignored(&relative, ignored) {
                return None;
            }
            node.children = filter_folder_nodes(node.children, ignored);
            Some(node)
        })
        .collect()
}

pub fn filter_gitignored_folders(
    vault_path: &Path,
    folders: Vec<FolderNode>,
    hide_enabled: bool,
) -> Vec<FolderNode> {
    if !hide_enabled || folders.is_empty() {
        return folders;
    }

    let mut queries = Vec::new();
    collect_folder_queries(&folders, &mut queries);
    let ignored = ignored_relative_paths(vault_path, &queries);
    if ignored.is_empty() {
        return folders;
    }

    filter_folder_nodes(folders, &ignored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;
    use tempfile::TempDir;

    fn write_file(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn init_git_repo(root: &Path) {
        crate::hidden_command("git")
            .args(["init"])
            .current_dir(root)
            .output()
            .unwrap();
    }

    fn entry(root: &Path, relative: &str) -> VaultEntry {
        VaultEntry {
            path: root.join(relative).to_string_lossy().to_string(),
            filename: relative.rsplit('/').next().unwrap().to_string(),
            title: relative.to_string(),
            ..VaultEntry::default()
        }
    }

    fn entry_paths(root: &Path, entries: &[VaultEntry]) -> Vec<String> {
        entries
            .iter()
            .map(|entry| relative_path(root, Path::new(&entry.path)).unwrap())
            .collect()
    }

    #[test]
    fn filters_ignored_entries_with_git_style_negation() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());
        write_file(dir.path(), ".gitignore", "ignored/*\n!ignored/keep.md\n");
        write_file(dir.path(), "visible.md", "# Visible\n");
        write_file(dir.path(), "ignored/hidden.md", "# Hidden\n");
        write_file(dir.path(), "ignored/keep.md", "# Keep\n");

        let filtered = filter_gitignored_entries(
            dir.path(),
            vec![
                entry(dir.path(), "visible.md"),
                entry(dir.path(), "ignored/hidden.md"),
                entry(dir.path(), "ignored/keep.md"),
            ],
            true,
        );
        assert_eq!(
            entry_paths(dir.path(), &filtered),
            vec!["visible.md", "ignored/keep.md"]
        );
    }

    #[test]
    fn keeps_ignored_entries_when_visibility_is_enabled() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());
        write_file(dir.path(), ".gitignore", "ignored/\n");

        let entries = vec![entry(dir.path(), "ignored/hidden.md")];
        let filtered = filter_gitignored_entries(dir.path(), entries, false);
        assert_eq!(
            entry_paths(dir.path(), &filtered),
            vec!["ignored/hidden.md"]
        );
    }

    #[test]
    fn filters_ignored_folder_trees() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());
        write_file(dir.path(), ".gitignore", "generated/\n");
        fs::create_dir_all(dir.path().join("generated/nested")).unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();

        let folders = vec![
            FolderNode {
                name: "generated".to_string(),
                path: "generated".to_string(),
                children: vec![FolderNode {
                    name: "nested".to_string(),
                    path: "generated/nested".to_string(),
                    children: vec![],
                }],
            },
            FolderNode {
                name: "notes".to_string(),
                path: "notes".to_string(),
                children: vec![],
            },
        ];

        let filtered = filter_gitignored_folders(dir.path(), folders, true);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].path, "notes");
    }

    #[test]
    fn filters_large_ignored_folder_sets_without_blocking_on_git_stdout() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());
        write_file(dir.path(), ".gitignore", "generated/\n");

        let folders = (0..6_000)
            .map(|index| FolderNode {
                name: format!("package-{index}"),
                path: format!("generated/package-{index}"),
                children: vec![],
            })
            .collect::<Vec<_>>();
        let vault_path = dir.path().to_path_buf();
        let (sender, receiver) = mpsc::channel();

        std::thread::spawn(move || {
            let filtered = filter_gitignored_folders(vault_path.as_path(), folders, true);
            let _ = sender.send(filtered);
            drop(dir);
        });

        let filtered = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("large gitignored folder filtering should not block on child stdout");
        assert!(filtered.is_empty());
    }

    #[test]
    fn has_no_effect_without_gitignore_file() {
        let dir = TempDir::new().unwrap();
        init_git_repo(dir.path());

        let entries = vec![entry(dir.path(), "notes/local.md")];
        let filtered = filter_gitignored_entries(dir.path(), entries, true);
        assert_eq!(entry_paths(dir.path(), &filtered), vec!["notes/local.md"]);
    }
}
