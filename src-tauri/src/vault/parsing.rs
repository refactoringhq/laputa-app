//! Pure text-processing helpers for markdown content parsing.
//! Snippet extraction, markdown stripping, date parsing, and string utilities.

#[derive(Clone, Copy)]
struct TextSlice<'a>(&'a str);

impl<'a> TextSlice<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }
}

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
    let body = strip_frontmatter(TextSlice(content));
    let title =
        first_non_empty_line(TextSlice(body)).and_then(|line| markdown_h1_text(TextSlice(line)))?;
    let stripped = strip_markdown_chars(TextSlice(title));
    non_empty_trimmed(TextSlice(&stripped)).map(str::to_string)
}

fn non_empty_trimmed(value: TextSlice<'_>) -> Option<&str> {
    let trimmed = value.as_str().trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn first_non_empty_line(value: TextSlice<'_>) -> Option<&str> {
    value
        .as_str()
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
}

fn markdown_h1_text(line: TextSlice<'_>) -> Option<&str> {
    line.as_str()
        .strip_prefix("# ")
        .and_then(|text| non_empty_trimmed(TextSlice(text)))
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
fn strip_frontmatter(content: TextSlice<'_>) -> &str {
    let value = content.as_str();
    let Some(rest) = value.strip_prefix("---") else {
        return value;
    };
    // Find closing `---` at the start of a line (preceded by newline)
    match rest.find("\n---") {
        Some(end) => {
            let after = end + 4; // skip past "\n---"
            rest[after..].trim_start()
        }
        None => value,
    }
}

/// Check if a line is useful for snippet extraction (not blank, heading, code fence, or rule).
fn is_snippet_line(line: TextSlice<'_>) -> bool {
    let t = line.as_str().trim();
    !t.is_empty() && !t.starts_with('#') && !t.starts_with("```") && !t.starts_with("---")
}

/// Extract sub-heading text (## , ### , etc.) stripped of the `#` prefix.
fn extract_subheading_text(line: TextSlice<'_>) -> Option<&str> {
    let t = line.as_str().trim();
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
fn strip_list_marker(line: TextSlice<'_>) -> &str {
    let t = line.as_str().trim_start();
    strip_unordered_marker(TextSlice(t))
        .or_else(|| strip_ordered_marker(TextSlice(t)))
        .unwrap_or(t)
}

/// Strip unordered list markers: "* ", "- ", "+ "
fn strip_unordered_marker(s: TextSlice<'_>) -> Option<&str> {
    ["* ", "- ", "+ "]
        .iter()
        .find_map(|prefix| s.as_str().strip_prefix(prefix))
}

/// Strip ordered list markers: "1. ", "2. ", etc.
fn strip_ordered_marker(s: TextSlice<'_>) -> Option<&str> {
    let value = s.as_str();
    let dot_pos = value.find(". ")?;
    if dot_pos <= 3 && value[..dot_pos].chars().all(|c| c.is_ascii_digit()) {
        Some(&value[dot_pos + 2..])
    } else {
        None
    }
}

/// Truncate a string to `max_len` bytes at a valid UTF-8 boundary, appending "...".
fn truncate_with_ellipsis(s: TextSlice<'_>, max_len: usize) -> String {
    let value = s.as_str();
    if value.len() <= max_len {
        return value.to_string();
    }
    let mut idx = max_len;
    while idx > 0 && !value.is_char_boundary(idx) {
        idx -= 1;
    }
    format!("{}...", &value[..idx])
}

/// Count the number of words in the note body (excluding frontmatter and H1 title).
pub(super) fn count_body_words(content: &str) -> u32 {
    let without_fm = strip_frontmatter(TextSlice(content));
    let body = without_h1_line(TextSlice(without_fm)).unwrap_or(without_fm);
    body.split_whitespace()
        .filter(|w| {
            !w.chars()
                .all(|c| matches!(c, '#' | '*' | '_' | '`' | '~' | '-' | '>' | '|'))
        })
        .count() as u32
}

/// Extract a snippet: first ~160 chars of content after frontmatter/title, stripped of markdown.
pub(super) fn extract_snippet(content: &str) -> String {
    let without_fm = strip_frontmatter(TextSlice(content));
    let body = without_h1_line(TextSlice(without_fm)).unwrap_or(without_fm);
    let clean: String = body
        .lines()
        .filter(|line| is_snippet_line(TextSlice(line)))
        .map(|line| strip_list_marker(TextSlice(line)))
        .collect::<Vec<&str>>()
        .join(" ");
    let stripped = strip_markdown_chars(TextSlice(&clean));
    let trimmed = stripped.trim();
    if !trimmed.is_empty() {
        return truncate_with_ellipsis(TextSlice(trimmed), 160);
    }
    // Fallback: collect sub-heading text when no paragraph content exists
    let heading_text: String = body
        .lines()
        .filter_map(|line| extract_subheading_text(TextSlice(line)))
        .collect::<Vec<&str>>()
        .join(" ");
    let heading_trimmed = strip_markdown_chars(TextSlice(&heading_text));
    let heading_trimmed = heading_trimmed.trim();
    if heading_trimmed.is_empty() {
        return String::new();
    }
    truncate_with_ellipsis(TextSlice(heading_trimmed), 160)
}

fn without_h1_line(s: TextSlice<'_>) -> Option<&str> {
    let value = s.as_str();
    let mut offset = 0;
    for line in value.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']).trim();
        if trimmed.starts_with("# ") {
            return Some(&value[offset + line.len()..]);
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

fn strip_markdown_chars(s: TextSlice<'_>) -> String {
    let value = s.as_str();
    let mut result = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
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

/// Extract the first image path from markdown content.
/// Scans for both `![alt](path)` and `![[path]]` patterns in document order,
/// returning whichever appears first.
/// Markdown image paths are returned as-is. Bare wikilink image embeds are
/// treated as portable attachment paths, matching the frontend image resolver.
pub(super) fn extract_first_image(content: &str) -> Option<String> {
    let without_fm = strip_frontmatter(TextSlice(content));
    let body: &str = without_fm;
    let mut search_from = 0;

    while let Some(candidate) = next_image_candidate(body, search_from) {
        let extracted = match candidate.kind {
            ImageCandidateKind::Wikilink => extract_wikilink_image(body, candidate.pos),
            ImageCandidateKind::Markdown => extract_markdown_image(body, candidate.pos),
        };

        if let Some((image, _next_search_from)) = extracted.as_ref() {
            return Some(image.clone());
        }
        search_from = extracted.map_or(candidate.pos + 2, |(_, next_search_from)| next_search_from);
    }

    None
}

struct ImageCandidate {
    pos: usize,
    kind: ImageCandidateKind,
}

enum ImageCandidateKind {
    Markdown,
    Wikilink,
}

fn next_image_candidate(body: &str, search_from: usize) -> Option<ImageCandidate> {
    let md_pos = body[search_from..].find("![").map(|p| search_from + p);
    let wl_pos = body[search_from..].find("![[").map(|p| search_from + p);

    match (md_pos, wl_pos) {
        (Some(md), Some(wl)) if wl <= md => Some(ImageCandidate {
            pos: wl,
            kind: ImageCandidateKind::Wikilink,
        }),
        (Some(md), Some(_)) | (Some(md), None) => Some(ImageCandidate {
            pos: md,
            kind: ImageCandidateKind::Markdown,
        }),
        (None, Some(wl)) => Some(ImageCandidate {
            pos: wl,
            kind: ImageCandidateKind::Wikilink,
        }),
        (None, None) => None,
    }
}

fn extract_wikilink_image(body: &str, pos: usize) -> Option<(String, usize)> {
    let inner_start = pos + 3;
    let end = inner_start + body[inner_start..].find("]]")?;
    let inner = &body[inner_start..end];
    let target = inner.split('|').next().unwrap_or("").trim();

    is_image_path(target).then(|| (portable_wikilink_image_target(target), end + 2))
}

fn extract_markdown_image(body: &str, pos: usize) -> Option<(String, usize)> {
    let url_start = pos + body[pos..].find("](")? + 2;
    let paren_end = body[url_start..].find(')')?;
    let url = &body[url_start..url_start + paren_end];
    let path = url.split_whitespace().next().unwrap_or(url);

    is_image_path(path).then(|| (path.to_string(), pos + 2))
}

fn is_image_path(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "avif" | "bmp" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "tif" | "tiff" | "webp"
    )
}

fn portable_wikilink_image_target(target: &str) -> String {
    let has_url_scheme = target
        .chars()
        .next()
        .map(|first| first.is_ascii_alphabetic())
        .unwrap_or(false)
        && target
            .chars()
            .take_while(|ch| *ch != ':')
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '.' | '-'))
        && target.contains(':');
    let is_absolute = target.starts_with('/')
        || target.starts_with(r"\\")
        || target
            .get(1..3)
            .map(|rest| rest == ":/" || rest == r":\")
            .unwrap_or(false);
    let is_explicit = has_url_scheme
        || is_absolute
        || target.starts_with('.')
        || target.contains('/')
        || target.contains('\\');

    if is_explicit {
        target.to_string()
    } else {
        format!("attachments/{target}")
    }
}

#[cfg(test)]
#[path = "parsing_tests.rs"]
mod tests;
