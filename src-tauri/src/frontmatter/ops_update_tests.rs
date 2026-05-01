use super::{update_frontmatter_content, FrontmatterValue};

struct UpdateCase<'a> {
    content: &'a str,
    key: &'a str,
    value: Option<FrontmatterValue>,
    expected_present: &'a [&'a str],
    expected_absent: &'a [&'a str],
}

fn assert_updated_content(case: UpdateCase<'_>) {
    let updated = update_frontmatter_content(case.content, case.key, case.value).unwrap();
    for expected in case.expected_present {
        assert!(
            updated.contains(expected),
            "missing expected snippet: {expected}"
        );
    }
    for unexpected in case.expected_absent {
        assert!(
            !updated.contains(unexpected),
            "found unexpected snippet: {unexpected}"
        );
    }
}

#[test]
fn test_update_frontmatter_replaces_or_adds_scalar_fields() {
    let cases = [
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "Status",
            value: Some(FrontmatterValue::String("Active".to_string())),
            expected_present: &["Status: Active"],
            expected_absent: &["Status: Draft"],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "Owner",
            value: Some(FrontmatterValue::String("Luca".to_string())),
            expected_present: &["Owner: Luca", "Status: Draft"],
            expected_absent: &[],
        },
        UpdateCase {
            content: "---\n\"Is A\": Note\n---\n# Test\n",
            key: "Is A",
            value: Some(FrontmatterValue::String("Project".to_string())),
            expected_present: &["\"Is A\": Project"],
            expected_absent: &["\"Is A\": Note"],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "Reviewed",
            value: Some(FrontmatterValue::Bool(true)),
            expected_present: &["Reviewed: true"],
            expected_absent: &[],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "Priority",
            value: Some(FrontmatterValue::Number(5.0)),
            expected_present: &["Priority: 5"],
            expected_absent: &[],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "Score",
            value: Some(FrontmatterValue::Number(9.5)),
            expected_present: &["Score: 9.5"],
            expected_absent: &[],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "ClearMe",
            value: Some(FrontmatterValue::Null),
            expected_present: &["ClearMe: null"],
            expected_absent: &[],
        },
    ];

    for case in cases {
        assert_updated_content(case);
    }
}

#[test]
fn test_update_frontmatter_list_and_delete_paths() {
    let list_cases = [
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "aliases",
            value: Some(FrontmatterValue::List(vec![
                "Alias1".to_string(),
                "Alias2".to_string(),
            ])),
            expected_present: &["aliases:", "  - \"Alias1\"", "  - \"Alias2\""],
            expected_absent: &[],
        },
        UpdateCase {
            content: "---\naliases:\n  - Old1\n  - Old2\nStatus: Draft\n---\n# Test\n",
            key: "aliases",
            value: Some(FrontmatterValue::List(vec!["New1".to_string()])),
            expected_present: &["  - \"New1\"", "Status: Draft"],
            expected_absent: &["Old1", "Old2"],
        },
        UpdateCase {
            content: "---\naliases:\n  - Alias1\n  - Alias2\nStatus: Draft\n---\n# Test\n",
            key: "aliases",
            value: None,
            expected_present: &["Status: Draft"],
            expected_absent: &["aliases", "Alias1"],
        },
        UpdateCase {
            content: "---\nStatus: Draft\nOwner: Luca\n---\n# Test\n",
            key: "Owner",
            value: None,
            expected_present: &["Status: Draft"],
            expected_absent: &["Owner"],
        },
        UpdateCase {
            content: "---\nStatus: Draft\n---\n# Test\n",
            key: "tags",
            value: Some(FrontmatterValue::List(vec![])),
            expected_present: &["tags: []"],
            expected_absent: &[],
        },
    ];

    for case in list_cases {
        assert_updated_content(case);
    }
}

#[test]
fn test_update_frontmatter_handles_missing_or_malformed_frontmatter() {
    let inserted = update_frontmatter_content(
        "# Test\n\nSome content here.",
        "Status",
        Some(FrontmatterValue::String("Draft".to_string())),
    )
    .unwrap();
    assert!(inserted.starts_with("---\n"));
    assert!(inserted.contains("Status: Draft"));
    assert!(inserted.contains("# Test"));

    let malformed = update_frontmatter_content(
        "---\nStatus: Draft\nNo closing fence here",
        "Status",
        Some(FrontmatterValue::String("Active".to_string())),
    );
    assert!(malformed.is_err());
    assert!(malformed.unwrap_err().contains("Malformed frontmatter"));

    let unchanged =
        update_frontmatter_content("---\nStatus: Draft\n---\n# Test\n", "Missing", None).unwrap();
    assert_eq!(unchanged, "---\nStatus: Draft\n---\n# Test\n");

    let no_frontmatter =
        update_frontmatter_content("# Test\n\nSome content.", "Missing", None).unwrap();
    assert_eq!(no_frontmatter, "# Test\n\nSome content.");
}

#[test]
fn test_update_frontmatter_canonicalizes_system_metadata_keys() {
    let cases = [
        UpdateCase {
            content: "---\nicon: rocket\n---\n# Test\n",
            key: "icon",
            value: Some(FrontmatterValue::String("star".to_string())),
            expected_present: &["_icon: star"],
            expected_absent: &["\nicon:", "rocket"],
        },
        UpdateCase {
            content: "---\nsidebar label: Projects\nsidebar_label: Legacy\n---\n# Test\n",
            key: "_sidebar_label",
            value: Some(FrontmatterValue::String("Programs".to_string())),
            expected_present: &["_sidebar_label: Programs"],
            expected_absent: &["sidebar label: Projects", "sidebar_label: Legacy"],
        },
        UpdateCase {
            content: "---\nsort: modified:desc\n_sort: title:asc\n---\n# Test\n",
            key: "_sort",
            value: None,
            expected_present: &["# Test"],
            expected_absent: &["\nsort:", "\n_sort:"],
        },
    ];

    for case in cases {
        assert_updated_content(case);
    }
}

#[test]
fn test_update_frontmatter_canonicalizes_type_key_case() {
    let cases = [
        UpdateCase {
            content: "---\nType: Note\n---\n# Test\n",
            key: "type",
            value: Some(FrontmatterValue::String("Project".to_string())),
            expected_present: &["type: Project"],
            expected_absent: &["Type: Note"],
        },
        UpdateCase {
            content: "---\nTYPE: Note\n---\n# Test\n",
            key: "Type",
            value: Some(FrontmatterValue::String("Person".to_string())),
            expected_present: &["type: Person"],
            expected_absent: &["TYPE: Note"],
        },
        UpdateCase {
            content: "---\nType: Note\nstatus: Active\n---\n# Test\n",
            key: "type",
            value: None,
            expected_present: &["status: Active", "# Test"],
            expected_absent: &["Type: Note", "\ntype:"],
        },
    ];

    for case in cases {
        assert_updated_content(case);
    }
}
