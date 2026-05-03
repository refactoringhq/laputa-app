use super::*;
use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::TempDir;

fn create_test_file(dir: &Path, name: &str, content: &str) {
    let file_path = dir.join(name);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = fs::File::create(file_path).unwrap();
    file.write_all(content.as_bytes()).unwrap();
}

fn parse_test_entry(dir: &TempDir, name: &str, content: &str) -> VaultEntry {
    create_test_file(dir.path(), name, content);
    parse_md_file(&dir.path().join(name), None).unwrap()
}

#[test]
fn parses_canonical_system_metadata_keys() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "project.md",
        "---\ntype: Type\n_icon: rocket\n_order: 4\n_sidebar_label: Projects\n_sort: title:asc\n---\n# Project\n",
    );

    assert_eq!(entry.icon.as_deref(), Some("rocket"));
    assert_eq!(entry.order, Some(4));
    assert_eq!(entry.sidebar_label.as_deref(), Some("Projects"));
    assert_eq!(entry.sort.as_deref(), Some("title:asc"));
}

#[test]
fn parses_legacy_system_metadata_keys_without_property_leaks() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "project.md",
        "---\ntype: Type\nicon: rocket\norder: 4\nsidebar label: Projects\nsort: title:asc\n---\n# Project\n",
    );

    assert_eq!(entry.icon.as_deref(), Some("rocket"));
    assert_eq!(entry.order, Some(4));
    assert_eq!(entry.sidebar_label.as_deref(), Some("Projects"));
    assert_eq!(entry.sort.as_deref(), Some("title:asc"));
    assert!(!entry.properties.contains_key("icon"));
    assert!(!entry.properties.contains_key("order"));
    assert!(!entry.properties.contains_key("sidebar label"));
    assert!(!entry.properties.contains_key("sort"));
}

#[test]
fn ignores_unknown_underscore_keys_in_properties_and_relationships() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "note.md",
        "---\ntype: Note\n_internal: secret\n_hidden_link: \"[[secret]]\"\nOwner: Luca\n---\n# Note\n",
    );

    assert!(!entry.properties.contains_key("_internal"));
    assert!(!entry.relationships.contains_key("_hidden_link"));
    assert_eq!(
        entry
            .properties
            .get("Owner")
            .and_then(|value| value.as_str()),
        Some("Luca")
    );
}

#[test]
fn parses_note_width_without_property_leaks() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "note.md",
        "---\ntype: Note\n_width: wide\n---\n# Note\n",
    );

    assert_eq!(entry.note_width.as_deref(), Some("wide"));
    assert!(!entry.properties.contains_key("_width"));
    assert!(!entry.relationships.contains_key("_width"));
}

#[test]
fn ignores_invalid_note_width_modes() {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(
        &dir,
        "note.md",
        "---\ntype: Note\n_width: expanded\n---\n# Note\n",
    );

    assert_eq!(entry.note_width, None);
}
