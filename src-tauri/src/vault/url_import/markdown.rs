use super::frontmatter::frontmatter_scalar;
use super::normalize_page_url;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Url;

static CURL_MD_FOOTER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)\n?---\s*\n\s*Powered by \[curl\.md\]\(https://curl\.md\)\s*$").unwrap()
});

pub(super) struct ParsedConvertedMarkdown {
    pub title: Option<String>,
    pub url: Option<Url>,
    pub body: String,
}

#[derive(Clone, Copy)]
struct MarkdownFence {
    marker: char,
    len: usize,
}

pub(super) fn parse_converted_markdown(content: &str) -> ParsedConvertedMarkdown {
    let (frontmatter, body) = split_leading_frontmatter(content);
    let title = frontmatter
        .as_deref()
        .and_then(|fm| frontmatter_scalar(fm, "title"))
        .or_else(|| extract_first_h1(body));
    let url = frontmatter
        .as_deref()
        .and_then(|fm| frontmatter_scalar(fm, "url"))
        .and_then(|candidate| normalize_page_url(&candidate).ok());
    let body = strip_curl_md_footer(body).trim().to_string();

    ParsedConvertedMarkdown { title, url, body }
}

fn split_leading_frontmatter(content: &str) -> (Option<String>, &str) {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, content);
    }

    let mut frontmatter = Vec::new();
    let mut body_start = 0;
    let mut consumed_first_line = false;
    for line in content.split_inclusive('\n') {
        if !consumed_first_line {
            consumed_first_line = true;
            body_start += line.len();
            continue;
        }
        if line.trim() == "---" {
            body_start += line.len();
            return (Some(frontmatter.join("\n")), &content[body_start..]);
        }
        frontmatter.push(line.trim_end_matches('\n').to_string());
        body_start += line.len();
    }

    (None, content)
}

fn strip_curl_md_footer(body: &str) -> String {
    CURL_MD_FOOTER_RE.replace(body, "").to_string()
}

fn extract_first_h1(markdown: &str) -> Option<String> {
    let mut fence = None;
    for line in markdown.lines() {
        let in_fence = fence.is_some();
        let title = (!in_fence)
            .then(|| {
                line.trim()
                    .strip_prefix("# ")
                    .map(str::trim)
                    .filter(|title| !title.is_empty())
                    .map(ToOwned::to_owned)
            })
            .flatten();
        update_markdown_fence_state(line, &mut fence);
        if title.is_some() {
            return title;
        }
    }
    None
}

pub(super) fn ensure_single_primary_h1(markdown: &str, title: &str) -> String {
    let lines = markdown.lines().collect::<Vec<_>>();
    let normalized = if starts_with_primary_h1(&lines) {
        normalize_existing_primary_h1(lines)
    } else {
        normalize_with_inserted_h1(lines, title)
    };
    format!("{}\n", normalized.join("\n").trim_end())
}

fn starts_with_primary_h1(lines: &[&str]) -> bool {
    first_non_fenced_content_index(lines)
        .and_then(|index| lines.get(index))
        .is_some_and(|line| is_markdown_h1(line))
}

fn normalize_existing_primary_h1(lines: Vec<&str>) -> Vec<String> {
    let mut primary_seen = false;
    let mut normalized = Vec::new();
    let mut fence = None;

    for line in lines {
        let in_fence = fence.is_some();
        if !in_fence && is_markdown_h1(line) {
            if primary_seen {
                normalized.push(demote_h1_line(line));
            } else {
                primary_seen = true;
                normalized.push(line.to_string());
            }
        } else {
            normalized.push(line.to_string());
        }
        update_markdown_fence_state(line, &mut fence);
    }
    normalized
}

fn normalize_with_inserted_h1(lines: Vec<&str>, title: &str) -> Vec<String> {
    let mut normalized = vec![format!("# {}", title.trim()), String::new()];
    let mut fence = None;

    for line in lines {
        let in_fence = fence.is_some();
        if !in_fence && is_markdown_h1(line) {
            normalized.push(demote_h1_line(line));
        } else {
            normalized.push(line.to_string());
        }
        update_markdown_fence_state(line, &mut fence);
    }
    normalized
}

fn first_non_fenced_content_index(lines: &[&str]) -> Option<usize> {
    let mut fence = None;
    lines.iter().enumerate().find_map(|(index, line)| {
        let in_fence = fence.is_some();
        let has_content = !in_fence && !line.trim().is_empty();
        update_markdown_fence_state(line, &mut fence);
        has_content.then_some(index)
    })
}

fn is_markdown_h1(line: &str) -> bool {
    line.trim_start().starts_with("# ")
}

fn demote_h1_line(line: &str) -> String {
    let heading_offset = line.find('#').unwrap_or(0);
    format!("{}#{}", &line[..heading_offset], &line[heading_offset..])
}

fn update_markdown_fence_state(line: &str, fence: &mut Option<MarkdownFence>) {
    match *fence {
        Some(active) if is_closing_markdown_fence(line, active) => *fence = None,
        Some(_) => {}
        None => *fence = opening_markdown_fence(line),
    }
}

pub(super) fn fenced_code_ranges(markdown: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut fence = None;
    let mut fence_start = 0;
    let mut offset = 0;

    for line in markdown.split_inclusive('\n') {
        if let Some(active) = fence {
            if is_closing_markdown_fence(line, active) {
                ranges.push((fence_start, offset + line.len()));
                fence = None;
            }
        } else if let Some(opening) = opening_markdown_fence(line) {
            fence_start = offset;
            fence = Some(opening);
        }
        offset += line.len();
    }

    if fence.is_some() {
        ranges.push((fence_start, markdown.len()));
    }
    ranges
}

fn opening_markdown_fence(line: &str) -> Option<MarkdownFence> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let len = trimmed
        .chars()
        .take_while(|candidate| *candidate == marker)
        .count();
    (len >= 3).then_some(MarkdownFence { marker, len })
}

fn is_closing_markdown_fence(line: &str, fence: MarkdownFence) -> bool {
    let trimmed = line.trim_start();
    let len = trimmed
        .chars()
        .take_while(|candidate| *candidate == fence.marker)
        .count();
    len >= fence.len
}

pub(super) fn title_from_url(url: &Url) -> String {
    url.path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
        .map(|segment| segment.replace(['-', '_'], " "))
        .filter(|segment| !segment.trim().is_empty())
        .unwrap_or_else(|| {
            url.host_str()
                .unwrap_or("Imported page")
                .replace("www.", "")
        })
}

pub(super) fn title_to_slug(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-");
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}
