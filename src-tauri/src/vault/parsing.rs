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

/// Check if a line is useful for snippet extraction (not blank, heading, code fence, rule, or table separator).
fn is_snippet_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') || t.starts_with("```") || t.starts_with("---") {
        return false;
    }
    !is_pipe_table_separator(t)
}

/// Detect a GFM pipe-table separator row, e.g. `| --- | :---: | ---: |`.
/// Requires at least one `|` so plain horizontal rules (`---`) are not classified as table separators.
fn is_pipe_table_separator(line: &str) -> bool {
    if !line.contains('|') {
        return false;
    }
    let trimmed = line.trim_matches('|').trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed
        .split('|')
        .map(str::trim)
        .all(is_pipe_table_separator_cell)
}

fn is_pipe_table_separator_cell(cell: &str) -> bool {
    let stripped = cell.trim_matches(':');
    !stripped.is_empty() && stripped.chars().all(|c| c == '-')
}

fn looks_like_pipe_table_row(line: &str) -> bool {
    line.starts_with('|') && line.ends_with('|') && line.len() >= 2
}

fn line_starts_html_table(line: &str) -> bool {
    let lower = line.trim_start().to_ascii_lowercase();
    lower.starts_with("<table") && (lower.as_bytes().get(6).is_some_and(|c| !c.is_ascii_alphanumeric()))
}

fn line_ends_html_table(line: &str) -> bool {
    line.to_ascii_lowercase().contains("</table>")
}

/// Walk the body line-by-line. Drop heading/code-fence/rule/empty lines. Replace any
/// table block (HTML or GFM pipe) with a `📊 col1 · col2 · …` marker built from the
/// header row (≤ 80 chars). Preserve surrounding prose verbatim.
fn collapse_table_blocks_in_body(body: &str) -> String {
    let mut walker = SnippetWalker::default();
    for line in body.lines() {
        walker.visit(line);
    }
    walker.finish()
}

#[derive(Default)]
struct SnippetWalker {
    parts: Vec<String>,
    inside_html_table: bool,
    html_table_buffer: Vec<String>,
    inside_pipe_table: bool,
}

impl SnippetWalker {
    fn visit(&mut self, line: &str) {
        if self.inside_html_table {
            self.visit_html_continuation(line);
            return;
        }
        let trimmed = line.trim();
        if line_starts_html_table(trimmed) {
            self.start_html_table(trimmed);
            return;
        }
        if looks_like_pipe_table_row(trimmed) || is_pipe_table_separator(trimmed) {
            self.visit_pipe_table_line(trimmed);
            return;
        }
        self.visit_prose_line(line, trimmed);
    }

    fn visit_html_continuation(&mut self, line: &str) {
        self.html_table_buffer.push(line.to_string());
        if !line_ends_html_table(line) {
            return;
        }
        self.flush_html_table();
    }

    fn start_html_table(&mut self, trimmed: &str) {
        self.inside_pipe_table = false;
        self.html_table_buffer.clear();
        self.html_table_buffer.push(trimmed.to_string());
        if line_ends_html_table(trimmed) {
            self.flush_html_table();
            return;
        }
        self.inside_html_table = true;
    }

    fn flush_html_table(&mut self) {
        let html = self.html_table_buffer.join("\n");
        let cells = html_table_header_cells(&html);
        self.parts.push(format_table_marker(&cells));
        self.html_table_buffer.clear();
        self.inside_html_table = false;
    }

    fn visit_pipe_table_line(&mut self, trimmed: &str) {
        if self.inside_pipe_table {
            return;
        }
        if is_pipe_table_separator(trimmed) {
            self.parts.push(TABLE_SNIPPET_FALLBACK.to_string());
            self.inside_pipe_table = true;
            return;
        }
        let cells = pipe_table_cells(trimmed);
        self.parts.push(format_table_marker(&cells));
        self.inside_pipe_table = true;
    }

    fn visit_prose_line(&mut self, line: &str, trimmed: &str) {
        self.inside_pipe_table = false;
        if !is_snippet_line(line) || trimmed.is_empty() {
            return;
        }
        let stripped = strip_list_marker(line);
        let html_stripped = strip_html_tags(stripped);
        let clean = html_stripped.trim();
        if !clean.is_empty() {
            self.parts.push(clean.to_string());
        }
    }

    fn finish(self) -> String {
        join_snippet_parts(&self.parts)
    }
}

fn join_snippet_parts(parts: &[String]) -> String {
    let mut out = String::new();
    let mut prev_was_table = false;
    for part in parts {
        let is_table = part.starts_with(TABLE_MARKER_PREFIX) || part == TABLE_SNIPPET_FALLBACK;
        if out.is_empty() {
            out.push_str(part);
        } else if is_table || prev_was_table {
            out.push('\n');
            out.push_str(part);
        } else {
            out.push(' ');
            out.push_str(part);
        }
        prev_was_table = is_table;
    }
    out
}

fn pipe_table_cells(row: &str) -> Vec<String> {
    row.trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .filter(|cell| !cell.is_empty())
        .collect()
}

