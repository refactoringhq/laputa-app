use super::yaml::{format_yaml_field, FrontmatterValue};

/// Check if a line continues the previous key's value (indented list item,
/// block scalar content, or blank line inside a block scalar).
fn is_value_continuation(line: FrontmatterLine<'_>) -> bool {
    line.0.is_empty() || line.0.starts_with("  ") || line.0.starts_with('\t')
}

#[derive(Clone, Copy)]
enum SystemKey {
    Type,
    Icon,
    Order,
    SidebarLabel,
    Sort,
}

impl SystemKey {
    fn canonical(self) -> &'static str {
        match self {
            Self::Type => "type",
            Self::Icon => "_icon",
            Self::Order => "_order",
            Self::SidebarLabel => "_sidebar_label",
            Self::Sort => "_sort",
        }
    }

    fn legacy_aliases(self) -> &'static [&'static str] {
        match self {
            Self::Type => &["type"],
            Self::Icon => &["icon"],
            Self::Order => &["order"],
            Self::SidebarLabel => &["sidebar_label", "sidebar label"],
            Self::Sort => &["sort"],
        }
    }

    fn alias_match_mode(self) -> KeyMatchMode {
        match self {
            Self::Type => KeyMatchMode::CaseInsensitive,
            _ => KeyMatchMode::Exact,
        }
    }
}

#[derive(Clone, Copy)]
enum KeyMatchMode {
    Exact,
    CaseInsensitive,
}

#[derive(Clone, Copy)]
struct DocumentText<'a>(&'a str);

#[derive(Clone, Copy)]
struct FrontmatterLine<'a>(&'a str);

#[derive(Clone, Copy)]
struct PropertyKey<'a>(&'a str);

impl<'a> PropertyKey<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }

    fn matches(self, candidate: &str, mode: KeyMatchMode) -> bool {
        match mode {
            KeyMatchMode::Exact => candidate == self.as_str(),
            KeyMatchMode::CaseInsensitive => candidate.eq_ignore_ascii_case(self.as_str()),
        }
    }
}

impl<'a> FrontmatterLine<'a> {
    fn key(self) -> Option<&'a str> {
        let trimmed = self.0.trim_start();
        if let Some(raw) = trimmed.strip_prefix('"') {
            return quoted_yaml_key(raw, '"');
        }
        if let Some(raw) = trimmed.strip_prefix('\'') {
            return quoted_yaml_key(raw, '\'');
        }
        trimmed
            .split_once(':')
            .map(|(key, _)| key.trim())
            .filter(|key| !key.is_empty())
    }
}

fn quoted_yaml_key(raw: &str, quote: char) -> Option<&str> {
    let (key, rest) = raw.split_once(quote)?;
    rest.trim_start().starts_with(':').then_some(key)
}

#[derive(Clone, Copy)]
struct FieldUpdate<'a> {
    key: PropertyKey<'a>,
    value: Option<&'a FrontmatterValue>,
    match_mode: KeyMatchMode,
}

impl<'a> FieldUpdate<'a> {
    fn matches_line(self, line: FrontmatterLine<'_>) -> bool {
        line.key()
            .is_some_and(|candidate| self.key.matches(candidate, self.match_mode))
    }

    fn prepend_to(self, content: DocumentText<'_>) -> String {
        let field_lines =
            format_yaml_field(self.key.as_str(), self.value.expect("value must exist"));
        format!("---\n{}\n---\n{}", field_lines.join("\n"), content.0)
    }

    fn apply_to_lines(self, lines: &[FrontmatterLine<'_>]) -> Vec<String> {
        let mut new_lines: Vec<String> = Vec::new();
        let mut found_key = false;
        let mut i = 0;

        while i < lines.len() {
            if !self.matches_line(lines[i]) {
                new_lines.push(lines[i].0.to_string());
                i += 1;
                continue;
            }

            found_key = true;
            i += 1;
            while i < lines.len() && is_value_continuation(lines[i]) {
                i += 1;
            }
            if let Some(v) = self.value {
                new_lines.extend(format_yaml_field(self.key.as_str(), v));
            }
        }

        if let (false, Some(v)) = (found_key, self.value) {
            new_lines.extend(format_yaml_field(self.key.as_str(), v));
        }

        new_lines
    }

    fn apply_to_content(self, content: DocumentText<'_>) -> Result<String, String> {
        if !content.0.starts_with("---\n") {
            return match self.value {
                Some(_) => Ok(self.prepend_to(content)),
                None => Ok(content.0.to_string()),
            };
        }

        let after_open = &content.0[4..];
        let (fm_content, rest) = if let Some(stripped) = after_open.strip_prefix("---") {
            ("", stripped)
        } else {
            let fm_end = after_open
                .find("\n---")
                .map(|i| i + 4)
                .ok_or_else(|| "Malformed frontmatter: no closing ---".to_string())?;
            (&content.0[4..fm_end], &content.0[fm_end + 4..])
        };
        let lines: Vec<FrontmatterLine<'_>> = fm_content.lines().map(FrontmatterLine).collect();
        let new_fm = self.apply_to_lines(&lines).join("\n");
        Ok(format!("---\n{}\n---{}", new_fm, rest))
    }
}

fn canonical_system_key(key: PropertyKey<'_>) -> Option<SystemKey> {
    match key
        .as_str()
        .trim()
        .to_ascii_lowercase()
        .replace(' ', "_")
        .as_str()
    {
        "type" => Some(SystemKey::Type),
        "_icon" | "icon" => Some(SystemKey::Icon),
        "_order" | "order" => Some(SystemKey::Order),
        "_sidebar_label" | "sidebar_label" | "sidebar label" => Some(SystemKey::SidebarLabel),
        "_sort" | "sort" => Some(SystemKey::Sort),
        _ => None,
    }
}

/// Internal function to update frontmatter content
pub fn update_frontmatter_content(
    content: &str,
    key: &str,
    value: Option<FrontmatterValue>,
) -> Result<String, String> {
    let update = FieldUpdate {
        key: PropertyKey(key),
        value: value.as_ref(),
        match_mode: KeyMatchMode::Exact,
    };
    let Some(system_key) = canonical_system_key(update.key) else {
        return update.apply_to_content(DocumentText(content));
    };

    let mut updated = content.to_string();
    for alias in system_key.legacy_aliases() {
        updated = FieldUpdate {
            key: PropertyKey(alias),
            value: None,
            match_mode: system_key.alias_match_mode(),
        }
        .apply_to_content(DocumentText(&updated))?;
    }

    FieldUpdate {
        key: PropertyKey(system_key.canonical()),
        value: update.value,
        match_mode: KeyMatchMode::Exact,
    }
    .apply_to_content(DocumentText(&updated))
}
