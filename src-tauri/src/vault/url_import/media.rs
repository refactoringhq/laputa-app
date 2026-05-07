use super::markdown::fenced_code_ranges;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Url;
use std::fs;
use std::path::{Path, PathBuf};

#[path = "media/fetch.rs"]
mod fetch;
#[path = "media/markdown_refs.rs"]
mod markdown_refs;

pub(super) use fetch::{
    read_limited_body, save_remote_media, validate_media_response_peer,
    validate_media_url_for_fetch,
};
use markdown_refs::markdown_media_references;

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tif", "tiff", "ico", "avif", "mp3", "wav",
    "ogg", "m4a", "flac", "aac", "mp4", "webm", "mov", "m4v",
];

static HTML_MEDIA_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<(?:img|audio|video|source)\s+[^>]*>").unwrap());
static HTML_SRC_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?is)\\bsrc\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))").unwrap());

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
pub(super) struct MediaRewriteResult {
    pub markdown: String,
    pub saved_count: usize,
    pub skipped_count: usize,
    pub warnings: Vec<String>,
}

pub(super) fn rewrite_markdown_media_with<F>(
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
        match media_replacement(page_url, media_ref, index + 1, &mut save_media) {
            MediaReplacement::Saved(replacement) => {
                saved_count += 1;
                replacements.push(replacement);
            }
            MediaReplacement::Skipped => skipped_count += 1,
            MediaReplacement::Ignored => {}
            MediaReplacement::Failed(error) => {
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

enum MediaReplacement {
    Saved((usize, usize, String)),
    Skipped,
    Ignored,
    Failed(String),
}

fn media_replacement<F>(
    page_url: &Url,
    media_ref: &MediaReference,
    index: usize,
    save_media: &mut F,
) -> MediaReplacement
where
    F: FnMut(&Url, usize) -> Result<Option<String>, String>,
{
    let destination = normalize_markdown_destination(&media_ref.destination);
    let Some(media_url) = resolve_media_url(page_url, &destination) else {
        return MediaReplacement::Skipped;
    };
    if media_ref.kind == MediaReferenceKind::MarkdownMediaLink
        && media_extension(&media_url, None).is_none()
    {
        return MediaReplacement::Ignored;
    }

    match save_media(&media_url, index) {
        Ok(Some(replacement)) => MediaReplacement::Saved((
            media_ref.destination_start,
            media_ref.destination_end,
            replacement,
        )),
        Ok(None) => MediaReplacement::Skipped,
        Err(error) => MediaReplacement::Failed(error),
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

fn is_offset_in_ranges(offset: usize, ranges: &[(usize, usize)]) -> bool {
    ranges
        .iter()
        .any(|(start, end)| offset >= *start && offset < *end)
}

fn html_media_references(markdown: &str) -> Vec<MediaReference> {
    let mut refs = Vec::new();

    for tag in HTML_MEDIA_TAG_RE.find_iter(markdown) {
        let tag_text = tag.as_str();
        let Some(captures) = HTML_SRC_ATTR_RE.captures(tag_text) else {
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

fn normalize_markdown_destination(destination: &str) -> String {
    let trimmed = destination.trim();
    let without_angles = if trimmed.starts_with('<') && trimmed.ends_with('>') && trimmed.len() > 2
    {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    };
    unescape_markdown_destination(without_angles)
}

fn unescape_markdown_destination(destination: &str) -> String {
    let mut result = String::with_capacity(destination.len());
    let mut chars = destination.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.next() {
                result.push(next);
            }
        } else {
            result.push(ch);
        }
    }
    result
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

pub(super) fn media_extension(url: &Url, content_type: Option<&str>) -> Option<String> {
    url_extension(url)
        .filter(|extension| SUPPORTED_MEDIA_EXTENSIONS.contains(&extension.as_str()))
        .or_else(|| content_type.and_then(extension_for_content_type))
}

pub(super) fn extension_for_content_type(content_type: &str) -> Option<String> {
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

pub(super) fn write_attachment(
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

pub(super) fn url_extension(url: &Url) -> Option<String> {
    PathBuf::from(url.path())
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
}
