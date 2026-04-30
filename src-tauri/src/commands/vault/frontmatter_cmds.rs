use crate::frontmatter;
use crate::frontmatter::FrontmatterValue;

use super::boundary::{with_existing_paths, with_validated_path, ValidatedPathMode};

#[tauri::command]
pub fn update_frontmatter(
    path: String,
    key: String,
    value: FrontmatterValue,
    vault_path: Option<String>,
) -> Result<String, String> {
    with_validated_path(
        &path,
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| frontmatter::update_frontmatter(validated_path, &key, value),
    )
}

#[tauri::command]
pub fn delete_frontmatter_property(
    path: String,
    key: String,
    vault_path: Option<String>,
) -> Result<String, String> {
    with_validated_path(
        &path,
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| frontmatter::delete_frontmatter_property(validated_path, &key),
    )
}

#[tauri::command]
pub fn batch_archive_notes(
    paths: Vec<String>,
    vault_path: Option<String>,
) -> Result<usize, String> {
    with_existing_paths(&paths, vault_path.as_deref(), |validated_paths| {
        let mut count = 0;
        for path in &validated_paths {
            frontmatter::update_frontmatter(path, "_archived", FrontmatterValue::Bool(true))?;
            count += 1;
        }
        Ok(count)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_path(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().into_owned()
    }

    fn write_note(path: &str, content: &str) {
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn update_frontmatter_command_validates_and_updates_note() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = note_path(&dir, "note.md");
        write_note(&path, "---\nStatus: Draft\n---\n# Note\n");

        let updated = update_frontmatter(
            path.clone(),
            "Status".to_string(),
            FrontmatterValue::String("Done".to_string()),
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert!(updated.contains("Status: Done"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), updated);
    }

    #[test]
    fn delete_frontmatter_property_command_removes_existing_key() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = note_path(&dir, "note.md");
        write_note(&path, "---\nStatus: Draft\nOwner: Ada\n---\n# Note\n");

        let updated = delete_frontmatter_property(
            path,
            "Owner".to_string(),
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert!(!updated.contains("Owner:"));
        assert!(updated.contains("Status: Draft"));
    }

    #[test]
    fn batch_archive_notes_command_marks_each_note_archived() {
        let dir = tempfile::TempDir::new().unwrap();
        let first = note_path(&dir, "first.md");
        let second = note_path(&dir, "second.md");
        write_note(&first, "---\nStatus: Draft\n---\n# First\n");
        write_note(&second, "# Second\n");

        let count = batch_archive_notes(
            vec![first.clone(), second.clone()],
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert_eq!(count, 2);
        assert!(std::fs::read_to_string(first)
            .unwrap()
            .contains("_archived: true"));
        assert!(std::fs::read_to_string(second)
            .unwrap()
            .contains("_archived: true"));
    }

    #[test]
    fn batch_archive_notes_command_rejects_notes_outside_vault() {
        let vault = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let outside_note = note_path(&outside, "outside.md");
        write_note(&outside_note, "# Outside\n");

        let error = batch_archive_notes(
            vec![outside_note],
            Some(vault.path().to_string_lossy().into_owned()),
        )
        .unwrap_err();

        assert!(error.contains("Path must stay inside the active vault"));
    }
}
