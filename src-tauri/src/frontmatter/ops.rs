use super::keys::{frontmatter_key_rule, frontmatter_keys_match, FrontmatterKey};
use super::yaml::{format_yaml_field, FrontmatterValue};

/// Check if a line continues the previous key's value (indented list item,
/// block scalar content, or blank line inside a block scalar).
fn is_value_continuation(line: FrontmatterLine<'_>) -> bool {
    line.0.is_empty() || line.0.starts_with("  ") || line.0.starts_with('\t')
}

#[derive(Clone, Copy)]
enum KeyMatchMode {
    Exact,
    Canonical,
}

#[derive(Clone, Copy)]
struct DocumentText<'a>(&'a str);

#[derive(Clone, Copy)]
struct FrontmatterLine<'a>(&'a str);

#[derive(Clone, Copy)]
struct PropertyKey<'a>(&'a str);

#[derive(Clone, Copy)]
struct FrontmatterBlock<'a> {
    body: &'a str,
    rest: &'a str,
    line_ending: &'static str,
}

impl<'a> PropertyKey<'a> {
    fn as_str(self) -> &'a str {
        self.0
    }

    fn matches(self, candidate: &str, mode: KeyMatchMode) -> bool {
        match mode {
            KeyMatchMode::Exact => candidate == self.as_str(),
            KeyMatchMode::Canonical => frontmatter_keys_match(
                FrontmatterKey::new(candidate),
                FrontmatterKey::new(self.as_str()),
            ),
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

fn frontmatter_open(content: &str) -> Option<(&str, &'static str)> {
    content
        .strip_prefix("---\n")
        .map(|after| (after, "\n"))
        .or_else(|| content.strip_prefix("---\r\n").map(|after| (after, "\r\n")))
}

fn close_marker(line_ending: &str) -> String {
    format!("{line_ending}---")
}

fn split_frontmatter_block(content: &str) -> Result<Option<FrontmatterBlock<'_>>, String> {
    let Some((after_open, line_ending)) = frontmatter_open(content) else {
        return Ok(None);
    };

    if let Some(rest) = after_open.strip_prefix("---") {
        return Ok(Some(FrontmatterBlock {
            body: "",
            rest,
            line_ending,
        }));
    }

    let marker = close_marker(line_ending);
    let close_start = after_open
        .find(&marker)
        .ok_or_else(|| "Malformed frontmatter: no closing ---".to_string())?;
    let rest_start = close_start + marker.len();
    Ok(Some(FrontmatterBlock {
        body: &after_open[..close_start],
        rest: &after_open[rest_start..],
        line_ending,
    }))
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
        let Some(block) = split_frontmatter_block(content.0)? else {
            return match self.value {
                Some(_) => Ok(self.prepend_to(content)),
                None => Ok(content.0.to_string()),
            };
        };

        let lines: Vec<FrontmatterLine<'_>> = block.body.lines().map(FrontmatterLine).collect();
        let new_fm = self.apply_to_lines(&lines).join(block.line_ending);
        Ok(format!(
            "---{}{}{}---{}",
            block.line_ending, new_fm, block.line_ending, block.rest
        ))
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
    let Some(rule) = frontmatter_key_rule(FrontmatterKey::new(update.key.as_str()))
        .filter(|rule| rule.canonicalizes_on_write())
    else {
        return update.apply_to_content(DocumentText(content));
    };

    let updated = FieldUpdate {
        key: PropertyKey(rule.write_key()),
        value: None,
        match_mode: KeyMatchMode::Canonical,
    }
    .apply_to_content(DocumentText(content))?;

    FieldUpdate {
        key: PropertyKey(rule.write_key()),
        value: update.value,
        match_mode: KeyMatchMode::Exact,
    }
    .apply_to_content(DocumentText(&updated))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bool_value(value: bool) -> FrontmatterValue {
        FrontmatterValue::Bool(value)
    }

    fn string_value(value: &str) -> FrontmatterValue {
        FrontmatterValue::String(value.to_string())
    }

    fn frontmatter_delimiter_lines(content: &str) -> usize {
        content.lines().filter(|line| *line == "---").count()
    }

    #[test]
    fn updates_existing_crlf_frontmatter_without_creating_a_second_block() {
        let content = concat!(
            "---\r\n",
            "type: Note\r\n",
            "related_to:\r\n",
            "  - \"[[tolaria]]\"\r\n",
            "---\r\n",
            "# Properties Panel\r\n",
        );

        let updated = update_frontmatter_content(content, "_organized", Some(bool_value(true)))
            .expect("frontmatter update should succeed");

        assert_eq!(frontmatter_delimiter_lines(&updated), 2);
        assert_eq!(
            updated,
            concat!(
                "---\r\n",
                "type: Note\r\n",
                "related_to:\r\n",
                "  - \"[[tolaria]]\"\r\n",
                "_organized: true\r\n",
                "---\r\n",
                "# Properties Panel\r\n",
            )
        );
    }

    #[test]
    fn repeated_crlf_updates_stay_in_the_original_frontmatter_block() {
        let content = concat!(
            "---\r\n",
            "type: Note\r\n",
            "related_to: \"[[tolaria]]\"\r\n",
            "---\r\n",
            "# Properties Panel\r\n",
        );

        let widened = update_frontmatter_content(content, "_width", Some(string_value("wide")))
            .expect("width update should succeed");
        let organized = update_frontmatter_content(&widened, "_organized", Some(bool_value(true)))
            .expect("organized update should succeed");

        assert_eq!(frontmatter_delimiter_lines(&organized), 2);
        assert!(organized.contains("type: Note\r\n"));
        assert!(organized.contains("_width: wide\r\n"));
        assert!(organized.contains("_organized: true\r\n"));
    }
}
