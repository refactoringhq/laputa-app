use super::*;

fn text(value: &str) -> TextSlice<'_> {
    TextSlice(value)
}

// --- slug_to_title tests ---

#[test]
fn test_slug_to_title_basic() {
    assert_eq!(slug_to_title("career-tracks"), "Career Tracks");
}

#[test]
fn test_slug_to_title_single_word() {
    assert_eq!(slug_to_title("hello"), "Hello");
}

#[test]
fn test_slug_to_title_empty() {
    assert_eq!(slug_to_title(""), "");
}

#[test]
fn test_slug_to_title_e2e() {
    assert_eq!(slug_to_title("e2e-test"), "E2e Test");
}

#[test]
fn test_slug_to_title_multiple_hyphens() {
    assert_eq!(slug_to_title("a--b"), "A B");
}

// --- extract_h1_title tests ---

#[test]
fn test_extract_h1_title_basic() {
    assert_eq!(
        extract_h1_title("# Hello World\n\nBody."),
        Some("Hello World".to_string())
    );
}

#[test]
fn test_extract_h1_title_after_frontmatter() {
    let content = "---\ntype: Note\n---\n# My Note\n\nBody.";
    assert_eq!(extract_h1_title(content), Some("My Note".to_string()));
}

#[test]
fn test_extract_h1_title_with_empty_lines_before() {
    let content = "---\ntype: Note\n---\n\n# Spaced Title\n\nBody.";
    assert_eq!(extract_h1_title(content), Some("Spaced Title".to_string()));
}

#[test]
fn test_extract_h1_title_preserves_plain_square_brackets() {
    let content = "# [26Q2] Tolaria MVP\n\nBody.";
    assert_eq!(
        extract_h1_title(content),
        Some("[26Q2] Tolaria MVP".to_string())
    );
}

#[test]
fn test_extract_h1_title_none_when_no_h1() {
    assert_eq!(extract_h1_title("Just body text."), None);
}

#[test]
fn test_extract_h1_title_none_when_h1_not_first() {
    assert_eq!(extract_h1_title("Some text\n# Not first\n"), None);
}

// --- extract_title tests ---

#[test]
fn test_extract_title_h1_takes_priority_over_frontmatter() {
    assert_eq!(
        extract_title(
            Some("FM Title"),
            "---\ntitle: FM Title\n---\n# H1 Title\n\nBody.",
            "note.md"
        ),
        "H1 Title"
    );
}

#[test]
fn test_extract_title_h1_when_no_frontmatter_title() {
    assert_eq!(
        extract_title(None, "# Hello World\n\nBody text.", "some-file.md"),
        "Hello World"
    );
}

#[test]
fn test_extract_title_h1_after_frontmatter() {
    let content = "---\nIs A: Note\n---\n# My Note\n\nBody.";
    assert_eq!(extract_title(None, content, "fallback.md"), "My Note");
}

#[test]
fn test_extract_title_frontmatter_when_no_h1() {
    assert_eq!(
        extract_title(Some("My Great Note"), "Just body text.", "my-great-note.md"),
        "My Great Note"
    );
}

#[test]
fn test_extract_title_fallback_to_filename() {
    assert_eq!(
        extract_title(None, "", "fallback-title.md"),
        "Fallback Title"
    );
}

#[test]
fn test_extract_title_h1_wins_over_empty_frontmatter() {
    assert_eq!(
        extract_title(Some(""), "# From H1\n", "empty-h1.md"),
        "From H1"
    );
}

#[test]
fn test_extract_title_empty_fm_no_h1_falls_back_to_filename() {
    assert_eq!(
        extract_title(Some(""), "No heading here.", "empty-h1.md"),
        "Empty H1"
    );
}

// --- extract_snippet tests ---

#[test]
fn test_extract_snippet_basic() {
    let content = "---\nIs A: Note\n---\n# My Note\n\nThis is the first paragraph of content.\n\n## Section Two\n\nMore content here.";
    let snippet = extract_snippet(content);
    assert!(snippet.starts_with("This is the first paragraph"));
    assert!(snippet.contains("More content here"));
}

