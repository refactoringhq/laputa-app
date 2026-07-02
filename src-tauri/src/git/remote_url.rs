const ALLOWED_REMOTE_URL_MESSAGE: &str =
    "Repository URL must start with https://, http://, ssh://, or git@host:path.";
const HIERARCHICAL_REMOTE_SCHEMES: [&str; 3] = ["https://", "http://", "ssh://"];

pub(crate) fn validate_user_remote_url(remote_url: &str) -> Result<&str, String> {
    let trimmed = remote_url.trim();

    if let Some(message) = invalid_remote_url_message(trimmed) {
        return Err(message.to_string());
    }

    if is_supported_remote_url(trimmed) {
        return Ok(trimmed);
    }

    Err(ALLOWED_REMOTE_URL_MESSAGE.to_string())
}

fn invalid_remote_url_message(remote_url: &str) -> Option<&'static str> {
    if remote_url.is_empty() {
        return Some("Enter a repository URL before continuing.");
    }

    if remote_url.starts_with('-') {
        return Some("Repository URL cannot start with '-'.");
    }

    if contains_unsafe_url_character(remote_url) {
        return Some(ALLOWED_REMOTE_URL_MESSAGE);
    }

    None
}

fn contains_unsafe_url_character(remote_url: &str) -> bool {
    remote_url
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
}

fn is_supported_remote_url(remote_url: &str) -> bool {
    HIERARCHICAL_REMOTE_SCHEMES
        .iter()
        .any(|scheme| is_hierarchical_remote_url(remote_url, scheme))
        || is_git_scp_remote_url(remote_url)
}

fn is_hierarchical_remote_url(url: &str, scheme: &str) -> bool {
    let Some(rest) = strip_ascii_prefix(url, scheme) else {
        return false;
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return false;
    };

    has_valid_remote_host(authority) && !path.is_empty()
}

fn strip_ascii_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    value
        .get(..prefix.len())
        .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
        .map(|_| &value[prefix.len()..])
}

fn is_git_scp_remote_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("git@") else {
        return false;
    };
    let Some((host, path)) = rest.split_once(':') else {
        return false;
    };

    has_valid_remote_host(host) && !path.is_empty()
}

fn has_valid_remote_host(authority: &str) -> bool {
    let host = host_from_authority(authority);

    !host.is_empty() && !host.starts_with('-')
}

fn host_from_authority(authority: &str) -> &str {
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);

    host.split_once(':').map_or(host, |(host, _)| host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_user_remote_url_accepts_supported_remote_forms() {
        for url in [
            "https://github.com/refactoringhq/tolaria.git",
            "http://git.example.test/org/repo.git",
            "ssh://git@git.example.test/org/repo.git",
            "git@github.com:refactoringhq/tolaria.git",
        ] {
            assert_eq!(validate_user_remote_url(url).unwrap(), url);
        }
    }

    #[test]
    fn validate_user_remote_url_trims_supported_urls() {
        assert_eq!(
            validate_user_remote_url("  https://github.com/refactoringhq/tolaria.git  ").unwrap(),
            "https://github.com/refactoringhq/tolaria.git"
        );
    }

    #[test]
    fn validate_user_remote_url_rejects_dangerous_or_unsupported_inputs() {
        for url in [
            "",
            "--upload-pack=touch-pwned",
            "ext::sh -c touch-pwned %0.git",
            "file:///Users/luca/private.git",
            "/Users/luca/private.git",
            "github.com:refactoringhq/tolaria.git",
            "git@-oProxyCommand=touch-pwned:repo.git",
            "https://",
            "ssh://git@example.com",
            "https://github.com/refactoringhq/tolaria with space.git",
        ] {
            assert!(validate_user_remote_url(url).is_err(), "{url}");
        }
    }
}
