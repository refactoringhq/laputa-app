use super::*;
use std::path::Path;

#[test]
fn test_scan_vault_folders_returns_tree() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("projects/laputa")).unwrap();
    std::fs::create_dir_all(dir.path().join("areas")).unwrap();

    let folders = scan_vault_folders(dir.path()).unwrap();
    let names: Vec<&str> = folders.iter().map(|folder| folder.name.as_str()).collect();
    assert!(names.contains(&"projects"));
    assert!(names.contains(&"areas"));

    let projects = folders
        .iter()
        .find(|folder| folder.name == "projects")
        .unwrap();
    assert_eq!(projects.children.len(), 1);
    assert_eq!(projects.children[0].name, "laputa");
    assert_eq!(projects.children[0].path, "projects/laputa");
}

#[test]
fn test_scan_vault_folders_excludes_hidden() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".git")).unwrap();
    std::fs::create_dir_all(dir.path().join(".laputa")).unwrap();
    std::fs::create_dir_all(dir.path().join("visible")).unwrap();

    let folders = scan_vault_folders(dir.path()).unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].name, "visible");
}

#[test]
fn test_scan_vault_folders_keeps_default_vault_folders_visible() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("attachments")).unwrap();
    std::fs::create_dir_all(dir.path().join("type")).unwrap();
    std::fs::create_dir_all(dir.path().join("views")).unwrap();
    std::fs::create_dir_all(dir.path().join("projects")).unwrap();

    let folders = scan_vault_folders(dir.path()).unwrap();
    let names: Vec<&str> = folders.iter().map(|folder| folder.name.as_str()).collect();

    assert_eq!(names, vec!["attachments", "projects", "views"]);
}

#[test]
fn test_scan_vault_folders_flat_vault() {
    let dir = TempDir::new().unwrap();
    create_test_file(dir.path(), "note.md", "# Note\n");

    let folders = scan_vault_folders(dir.path()).unwrap();
    assert!(folders.is_empty(), "flat vault has no visible folders");
}

#[test]
fn test_list_properties_display_values_and_non_leakage() {
    let dir = TempDir::new().unwrap();
    let content =
        "---\ntype: Type\n_list_properties_display:\n  - rating\n  - genre\n---\n# Movies\n";
    let entry = parse_test_entry(&dir, "movies.md", content);
    assert_eq!(entry.list_properties_display, vec!["rating", "genre"]);
    assert!(!entry.properties.contains_key("_list_properties_display"));
    assert!(!entry.relationships.contains_key("_list_properties_display"));

    let absent = parse_test_entry(&dir, "books.md", "---\ntype: Type\n---\n# Books\n");
    assert!(absent.list_properties_display.is_empty());
}

#[test]
fn test_non_markdown_files_use_expected_titles_and_kinds() {
    let dir = TempDir::new().unwrap();

    let named_yml_path = dir.path().join("active-projects.yml");
    std::fs::write(
        &named_yml_path,
        "name: Active Projects\nicon: rocket\ncolor: blue\n",
    )
    .unwrap();
    let named_yml_entry = super::parse_non_md_file(&named_yml_path, None).unwrap();
    assert_eq!(named_yml_entry.title, "Active Projects");
    assert_eq!(named_yml_entry.filename, "active-projects.yml");

    let unnamed_yml_path = dir.path().join("config.yml");
    std::fs::write(&unnamed_yml_path, "key: value\n").unwrap();
    let unnamed_yml_entry = super::parse_non_md_file(&unnamed_yml_path, None).unwrap();
    assert_eq!(unnamed_yml_entry.title, "config.yml");

    let txt_path = dir.path().join("notes.txt");
    std::fs::write(&txt_path, "some content").unwrap();
    let txt_entry = super::parse_non_md_file(&txt_path, None).unwrap();
    assert_eq!(txt_entry.title, "notes.txt");

    create_test_file(
        dir.path(),
        "views/my-view.yml",
        "name: My View\nicon: rocket\n",
    );
    let text_entry = super::parse_non_md_file(&dir.path().join("views/my-view.yml"), None).unwrap();
    assert_eq!(text_entry.file_kind, "text");
    assert_eq!(text_entry.title, "My View");
}

#[test]
fn test_classify_file_kind_by_extension() {
    for (path, expected_kind) in [
        ("views/active-projects.yml", "text"),
        ("config.yaml", "text"),
        ("data.json", "text"),
        ("script.py", "text"),
        ("readme.txt", "text"),
        ("note.md", "markdown"),
        ("README.markdown", "markdown"),
        ("diagram.excalidraw", "text"),
        ("photo.png", "binary"),
        ("archive.zip", "binary"),
    ] {
        assert_eq!(classify_file_kind(Path::new(path)), expected_kind, "{path}");
    }
}
