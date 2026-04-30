//! Pure text-processing helpers for markdown content parsing.
//! Snippet extraction, markdown stripping, date parsing, and string utilities.

/// Derive a human-readable title from a filename stem (slug).
/// Converts hyphens to spaces and title-cases each word.
/// Example: `career-tracks-depend-on-company-shape` → `Career Tracks Depend on Company Shape`
pub(super) fn slug_to_title(stem: &str) -> String {
    stem.split('-')
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => {
                    let upper: String = c.to_uppercase().collect();
                    format!("{}{}", upper, chars.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extract the H1 title from the first non-empty line of the body (after frontmatter).
/// Returns `None` if no H1 is found on the first non-empty line.
pub(super) fn extract_h1_title(content: &str) -> Option<String> {
    let body = strip_frontmatter(content);
    let title = first_non_empty_line(body).and_then(markdown_h1_text)?;
    non_empty_trimmed(&strip_markdown_chars(title)).map(str::to_string)
}

fn non_empty_trimmed(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn first_non_empty_line(value: &str) -> Option<&str> {
    value.lines().map(str::trim).find(|line| !line.is_empty())
}

fn markdown_h1_text(line: &str) -> Option<&str> {
    line.strip_prefix("# ").and_then(non_empty_trimmed)
}

/// Extract the display title for a note.
/// Priority: H1 on first non-empty line → frontmatter `title:` → filename-derived title.
pub(super) fn extract_title(fm_title: Option<&str>, content: &str, filename: &str) -> String {
    // 1. H1 on first non-empty line of body
    if let Some(h1) = extract_h1_title(content) {
        return h1;
    }
    // 2. frontmatter title (legacy, backward compat)
    if let Some(title) = fm_title {
        if !title.is_empty() {
            return title.to_string();
        }
    }
    // 3. filename slug
    let stem = filename.strip_suffix(".md").unwrap_or(filename);
    slug_to_title(stem)
}

/// Remove YAML frontmatter (triple-dash delimited) from content.
/// The closing `---` must appear at the start of a line to avoid matching
/// occurrences inside frontmatter values (e.g. `title: foo---bar`).
fn strip_frontmatter(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("---") else {
        return content;
    };
    // Find closing `---` at the start of a line (preceded by newline)
    match rest.find("\n---") {
        Some(end) => {
            let after = end + 4; // skip past "\n---"
            rest[after..].trim_start()
        }
        None => content,
    }
}

/// Check if a line is useful for snippet extraction (not blank, heading, code fence, or rule).
fn is_snippet_line(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && !t.starts_with('#') && !t.starts_with("```") && !t.starts_with("---")
}

/// Extract sub-heading text (## , ### , etc.) stripped of the `#` prefix.
fn extract_subheading_text(line: &str) -> Option<&str> {
    let t = line.trim();
    let stripped = t.trim_start_matches('#');
    if stripped.len() < t.len() && stripped.starts_with(' ') {
        let text = stripped.trim();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

/// Strip leading list markers (*, -, +, 1.) from a line.
fn strip_list_marker(line: &str) -> &str {
    let t = line.trim_start();
    strip_unordered_marker(t)
        .or_else(|| strip_ordered_marker(t))
        .unwrap_or(t)
}

/// Strip unordered list markers: "* ", "- ", "+ "
fn strip_unordered_marker(s: &str) -> Option<&str> {
    ["* ", "- ", "+ "]
        .iter()
        .find_map(|prefix| s.strip_prefix(prefix))
}

/// Strip ordered list markers: "1. ", "2. ", etc.
fn strip_ordered_marker(s: &str) -> Option<&str> {
    let dot_pos = s.find(". ")?;
    if dot_pos <= 3 && s[..dot_pos].chars().all(|c| c.is_ascii_digit()) {
        Some(&s[dot_pos + 2..])
    } else {
        None
    }
}

/// Truncate a string to `max_len` bytes at a valid UTF-8 boundary, appending "...".
fn truncate_with_ellipsis(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    let mut idx = max_len;
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    format!("{}...", &s[..idx])
}

/// Count the number of words in the note body (excluding frontmatter and H1 title).
pub(super) fn count_body_words(content: &str) -> u32 {
    let without_fm = strip_frontmatter(content);
    let body = without_h1_line(without_fm).unwrap_or(without_fm);
    body.split_whitespace()
        .filter(|w| {
            !w.chars()
                .all(|c| matches!(c, '#' | '*' | '_' | '`' | '~' | '-' | '>' | '|'))
        })
        .count() as u32
}

/// Extract a snippet: first ~160 chars of content after frontmatter/title, stripped of markdown.
pub(super) fn extract_snippet(content: &str) -> String {
    let without_fm = strip_frontmatter(content);
    let body = without_h1_line(without_fm).unwrap_or(without_fm);
    let clean: String = body
        .lines()
        .filter(|line| is_snippet_line(line))
        .map(strip_list_marker)
        .collect::<Vec<&str>>()
        .join(" ");
    let stripped = strip_markdown_chars(&clean);
    let trimmed = stripped.trim();
    if !trimmed.is_empty() {
        return truncate_with_ellipsis(trimmed, 160);
    }
    // Fallback: collect sub-heading text when no paragraph content exists
    let heading_text: String = body
        .lines()
        .filter_map(extract_subheading_text)
        .collect::<Vec<&str>>()
        .join(" ");
    let heading_trimmed = strip_markdown_chars(&heading_text);
    let heading_trimmed = heading_trimmed.trim();
    if heading_trimmed.is_empty() {
        return String::new();
    }
    truncate_with_ellipsis(heading_trimmed, 160)
}

fn without_h1_line(s: &str) -> Option<&str> {
    let mut offset = 0;
    for line in s.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']).trim();
        if trimmed.starts_with("# ") {
            return Some(&s[offset + line.len()..]);
        }
        // If we hit non-empty non-heading content first, there's no H1 to skip
        if !trimmed.is_empty() {
            return None;
        }
        offset += line.len();
    }
    None
}

/// Collect chars until a delimiter, returning the collected string.
fn collect_until(chars: &mut impl Iterator<Item = char>, delimiter: char) -> String {
    let mut buf = String::new();
    for c in chars.by_ref() {
        if c == delimiter {
            break;
        }
        buf.push(c);
    }
    buf
}

/// Skip all chars until a delimiter (consuming the delimiter).
fn skip_until(chars: &mut impl Iterator<Item = char>, delimiter: char) {
    for c in chars.by_ref() {
        if c == delimiter {
            break;
        }
    }
}

/// Check if a char is markdown formatting that should be stripped.
fn is_markdown_formatting(ch: char) -> bool {
    matches!(ch, '*' | '_' | '`' | '~')
}

fn strip_markdown_chars(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '[' if chars.peek() == Some(&'[') => {
                process_wikilink(&mut chars, &mut result);
            }
            '[' => {
                process_markdown_link(&mut chars, &mut result);
            }
            c if is_markdown_formatting(c) => {}
            _ => result.push(ch),
        }
    }
    result
}

/// Process a wikilink `[[...]]` or `[[...|display]]`, extracting the display text.
fn process_wikilink(
    chars: &mut std::iter::Peekable<impl Iterator<Item = char>>,
    result: &mut String,
) {
    chars.next(); // consume second '['
    let inner = collect_wikilink_inner(chars);
    let display_text = extract_wikilink_display(&inner);
    result.push_str(display_text);
}

/// Extract display text from wikilink inner content.
/// Returns the part after '|' if present, otherwise the whole inner text.
fn extract_wikilink_display(inner: &str) -> &str {
    inner.find('|').map_or(inner, |idx| &inner[idx + 1..])
}

/// Process bracketed text.
/// Real markdown links `[text](url)` are unwrapped to `text`.
/// Plain bracketed text `[text]` is preserved verbatim.
fn process_markdown_link(
    chars: &mut std::iter::Peekable<impl Iterator<Item = char>>,
    result: &mut String,
) {
    let inner = collect_until(chars, ']');
    if chars.peek() == Some(&'(') {
        chars.next();
        skip_until(chars, ')');
        result.push_str(&inner);
        return;
    }

    result.push('[');
    result.push_str(&inner);
    result.push(']');
}

/// Collect chars inside a wikilink until `]]`, consuming both closing brackets.
fn collect_wikilink_inner(chars: &mut std::iter::Peekable<impl Iterator<Item = char>>) -> String {
    let mut buf = String::new();
    while let Some(c) = chars.next() {
        if c == ']' && chars.peek() == Some(&']') {
            chars.next();
            break;
        }
        buf.push(c);
    }
    buf
}

/// Check if a string contains a wikilink pattern `[[...]]`.
pub(super) fn contains_wikilink(s: &str) -> bool {
    s.contains("[[") && s.contains("]]")
}

/// Extract all outgoing wikilink targets from content.
/// Finds `[[target]]` and `[[target|display]]` patterns, returning just the target part.
/// Returns a sorted, deduplicated Vec of targets.
pub(super) fn extract_outgoing_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut search_from = 0;
    let bytes = content.as_bytes();
    while search_from + 3 < bytes.len() {
        let Some(start) = content[search_from..].find("[[") else {
            break;
        };
        let abs_start = search_from + start + 2;
        let Some(end) = content[abs_start..].find("]]") else {
            break;
        };
        let inner = &content[abs_start..abs_start + end];
        let target = match inner.find('|') {
            Some(idx) => &inner[..idx],
            None => inner,
        };
        if !target.is_empty() {
            links.push(target.to_string());
        }
        search_from = abs_start + end + 2;
    }
    links.sort();
    links.dedup();
    links
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(strip_list_marker("* Item one"), "Item one");
        assert_eq!(strip_list_marker("- Item two"), "Item two");
        assert_eq!(strip_list_marker("+ Item three"), "Item three");
    }

    #[test]
    fn test_strip_list_marker_ordered() {
        assert_eq!(strip_list_marker("1. First item"), "First item");
        assert_eq!(strip_list_marker("10. Tenth item"), "Tenth item");
        assert_eq!(strip_list_marker("99. Large number"), "Large number");
    }

    #[test]
    fn test_strip_list_marker_preserves_non_list() {
        assert_eq!(strip_list_marker("Regular text"), "Regular text");
        assert_eq!(strip_list_marker("  Indented text"), "Indented text");
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
        let content = "---\ntype: Project\n---\n# My Project\n\n## Description\n\n---\n\n## Key Results\n\n---\n";
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
        assert_eq!(strip_frontmatter(content), "Body content.");
    }

    #[test]
    fn test_strip_frontmatter_no_frontmatter() {
        let content = "Just plain content.";
        assert_eq!(strip_frontmatter(content), "Just plain content.");
    }

    #[test]
    fn test_strip_frontmatter_dashes_in_value() {
        // The closing --- must be at line start, not inside a value
        let content = "---\ntitle: foo---bar\nstatus: active\n---\nBody here.";
        assert_eq!(strip_frontmatter(content), "Body here.");
    }

    #[test]
    fn test_strip_frontmatter_unclosed() {
        let content = "---\ntitle: Test\nNo closing fence";
        assert_eq!(strip_frontmatter(content), content);
    }

    #[test]
    fn test_strip_frontmatter_empty_body() {
        let content = "---\ntitle: Test\n---\n";
        assert_eq!(strip_frontmatter(content), "");
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
        assert_eq!(strip_markdown_chars("hello world"), "hello world");
    }

    #[test]
    fn test_strip_markdown_chars_emphasis() {
        assert_eq!(
            strip_markdown_chars("**bold** and *italic*"),
            "bold and italic"
        );
    }

    #[test]
    fn test_strip_markdown_chars_backticks() {
        assert_eq!(strip_markdown_chars("use `code` here"), "use code here");
    }

    #[test]
    fn test_strip_markdown_chars_strikethrough() {
        assert_eq!(strip_markdown_chars("~~deleted~~"), "deleted");
    }

    #[test]
    fn test_strip_markdown_chars_link_with_url() {
        assert_eq!(
            strip_markdown_chars("[click here](https://example.com)"),
            "click here"
        );
    }

    #[test]
    fn test_strip_markdown_chars_wikilink() {
        assert_eq!(strip_markdown_chars("see [[my note]]"), "see my note");
    }

    #[test]
    fn test_strip_markdown_chars_wikilink_alias() {
        assert_eq!(
            strip_markdown_chars("visit [[project/alpha|Alpha Project]]"),
            "visit Alpha Project"
        );
    }

    #[test]
    fn test_strip_markdown_chars_wikilink_unclosed() {
        assert_eq!(strip_markdown_chars("see [[broken link"), "see broken link");
    }

    #[test]
    fn test_strip_markdown_chars_bracket_without_url() {
        assert_eq!(strip_markdown_chars("[just brackets]"), "[just brackets]");
    }

    #[test]
    fn test_strip_markdown_chars_empty() {
        assert_eq!(strip_markdown_chars(""), "");
    }

    // --- without_h1_line tests ---

    #[test]
    fn test_without_h1_line_starts_with_h1() {
        let result = without_h1_line("# Title\nBody text");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "Body text");
    }

    #[test]
    fn test_without_h1_line_blank_lines_then_h1() {
        let result = without_h1_line("\n\n# Title\nBody");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "Body");
    }

    #[test]
    fn test_without_h1_line_non_heading_first() {
        let result = without_h1_line("Some text\n# Title\n");
        assert!(result.is_none());
    }

    #[test]
    fn test_without_h1_line_empty() {
        let result = without_h1_line("");
        assert!(result.is_none());
    }

    #[test]
    fn test_without_h1_line_only_blank_lines() {
        let result = without_h1_line("\n\n\n");
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
}