#[test]
fn test_extract_snippet_strips_markdown() {
    let content = "# Title\n\nSome **bold** and *italic* and `code` text.";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Some bold and italic and code text.");
}

#[test]
fn test_extract_snippet_strips_links() {
    let content = "# Title\n\nSee [this link](https://example.com) and [[wiki link]].";
    let snippet = extract_snippet(content);
    assert!(snippet.contains("this link"));
    assert!(!snippet.contains("https://example.com"));
    assert!(snippet.contains("wiki link"));
    assert!(!snippet.contains("[["));
    assert!(!snippet.contains("]]"));
}

#[test]
fn test_extract_snippet_wikilink_alias() {
    let content = "# Title\n\nDiscussed in [[meetings/standup|standup]] today.";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Discussed in standup today.");
}

#[test]
fn test_extract_snippet_truncates() {
    let long_content = format!("# Title\n\n{}", "word ".repeat(100));
    let snippet = extract_snippet(&long_content);
    assert!(snippet.len() <= 165); // 160 + "..."
    assert!(snippet.ends_with("..."));
}

#[test]
fn test_extract_snippet_no_content() {
    let content = "---\nIs A: Note\n---\n# Just a Title\n";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "");
}

#[test]
fn test_extract_snippet_code_fence_delimiters_skipped() {
    let content = "# Title\n\n```rust\nfn main() {}\n```\n\nReal content here.";
    let snippet = extract_snippet(content);
    assert!(!snippet.contains("```"));
    assert!(snippet.contains("Real content here"));
}

#[test]
fn test_extract_snippet_only_headings_uses_fallback() {
    let content = "# Title\n\n## Section One\n\n### Sub Section\n";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Section One Sub Section");
}

#[test]
fn test_extract_snippet_no_frontmatter_no_h1() {
    let content = "Just plain text content without any heading.";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Just plain text content without any heading.");
}

#[test]
fn test_extract_snippet_unclosed_frontmatter() {
    let content = "---\nIs A: Note\nThis has no closing fence\n# Title\n\nBody text.";
    let snippet = extract_snippet(content);
    assert!(snippet.contains("Body text"));
}

#[test]
fn test_extract_snippet_horizontal_rules_skipped() {
    let content = "# Title\n\n---\n\nContent after rule.";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Content after rule.");
}

// --- strip_list_marker tests ---

#[test]
fn test_strip_list_marker_unordered() {
    assert_eq!(strip_list_marker(text("* Item one")), "Item one");
    assert_eq!(strip_list_marker(text("- Item two")), "Item two");
    assert_eq!(strip_list_marker(text("+ Item three")), "Item three");
}

#[test]
fn test_strip_list_marker_ordered() {
    assert_eq!(strip_list_marker(text("1. First item")), "First item");
    assert_eq!(strip_list_marker(text("10. Tenth item")), "Tenth item");
    assert_eq!(strip_list_marker(text("99. Large number")), "Large number");
}

#[test]
fn test_strip_list_marker_preserves_non_list() {
    assert_eq!(strip_list_marker(text("Regular text")), "Regular text");
    assert_eq!(strip_list_marker(text("  Indented text")), "Indented text");
}

#[test]
fn test_extract_snippet_strips_list_markers() {
    let content =
        "---\ntype: Project\n---\n# My Project\n\n* First bullet\n* Second bullet\n- Dash item";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "First bullet Second bullet Dash item");
}

#[test]
fn test_extract_snippet_mixed_headings_and_bullets() {
    let content = "---\ntype: Project\nstatus: Active\n---\n# Migrate newsletter to Beehiiv\n\n### 1) Newsletter is 100% on Beehiiv\n\n* Migration is successful\n\n### 2) Open rate is >27%\n\n* No regressions on open rate";
    let snippet = extract_snippet(content);
    assert!(
        snippet.starts_with("Migration is successful"),
        "snippet should start with first bullet content, got: {}",
        snippet
    );
    assert!(snippet.contains("No regressions on open rate"));
}

