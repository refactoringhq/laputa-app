use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::Url;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::Path;

use super::{media_extension, write_attachment};

const MAX_MEDIA_REDIRECTS: usize = 5;
const MAX_MEDIA_BYTES: u64 = 25 * 1024 * 1024;

pub(in crate::vault::url_import) fn save_remote_media(
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

    if media_is_over_limit(&response) {
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

fn media_is_over_limit(response: &Response) -> bool {
    response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_MEDIA_BYTES)
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
        current_url = media_redirect_target(&response, &current_url)?;
    }

    Err(format!(
        "Media {} redirected too many times",
        media_url.as_str()
    ))
}

fn media_redirect_target(response: &Response, current_url: &Url) -> Result<Url, String> {
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("Media {} redirected without a Location header", current_url))?;
    current_url
        .join(location)
        .map_err(|error| format!("Media redirect target is invalid: {error}"))
}

pub(in crate::vault::url_import) fn read_limited_body(
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

pub(in crate::vault::url_import) fn validate_media_url_for_fetch(
    media_url: &Url,
    page_url: &Url,
) -> Result<(), String> {
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

pub(in crate::vault::url_import) fn validate_media_response_peer(
    response: &Response,
    page_url: &Url,
) -> Result<(), String> {
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
    let lower_host = normalized_host(host);
    lower_host == "localhost"
        || lower_host.ends_with(".localhost")
        || lower_host.parse::<IpAddr>().is_ok_and(is_local_network_ip)
}

fn media_url_resolves_to_local_network(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let lower_host = normalized_host(host);
    if lower_host == "localhost" || lower_host.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = lower_host.parse::<IpAddr>() {
        return is_local_network_ip(ip);
    }
    url_resolves_to_local_network(&lower_host, url.port_or_known_default())
}

fn normalized_host(host: &str) -> String {
    host.trim_matches(['[', ']']).to_lowercase()
}

fn url_resolves_to_local_network(host: &str, port: Option<u16>) -> bool {
    let Some(port) = port else {
        return true;
    };
    (host, port)
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
        IpAddr::V4(ip) => is_local_ipv4(ip),
        IpAddr::V6(ip) => is_local_ipv6(ip),
    }
}

fn is_local_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    [
        ip.is_loopback(),
        ip.is_private(),
        ip.is_link_local(),
        ip.is_unspecified(),
        ip.is_broadcast(),
        ip.is_multicast(),
        octets[0] == 0,
        is_shared_ipv4(octets),
        is_benchmark_ipv4(octets),
    ]
    .into_iter()
    .any(|blocked| blocked)
}

fn is_local_ipv6(ip: Ipv6Addr) -> bool {
    let first_segment = ip.segments()[0];
    [
        ip.is_loopback(),
        ip.is_unspecified(),
        ip.is_multicast(),
        (first_segment & 0xfe00) == 0xfc00,
        (first_segment & 0xffc0) == 0xfe80,
    ]
    .into_iter()
    .any(|blocked| blocked)
}

fn is_shared_ipv4(octets: [u8; 4]) -> bool {
    octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000
}

fn is_benchmark_ipv4(octets: [u8; 4]) -> bool {
    octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
}
