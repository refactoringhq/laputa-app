pub(crate) mod keys;
mod ops;
#[cfg(test)]
mod ops_update_tests;
mod yaml;

use std::fs;
use std::path::Path;

pub use ops::update_frontmatter_content;
pub use yaml::{format_yaml_key, FrontmatterValue};

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn validate_frontmatter_path(path: &str, file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !is_markdown_path(file_path) {
        return Err(format!(
            "Frontmatter can only be updated on Markdown notes: {}",
            path
        ));
    }

    Ok(())
}

/// Helper to read a file, apply a frontmatter transformation, and write back.
pub fn with_frontmatter<F>(path: &str, transform: F) -> Result<String, String>
where
    F: FnOnce(&str) -> Result<String, String>,
{
    let file_path = Path::new(path);
    validate_frontmatter_path(path, file_path)?;

    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let updated = transform(&content)?;

    fs::write(file_path, &updated).map_err(|e| format!("Failed to write {}: {}", path, e))?;

    Ok(updated)
}

/// Update a single frontmatter property in a markdown file.
pub fn update_frontmatter(
    path: &str,
    key: &str,
    value: FrontmatterValue,
) -> Result<String, String> {
    with_frontmatter(path, |content| {
        update_frontmatter_content(content, key, Some(value.clone()))
    })
}

/// Delete a frontmatter property from a markdown file.
pub fn delete_frontmatter_property(path: &str, key: &str) -> Result<String, String> {
    with_frontmatter(path, |content| {
        update_frontmatter_content(content, key, None)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_with_frontmatter_file_not_found() {
        let result = with_frontmatter("/nonexistent/path/file.md", |c| Ok(c.to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_update_frontmatter_rejects_binary_attachment_before_utf8_read() {
        let dir = tempfile::tempdir().unwrap();
        let attachment_dir = dir.path().join("attachments");
        fs::create_dir_all(&attachment_dir).unwrap();
        let attachment_path = attachment_dir.join("screenshot.png");
        fs::write(&attachment_path, [0xff, 0xfe, 0xfd]).unwrap();

        let err = update_frontmatter(
            attachment_path.to_str().unwrap(),
            "Status",
            FrontmatterValue::String("Done".to_string()),
        )
        .unwrap_err();

        assert!(err.contains("Frontmatter can only be updated on Markdown notes"));
        assert!(err.contains("screenshot.png"));
    }

    #[test]
    fn test_roundtrip_update_string() {
        let content = "---\nStatus: Draft\n---\n# Test\n";
        let updated = update_frontmatter_content(
            content,
            "Status",
            Some(FrontmatterValue::String("Active".to_string())),
        )
        .unwrap();
        let matter = gray_matter::Matter::<gray_matter::engine::YAML>::new();
        let parsed = matter.parse(&updated);
        let data = parsed.data.unwrap();
        if let gray_matter::Pod::Hash(map) = data {
            assert_eq!(map.get("Status").unwrap().as_string().unwrap(), "Active");
        } else {
            panic!("Expected hash");
        }
    }

    #[test]
    fn test_roundtrip_update_list() {
        let content = "---\nStatus: Draft\n---\n# Test\n";
        let updated = update_frontmatter_content(
            content,
            "aliases",
            Some(FrontmatterValue::List(vec![
                "A".to_string(),
                "B".to_string(),
            ])),
        )
        .unwrap();
        let matter = gray_matter::Matter::<gray_matter::engine::YAML>::new();
        let parsed = matter.parse(&updated);
        let data = parsed.data.unwrap();
        if let gray_matter::Pod::Hash(map) = data {
            let aliases = map.get("aliases").unwrap();
            if let gray_matter::Pod::Array(arr) = aliases {
                assert_eq!(arr.len(), 2);
                assert_eq!(arr[0].as_string().unwrap(), "A");
                assert_eq!(arr[1].as_string().unwrap(), "B");
            } else {
                panic!("Expected array");
            }
        } else {
            panic!("Expected hash");
        }
    }

    #[test]
    fn test_roundtrip_add_then_delete() {
        let content = "---\nStatus: Draft\n---\n# Test\n";
        let with_owner = update_frontmatter_content(
            content,
            "Owner",
            Some(FrontmatterValue::String("Luca".to_string())),
        )
        .unwrap();
        assert!(with_owner.contains("Owner: Luca"));
        let without_owner = update_frontmatter_content(&with_owner, "Owner", None).unwrap();
        assert!(!without_owner.contains("Owner"));
        assert!(without_owner.contains("Status: Draft"));
    }

    #[test]
    fn test_update_frontmatter_empty_block() {
        let content = "---\n---\n\n# Test\n";
        let result = update_frontmatter_content(
            content,
            "title",
            Some(FrontmatterValue::String("New Title".to_string())),
        );
        assert!(result.is_ok());
        assert!(result.unwrap().contains("title: New Title"));
    }

    #[test]
    fn test_update_frontmatter_block_scalar_writes_and_rewrites() {
        let cases = [
            (
                "---\ntype: Type\n---\n# Project\n",
                "## Objective\n\n## Timeline",
                &["template: |", "  ## Objective", "type: Type"][..],
                &[][..],
            ),
            (
                "---\ntype: Type\ntemplate: |\n  ## Old\n  \n  ## Stuff\ncolor: green\n---\n# Project\n",
                "## New\n\n## Content",
                &["  ## New", "color: green"][..],
                &["## Old"][..],
            ),
        ];

        for (content, template, expected_present, expected_absent) in cases {
            let updated = update_frontmatter_content(
                content,
                "template",
                Some(FrontmatterValue::String(template.to_string())),
            )
            .unwrap();
            for expected in expected_present {
                assert!(updated.contains(expected));
            }
            for unexpected in expected_absent {
                assert!(!updated.contains(unexpected));
            }
        }
    }

    #[test]
    fn test_delete_frontmatter_block_scalar() {
        let content =
            "---\ntype: Type\ntemplate: |\n  ## Heading\n  \n  ## Body\ncolor: green\n---\n# Project\n";
        let updated = update_frontmatter_content(content, "template", None).unwrap();
        assert!(!updated.contains("template"));
        assert!(updated.contains("color: green"));
    }

    #[test]
    fn test_update_frontmatter_no_body_after_closing() {
        let content = "---\ntitle: Old\n---\n";
        let updated = update_frontmatter_content(
            content,
            "title",
            Some(FrontmatterValue::String("New".to_string())),
        )
        .unwrap();
        assert!(updated.contains("title: New"));
        assert!(!updated.contains("title: Old"));
    }

    #[test]
    fn test_roundtrip_block_scalar() {
        let content = "---\ntype: Type\n---\n# Project\n";
        let template = "## Objective\n\nDescribe the goal.\n\n## Timeline\n\nKey dates.";
        let updated = update_frontmatter_content(
            content,
            "template",
            Some(FrontmatterValue::String(template.to_string())),
        )
        .unwrap();
        let matter = gray_matter::Matter::<gray_matter::engine::YAML>::new();
        let parsed = matter.parse(&updated);
        let data = parsed.data.unwrap();
        if let gray_matter::Pod::Hash(map) = data {
            let roundtripped = map.get("template").unwrap().as_string().unwrap();
            assert!(roundtripped.contains("## Objective"));
            assert!(roundtripped.contains("## Timeline"));
            assert!(roundtripped.contains("Describe the goal."));
        } else {
            panic!("Expected hash");
        }
    }
}