#[test]
fn test_extract_snippet_ordered_list() {
    let content = "# Title\n\n1. First step\n2. Second step\n3. Third step";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "First step Second step Third step");
}

#[test]
fn test_extract_snippet_only_subheadings_fallback() {
    let content =
        "---\ntype: Project\n---\n# My Project\n\n## Description\n\n---\n\n## Key Results\n\n---\n";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Description Key Results");
}

#[test]
fn test_extract_snippet_subheadings_with_emoji() {
    let content = "# Daily\n\n## Intentions\n\n## Reflections\n";
    let snippet = extract_snippet(content);
    assert_eq!(snippet, "Intentions Reflections");
}

#[test]
fn test_extract_snippet_paragraph_takes_priority_over_headings() {
    let content = "# Title\n\n## Section One\n\nActual paragraph content.\n\n## Section Two\n";
    let snippet = extract_snippet(content);
    assert!(
        snippet.starts_with("Actual paragraph content"),
        "paragraph content should be preferred over headings, got: {}",
        snippet
    );
}

#[test]
fn test_extract_snippet_crlf_chinese_h1_table_content() {
    let content =
            "\r\n\r\n# 上海复盘\r\n\r\n| 指标 | 值 |\r\n| --- | --- |\r\n| 收入 | 增长 |\r\n\r\n正文包含中文字符。";
    let snippet = extract_snippet(content);

    assert!(snippet.contains("指标"));
    assert!(snippet.contains("正文包含中文字符"));
}

// --- count_body_words tests ---

#[test]
fn test_count_body_words_basic() {
    let content = "---\nIs A: Note\n---\n# My Note\n\nHello world, this is a test.";
    assert_eq!(count_body_words(content), 6);
}

#[test]
fn test_count_body_words_no_frontmatter() {
    let content = "# Title\n\nOne two three four five.";
    assert_eq!(count_body_words(content), 5);
}

#[test]
fn test_count_body_words_empty_body() {
    let content = "---\nIs A: Note\n---\n# Just a Title\n";
    assert_eq!(count_body_words(content), 0);
}

#[test]
fn test_count_body_words_no_content() {
    assert_eq!(count_body_words(""), 0);
}

#[test]
fn test_count_body_words_excludes_markdown_markers() {
    let content = "# Title\n\n## Section\n\nReal words here. ---\n\n> quote text";
    // "Real", "words", "here.", "quote", "text" = 5 real words
    // "##", "Section", "---", ">" are markdown markers (## is a heading, --- is a rule, > is blockquote)
    // "Section" passes the filter (not all markdown chars), so count includes it
    assert_eq!(count_body_words(content), 6);
}

#[test]
fn test_count_body_words_plain_text_only() {
    let content = "Just plain text without any heading.";
    assert_eq!(count_body_words(content), 6);
}

// --- strip_frontmatter tests ---

#[test]
fn test_strip_frontmatter_basic() {
    let content = "---\ntitle: Test\n---\nBody content.";
    assert_eq!(strip_frontmatter(text(content)), "Body content.");
}

#[test]
fn test_strip_frontmatter_no_frontmatter() {
    let content = "Just plain content.";
    assert_eq!(strip_frontmatter(text(content)), "Just plain content.");
}

#[test]
fn test_strip_frontmatter_dashes_in_value() {
    // The closing --- must be at line start, not inside a value
    let content = "---\ntitle: foo---bar\nstatus: active\n---\nBody here.";
    assert_eq!(strip_frontmatter(text(content)), "Body here.");
}

#[test]
fn test_strip_frontmatter_unclosed() {
    let content = "---\ntitle: Test\nNo closing fence";
    assert_eq!(strip_frontmatter(text(content)), content);
}

