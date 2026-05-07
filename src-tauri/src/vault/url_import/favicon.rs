use super::media::{
    extension_for_content_type, read_limited_body, url_extension, validate_media_response_peer,
    validate_media_url_for_fetch,
};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, RANGE};
use reqwest::Url;
use std::collections::HashSet;

const MAX_HTML_BYTES: usize = 1024 * 1024;

const SUPPORTED_ICON_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif",
];

static HTML_LINK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<link\s+[^>]*>").unwrap());
static HTML_ATTR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new("(?is)\\b([a-z_:][-a-z0-9_:.]*)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))")
        .unwrap()
});

pub(super) fn discover_favicon_url(
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

    let Some(bytes) = read_limited_body(response, MAX_HTML_BYTES as u64, page_url.as_str())? else {
        return Err("HTML page is too large for favicon discovery".to_string());
    };
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

pub(super) fn favicon_candidates_from_html(page_url: &Url, html: &str) -> Vec<Url> {
    let mut candidates = Vec::new();

    for link in HTML_LINK_RE.find_iter(html) {
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
    HTML_ATTR_RE
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
