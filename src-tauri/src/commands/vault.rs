mod boundary;
mod file_cmds;
mod frontmatter_cmds;
mod lifecycle_cmds;
mod rename_cmds;
mod scan_cmds;
mod view_cmds;

pub(super) use boundary::VaultBoundary;
pub use file_cmds::*;
pub use frontmatter_cmds::*;
pub use lifecycle_cmds::*;
pub use rename_cmds::*;
pub use scan_cmds::*;
pub use view_cmds::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ViewDefinition;
    use std::path::Path;

    const ACTIVE_VAULT_PATH_ERROR: &str = super::boundary::ACTIVE_VAULT_PATH_ERROR;
    const INVALID_VIEW_FILENAME_ERROR: &str = super::boundary::INVALID_VIEW_FILENAME_ERROR;

    fn vault_path_arg(vault_path: &Path) -> Option<std::path::PathBuf> {
        Some(vault_path.to_path_buf())
    }

    fn vault_path_string_arg(vault_path: &Path) -> Option<String> {
        Some(vault_path.to_string_lossy().to_string())
    }

    fn assert_note_write_rejects_escape<T: std::fmt::Debug>(
        action: impl FnOnce(std::path::PathBuf, String, Option<std::path::PathBuf>) -> Result<T, String>,
    ) {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path();
        let escape_path = vault_path.join("../outside.md");

        let err = action(
            escape_path,
            "# Outside\n".to_string(),
            vault_path_arg(vault_path),
        )
        .expect_err("expected traversal write to be rejected");

        assert_eq!(err, ACTIVE_VAULT_PATH_ERROR);
    }

    fn sample_view_definition() -> ViewDefinition {
        ViewDefinition {
            name: "Inbox".to_string(),
            icon: None,
            color: None,
            order: None,
            sort: None,
            list_properties_display: vec![],
            filters: crate::vault::FilterGroup::All(vec![]),
        }
    }

    fn assert_save_view_cmd_rejects_invalid_filename(filename: &str) {
        let dir = tempfile::TempDir::new().unwrap();

        let err = save_view_cmd(
            dir.path().to_string_lossy().to_string(),
            filename.to_string(),
            sample_view_definition(),
        )
        .expect_err("expected invalid filename to be rejected");

        assert_eq!(err, INVALID_VIEW_FILENAME_ERROR);
    }

    fn temp_note(body: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::TempDir::new().unwrap();
        let note = dir.path().join("note.md");
        std::fs::write(&note, body).unwrap();
        (dir, note)
    }

    fn assert_paths_exist(root: &Path, paths: &[&str]) {
        for path in paths {
            assert!(root.join(path).exists(), "{path} should exist");
        }
    }

    fn assert_paths_absent(root: &Path, paths: &[&str]) {
        for path in paths {
            assert!(!root.join(path).exists(), "{path} should be absent");
        }
    }

    fn assert_seeded_guidance_content(vault_path: &Path) {
        let agents = std::fs::read_to_string(vault_path.join("AGENTS.md")).unwrap();
        let claude = std::fs::read_to_string(vault_path.join("CLAUDE.md")).unwrap();

        assert!(agents.contains("Legacy `title:` frontmatter is still read as a fallback"));
        assert!(agents.contains("views/*.yml"));
        assert!(claude.starts_with("---\ntype: Note\n_organized: true\n---"));
        assert!(claude.contains("@AGENTS.md"));
        assert!(claude.contains("only a Claude Code compatibility shim"));
        assert!(!claude.contains("# CLAUDE.md"));
    }

    fn assert_seeded_type_scaffolding(vault_path: &Path) {
        let type_definition = std::fs::read_to_string(vault_path.join("type.md")).unwrap();

        assert!(type_definition.contains("visible: false"));
        assert!(type_definition.contains("# Type"));
    }

    #[test]
    fn test_batch_archive_notes() {
        let (dir, note) = temp_note("---\nStatus: Active\n---\n# Note\n");
        assert_eq!(
            batch_archive_notes(
                vec![note.to_str().unwrap().to_string()],
                vault_path_string_arg(dir.path()),
            )
            .unwrap(),
            1
        );
        let content = std::fs::read_to_string(&note).unwrap();
        assert!(content.contains("_archived: true"));
        assert!(content.contains("Status: Active"));
    }

    #[test]
    fn test_reload_vault_entry_reads_from_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let note = dir.path().join("test.md");
        std::fs::write(&note, "---\ntitle: Test\nStatus: Active\n---\n# Test\n").unwrap();

        let entry = reload_vault_entry(note.clone(), vault_path_arg(dir.path())).unwrap();
        assert_eq!(entry.title, "Test");
        assert_eq!(entry.status, Some("Active".to_string()));

        std::fs::write(&note, "---\ntitle: Test\nStatus: Done\n---\n# Test\n").unwrap();
        let fresh = reload_vault_entry(note, vault_path_arg(dir.path())).unwrap();
        assert_eq!(fresh.status, Some("Done".to_string()));
    }

    #[test]
    fn test_reload_vault_entry_nonexistent() {
        let result = reload_vault_entry("/nonexistent/path.md".into(), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_note_content_rejects_path_outside_active_vault() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path();
        let inside = vault_path.join("inside.md");
        let outside_dir = tempfile::TempDir::new().unwrap();
        let outside = outside_dir.path().join("outside.md");

        std::fs::write(&inside, "# Inside\n").unwrap();
        std::fs::write(&outside, "# Outside\n").unwrap();

        let err = get_note_content(outside, vault_path_arg(vault_path))
            .expect_err("expected out-of-vault read to be rejected");

        assert_eq!(err, ACTIVE_VAULT_PATH_ERROR);
    }

    #[test]
    fn test_save_note_content_rejects_traversal_outside_active_vault() {
        assert_note_write_rejects_escape(save_note_content);
    }

    #[test]
    fn test_create_note_content_rejects_traversal_outside_active_vault() {
        assert_note_write_rejects_escape(create_note_content);
    }

    #[test]
    fn test_create_vault_folder_rejects_escape_path() {
        let dir = tempfile::TempDir::new().unwrap();

        let err = create_vault_folder(dir.path().into(), "../escape".into())
            .expect_err("expected escaping folder path to be rejected");

        assert_eq!(err, ACTIVE_VAULT_PATH_ERROR);
    }

    #[test]
    fn test_create_vault_folder_rejects_windows_invalid_names() {
        let dir = tempfile::TempDir::new().unwrap();

        let err = create_vault_folder(dir.path().into(), "con".into())
            .expect_err("expected Windows-invalid folder name to be rejected");

        assert_eq!(err, "Invalid folder name");
    }

    #[test]
    fn test_save_view_cmd_rejects_nested_filename() {
        assert_save_view_cmd_rejects_invalid_filename("../escape.yml");
    }

    #[test]
    fn test_save_view_cmd_rejects_windows_invalid_filename() {
        assert_save_view_cmd_rejects_invalid_filename("con.yml");
    }

    #[test]
    fn test_reload_vault_invalidates_cache_and_rescans() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path();
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(vault_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "t@t.com"])
            .current_dir(vault_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "T"])
            .current_dir(vault_path)
            .output()
            .unwrap();

        let cache_dir = tempfile::TempDir::new().unwrap();
        std::env::set_var(
            "LAPUTA_CACHE_DIR",
            cache_dir.path().to_string_lossy().as_ref(),
        );

        std::fs::write(
            vault_path.join("note.md"),
            "---\n_archived: false\n---\n# Note\n",
        )
        .unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(vault_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(vault_path)
            .output()
            .unwrap();

        let entries = list_vault(vault_path.into()).unwrap();
        assert!(!entries[0].archived);

        std::fs::write(
            vault_path.join("note.md"),
            "---\n_archived: true\n---\n# Note\n",
        )
        .unwrap();

        let vp_str = vault_path.to_str().unwrap();
        crate::vault::invalidate_cache(std::path::Path::new(vp_str));
        let fresh = crate::vault::scan_vault_cached(std::path::Path::new(vp_str)).unwrap();
        assert!(
            fresh[0].archived,
            "reload_vault must reflect disk state after archiving"
        );
    }

    #[test]
    fn test_check_vault_exists_false() {
        assert!(!check_vault_exists("/nonexistent/path/abc123".to_string()));
    }

    #[test]
    fn test_get_default_vault_path_returns_ok() {
        let result = get_default_vault_path();
        assert!(result.is_ok());
    }

    #[test]
    fn test_repair_vault_migrates_is_a_to_type() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path();
        let note_dir = vault_path.join("note");
        std::fs::create_dir_all(&note_dir).unwrap();
        std::fs::write(note_dir.join("hello.md"), "---\nis_a: Note\n---\n# Hello\n").unwrap();

        let result = repair_vault(vault_path.to_str().unwrap().to_string());
        assert!(result.is_ok());
        assert!(note_dir.join("hello.md").exists());
        let content = std::fs::read_to_string(note_dir.join("hello.md")).unwrap();
        assert!(content.contains("type: Note"));
        assert!(!content.contains("is_a:"));
    }

    #[test]
    fn test_repair_vault_creates_config_files() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path();

        let result = repair_vault(vault_path.to_str().unwrap().to_string());
        assert!(result.is_ok());
        assert_paths_exist(
            vault_path,
            &["AGENTS.md", "CLAUDE.md", "type.md", "note.md", ".gitignore"],
        );
        assert_paths_absent(vault_path, &["config.md"]);
    }

    #[test]
    fn test_create_empty_vault_seeds_agents_and_type_scaffolding() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path().join("fresh-vault");

        let result = create_empty_vault(vault_path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_paths_exist(
            &vault_path,
            &[".git", "AGENTS.md", "CLAUDE.md", "type.md", "note.md"],
        );
        assert_paths_absent(&vault_path, &["config.md"]);
        assert_seeded_guidance_content(&vault_path);
        assert_seeded_type_scaffolding(&vault_path);
    }

    #[test]
    fn test_create_empty_vault_rejects_nonempty_target() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path().join("existing-folder");
        std::fs::create_dir_all(&vault_path).unwrap();
        std::fs::write(vault_path.join("keep.txt"), "keep").unwrap();

        let result = create_empty_vault(vault_path.to_string_lossy().to_string());
        let err = result.expect_err("expected non-empty folder to be rejected");

        assert_eq!(err, "Choose an empty folder to create a new vault");
        assert_paths_exist(&vault_path, &["keep.txt"]);
        assert_paths_absent(&vault_path, &[".git", "AGENTS.md"]);
    }
}
