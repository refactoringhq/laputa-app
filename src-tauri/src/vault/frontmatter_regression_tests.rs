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

struct HiddenPropertyCase<'a> {
    content: &'a str,
    hidden_key: &'a str,
}

fn assert_filtered_property_stays_hidden(case: HiddenPropertyCase<'_>) {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(&dir, "test.md", case.content);
    assert!(!entry.properties.contains_key(case.hidden_key));
    assert_eq!(
        entry
            .properties
            .get("Company")
            .and_then(|value| value.as_str()),
        Some("Acme Corp")
    );
}

struct SingleElementArrayCase<'a> {
    note_type: &'a str,
    key: &'a str,
    value: &'a str,
}

fn assert_single_element_array_property(case: SingleElementArrayCase<'_>) {
    let dir = TempDir::new().unwrap();
    let content = format!(
        "---\ntype: {}\n{}:\n  - {}\n---\n# Test\n",
        case.note_type, case.key, case.value
    );
    let entry = parse_test_entry(&dir, "test.md", &content);
    assert_eq!(
        entry
            .properties
            .get(case.key)
            .and_then(|property| property.as_str()),
        Some(case.value)
    );
    assert_eq!(entry.is_a, Some(case.note_type.to_string()));
}

struct AliasRecoveryCase<'a> {
    file_name: &'a str,
    title: &'a str,
    alias_item: &'a str,
}

fn assert_alias_parser_recovers(case: AliasRecoveryCase<'_>) {
    let dir = TempDir::new().unwrap();
    let content = format!(
        "---\ntype: Note\n_organized: true\naliases:\n  - {}\n  - Note\n---\n# {}\n",
        case.alias_item, case.title
    );
    let entry = parse_test_entry(&dir, case.file_name, &content);
    assert_eq!(entry.is_a, Some("Note".to_string()));
    assert!(entry.organized);
}

#[test]
fn test_filtered_properties_stay_hidden() {
    let cases = [
        HiddenPropertyCase {
            content: "---\nMentor: \"[[person/alice]]\"\nCompany: Acme Corp\n---\n# Test\n",
            hidden_key: "Mentor",
        },
        HiddenPropertyCase {
            content: "---\nTags:\n  - productivity\n  - writing\nCompany: Acme Corp\n---\n# Test\n",
            hidden_key: "Tags",
        },
    ];

    for case in cases {
        assert_filtered_property_stays_hidden(case);
    }
}

#[test]
fn test_single_element_array_properties_unwrap_to_scalars() {
    let cases = [
        SingleElementArrayCase {
            note_type: "Responsibility",
            key: "Owner",
            value: "Luca",
        },
        SingleElementArrayCase {
            note_type: "Procedure",
            key: "Cadence",
            value: "Weekly",
        },
    ];

    for case in cases {
        assert_single_element_array_property(case);
    }
}

#[test]
fn test_alias_parser_recovers_special_alias_items() {
    let cases = [
        AliasRecoveryCase {
            file_name: "colon-alias.md",
            title: "Test",
            alias_item: "Bitcoin: Net Unrealized Profit/Loss",
        },
        AliasRecoveryCase {
            file_name: "hash-alias.md",
            title: "Title",
            alias_item: "# Writing a Good CLAUDE.md",
        },
    ];

    for case in cases {
        assert_alias_parser_recovers(case);
    }
}

#[test]
fn test_alias_collisions_keep_frontmatter_with_last_value_winning() {
    let dir = TempDir::new().unwrap();
    let content = "---\ntype: Note\nstatus: Active\nStatus: Evergreened\n---\n# Test\n";
    let entry = parse_test_entry(&dir, "test.md", content);

    assert_eq!(entry.is_a, Some("Note".to_string()));
    assert_eq!(entry.status, Some("Evergreened".to_string()));
}