fn html_table_header_cells(html: &str) -> Vec<String> {
    let scope = extract_thead_or_html(html);
    let first_row = extract_first_tr(scope);
    extract_th_or_td_text(first_row)
}

fn extract_thead_or_html(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    let Some(open) = lower.find("<thead") else {
        return html;
    };
    let Some(open_end) = lower[open..].find('>').map(|i| open + i + 1) else {
        return html;
    };
    let Some(close) = lower[open_end..].find("</thead>").map(|i| open_end + i) else {
        return html;
    };
    &html[open_end..close]
}

fn extract_first_tr(scope: &str) -> &str {
    let lower = scope.to_ascii_lowercase();
    let Some(open) = lower.find("<tr") else {
        return "";
    };
    let Some(open_end) = lower[open..].find('>').map(|i| open + i + 1) else {
        return "";
    };
    let Some(close) = lower[open_end..].find("</tr>").map(|i| open_end + i) else {
        return "";
    };
    &scope[open_end..close]
}

fn extract_th_or_td_text(row: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut cursor = 0;
    let lower = row.to_ascii_lowercase();
    while cursor < row.len() {
        let Some(open_idx) = next_cell_open(&lower, cursor) else {
            break;
        };
        let Some(open_end) = lower[open_idx..].find('>').map(|i| open_idx + i + 1) else {
            break;
        };
        let Some(close_idx) = next_cell_close(&lower, open_end) else {
            break;
        };
        let raw = &row[open_end..close_idx];
        let cleaned = strip_html_tags(raw);
        let trimmed = cleaned.trim();
        if !trimmed.is_empty() {
            cells.push(trimmed.to_string());
        }
        cursor = close_idx + 1;
    }
    cells
}

fn next_cell_open(lower: &str, from: usize) -> Option<usize> {
    let th = lower[from..].find("<th").map(|i| from + i);
    let td = lower[from..].find("<td").map(|i| from + i);
    match (th, td) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    }
}

fn next_cell_close(lower: &str, from: usize) -> Option<usize> {
    let th = lower[from..].find("</th>").map(|i| from + i);
    let td = lower[from..].find("</td>").map(|i| from + i);
    match (th, td) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    }
}

fn format_table_marker(cells: &[String]) -> String {
    let cleaned: Vec<String> = cells
        .iter()
        .map(|cell| strip_html_tags(cell).trim().to_string())
        .filter(|cell| !cell.is_empty())
        .collect();
    if cleaned.is_empty() {
        return TABLE_SNIPPET_FALLBACK.to_string();
    }
    let joined = cleaned.join(TABLE_CELL_SEPARATOR);
    let truncated = truncate_header_text(&joined);
    format!("{}{}", TABLE_MARKER_PREFIX, truncated)
}

fn truncate_header_text(text: &str) -> String {
    if text.chars().count() <= TABLE_HEADER_PREVIEW_MAX {
        return text.to_string();
    }
    let mut buf = String::new();
    for (i, ch) in text.chars().enumerate() {
        if i >= TABLE_HEADER_PREVIEW_MAX - 1 {
            break;
        }
        buf.push(ch);
    }
    format!("{}…", buf.trim_end())
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

/// Placeholder emitted when a table block has no recoverable header cells.
pub(super) const TABLE_SNIPPET_FALLBACK: &str = "📊 Table";
const TABLE_HEADER_PREVIEW_MAX: usize = 80;
const TABLE_CELL_SEPARATOR: &str = " · ";
const TABLE_MARKER_PREFIX: &str = "📊 ";

/// Extract a snippet: first ~160 chars of content after frontmatter/title, stripped of markdown and inline HTML.
/// Table blocks (HTML `<table>` or GFM pipe) are replaced with a single `[Table]` placeholder.
pub(super) fn extract_snippet(content: &str) -> String {
    let without_fm = strip_frontmatter(content);
    let body = without_h1_line(without_fm).unwrap_or(without_fm);
    let clean = collapse_table_blocks_in_body(body);
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

/// Strip inline HTML tags from a snippet candidate.
/// Drops anything between `<` and the next `>` when the `<` is followed by
/// an ASCII letter or `/letter` (so legit text like `if x < y` is preserved).
/// Collapses runs of whitespace introduced by removed tags so the snippet
/// stays readable.
fn strip_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            if let Some(tag_len) = match_html_tag_len(bytes, i) {
                i += tag_len;
                continue;
            }
        }
        let ch_len = utf8_char_len(bytes[i]);
        result.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    collapse_whitespace(&result)
}

/// Return the byte length of an HTML tag starting at `start` (which must point
/// to `<`), or `None` if the chars don't look like a tag. A tag must start with
/// `<[A-Za-z]` or `</[A-Za-z]` and end at `>` on the same line.
fn match_html_tag_len(bytes: &[u8], start: usize) -> Option<usize> {
    let mut cursor = start + 1;
    if bytes.get(cursor) == Some(&b'/') {
        cursor += 1;
    }
    if !bytes.get(cursor).is_some_and(u8::is_ascii_alphabetic) {
        return None;
    }
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'>' => return Some(cursor - start + 1),
            b'\n' => return None,
            _ => cursor += 1,
        }
    }
    None
}

