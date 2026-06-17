use super::*;
use std::collections::HashMap;

fn assert_string_property(entry: &VaultEntry, key: &str, expected: &str) {
    assert_eq!(
        entry.properties.get(key).and_then(|value| value.as_str()),
        Some(expected),
        "unexpected value for {key}"
    );
}

#[test]
fn test_parse_sidebar_label_from_type_entry() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\nsidebar label: News\n---\n# News\n";
    let entry = parse_test_entry(&dir, "news.md", content);
    assert_eq!(entry.sidebar_label, Some("News".to_string()));
}

#[test]
fn test_parse_sidebar_label_missing_defaults_to_none() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert_eq!(entry.sidebar_label, None);
}

#[test]
fn test_sidebar_label_not_in_relationships() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\nsidebar label: My Series\n---\n# Series\n";
    let entry = parse_test_entry(&dir, "series.md", content);
    assert!(!entry.relationships.contains_key("sidebar label"));
}

#[test]
fn test_parse_template_from_type_entry() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\ntemplate: \"## Objective\\n\\n## Timeline\"\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(entry.template.is_some());
}

#[test]
fn test_parse_template_block_scalar() {
    let dir = TempDir::new().unwrap();
    let content =
        "---\ntype: Type\ntemplate: |\n  ## Objective\n  \n  ## Timeline\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(entry.template.is_some());
    let template = entry.template.unwrap();
    assert!(template.contains("## Objective"));
    assert!(template.contains("## Timeline"));
}

#[test]
fn test_parse_filename_template_from_type_entry() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n_filename_template: \"{{date:yyyy-MM-dd}}\"\n---\n# Journal\n";
    let entry = parse_test_entry(&dir, "journal.md", content);
    assert_eq!(
        entry.filename_template.as_deref(),
        Some("{{date:yyyy-MM-dd}}"),
        "_filename_template must be parsed for journal filenames"
    );
}

#[test]
fn test_vault_entry_serializes_filename_template_as_camel_case() {
    let entry = VaultEntry {
        filename_template: Some("{{date}}".to_string()),
        ..VaultEntry::default()
    };
    let json = serde_json::to_string(&entry).unwrap();
    assert!(
        json.contains("\"filenameTemplate\""),
        "expected camelCase key for the IPC boundary, got: {json}"
    );
}

#[test]
fn test_parse_subfolder_path_from_type_entry() {
    let dir = TempDir::new().unwrap();
    let content =
        "---\ntype: Type\n_subfolder_path: \"journals/{{date:yyyy}}/{{date:MM}}\"\n---\n# Journal\n";
    let entry = parse_test_entry(&dir, "journal.md", content);
    assert_eq!(
        entry.subfolder_path.as_deref(),
        Some("journals/{{date:yyyy}}/{{date:MM}}"),
        "_subfolder_path must be parsed for type-scoped note filing"
    );
}

#[test]
fn test_vault_entry_serializes_subfolder_path_as_camel_case() {
    let entry = VaultEntry {
        subfolder_path: Some("journals/{{date:yyyy}}".to_string()),
        ..VaultEntry::default()
    };
    let json = serde_json::to_string(&entry).unwrap();
    assert!(
        json.contains("\"subfolderPath\""),
        "expected camelCase key for the IPC boundary, got: {json}"
    );
}

#[test]
fn test_subfolder_path_missing_defaults_to_none() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n---\n# Journal\n";
    let entry = parse_test_entry(&dir, "journal.md", content);
    assert_eq!(entry.subfolder_path, None);
}

#[test]
fn test_subfolder_path_not_in_properties_or_relationships() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n_subfolder_path: \"journals/{{date:yyyy}}\"\n---\n# Journal\n";
    let entry = parse_test_entry(&dir, "journal.md", content);
    assert!(!entry.properties.contains_key("_subfolder_path"));
    assert!(!entry.relationships.contains_key("_subfolder_path"));
}

#[test]
fn test_parse_template_missing_defaults_to_none() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n---\n# Note\n";
    let entry = parse_test_entry(&dir, "note.md", content);
    assert_eq!(entry.template, None);
}

#[test]
fn test_template_not_in_relationships() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\ntemplate: \"## Heading\"\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(!entry.relationships.contains_key("template"));
}

#[test]
fn test_parse_sort_from_type_entry() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\nsort: \"modified:desc\"\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert_eq!(entry.sort, Some("modified:desc".to_string()));
}

#[test]
fn test_parse_sort_missing_defaults_to_none() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert_eq!(entry.sort, None);
}

#[test]
fn test_sort_not_in_relationships() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\nsort: \"title:asc\"\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(!entry.relationships.contains_key("sort"));
}

#[test]
fn test_sort_not_in_properties() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Type\nsort: \"title:asc\"\n---\n# Project\n";
    let entry = parse_test_entry(&dir, "project.md", content);
    assert!(!entry.properties.contains_key("sort"));
}

#[test]
fn test_extract_properties_scalar_values() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Is A: Project
Status: Active
Priority: High
Rating: 5
Due date: 2026-06-15
Reviewed: true
---
# Test
"#;
    let entry = parse_test_entry(&dir, "project/test.md", content);
    let expected: HashMap<String, serde_json::Value> = [
        ("Priority".into(), serde_json::Value::String("High".into())),
        ("Rating".into(), serde_json::json!(5)),
        (
            "Due date".into(),
            serde_json::Value::String("2026-06-15".into()),
        ),
        ("Reviewed".into(), serde_json::Value::Bool(true)),
    ]
    .into_iter()
    .collect();
    assert_eq!(entry.properties, expected);
}

#[test]
fn test_extract_properties_skips_structural_fields() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Is A: Project
Status: Active
Owner: Luca
Cadence: Weekly
Archived: false
Priority: High
---
# Test
"#;
    let entry = parse_test_entry(&dir, "project/test.md", content);
    assert_eq!(entry.properties.len(), 3);
    for (key, value) in [
        ("Priority", "High"),
        ("Owner", "Luca"),
        ("Cadence", "Weekly"),
    ] {
        assert_string_property(&entry, key, value);
    }
}
