use super::*;
use std::collections::HashMap;

fn assert_relationship_values(
    relationships: &HashMap<String, Vec<String>>,
    expected: &[(&str, &[&str])],
) {
    for (key, values) in expected {
        let actual = relationships.get(*key).unwrap();
        let expected_values = values
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>();
        assert_eq!(actual, &expected_values, "relationship {key} mismatch");
    }
}

#[test]
fn test_parse_relationships_array() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Is A: Responsibility
Has:
  - "[[essay/foo|Foo Essay]]"
  - "[[essay/bar|Bar Essay]]"
Topics:
  - "[[topic/rust]]"
  - "[[topic/wasm]]"
Status: Active
---
# Publish Essays
"#;
    create_test_file(dir.path(), "publish-essays.md", content);

    let entry = parse_md_file(&dir.path().join("publish-essays.md"), None).unwrap();
    assert_eq!(entry.relationships.len(), 3);
    assert_relationship_values(
        &entry.relationships,
        &[
            (
                "Has",
                &["[[essay/foo|Foo Essay]]", "[[essay/bar|Bar Essay]]"],
            ),
            ("Topics", &["[[topic/rust]]", "[[topic/wasm]]"]),
            ("Type", &["[[responsibility]]"]),
        ],
    );
}

#[test]
fn test_parse_relationships_single_string() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Is A: Project
Owner: "[[person/luca-rossi|Luca Rossi]]"
Belongs to:
  - "[[responsibility/grow-newsletter]]"
---
# Some Project
"#;
    create_test_file(dir.path(), "some-project.md", content);

    let entry = parse_md_file(&dir.path().join("some-project.md"), None).unwrap();
    assert!(entry.relationships.contains_key("Owner"));
    assert!(!entry.properties.contains_key("Owner"));
    assert_relationship_values(
        &entry.relationships,
        &[("Belongs to", &["[[responsibility/grow-newsletter]]"])],
    );
    assert_eq!(entry.belongs_to, vec!["[[responsibility/grow-newsletter]]"]);
}

#[test]
fn test_parse_relationships_ignores_non_wikilinks() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Is A: Note
Status: Active
Tags:
  - productivity
  - writing
Custom Field: just a plain string
---
# A Note
"#;
    create_test_file(dir.path(), "plain-note.md", content);

    let entry = parse_md_file(&dir.path().join("plain-note.md"), None).unwrap();
    assert_eq!(entry.relationships.len(), 1);
    assert_relationship_values(&entry.relationships, &[("Type", &["[[note]]"])]);
}

const BIG_PROJECT_CONTENT: &str = "---\nIs A: Project\nHas:\n  - \"[[deliverable/mvp]]\"\n  - \"[[deliverable/v2]]\"\nTopics:\n  - \"[[topic/ai]]\"\n  - \"[[topic/compilers]]\"\nEvents:\n  - \"[[event/launch-day]]\"\nNotes:\n  - \"[[note/design-rationale]]\"\n  - \"[[note/meeting-2024-01]]\"\n  - \"[[note/meeting-2024-02]]\"\nOwner: \"[[person/alice]]\"\nRelated to:\n  - \"[[project/sibling-project]]\"\nBelongs to:\n  - \"[[area/engineering]]\"\nStatus: Active\n---\n# Big Project\n";

fn parse_big_project_relationships() -> HashMap<String, Vec<String>> {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(&dir, "big-project.md", BIG_PROJECT_CONTENT);
    entry.relationships
}

#[test]
fn test_parse_relationships_custom_fields() {
    let relationships = parse_big_project_relationships();
    assert_eq!(relationships.get("Has").unwrap().len(), 2);
    assert_eq!(relationships.get("Topics").unwrap().len(), 2);
    assert_eq!(relationships.get("Events").unwrap().len(), 1);
}

#[test]
fn test_parse_relationships_owner_and_notes() {
    let relationships = parse_big_project_relationships();
    assert_eq!(relationships.get("Notes").unwrap().len(), 3);
    assert!(relationships.contains_key("Owner"));
}

#[test]
fn test_parse_relationships_builtin_wikilink_fields() {
    let relationships = parse_big_project_relationships();
    assert_eq!(relationships.get("Related to").unwrap().len(), 1);
    assert_eq!(relationships.get("Belongs to").unwrap().len(), 1);
}

