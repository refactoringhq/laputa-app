use crate::vault::{invalidate_cache, reload_entry, VaultEntry};
use reqwest::blocking::Client;
use reqwest::header::ACCEPT;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[path = "url_import/favicon.rs"]
mod favicon;
#[path = "url_import/frontmatter.rs"]
mod frontmatter;
#[path = "url_import/markdown.rs"]
mod markdown;
#[path = "url_import/media.rs"]
mod media;

use favicon::discover_favicon_url;
use frontmatter::build_note_content;
use markdown::{ensure_single_primary_h1, parse_converted_markdown, title_from_url, title_to_slug};
use media::{rewrite_markdown_media_with, save_remote_media};

const CURL_MD_BASE: &str = "https://curl.md/";
const HTTP_TIMEOUT_SECS: u64 = 30;

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
        .as_deref()
        .or(payload.markdown.as_deref())
        .ok_or_else(|| "curl.md did not return Markdown content".to_string())?;
    let parsed = parse_converted_markdown(content);
    let canonical_url = converted_document_url(&payload, &parsed, page_url);
    let title = converted_document_title(&payload, &parsed, &canonical_url);
    let body = ensure_single_primary_h1(&parsed.body, &title);

    Ok(ConvertedDocument {
        title,
        url: canonical_url,
        body,
    })
}

fn converted_document_url(
    payload: &CurlMdResponse,
    parsed: &markdown::ParsedConvertedMarkdown,
    fallback_url: &Url,
) -> Url {
    payload
        .url
        .as_deref()
        .and_then(|candidate| normalize_page_url(candidate).ok())
        .or_else(|| parsed.url.clone())
        .unwrap_or_else(|| fallback_url.clone())
}

fn converted_document_title(
    payload: &CurlMdResponse,
    parsed: &markdown::ParsedConvertedMarkdown,
    canonical_url: &Url,
) -> String {
    payload
        .title
        .clone()
        .or_else(|| parsed.title.clone())
        .unwrap_or_else(|| title_from_url(canonical_url))
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

fn normalize_page_url(input: &str) -> Result<Url, String> {
    let trimmed = validated_url_input(input)?;
    let candidate = page_url_candidate(trimmed);
    let parsed = Url::parse(&candidate).map_err(|_| "Enter a valid web URL".to_string())?;
    if is_importable_page_url(&parsed) {
        Ok(parsed)
    } else {
        Err("Only HTTP and HTTPS URLs can be imported".to_string())
    }
}

fn validated_url_input(input: &str) -> Result<&str, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        Err("Enter a valid web URL".to_string())
    } else {
        Ok(trimmed)
    }
}

fn page_url_candidate(trimmed: &str) -> String {
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if is_bare_domain_url(trimmed) {
        format!("https://{trimmed}")
    } else {
        trimmed.to_string()
    }
}

fn is_importable_page_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
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

    labels.iter().all(|label| is_domain_label(label))
}

fn is_domain_label(label: &str) -> bool {
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

#[cfg(test)]
#[path = "url_import/tests.rs"]
mod tests;
