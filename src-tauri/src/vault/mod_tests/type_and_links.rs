use super::*;
use std::fs;

#[test]
fn test_type_from_frontmatter_only() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "test.md", "---\ntype: Custom\n---\n# Test\n");
    let entry = parse_md_file(&dir.path().join("test.md"), None).unwrap();
    assert_eq!(entry.is_a, Some("Custom".to_string()));
}

#[test]
fn test_no_type_when_frontmatter_missing() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "note/test.md", "# Test\n");
    let entry = parse_md_file(&dir.path().join("note/test.md"), None).unwrap();
    assert_eq!(entry.is_a, None, "type should not be inferred from folder");
}

#[test]
fn test_created_at_from_filesystem() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: Note\n---\n# Test\n";
    create_test_file(dir.path(), "test.md", content);

    let entry = parse_md_file(&dir.path().join("test.md"), None).unwrap();
    assert!(
        entry.created_at.is_some(),
        "created_at should come from filesystem"
    );
}

#[test]
fn test_type_relationship_added_for_regular_entries() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: Project\n---\n# My Project\n";
    let entry = parse_test_entry(&dir, "project/my-project.md", content);
    assert_eq!(
        entry.relationships.get("Type").unwrap(),
        &vec!["[[project]]".to_string()]
    );
}

#[test]
fn test_type_relationship_skipped_for_type_documents() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: Type\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(!entry.relationships.contains_key("Type"));
}

#[test]
fn test_no_type_relationship_without_frontmatter() {
    let dir = TempDir::new().unwrap();
    let content = "# A Person\n\nSome content.";
    let entry = parse_test_entry(&dir, "someone.md", content);
    assert_eq!(entry.is_a, None);
    assert!(!entry.relationships.contains_key("Type"));
}

#[test]
fn test_type_relationship_handles_wikilink_is_a() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: \"[[experiment]]\"\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "test.md", content);
    assert_eq!(
        entry.relationships.get("Type").unwrap(),
        &vec!["[[experiment]]".to_string()]
    );
}

#[test]
fn test_type_from_frontmatter_not_folder() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n---\n# Some Type\n";
    let entry = parse_test_entry(&dir, "some-type.md", content);
    assert_eq!(entry.is_a, Some("Type".to_string()));
}

#[test]
fn test_parse_type_key_lowercase() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Project\n---\n# My Project\n";
    let entry = parse_test_entry(&dir, "project/my-project.md", content);
    assert_eq!(entry.is_a, Some("Project".to_string()));
}

#[test]
fn test_parse_type_key_case_insensitive() {
    for (key, expected_type) in [("Type", "Project"), ("TYPE", "Person")] {
        let dir = TempDir::new().unwrap();
        let content = format!("---\n{key}: {expected_type}\n---\n# Test\n");
        let entry = parse_test_entry(&dir, "note/test.md", &content);
        assert_eq!(entry.is_a, Some(expected_type.to_string()));
    }
}

#[test]
fn test_type_key_generates_type_relationship() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Person\n---\n# Alice\n";
    let entry = parse_test_entry(&dir, "person/alice.md", content);
    assert_eq!(
        entry.relationships.get("Type").unwrap(),
        &vec!["[[person]]".to_string()]
    );
}

#[test]
fn test_type_key_not_in_relationships_as_generic() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Note\nHas:\n  - \"[[task/foo]]\"\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "note/test.md", content);
    assert_eq!(entry.relationships.len(), 2);
    assert!(entry.relationships.contains_key("Has"));
    assert!(entry.relationships.contains_key("Type"));
}

#[test]
fn test_outgoing_links_extracted_from_content_body() {
    let dir = TempDir::new().unwrap();
    let content = "---\nIs A: Note\n---\n# My Note\n\nSee [[person/alice]] and [[topic/rust]].";
    let entry = parse_test_entry(&dir, "note/my-note.md", content);
    assert_eq!(entry.outgoing_links, vec!["person/alice", "topic/rust"]);
}

#[test]
fn test_outgoing_links_excludes_frontmatter_wikilinks() {
    let dir = TempDir::new().unwrap();
    let content = "---\nHas:\n  - \"[[task/design]]\"\n---\n# Note\n\nSee [[person/bob]].";
    let entry = parse_test_entry(&dir, "note/test.md", content);
    assert!(!entry.outgoing_links.contains(&"task/design".to_string()));
    assert!(entry.outgoing_links.contains(&"person/bob".to_string()));
}

#[test]
fn test_outgoing_links_handles_pipe_syntax() {
    let dir = TempDir::new().unwrap();
    let content = "# Note\n\nSee [[project/alpha|Alpha Project]] for details.";
    let entry = parse_test_entry(&dir, "test.md", content);
    assert!(entry.outgoing_links.contains(&"project/alpha".to_string()));
}

#[test]
fn test_save_note_content_creates_parent_directory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("new-type/untitled-note.md");
    let content = "---\ntitle: Untitled note\n---\n# Untitled note\n\n";

    assert!(!path.parent().unwrap().exists());
    save_note_content(path.to_str().unwrap(), content).unwrap();

    assert!(path.exists());
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
}

#[test]
fn test_save_note_content_existing_directory() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("note")).unwrap();
    let path = dir.path().join("note/test.md");
    let content = "# Test\n";

    save_note_content(path.to_str().unwrap(), content).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
}

#[test]
fn test_save_note_content_deeply_nested_new_directory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("a/b/c/deep-note.md");
    let content = "---\ntitle: Deep\n---\n";

    save_note_content(path.to_str().unwrap(), content).unwrap();
    assert!(path.exists());
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
}

#[test]
fn test_create_note_content_creates_parent_directory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("new-type/briefing.md");
    let content = "---\ntitle: Briefing\ntype: Note\n---\n";

    assert!(!path.parent().unwrap().exists());
    create_note_content(path.to_str().unwrap(), content).unwrap();

    assert!(path.exists());
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
}

#[test]
fn test_create_note_content_rejects_existing_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("briefing.md");
    fs::write(&path, "# Existing\n").unwrap();

    let err = create_note_content(path.to_str().unwrap(), "# Replacement\n")
        .expect_err("expected create-only write to reject collisions");

    assert!(err.contains("already exists"));
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Existing\n");
}