#[test]
fn test_strip_frontmatter_empty_body() {
    let content = "---\ntitle: Test\n---\n";
    assert_eq!(strip_frontmatter(text(content)), "");
}

#[test]
fn test_count_body_words_with_dashes_in_frontmatter_value() {
    // Regression: strip_frontmatter previously matched --- inside values
    let content = "---\ntitle: my---note\nstatus: active\n---\n# Title\n\nThree body words.";
    assert_eq!(count_body_words(content), 3);
}

// --- strip_markdown_chars tests ---

#[test]
fn test_strip_markdown_chars_plain_text() {
    assert_eq!(strip_markdown_chars(text("hello world")), "hello world");
}

#[test]
fn test_strip_markdown_chars_emphasis() {
    assert_eq!(
        strip_markdown_chars(text("**bold** and *italic*")),
        "bold and italic"
    );
}

#[test]
fn test_strip_markdown_chars_backticks() {
    assert_eq!(
        strip_markdown_chars(text("use `code` here")),
        "use code here"
    );
}

#[test]
fn test_strip_markdown_chars_strikethrough() {
    assert_eq!(strip_markdown_chars(text("~~deleted~~")), "deleted");
}

#[test]
fn test_strip_markdown_chars_link_with_url() {
    assert_eq!(
        strip_markdown_chars(text("[click here](https://example.com)")),
        "click here"
    );
}

#[test]
fn test_strip_markdown_chars_wikilink() {
    assert_eq!(strip_markdown_chars(text("see [[my note]]")), "see my note");
}

#[test]
fn test_strip_markdown_chars_wikilink_alias() {
    assert_eq!(
        strip_markdown_chars(text("visit [[project/alpha|Alpha Project]]")),
        "visit Alpha Project"
    );
}

#[test]
fn test_strip_markdown_chars_wikilink_unclosed() {
    assert_eq!(
        strip_markdown_chars(text("see [[broken link")),
        "see broken link"
    );
}

#[test]
fn test_strip_markdown_chars_bracket_without_url() {
    assert_eq!(
        strip_markdown_chars(text("[just brackets]")),
        "[just brackets]"
    );
}

#[test]
fn test_strip_markdown_chars_empty() {
    assert_eq!(strip_markdown_chars(text("")), "");
}

// --- without_h1_line tests ---

#[test]
fn test_without_h1_line_starts_with_h1() {
    let result = without_h1_line(text("# Title\nBody text"));
    assert!(result.is_some());
    assert_eq!(result.unwrap(), "Body text");
}

#[test]
fn test_without_h1_line_blank_lines_then_h1() {
    let result = without_h1_line(text("\n\n# Title\nBody"));
    assert!(result.is_some());
    assert_eq!(result.unwrap(), "Body");
}

#[test]
fn test_without_h1_line_non_heading_first() {
    let result = without_h1_line(text("Some text\n# Title\n"));
    assert!(result.is_none());
}

#[test]
fn test_without_h1_line_empty() {
    let result = without_h1_line(text(""));
    assert!(result.is_none());
}

#[test]
fn test_without_h1_line_only_blank_lines() {
    let result = without_h1_line(text("\n\n\n"));
    assert!(result.is_none());
}

// --- contains_wikilink tests ---

#[test]
fn test_contains_wikilink_true() {
    assert!(contains_wikilink("[[some note]]"));
    assert!(contains_wikilink("text before [[link]] text after"));
}

#[test]
fn test_contains_wikilink_false_plain_text() {
    assert!(!contains_wikilink("no links here"));
    assert!(!contains_wikilink("[single bracket]"));
}

#[test]
fn test_contains_wikilink_false_partial_markers() {
    assert!(!contains_wikilink("only [[ opening"));
    assert!(!contains_wikilink("only ]] closing"));
}

// --- extract_outgoing_links tests ---

#[test]
fn test_extract_outgoing_links_basic() {
    let content = "# Note\n\nSee [[Alice]] and [[Bob]] for details.";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["Alice", "Bob"]);
}