#[test]
fn test_parse_relationships_skip_keys_excluded_from_generic() {
    let relationships = parse_big_project_relationships();
    assert!(!relationships.contains_key("Status"));
    assert!(!relationships.contains_key("Is A"));
}

#[test]
fn test_parse_relationships_single_vs_array_wikilinks() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
Mentor: "[[person/bob|Bob Smith]]"
Reviewers:
  - "[[person/carol]]"
  - "[[person/dave]]"
Context: "[[area/research]]"
---
# A Note
"#;
    create_test_file(dir.path(), "single-vs-array.md", content);

    let entry = parse_md_file(&dir.path().join("single-vs-array.md"), None).unwrap();
    assert_relationship_values(
        &entry.relationships,
        &[
            ("Mentor", &["[[person/bob|Bob Smith]]"]),
            ("Reviewers", &["[[person/carol]]", "[[person/dave]]"]),
            ("Context", &["[[area/research]]"]),
        ],
    );
}

const SKIP_KEYS_CONTENT: &str = "---\nIs A: \"[[project]]\"\nAliases:\n  - \"[[alias/foo]]\"\nStatus: \"[[status/active]]\"\nCadence: \"[[cadence/weekly]]\"\nCreated at: \"[[time/2024-01-01]]\"\nCreated time: \"[[time/noon]]\"\nReal Relation: \"[[note/important]]\"\n---\n# Skip Keys Test\n";

fn parse_skip_key_relationships() -> (HashMap<String, Vec<String>>, usize) {
    let dir = TempDir::new().unwrap();
    let entry = parse_test_entry(&dir, "skip-keys.md", SKIP_KEYS_CONTENT);
    let relationship_count = entry.relationships.len();
    (entry.relationships, relationship_count)
}

#[test]
fn test_skip_keys_identity_fields_excluded() {
    let (relationships, _) = parse_skip_key_relationships();
    assert!(!relationships.contains_key("Is A"));
    assert!(!relationships.contains_key("Aliases"));
    assert!(!relationships.contains_key("Status"));
}

#[test]
fn test_skip_keys_temporal_fields_excluded() {
    let (relationships, _) = parse_skip_key_relationships();
    for key in ["Cadence", "Created at", "Created time"] {
        assert!(relationships.contains_key(key), "missing {key}");
    }
}

#[test]
fn test_skip_keys_real_relation_included() {
    let (relationships, relationship_count) = parse_skip_key_relationships();
    assert_eq!(relationship_count, 5);
    assert_relationship_values(
        &relationships,
        &[
            ("Real Relation", &["[[note/important]]"]),
            ("Type", &["[[project]]"]),
        ],
    );
    for key in ["Cadence", "Created at", "Created time"] {
        assert!(relationships.contains_key(key), "missing {key}");
    }
}

#[test]
fn test_parse_relationships_mixed_wikilinks_and_plain_in_array() {
    let dir = TempDir::new().unwrap();
    let content = r#"---
References:
  - "[[source/paper-a]]"
  - "just a plain string"
  - "[[source/paper-b]]"
  - "no links here"
---
# Mixed Array
"#;
    create_test_file(dir.path(), "mixed-array.md", content);

    let entry = parse_md_file(&dir.path().join("mixed-array.md"), None).unwrap();
    assert_relationship_values(
        &entry.relationships,
        &[("References", &["[[source/paper-a]]", "[[source/paper-b]]"])],
    );
}

#[test]
fn test_parse_large_notes_relationship_array() {
    let dir = TempDir::new().unwrap();
    let content = include_str!("fixtures/large-relationships.md");
    create_test_file(dir.path(), "no-code.md", content);
    let entry = parse_md_file(&dir.path().join("no-code.md"), None).unwrap();

    let notes = entry
        .relationships
        .get("Notes")
        .expect("Notes relationship should exist");
    assert_eq!(notes.len(), 32, "All 32 Notes entries should be parsed");

    let referred = entry
        .relationships
        .get("Referred by Data")
        .expect("Referred by Data should exist");
    assert_eq!(referred.len(), 2);

    let belongs_to = entry
        .relationships
        .get("Belongs to")
        .expect("Belongs to should exist");
    assert_eq!(belongs_to.len(), 1);
}
