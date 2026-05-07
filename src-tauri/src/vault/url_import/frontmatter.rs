use super::TypeInstanceDefault;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;

static YAML_PLAIN_SCALAR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(?:true|false|null|[-+]?\d+(?:\.\d+)?)$").unwrap());

pub(super) fn build_note_content(
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
        format!(
            "url: {}",
            format_yaml_scalar(&Value::String(url.to_string()))
        ),
    ];
    if let Some(icon) = icon.filter(|value| !value.trim().is_empty()) {
        lines.push(format!(
            "icon: {}",
            format_yaml_scalar(&Value::String(icon.to_string()))
        ));
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

        append_type_default(lines, key, &default_value.value);
    }
}

fn append_type_default(lines: &mut Vec<String>, key: &str, value: &Value) {
    if let Value::Array(values) = value {
        lines.push(format!("{key}:"));
        append_array_type_default(lines, values);
    } else if let Some(scalar) = scalar_value(value) {
        lines.push(format!("{key}: {}", format_yaml_scalar(&scalar)));
    }
}

fn append_array_type_default(lines: &mut Vec<String>, values: &[Value]) {
    for value in values {
        if let Some(scalar) = scalar_value(value) {
            lines.push(format!("  - {}", format_yaml_scalar(&scalar)));
        }
    }
}

pub(super) fn canonical_frontmatter_key(key: &str) -> String {
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

pub(super) fn frontmatter_scalar(frontmatter: &str, key: &str) -> Option<String> {
    let mapping = serde_yaml::from_str::<serde_yaml::Mapping>(frontmatter).ok()?;
    mapping.into_iter().find_map(|(candidate_key, value)| {
        let candidate = candidate_key.as_str()?;
        if canonical_frontmatter_key(candidate) != canonical_frontmatter_key(key) {
            return None;
        }
        value.as_str().map(|scalar| scalar.trim().to_string())
    })
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
        || YAML_PLAIN_SCALAR_RE.is_match(value)
}