#[test]
fn test_extract_outgoing_links_pipe_syntax() {
    let content = "Link to [[project/alpha|Alpha Project]] here.";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["project/alpha"]);
}

#[test]
fn test_extract_outgoing_links_deduplicates() {
    let content = "See [[Alice]] and then [[Alice]] again.";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["Alice"]);
}

#[test]
fn test_extract_outgoing_links_sorted() {
    let content = "[[Zebra]] then [[Alpha]] then [[Middle]]";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["Alpha", "Middle", "Zebra"]);
}

#[test]
fn test_extract_outgoing_links_with_frontmatter() {
    let content = "---\nHas:\n  - \"[[task/design]]\"\n---\n# Note\n\nSee [[person/alice]].";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["person/alice", "task/design"]);
}

#[test]
fn test_extract_outgoing_links_empty_content() {
    assert!(extract_outgoing_links("").is_empty());
    assert!(extract_outgoing_links("No links here").is_empty());
}

#[test]
fn test_extract_outgoing_links_unclosed_bracket() {
    // First [[ matches with the only ]], yielding "unclosed and [[valid"
    let content = "[[unclosed and [[valid]]";
    let links = extract_outgoing_links(content);
    assert_eq!(links, vec!["unclosed and [[valid"]);
}

#[test]
fn extract_first_image_finds_markdown_image() {
    let content = "# Title\n\nSome text\n\n![photo](attachments/food.png)\n\nMore text";
    assert_eq!(
        extract_first_image(content),
        Some("attachments/food.png".to_string())
    );
}

#[test]
fn extract_first_image_finds_wikilink_embed() {
    let content = "# Title\n\n![[ramen.jpg]]\n\nText";
    assert_eq!(
        extract_first_image(content),
        Some("attachments/ramen.jpg".to_string())
    );
}

#[test]
fn extract_first_image_skips_non_image_links() {
    let content = "# Title\n\n[link](https://example.com)\n\n![[note-reference]]";
    assert_eq!(extract_first_image(content), None);
}

#[test]
fn extract_first_image_skips_frontmatter() {
    let content = "---\n_icon: icon.png\n---\n\n![real](photo.jpg)";
    assert_eq!(extract_first_image(content), Some("photo.jpg".to_string()));
}

#[test]
fn extract_first_image_returns_first_when_multiple() {
    let content = "# Title\n\n![first](a.png)\n\n![second](b.png)";
    assert_eq!(extract_first_image(content), Some("a.png".to_string()));
}

#[test]
fn extract_first_image_returns_none_when_no_images() {
    let content = "# Title\n\nJust text, no images.";
    assert_eq!(extract_first_image(content), None);
}

#[test]
fn extract_first_image_strips_wikilink_alias() {
    let content = "# Title\n\n![[photo.jpg|display text]]";
    assert_eq!(
        extract_first_image(content),
        Some("attachments/photo.jpg".to_string())
    );
}

#[test]
fn extract_first_image_preserves_explicit_wikilink_paths() {
    let content = "# Title\n\n![[images/photo.jpg]]";
    assert_eq!(
        extract_first_image(content),
        Some("images/photo.jpg".to_string())
    );
}

#[test]
fn extract_first_image_handles_url_title() {
    let content = "# Title\n\n![alt](photo.jpg \"A title\")";
    assert_eq!(extract_first_image(content), Some("photo.jpg".to_string()));
}

#[test]
fn extract_first_image_wikilink_before_markdown() {
    // Wikilink image appears before markdown image — should return wikilink
    let content = "# Title\n\n![[first.jpg]]\n\n![second](b.png)";
    assert_eq!(
        extract_first_image(content),
        Some("attachments/first.jpg".to_string())
    );
}

#[test]
fn extract_first_image_markdown_before_wikilink() {
    // Markdown image appears before wikilink image — should return markdown
    let content = "# Title\n\n![first](a.png)\n\n![[second.jpg]]";
    assert_eq!(extract_first_image(content), Some("a.png".to_string()));
}
