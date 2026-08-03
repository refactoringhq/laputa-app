use super::{is_numeric_version_part, parse_legacy_build_label};

pub fn parse_build_label(version: &str) -> String {
    let version = version.trim();
    if version.is_empty() {
        return "b?".to_string();
    }

    parse_legacy_build_label(version)
        .or_else(|| parse_calendar_build_label(version))
        .or_else(|| parse_semver_build_label(version))
        .unwrap_or_else(|| "b?".to_string())
}

fn strip_build_metadata(version: &str) -> &str {
    version.split_once('+').map_or(version, |(base, _)| base)
}

fn parse_calendar_build_label(version: &str) -> Option<String> {
    let semver = strip_build_metadata(version);
    let (core, prerelease) = semver
        .split_once('-')
        .map_or((semver, None), |(base, suffix)| (base, Some(suffix)));
    let [year, month, day] = split_numeric_version_parts(core)?;
    if year.len() != 4 {
        return None;
    }

    let core_version = format!(
        "{}.{}.{}",
        year.parse::<u32>().ok()?,
        month.parse::<u32>().ok()?,
        day.parse::<u32>().ok()?
    );

    calendar_prerelease_label(core_version, prerelease)
}

fn calendar_prerelease_label(core_version: String, prerelease: Option<&str>) -> Option<String> {
    match prerelease {
        Some(suffix) if suffix.starts_with("alpha.") => suffix
            .strip_prefix("alpha.")
            .map(|sequence| format!("Alpha {core_version}.{sequence}")),
        Some(suffix) if suffix.starts_with("stable.") => Some(core_version),
        Some(_) => None,
        None => Some(core_version),
    }
}

fn parse_semver_build_label(version: &str) -> Option<String> {
    let semver = strip_build_metadata(version);
    let (core, prerelease) = semver
        .split_once('-')
        .map_or((semver, None), |(base, suffix)| (base, Some(suffix)));
    split_numeric_version_parts(core)?;

    match prerelease {
        Some(suffix) if suffix.starts_with("alpha.") => Some(format!("Alpha {}", semver)),
        Some(_) => Some(format!("v{}", semver)),
        None if semver == "0.1.0" || semver == "0.0.0" => Some("dev".to_string()),
        None => Some(format!("v{}", semver)),
    }
}

fn split_numeric_version_parts(version: &str) -> Option<[&str; 3]> {
    let parts: Vec<&str> = version.split('.').collect();
    let [major, minor, patch] = parts.as_slice() else {
        return None;
    };
    if ![major, minor, patch]
        .iter()
        .all(|part| is_numeric_version_part(part))
    {
        return None;
    }

    Some([major, minor, patch])
}

#[cfg(test)]
mod tests {
    use super::parse_build_label;

    #[test]
    fn parse_build_label_release_version() {
        assert_eq!(parse_build_label("0.20260303.281"), "b281");
        assert_eq!(parse_build_label("0.20251215.42"), "b42");
    }

    #[test]
    fn parse_build_label_calendar_versions() {
        assert_eq!(parse_build_label("2026.4.16"), "2026.4.16");
        assert_eq!(parse_build_label("2026.4.16-stable.1"), "2026.4.16");
        assert_eq!(parse_build_label("2026.4.16-alpha.3"), "Alpha 2026.4.16.3");
        assert_eq!(
            parse_build_label("2026.4.16-alpha.3+darwin"),
            "Alpha 2026.4.16.3"
        );
    }

    #[test]
    fn parse_build_label_legacy_semver_releases() {
        assert_eq!(parse_build_label("1.2.3"), "v1.2.3");
        assert_eq!(
            parse_build_label("1.2.4-alpha.202604122135.7"),
            "Alpha 1.2.4-alpha.202604122135.7"
        );
        assert_eq!(
            parse_build_label("1.2.4-alpha.202604122135.7+darwin"),
            "Alpha 1.2.4-alpha.202604122135.7"
        );
    }

    #[test]
    fn parse_build_label_dev_version() {
        assert_eq!(parse_build_label("0.1.0"), "dev");
        assert_eq!(parse_build_label("0.0.0"), "dev");
    }

    #[test]
    fn parse_build_label_malformed() {
        assert_eq!(parse_build_label("invalid"), "b?");
        assert_eq!(parse_build_label(""), "b?");
    }
}