fn utf8_char_len(leading_byte: u8) -> usize {
    match leading_byte {
        0..=0x7F => 1,
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_was_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out
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
    fn test_extract_snippet_chinese_pipe_table_with_outro_uses_header_preview() {
        let content =
            "\r\n\r\n# 上海复盘\r\n\r\n| 指标 | 值 |\r\n| --- | --- |\r\n| 收入 | 增长 |\r\n\r\n正文包含中文字符。";
        let snippet = extract_snippet(content);

        assert!(snippet.contains("📊 指标 · 值"));
        assert!(snippet.contains("正文包含中文字符"));
        assert!(!snippet.contains('|'));
        assert!(snippet.contains('\n'));
    }

    // --- HTML table snippet tests (issue #452 follow-up) ---

    #[test]
    fn test_extract_snippet_replaces_html_table_with_thead_marker() {
        let content = "# Test\n\n<table>\n  <thead><tr><th>Bezeichnung</th><th>Format</th></tr></thead>\n  <tbody><tr><td>Dokumentennummer</td><td>an..35</td></tr></tbody>\n</table>";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "📊 Bezeichnung · Format");
    }

    #[test]
    fn test_extract_snippet_html_table_without_thead_uses_first_tr() {
        let content = "# T\n\n<table><tr><td>Alpha</td><td>Beta</td></tr><tr><td>1</td><td>2</td></tr></table>";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "📊 Alpha · Beta");
    }

    #[test]
    fn test_extract_snippet_html_table_with_surrounding_prose() {
        let content = "# Test\n\nIntro paragraph.\n\n<table><tr><th>x</th><th>y</th></tr></table>\n\nOutro paragraph.";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "Intro paragraph.\n📊 x · y\nOutro paragraph.");
    }

    #[test]
    fn test_extract_snippet_empty_html_table_falls_back_to_static_marker() {
        let content = "# T\n\n<table></table>";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, TABLE_SNIPPET_FALLBACK);
    }

    #[test]
    fn test_extract_snippet_strips_inline_html_tags() {
        let content = "# Title\n\nHello <span class=\"x\">world</span> and <em>everyone</em>.";
        let snippet = extract_snippet(content);

        assert!(!snippet.contains("<span"), "snippet retains <span>: {}", snippet);
        assert!(!snippet.contains("</span>"));
        assert!(!snippet.contains("<em>"));
        assert!(snippet.contains("Hello"));
        assert!(snippet.contains("world"));
        assert!(snippet.contains("everyone"));
    }

    #[test]
    fn test_extract_snippet_preserves_less_than_in_text() {
        let content = "# Title\n\nNote: when x < y the alarm triggers.";
        let snippet = extract_snippet(content);

        assert!(snippet.contains("x < y"), "literal `x < y` should survive: {}", snippet);
    }

    #[test]
    fn test_extract_snippet_handles_unclosed_html_tag_gracefully() {
        let content = "# Title\n\nText before <table without close, more text.";
        let snippet = extract_snippet(content);

        assert!(snippet.contains("Text before"));
        assert!(snippet.contains("more text"));
    }

    // --- GFM pipe-table snippet tests ---

    #[test]
    fn test_extract_snippet_pipe_table_uses_header_row_preview() {
        let content = "# Title\n\n| Bezeichnung | M/K | Format |\n| --- | --- | --- |\n| Doc | M | an..35 |";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "📊 Bezeichnung · M/K · Format");
        assert!(!snippet.contains('|'));
        assert!(!snippet.contains("---"));
    }

    #[test]
    fn test_extract_snippet_pipe_table_with_alignment_separator() {
        let content = "# Title\n\n| Name | Status |\n| :--- | ---: |\n| Alpha | Active |";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "📊 Name · Status");
    }

    #[test]
    fn test_extract_snippet_pipe_table_keeps_surrounding_prose_with_newline_separator() {
        let content = "# Title\n\nIntro text.\n\n| col |\n| --- |\n| val |\n\nOutro text.";
        let snippet = extract_snippet(content);

        assert_eq!(snippet, "Intro text.\n📊 col\nOutro text.");
    }

    #[test]
    fn test_extract_snippet_emits_only_one_marker_per_pipe_table() {
        let content = "# Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |";
        let snippet = extract_snippet(content);

        assert_eq!(snippet.matches(TABLE_MARKER_PREFIX).count(), 1);
    }

    #[test]
    fn test_truncate_header_text_caps_at_max_length() {
        let long = "abcdefghij".repeat(10); // 100 chars
        let truncated = truncate_header_text(&long);
        assert!(truncated.chars().count() <= TABLE_HEADER_PREVIEW_MAX);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn test_is_pipe_table_separator_recognises_dashed_rows() {
        assert!(is_pipe_table_separator("| --- | --- |"));
        assert!(is_pipe_table_separator("|---|---|"));
        assert!(is_pipe_table_separator("| :--- | ---: | :---: |"));
        assert!(!is_pipe_table_separator("| col1 | col2 |"));
        assert!(!is_pipe_table_separator("---"));
        assert!(!is_pipe_table_separator(""));
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
