use crate::vault::{invalidate_cache, reload_entry, VaultEntry};
use regex::Regex;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, LOCATION, RANGE};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

const CURL_MD_BASE: &str = "https://curl.md/";
const HTTP_TIMEOUT_SECS: u64 = 30;
const MAX_MEDIA_REDIRECTS: usize = 5;
const MAX_MEDIA_BYTES: u64 = 25 * 1024 * 1024;
const MAX_HTML_BYTES: usize = 1024 * 1024;

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tif", "tiff", "ico", "avif", "mp3", "wav",
    "ogg", "m4a", "flac", "aac", "mp4", "webm", "mov", "m4v",
];

const SUPPORTED_ICON_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeInstanceDefault {
    pub key: String,
    pub value: Value,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNoteFromUrlResult {
    pub entry: VaultEntry,
    pub content: String,
    pub saved_media_count: usize,
    pub skipped_media_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CurlMdResponse {
    content: Option<String>,
    markdown: Option<String>,
    title: Option<String>,
    url: Option<String>,
}

#[derive(Debug)]
struct ConvertedDocument {
    title: String,
    url: Url,
    body: String,
}

#[derive(Debug, PartialEq)]
struct MediaReference {
    destination_start: usize,
    destination_end: usize,
    destination: String,
    kind: MediaReferenceKind,
}

#[derive(Debug, PartialEq)]
enum MediaReferenceKind {
    HtmlMediaSrc,
    MarkdownImage,
    MarkdownMediaLink,
}

#[derive(Debug, PartialEq)]
struct MediaRewriteResult {
    markdown: String,
    saved_count: usize,
    skipped_count: usize,
    warnings: Vec<String>,
}

#[derive(Clone, Copy)]
struct MarkdownFence {
    marker: char,
    len: usize,
}

pub fn import_note_from_url(
    vault_path: &Path,
    url: &str,
    note_type: &str,
    type_defaults: Vec<TypeInstanceDefault>,
) -> Result<ImportNoteFromUrlResult, String> {
    let client = http_client()?;
    let media_client = http_client_without_redirects()?;
    let page_url = normalize_page_url(url)?;
    let converted = fetch_converted_document(&client, &page_url)?;
    let icon = discover_favicon_url(&client, &media_client, &converted.url);
    let slug = title_to_slug(&converted.title);
    let media = rewrite_markdown_media_with(&converted.body, &converted.url, |media_url, index| {
        save_remote_media(
            &media_client,
            vault_path,
            &slug,
            index,
            &converted.url,
            media_url,
        )
    });
    let content = build_note_content(
        note_type,
        converted.url.as_str(),
        icon.as_deref(),
        &type_defaults,
        &media.markdown,
    );
    let note_path = unique_note_path(vault_path, &slug);
    fs::write(&note_path, &content)
        .map_err(|error| format!("Failed to write imported note: {error}"))?;
    invalidate_cache(vault_path);
    let entry = reload_entry(&note_path)?;

    Ok(ImportNoteFromUrlResult {
        entry,
        content,
        saved_media_count: media.saved_count,
        skipped_media_count: media.skipped_count,
        warnings: media.warnings,
    })
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent(format!("Tolaria/{} URL Import", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Failed to create URL import client: {error}"))
}

fn http_client_without_redirects() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent(format!("Tolaria/{} URL Import", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to create URL import client: {error}"))
}

fn normalize_page_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return Err("Enter a valid web URL".to_string());
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if is_bare_domain_url(trimmed) {
        format!("https://{trimmed}")
    } else {
        trimmed.to_string()
    };

    let parsed = Url::parse(&candidate).map_err(|_| "Enter a valid web URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Ok(parsed),
        _ => Err("Only HTTP and HTTPS URLs can be imported".to_string()),
    }
}

fn is_bare_domain_url(value: &str) -> bool {
    if value.contains("://") {
        return false;
    }

    let host = value.split(['/', '?', '#']).next().unwrap_or_default();
    let labels = host.split('.').collect::<Vec<_>>();
    if labels.len() < 2 || labels.last().map_or(true, |label| label.len() < 2) {
        return false;
    }

    labels.iter().all(|label| {
        !label.is_empty()
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && label
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && label
                .chars()
                .last()
                .is_some_and(|c| c.is_ascii_alphanumeric())
    })
}

fn fetch_converted_document(client: &Client, page_url: &Url) -> Result<ConvertedDocument, String> {
    let curl_url = format!("{CURL_MD_BASE}{}", page_url.as_str());
    let response = client
        .get(curl_url)
        .header(ACCEPT, "application/json")
        .send()
        .map_err(|error| format!("Failed to fetch Markdown from curl.md: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("curl.md returned {status}"));
    }

    let text = response
        .text()
        .map_err(|error| format!("Failed to read curl.md response: {error}"))?;
    let payload = parse_curl_md_response(&text)?;
    let content = payload
        .content
        .or(payload.markdown)
        .ok_or_else(|| "curl.md did not return Markdown content".to_string())?;
    let parsed = parse_converted_markdown(&content);
    let canonical_url = payload
        .url
        .as_deref()
        .and_then(|candidate| normalize_page_url(candidate).ok())
        .or(parsed.url)
        .unwrap_or_else(|| page_url.clone());
    let title = payload
        .title
        .or(parsed.title)
        .unwrap_or_else(|| title_from_url(&canonical_url));
    let body = ensure_single_primary_h1(&parsed.body, &title);

    Ok(ConvertedDocument {
        title,
        url: canonical_url,
        body,
    })
}

fn parse_curl_md_response(text: &str) -> Result<CurlMdResponse, String> {
    match serde_json::from_str::<CurlMdResponse>(text) {
        Ok(payload) => Ok(payload),
        Err(_) if !text.trim().is_empty() => Ok(CurlMdResponse {
            content: Some(text.to_string()),
            markdown: None,
            title: None,
            url: None,
        }),
        Err(error) => Err(format!("Failed to parse curl.md response: {error}")),
    }
}

struct ParsedConvertedMarkdown {
    title: Option<String>,
    url: Option<Url>,
    body: String,
}

fn parse_converted_markdown(content: &str) -> ParsedConvertedMarkdown {
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

fn frontmatter_scalar(frontmatter: &str, key: &str) -> Option<String> {
    let mapping = serde_yaml::from_str::<serde_yaml::Mapping>(frontmatter).ok()?;
    mapping.into_iter().find_map(|(candidate_key, value)| {
        let candidate = candidate_key.as_str()?;
        if canonical_frontmatter_key(candidate) != canonical_frontmatter_key(key) {
            return None;
        }
        value.as_str().map(|scalar| scalar.trim().to_string())
    })
}

fn strip_curl_md_footer(body: &str) -> String {
    let footer = Regex::new(r"(?s)\n?---\s*\n\s*Powered by \[curl\.md\]\(https://curl\.md\)\s*$")
        .expect("curl.md footer regex should compile");
    footer.replace(body, "").to_string()
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

fn ensure_single_primary_h1(markdown: &str, title: &str) -> String {
    let mut lines = markdown.lines().collect::<Vec<_>>();
    let first_content_index = first_non_fenced_content_index(&lines);
    let mut primary_seen = false;
    let mut normalized = Vec::new();
    let mut fence = None;

    if first_content_index
        .and_then(|index| lines.get(index))
        .is_some_and(|line| is_markdown_h1(line))
    {
        for line in lines.drain(..) {
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
    } else {
        normalized.push(format!("# {}", title.trim()));
        normalized.push(String::new());
        for line in lines.drain(..) {
            let in_fence = fence.is_some();
            if !in_fence && is_markdown_h1(line) {
                normalized.push(demote_h1_line(line));
            } else {
                normalized.push(line.to_string());
            }
            update_markdown_fence_state(line, &mut fence);
        }
    }

    format!("{}\n", normalized.join("\n").trim_end())
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

fn title_from_url(url: &Url) -> String {
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

fn title_to_slug(title: &str) -> String {
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

fn unique_note_path(vault_path: &Path, slug: &str) -> PathBuf {
    for suffix in 0.. {
        let stem = if suffix == 0 {
            slug.to_string()
        } else {
            format!("{slug}-{suffix}")
        };
        let candidate = vault_path.join(format!("{stem}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("unbounded suffix search should return a path")
}

fn build_note_content(
    note_type: &str,
    url: &str,
    icon: Option<&str>,
    defaults: &[TypeInstanceDefault],
    body: &str,
) -> String {
    let mut lines = vec![
        "---".to_string(),
        format!(
            "type: {}",
            format_yaml_scalar(&Value::String(note_type.trim().to_string()))
        ),
        format!("url: {url}"),
    ];
    if let Some(icon) = icon.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("icon: {icon}"));
    }
    append_type_defaults(&mut lines, defaults);
    lines.push("---".to_string());
    format!("{}\n\n{}", lines.join("\n"), body.trim_start())
}

fn append_type_defaults(lines: &mut Vec<String>, defaults: &[TypeInstanceDefault]) {
    let mut existing_keys = lines
        .iter()
        .filter_map(|line| {
            line.split_once(':')
                .map(|(key, _)| canonical_frontmatter_key(key))
        })
        .collect::<HashSet<_>>();
    existing_keys.insert("title".to_string());

    for default_value in defaults {
        let key = default_value.key.trim();
        if key.is_empty() || key.contains('\n') {
            continue;
        }
        let canonical_key = canonical_frontmatter_key(key);
        if existing_keys.contains(&canonical_key) {
            continue;
        }
        existing_keys.insert(canonical_key);

        if let Value::Array(values) = &default_value.value {
            lines.push(format!("{key}:"));
            for value in values {
                if let Some(scalar) = scalar_value(value) {
                    lines.push(format!("  - {}", format_yaml_scalar(&scalar)));
                }
            }
        } else if let Some(scalar) = scalar_value(&default_value.value) {
            lines.push(format!("{key}: {}", format_yaml_scalar(&scalar)));
        }
    }
}

fn canonical_frontmatter_key(key: &str) -> String {
    let normalized = key
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_");
    match normalized.as_str() {
        "is_a" | "is_a:" => "type".to_string(),
        "_icon" => "icon".to_string(),
        _ => normalized,
    }
}

fn scalar_value(value: &Value) -> Option<Value> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(Value::String(value.clone())),
        Value::Number(_) | Value::Bool(_) => Some(value.clone()),
        _ => None,
    }
}

fn format_yaml_scalar(value: &Value) -> String {
    match value {
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) if should_quote_yaml_string(value) => {
            serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
        }
        Value::String(value) => value.clone(),
        _ => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()),
    }
}

fn should_quote_yaml_string(value: &str) -> bool {
    value.trim() != value
        || value.contains(':')
        || value.starts_with("[[") && value.ends_with("]]")
        || Regex::new(r"(?i)^(?:true|false|null|[-+]?\d+(?:\.\d+)?)$")
            .expect("YAML scalar regex should compile")
            .is_match(value)
}

fn rewrite_markdown_media_with<F>(
    markdown: &str,
    page_url: &Url,
    mut save_media: F,
) -> MediaRewriteResult
where
    F: FnMut(&Url, usize) -> Result<Option<String>, String>,
{
    let refs = media_references(markdown);
    let mut replacements = Vec::new();
    let mut saved_count = 0;
    let mut skipped_count = 0;
    let mut warnings = Vec::new();

    for (index, media_ref) in refs.iter().enumerate() {
        let destination = normalize_markdown_destination(&media_ref.destination);
        let Some(media_url) = resolve_media_url(page_url, &destination) else {
            skipped_count += 1;
            continue;
        };
        if media_ref.kind == MediaReferenceKind::MarkdownMediaLink
            && media_extension(&media_url, None).is_none()
        {
            continue;
        }

        match save_media(&media_url, index + 1) {
            Ok(Some(replacement)) => {
                saved_count += 1;
                replacements.push((
                    media_ref.destination_start,
                    media_ref.destination_end,
                    replacement,
                ));
            }
            Ok(None) => {
                skipped_count += 1;
            }
            Err(error) => {
                skipped_count += 1;
                warnings.push(error);
            }
        }
    }

    let mut rewritten = markdown.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        rewritten.replace_range(start..end, &replacement);
    }

    MediaRewriteResult {
        markdown: rewritten,
        saved_count,
        skipped_count,
        warnings,
    }
}

fn media_references(markdown: &str) -> Vec<MediaReference> {
    let fenced_ranges = fenced_code_ranges(markdown);
    let mut refs = markdown_media_references(markdown);
    refs.extend(html_media_references(markdown));
    refs.retain(|media_ref| !is_offset_in_ranges(media_ref.destination_start, &fenced_ranges));
    refs.sort_by_key(|media_ref| media_ref.destination_start);
    refs
}

fn fenced_code_ranges(markdown: &str) -> Vec<(usize, usize)> {
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

fn is_offset_in_ranges(offset: usize, ranges: &[(usize, usize)]) -> bool {
    ranges
        .iter()
        .any(|(start, end)| offset >= *start && offset < *end)
}

fn markdown_media_references(markdown: &str) -> Vec<MediaReference> {
    let mut refs = Vec::new();
    let bytes = markdown.as_bytes();
    let mut index = 0;

    while let Some(offset) = markdown[index..].find('[') {
        let label_start = index + offset;
        let is_image = label_start > 0 && bytes[label_start - 1] == b'!';
        let Some(label_end_relative) = markdown[label_start + 1..].find("](") else {
            break;
        };
        let destination_start = label_start + 1 + label_end_relative + 2;
        let Some(destination_end) = find_markdown_destination_end(bytes, destination_start) else {
            break;
        };
        let destination = markdown[destination_start..destination_end]
            .trim()
            .to_string();
        if !destination.is_empty() {
            refs.push(MediaReference {
                destination_start,
                destination_end,
                destination,
                kind: if is_image {
                    MediaReferenceKind::MarkdownImage
                } else {
                    MediaReferenceKind::MarkdownMediaLink
                },
            });
        }
        index = destination_end + 1;
    }

    refs
}

fn html_media_references(markdown: &str) -> Vec<MediaReference> {
    let tag_regex =
        Regex::new(r"(?is)<(?:img|audio|video|source)\s+[^>]*>").expect("media tag regex");
    let src_regex = Regex::new(r#"(?is)\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))"#)
        .expect("media src regex");
    let mut refs = Vec::new();

    for tag in tag_regex.find_iter(markdown) {
        let tag_text = tag.as_str();
        let Some(captures) = src_regex.captures(tag_text) else {
            continue;
        };
        let value_match = captures
            .get(2)
            .or_else(|| captures.get(3))
            .or_else(|| captures.get(4));
        let Some(value_match) = value_match else {
            continue;
        };
        let destination = value_match.as_str().trim().to_string();
        if destination.is_empty() {
            continue;
        }
        refs.push(MediaReference {
            destination_start: tag.start() + value_match.start(),
            destination_end: tag.start() + value_match.end(),
            destination,
            kind: MediaReferenceKind::HtmlMediaSrc,
        });
    }

    refs
}

fn find_markdown_destination_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut escaped = false;
    for (offset, byte) in bytes[start..].iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if *byte == b'\\' {
            escaped = true;
            continue;
        }
        if *byte == b')' {
            return Some(start + offset);
        }
    }
    None
}

fn normalize_markdown_destination(destination: &str) -> String {
    let trimmed = destination.trim();
    if trimmed.starts_with('<') && trimmed.ends_with('>') && trimmed.len() > 2 {
        trimmed[1..trimmed.len() - 1].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_media_url(page_url: &Url, destination: &str) -> Option<Url> {
    let lower = destination.to_lowercase();
    if lower.starts_with("data:")
        || lower.starts_with("mailto:")
        || lower.starts_with('#')
        || lower.starts_with("javascript:")
    {
        return None;
    }

    let resolved = page_url.join(destination).ok()?;
    matches!(resolved.scheme(), "http" | "https").then_some(resolved)
}

fn save_remote_media(
    client: &Client,
    vault_path: &Path,
    note_slug: &str,
    index: usize,
    page_url: &Url,
    media_url: &Url,
) -> Result<Option<String>, String> {
    validate_media_url_for_fetch(media_url, page_url)?;
    let response = fetch_media_response(client, media_url, page_url)?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Media {} returned {status}", media_url.as_str()));
    }

    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_MEDIA_BYTES)
    {
        return Ok(None);
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let Some(extension) = media_extension(media_url, content_type.as_deref()) else {
        return Ok(None);
    };
    let Some(bytes) = read_limited_body(response, MAX_MEDIA_BYTES, media_url.as_str())? else {
        return Ok(None);
    };

    let relative_path =
        write_attachment(vault_path, note_slug, index, media_url, &bytes, &extension)?;
    Ok(Some(relative_path))
}

fn fetch_media_response(
    client: &Client,
    media_url: &Url,
    page_url: &Url,
) -> Result<Response, String> {
    let mut current_url = media_url.clone();
    for _ in 0..=MAX_MEDIA_REDIRECTS {
        validate_media_url_for_fetch(&current_url, page_url)?;
        let response = client.get(current_url.clone()).send().map_err(|error| {
            format!("Failed to download media {}: {error}", current_url.as_str())
        })?;
        validate_media_response_peer(&response, page_url)?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("Media {} redirected without a Location header", current_url))?;
        current_url = current_url
            .join(location)
            .map_err(|error| format!("Media redirect target is invalid: {error}"))?;
    }

    Err(format!(
        "Media {} redirected too many times",
        media_url.as_str()
    ))
}

fn read_limited_body(
    reader: impl Read,
    limit: u64,
    source: &str,
) -> Result<Option<Vec<u8>>, String> {
    let mut limited = reader.take(limit + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read media {source}: {error}"))?;
    if bytes.len() as u64 > limit {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn validate_media_url_for_fetch(media_url: &Url, page_url: &Url) -> Result<(), String> {
    if media_url_resolves_to_local_network(media_url)
        && !is_allowed_local_media_origin(media_url, page_url)
    {
        return Err(format!(
            "Skipped media {} because it resolves to a local network address",
            media_url.as_str()
        ));
    }
    Ok(())
}

fn validate_media_response_peer(response: &Response, page_url: &Url) -> Result<(), String> {
    if response
        .remote_addr()
        .is_some_and(|remote_addr| is_local_network_ip(remote_addr.ip()))
        && !is_allowed_local_media_origin(response.url(), page_url)
    {
        return Err(format!(
            "Skipped media {} because it connected to a local network address",
            response.url()
        ));
    }
    Ok(())
}

fn is_allowed_local_media_origin(media_url: &Url, page_url: &Url) -> bool {
    is_same_origin(media_url, page_url) && is_explicit_local_origin(page_url)
}

fn is_same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str().map(str::to_lowercase) == right.host_str().map(str::to_lowercase)
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_explicit_local_origin(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let lower_host = host.trim_matches(['[', ']']).to_lowercase();
    lower_host == "localhost"
        || lower_host.ends_with(".localhost")
        || lower_host.parse::<IpAddr>().is_ok_and(is_local_network_ip)
}

fn media_url_resolves_to_local_network(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let lower_host = host.trim_matches(['[', ']']).to_lowercase();
    if lower_host == "localhost" || lower_host.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = lower_host.parse::<IpAddr>() {
        return is_local_network_ip(ip);
    }
    let Some(port) = url.port_or_known_default() else {
        return true;
    };
    (lower_host.as_str(), port)
        .to_socket_addrs()
        .map(|addresses| {
            addresses
                .into_iter()
                .any(|address| is_local_network_ip(address.ip()))
        })
        .unwrap_or(false)
}

fn is_local_network_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || ip.octets()[0] == 0
                || is_shared_ipv4(ip.octets())
                || is_benchmark_ipv4(ip.octets())
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_shared_ipv4(octets: [u8; 4]) -> bool {
    octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000
}

fn is_benchmark_ipv4(octets: [u8; 4]) -> bool {
    octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
}

fn media_extension(url: &Url, content_type: Option<&str>) -> Option<String> {
    url_extension(url)
        .filter(|extension| SUPPORTED_MEDIA_EXTENSIONS.contains(&extension.as_str()))
        .or_else(|| content_type.and_then(extension_for_content_type))
}

fn extension_for_content_type(content_type: &str) -> Option<String> {
    let media_type = content_type.split(';').next()?.trim().to_lowercase();
    let extension = match media_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/avif" => "avif",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" => "m4a",
        "audio/aac" => "aac",
        "audio/flac" => "flac",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        _ => return None,
    };
    Some(extension.to_string())
}

fn write_attachment(
    vault_path: &Path,
    note_slug: &str,
    index: usize,
    media_url: &Url,
    bytes: &[u8],
    extension: &str,
) -> Result<String, String> {
    let attachments_dir = vault_path.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|error| format!("Failed to create attachments directory: {error}"))?;

    let short_slug = safe_attachment_slug(note_slug);
    let short_hash = short_hash(media_url.as_str().as_bytes(), bytes);
    let base = format!("url-import-{short_slug}-{index:02}-{short_hash}");
    let filename = unique_attachment_filename(&attachments_dir, &base, extension);
    let target_path = attachments_dir.join(&filename);
    fs::write(&target_path, bytes).map_err(|error| {
        format!(
            "Failed to write attachment {}: {error}",
            target_path.display()
        )
    })?;
    Ok(format!("attachments/{filename}"))
}

fn safe_attachment_slug(slug: &str) -> String {
    let cleaned = slug
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let cleaned = if cleaned.is_empty() {
        "page".to_string()
    } else {
        cleaned
    };
    cleaned.chars().take(64).collect()
}

fn unique_attachment_filename(attachments_dir: &Path, base: &str, extension: &str) -> String {
    for suffix in 0.. {
        let filename = if suffix == 0 {
            format!("{base}.{extension}")
        } else {
            format!("{base}-{suffix}.{extension}")
        };
        if !attachments_dir.join(&filename).exists() {
            return filename;
        }
    }
    unreachable!("unbounded suffix search should return a filename")
}

fn short_hash(first: &[u8], second: &[u8]) -> String {
    let mut hash = 0x811c9dc5_u32;
    for byte in first.iter().chain(second.iter()) {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn discover_favicon_url(
    html_client: &Client,
    fetch_client: &Client,
    page_url: &Url,
) -> Option<String> {
    let candidates = favicon_candidates(html_client, page_url);
    candidates
        .into_iter()
        .find(|candidate| favicon_is_reachable(fetch_client, candidate, page_url))
        .map(|candidate| candidate.to_string())
}

fn favicon_candidates(client: &Client, page_url: &Url) -> Vec<Url> {
    let mut candidates = Vec::new();
    if let Ok(html) = fetch_html_for_favicon(client, page_url) {
        candidates.extend(favicon_candidates_from_html(page_url, &html));
    }
    if let Some(default_icon) = default_favicon_url(page_url) {
        candidates.push(default_icon);
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.to_string()))
        .collect()
}

fn fetch_html_for_favicon(client: &Client, page_url: &Url) -> Result<String, String> {
    let response = client
        .get(page_url.clone())
        .header(ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(response.status().to_string());
    }
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_HTML_BYTES)
    {
        return Err("HTML page is too large for favicon discovery".to_string());
    }

    let bytes = response.bytes().map_err(|error| error.to_string())?;
    if bytes.len() > MAX_HTML_BYTES {
        return Err("HTML page is too large for favicon discovery".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|error| error.to_string())
}

fn favicon_candidates_from_html(page_url: &Url, html: &str) -> Vec<Url> {
    let link_regex = Regex::new(r"(?is)<link\s+[^>]*>").expect("link regex should compile");
    let mut candidates = Vec::new();

    for link in link_regex.find_iter(html) {
        let attrs = html_link_attrs(link.as_str());
        let rel = attrs
            .iter()
            .find_map(|(key, value)| {
                key.eq_ignore_ascii_case("rel")
                    .then_some(value.to_lowercase())
            })
            .unwrap_or_default();
        if !rel.split_whitespace().any(|token| token.contains("icon")) {
            continue;
        }
        let href = attrs
            .iter()
            .find_map(|(key, value)| key.eq_ignore_ascii_case("href").then_some(value.as_str()));
        let Some(href) = href else {
            continue;
        };
        let icon_type = attrs
            .iter()
            .find_map(|(key, value)| key.eq_ignore_ascii_case("type").then_some(value.as_str()));
        let Some(candidate) = page_url.join(href).ok().and_then(https_icon_url) else {
            continue;
        };
        if is_supported_icon_url(&candidate, icon_type) {
            candidates.push(candidate);
        }
    }

    candidates
}

fn html_link_attrs(link: &str) -> Vec<(String, String)> {
    let attr_regex =
        Regex::new(r#"(?is)\b([a-z_:][-a-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))"#)
            .expect("HTML attr regex should compile");
    attr_regex
        .captures_iter(link)
        .filter_map(|captures| {
            let key = captures.get(1)?.as_str().to_string();
            let value = captures
                .get(3)
                .or_else(|| captures.get(4))
                .or_else(|| captures.get(5))?
                .as_str()
                .to_string();
            Some((key, value))
        })
        .collect()
}

fn default_favicon_url(page_url: &Url) -> Option<Url> {
    let mut default_icon = page_url.join("/favicon.ico").ok()?;
    default_icon.set_scheme("https").ok()?;
    Some(default_icon)
}

fn https_icon_url(mut url: Url) -> Option<Url> {
    match url.scheme() {
        "https" => Some(url),
        "http" => {
            url.set_scheme("https").ok()?;
            Some(url)
        }
        _ => None,
    }
}

fn is_supported_icon_url(url: &Url, content_type: Option<&str>) -> bool {
    url.scheme() == "https"
        && (url_extension(url)
            .is_some_and(|extension| SUPPORTED_ICON_EXTENSIONS.contains(&extension.as_str()))
            || content_type
                .and_then(extension_for_content_type)
                .is_some_and(|extension| SUPPORTED_ICON_EXTENSIONS.contains(&extension.as_str())))
}

fn favicon_is_reachable(client: &Client, url: &Url, page_url: &Url) -> bool {
    if !is_supported_icon_url(url, None) {
        return false;
    }
    if validate_media_url_for_fetch(url, page_url).is_err() {
        return false;
    }

    match client.head(url.clone()).send() {
        Ok(response) if response.status().is_success() => {
            if validate_media_response_peer(&response, page_url).is_err() {
                return false;
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok());
            content_type
                .map(|value| is_supported_icon_url(url, Some(value)))
                .unwrap_or(true)
        }
        _ => client
            .get(url.clone())
            .header(RANGE, "bytes=0-0")
            .send()
            .ok()
            .is_some_and(|response| {
                response.status().is_success()
                    && validate_media_response_peer(&response, page_url).is_ok()
            }),
    }
}

fn url_extension(url: &Url) -> Option<String> {
    Path::new(url.path())
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn page_url() -> Url {
        Url::parse("https://example.com/articles/page").unwrap()
    }

    #[test]
    fn normalizes_bare_domains_and_rejects_non_http_schemes() {
        assert_eq!(
            normalize_page_url("example.com/post").unwrap().as_str(),
            "https://example.com/post"
        );
        assert!(normalize_page_url("ftp://example.com/file").is_err());
        assert!(normalize_page_url("https://example .com").is_err());
    }

    #[test]
    fn builds_tolaria_frontmatter_with_clean_url_icon_and_defaults() {
        let defaults = vec![
            TypeInstanceDefault {
                key: "status".to_string(),
                value: Value::String("Active".to_string()),
                kind: "property".to_string(),
            },
            TypeInstanceDefault {
                key: "url".to_string(),
                value: Value::String("https://wrong.example".to_string()),
                kind: "property".to_string(),
            },
            TypeInstanceDefault {
                key: "Related to".to_string(),
                value: Value::Array(vec![Value::String("[[Research]]".to_string())]),
                kind: "relationship".to_string(),
            },
        ];

        let content = build_note_content(
            "Article",
            "https://example.com/post",
            Some("https://example.com/favicon.ico"),
            &defaults,
            "# Imported\n\nBody\n",
        );

        assert!(content.starts_with(
            "---\ntype: Article\nurl: https://example.com/post\nicon: https://example.com/favicon.ico\nstatus: Active\nRelated to:\n  - \"[[Research]]\"\n---\n\n# Imported"
        ));
        assert!(!content.contains("curl.md"));
        assert!(!content.contains("wrong.example"));
    }

    #[test]
    fn strips_curl_md_frontmatter_footer_and_ensures_one_primary_h1() {
        let parsed = parse_converted_markdown(
            "---\ntitle: Sample Page\nurl: https://example.com/sample\n---\n\nIntro\n\n# Section\n\n---\nPowered by [curl.md](https://curl.md)\n",
        );
        let body = ensure_single_primary_h1(&parsed.body, parsed.title.as_deref().unwrap());

        assert_eq!(parsed.title.as_deref(), Some("Sample Page"));
        assert_eq!(parsed.url.unwrap().as_str(), "https://example.com/sample");
        assert_eq!(body, "# Sample Page\n\nIntro\n\n## Section\n");
    }

    #[test]
    fn extracts_titles_only_from_non_fenced_h1_lines() {
        let parsed =
            parse_converted_markdown("```sh\n# install deps\n```\n\n# Real Title\n\nBody\n");

        assert_eq!(parsed.title.as_deref(), Some("Real Title"));
    }

    #[test]
    fn preserves_fenced_h1_looking_lines_when_normalizing_headings() {
        let markdown = "# Article\n\n```sh\n# install deps\npnpm install\n```\n\n# Real section\n";
        let body = ensure_single_primary_h1(markdown, "Ignored");

        assert_eq!(
            body,
            "# Article\n\n```sh\n# install deps\npnpm install\n```\n\n## Real section\n"
        );
    }

    #[test]
    fn inserts_title_without_demoting_fenced_code_comments() {
        let markdown = "Intro\n\n```sh\n# install deps\npnpm install\n```\n";
        let body = ensure_single_primary_h1(markdown, "Imported Page");

        assert_eq!(
            body,
            "# Imported Page\n\nIntro\n\n```sh\n# install deps\npnpm install\n```\n"
        );
    }

    #[test]
    fn rewrites_markdown_media_refs_and_counts_partial_failures() {
        let markdown = "![Hero](/hero.png)\n\n![Broken](https://cdn.example.com/broken.jpg)\n\n![Inline](data:image/png;base64,abc)\n\n[Audio](/clip.mp3)\n\n[Regular link](/article)\n\n<video src=\"/movie.mp4\"></video>\n";
        let result = rewrite_markdown_media_with(markdown, &page_url(), |url, _| {
            if url.as_str().contains("broken") {
                Err("download failed".to_string())
            } else if url.path().ends_with(".mp3") {
                Ok(Some(
                    "attachments/url-import-page-04-a1b2c3d4.mp3".to_string(),
                ))
            } else if url.path().ends_with(".mp4") {
                Ok(Some(
                    "attachments/url-import-page-06-a1b2c3d4.mp4".to_string(),
                ))
            } else {
                Ok(Some(
                    "attachments/url-import-page-01-a1b2c3d4.png".to_string(),
                ))
            }
        });

        assert!(result
            .markdown
            .contains("![Hero](attachments/url-import-page-01-a1b2c3d4.png)"));
        assert!(result
            .markdown
            .contains("![Broken](https://cdn.example.com/broken.jpg)"));
        assert!(result
            .markdown
            .contains("[Audio](attachments/url-import-page-04-a1b2c3d4.mp3)"));
        assert!(result.markdown.contains("[Regular link](/article)"));
        assert!(result
            .markdown
            .contains("<video src=\"attachments/url-import-page-06-a1b2c3d4.mp4\"></video>"));
        assert_eq!(result.saved_count, 3);
        assert_eq!(result.skipped_count, 2);
        assert_eq!(result.warnings, vec!["download failed"]);
    }

    #[test]
    fn ignores_markdown_media_refs_inside_fenced_code() {
        let markdown = "![Hero](/hero.png)\n\n```markdown\n![Code](/secret.png)\n<audio src=\"/secret.mp3\"></audio>\n```\n\n[Audio](/clip.mp3)\n";
        let mut saved = Vec::new();
        let result = rewrite_markdown_media_with(markdown, &page_url(), |url, _| {
            saved.push(url.path().to_string());
            Ok(Some(format!("attachments{}", url.path())))
        });

        assert_eq!(saved, vec!["/hero.png", "/clip.mp3"]);
        assert!(result.markdown.contains("![Hero](attachments/hero.png)"));
        assert!(result.markdown.contains("[Audio](attachments/clip.mp3)"));
        assert!(result.markdown.contains(
            "```markdown\n![Code](/secret.png)\n<audio src=\"/secret.mp3\"></audio>\n```"
        ));
        assert_eq!(result.saved_count, 2);
        assert_eq!(result.skipped_count, 0);
    }

    #[test]
    fn writes_attachments_flat_with_unique_names() {
        let dir = TempDir::new().unwrap();
        let url = Url::parse("https://example.com/assets/photo.png").unwrap();
        let first = write_attachment(dir.path(), "sample-page", 1, &url, b"image", "png").unwrap();
        let second = write_attachment(dir.path(), "sample-page", 1, &url, b"image", "png").unwrap();

        assert!(first.starts_with("attachments/url-import-sample-page-01-"));
        assert!(second.starts_with("attachments/url-import-sample-page-01-"));
        assert_ne!(first, second);
        assert_eq!(
            fs::read_dir(dir.path().join("attachments"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .count(),
            2
        );
    }

    #[test]
    fn selects_supported_https_favicon_candidates_from_html() {
        let candidates = favicon_candidates_from_html(
            &page_url(),
            r#"
            <link rel="stylesheet" href="/app.css">
            <link rel="icon" type="image/png" href="/favicon.png">
            <link rel="apple-touch-icon" href="http://example.com/apple.png">
            <link rel="icon" href="/favicon.txt">
            "#,
        );

        let values = candidates.iter().map(Url::as_str).collect::<Vec<_>>();
        assert_eq!(
            values,
            vec![
                "https://example.com/favicon.png",
                "https://example.com/apple.png",
            ]
        );
    }

    #[test]
    fn media_extension_accepts_common_image_audio_and_video_types() {
        let png = Url::parse("https://example.com/no-extension").unwrap();
        let mp4 = Url::parse("https://example.com/video").unwrap();
        let webp = Url::parse("https://example.com/image.webp").unwrap();

        assert_eq!(
            media_extension(&png, Some("image/png")),
            Some("png".to_string())
        );
        assert_eq!(
            media_extension(&mp4, Some("video/mp4")),
            Some("mp4".to_string())
        );
        assert_eq!(media_extension(&webp, None), Some("webp".to_string()));
    }

    #[test]
    fn read_limited_body_enforces_cap_while_reading() {
        assert_eq!(
            read_limited_body(std::io::Cursor::new(vec![1, 2, 3]), 3, "test").unwrap(),
            Some(vec![1, 2, 3])
        );
        assert_eq!(
            read_limited_body(std::io::Cursor::new(vec![1, 2, 3, 4]), 3, "test").unwrap(),
            None
        );
    }

    #[test]
    fn blocks_local_network_media_unless_page_origin_is_explicitly_local() {
        let public_page = Url::parse("https://example.com/page").unwrap();
        let loopback = Url::parse("http://127.0.0.1/image.png").unwrap();
        let private = Url::parse("http://10.0.0.5/image.png").unwrap();
        let localhost = Url::parse("http://localhost/image.png").unwrap();
        let same_local_page = Url::parse("http://localhost/assets/page").unwrap();
        let same_local_media = Url::parse("http://localhost/image.png").unwrap();
        let other_local_port = Url::parse("http://localhost:8080/image.png").unwrap();

        assert!(validate_media_url_for_fetch(&loopback, &public_page).is_err());
        assert!(validate_media_url_for_fetch(&private, &public_page).is_err());
        assert!(validate_media_url_for_fetch(&localhost, &public_page).is_err());
        assert!(validate_media_url_for_fetch(&same_local_media, &same_local_page).is_ok());
        assert!(validate_media_url_for_fetch(&other_local_port, &same_local_page).is_err());
    }
}
