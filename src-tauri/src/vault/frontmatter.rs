use crate::vault::parsing::contains_wikilink;
use serde::Deserialize;
use std::collections::HashMap;

/// Intermediate struct to capture YAML frontmatter fields.
#[derive(Debug, Deserialize, Default)]
pub(crate) struct Frontmatter {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(rename = "type", alias = "Is A", alias = "is_a")]
    pub is_a: Option<StringOrList>,
    #[serde(default)]
    pub aliases: Option<StringOrList>,
    #[serde(
        rename = "_archived",
        alias = "Archived",
        alias = "archived",
        default,
        deserialize_with = "deserialize_bool_or_string"
    )]
    pub archived: Option<bool>,
    #[serde(rename = "Status", alias = "status", default)]
    pub status: Option<StringOrList>,
    #[serde(rename = "_icon", alias = "icon", default)]
    pub icon: Option<StringOrList>,
    #[serde(default)]
    pub color: Option<StringOrList>,
    #[serde(rename = "_order", alias = "order", default)]
    pub order: Option<i64>,
    #[serde(
        rename = "_sidebar_label",
        alias = "sidebar label",
        alias = "sidebar_label",
        default
    )]
    pub sidebar_label: Option<StringOrList>,
    #[serde(default)]
    pub template: Option<StringOrList>,
    #[serde(rename = "_sort", alias = "sort", default)]
    pub sort: Option<StringOrList>,
    #[serde(default)]
    pub view: Option<StringOrList>,
    #[serde(rename = "_width", alias = "width", default)]
    pub note_width: Option<StringOrList>,
    #[serde(default)]
    pub visible: Option<bool>,
    #[serde(
        rename = "_organized",
        default,
        deserialize_with = "deserialize_bool_or_string"
    )]
    pub organized: Option<bool>,
    #[serde(
        rename = "_favorite",
        default,
        deserialize_with = "deserialize_bool_or_string"
    )]
    pub favorite: Option<bool>,
    #[serde(rename = "_favorite_index", default)]
    pub favorite_index: Option<i64>,
    #[serde(rename = "_list_properties_display", default)]
    pub list_properties_display: Option<Vec<String>>,
}

/// Custom deserializer for boolean fields that may arrive as strings.
/// YAML `Yes`/`No` get converted to JSON strings by gray_matter, so we
/// need to accept both actual booleans and their string representations.
fn deserialize_bool_or_string<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;

    struct BoolOrStringVisitor;

    impl<'de> de::Visitor<'de> for BoolOrStringVisitor {
        type Value = Option<bool>;

        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a boolean or a string representing a boolean")
        }

        fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
            Ok(Some(v))
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
            match v.to_lowercase().as_str() {
                "true" | "yes" | "1" => Ok(Some(true)),
                "false" | "no" | "0" | "" => Ok(Some(false)),
                _ => Ok(Some(false)),
            }
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
            Ok(Some(v != 0))
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v != 0))
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
    }

    deserializer.deserialize_any(BoolOrStringVisitor)
}

/// Handles YAML fields that can be either a single string or a list of strings.
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub(crate) enum StringOrList {
    Single(String),
    List(Vec<String>),
}

impl StringOrList {
    pub fn into_vec(self) -> Vec<String> {
        match self {
            StringOrList::Single(s) => vec![s],
            StringOrList::List(v) => v,
        }
    }

    /// Normalize to a single scalar: unwrap single-element arrays, take first
    /// element of multi-element arrays, return scalar unchanged, empty array → None.
    pub fn into_scalar(self) -> Option<String> {
        match self {
            StringOrList::Single(s) => Some(s),
            StringOrList::List(mut v) => {
                if v.is_empty() {
                    None
                } else {
                    Some(v.swap_remove(0))
                }
            }
        }
    }
}

/// Sanitize a JSON value so that arrays of mixed types (strings + objects + nulls)
/// are flattened to arrays of strings. gray_matter mis-parses certain YAML patterns:
///
/// 1. Unquoted colons in list items: `- Bitcoin: Net Unrealized` becomes
///    `{"Bitcoin": "Net Unrealized"}` instead of a plain string.
/// 2. Hash comments in list items: `- # Heading` becomes `Null` because
///    gray_matter treats `#` as a YAML comment.
///
/// This sanitizer converts objects back to "key: value" strings and removes nulls,
/// preventing serde deserialization of the entire Frontmatter struct from failing.
fn sanitize_array_item(item: &serde_json::Value) -> Option<serde_json::Value> {
    match item {
        serde_json::Value::Null => None,
        serde_json::Value::Object(map) if !map.is_empty() => {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| match v {
                    serde_json::Value::String(s) => format!("{}: {}", k, s),
                    _ => format!("{}: {}", k, v),
                })
                .collect();
            Some(serde_json::Value::String(parts.join(", ")))
        }
        other => Some(other.clone()),
    }
}

fn sanitize_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(arr) => {
            let sanitized: Vec<serde_json::Value> =
                arr.iter().filter_map(sanitize_array_item).collect();
            serde_json::Value::Array(sanitized)
        }
        other => other.clone(),
    }
}

/// Parse frontmatter from raw YAML data extracted by gray_matter.
fn parse_frontmatter(data: &HashMap<String, serde_json::Value>) -> Frontmatter {
    static KNOWN_KEYS: &[&str] = &[
        "title",
        "type",
        "Is A",
        "is_a",
        "aliases",
        "_archived",
        "Archived",
        "archived",
        "_icon",
        "icon",
        "color",
        "_order",
        "order",
        "_sidebar_label",
        "sidebar_label",
        "sidebar label",
        "template",
        "_sort",
        "sort",
        "view",
        "_width",
        "width",
        "visible",
        "notion_id",
        "Status",
        "status",
        "_organized",
        "_favorite",
        "_favorite_index",
        "_list_properties_display",
    ];
    let filtered: serde_json::Map<String, serde_json::Value> = data
        .iter()
        .filter(|(k, _)| KNOWN_KEYS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), sanitize_value(v)))
        .collect();
    let value = serde_json::Value::Object(filtered);
    serde_json::from_value(value).unwrap_or_default()
}

/// Known non-relationship frontmatter keys to skip (case-insensitive comparison).
/// Only skip keys that can never contain wikilinks.
/// Note: owner and cadence are NOT skipped — they should appear in generic properties.
const SKIP_KEYS: &[&str] = &[
    "title",
    "is_a",
    "type",
    "aliases",
    "_archived",
    "archived",
    "icon",
    "color",
    "order",
    "sidebar_label",
    "template",
    "sort",
    "view",
    "_width",
    "width",
    "visible",
    "status",
    "_organized",
    "_favorite",
    "_favorite_index",
    "_list_properties_display",
];

#[derive(Clone, Copy)]
struct FrontmatterKey<'a>(&'a str);

impl FrontmatterKey<'_> {
    fn normalize(self) -> String {
        self.0.trim().to_ascii_lowercase().replace(' ', "_")
    }

    fn should_skip(self) -> bool {
        let normalized = self.normalize();
        normalized.starts_with('_') || SKIP_KEYS.contains(&normalized.as_str())
    }
}

/// Extract all wikilink-containing fields from raw YAML frontmatter.
pub(crate) fn extract_relationships(
    data: &HashMap<String, serde_json::Value>,
) -> HashMap<String, Vec<String>> {
    let mut relationships = HashMap::new();

    for (key, value) in data {
        if FrontmatterKey(key).should_skip() {
            continue;
        }

        match value {
            serde_json::Value::String(s) if contains_wikilink(s) => {
                relationships.insert(key.clone(), vec![s.clone()]);
            }
            serde_json::Value::Array(arr) => {
                let wikilinks: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| contains_wikilink(s))
                    .map(|s| s.to_string())
                    .collect();
                if !wikilinks.is_empty() {
                    relationships.insert(key.clone(), wikilinks);
                }
            }
            _ => {}
        }
    }

    relationships
}

/// Extract custom scalar properties from raw YAML frontmatter.
pub(crate) fn extract_properties(
    data: &HashMap<String, serde_json::Value>,
) -> HashMap<String, serde_json::Value> {
    let mut properties = HashMap::new();

    for (key, value) in data {
        if FrontmatterKey(key).should_skip() {
            continue;
        }

        match value {
            serde_json::Value::String(s) if !contains_wikilink(s) => {
                properties.insert(key.clone(), value.clone());
            }
            serde_json::Value::Number(_) | serde_json::Value::Bool(_) => {
                properties.insert(key.clone(), value.clone());
            }
            // Handle single-element arrays: unwrap to scalar.
            // This ensures YAML like "Owner: [Luca]" or "Owner:\n  - Luca" works correctly.
            serde_json::Value::Array(arr) => {
                if let [serde_json::Value::String(s)] = arr.as_slice() {
                    if !contains_wikilink(s) {
                        properties.insert(key.clone(), serde_json::Value::String(s.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    properties
}

/// Resolve `is_a` from frontmatter only.
pub(crate) fn resolve_is_a(fm_is_a: Option<StringOrList>) -> Option<String> {
    fm_is_a.and_then(|a| a.into_vec().into_iter().next())
}

pub(crate) fn resolve_note_width(note_width: Option<StringOrList>) -> Option<String> {
    match note_width
        .and_then(StringOrList::into_scalar)
        .map(|value| value.trim().to_ascii_lowercase())
    {
        Some(mode) if mode == "normal" || mode == "wide" => Some(mode),
        _ => None,
    }
}

/// Convert gray_matter::Pod to serde_json::Value
fn pod_to_json(pod: gray_matter::Pod) -> serde_json::Value {
    match pod {
        gray_matter::Pod::String(s) => serde_json::Value::String(s),
        gray_matter::Pod::Integer(i) => serde_json::json!(i),
        gray_matter::Pod::Float(f) => serde_json::json!(f),
        gray_matter::Pod::Boolean(b) => serde_json::Value::Bool(b),
        gray_matter::Pod::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(pod_to_json).collect())
        }
        gray_matter::Pod::Hash(map) => {
            let obj: serde_json::Map<String, serde_json::Value> =
                map.into_iter().map(|(k, v)| (k, pod_to_json(v))).collect();
            serde_json::Value::Object(obj)
        }
        gray_matter::Pod::Null => serde_json::Value::Null,
    }
}

#[derive(Clone, Copy)]
struct YamlScalar<'a>(&'a str);

impl<'a> YamlScalar<'a> {
    /// Strip matching outer quotes (single or double) from a YAML scalar.
    fn unquote(self) -> &'a str {
        self.0
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
            .or_else(|| {
                self.0
                    .strip_prefix('\'')
                    .and_then(|rest| rest.strip_suffix('\''))
            })
            .unwrap_or(self.0)
    }

    /// Parse a scalar YAML value into a JSON value.
    fn parse(self) -> serde_json::Value {
        let trimmed = self.unquote();
        match trimmed.to_lowercase().as_str() {
            "true" | "yes" => serde_json::Value::Bool(true),
            "false" | "no" => serde_json::Value::Bool(false),
            _ => trimmed
                .parse::<i64>()
                .map(|n| serde_json::json!(n))
                .unwrap_or_else(|_| serde_json::Value::String(trimmed.to_string())),
        }
    }
}

#[derive(Clone, Copy)]
struct YamlLine<'a>(&'a str);

impl<'a> YamlLine<'a> {
    fn is_top_level(self) -> bool {
        if self.0.is_empty() {
            return false;
        }
        if self.0.starts_with(' ') {
            return false;
        }
        !self.0.starts_with('\t')
    }

    /// Return the key from a top-level `key:` or `"key":` YAML line.
    /// Returns `None` for indented, blank, or non-key lines.
    fn key(self) -> Option<&'a str> {
        if !self.is_top_level() {
            return None;
        }
        let (key, _) = self.0.split_once(':')?;
        Some(key.trim().trim_matches('"'))
    }

    fn list_item(self) -> Option<&'a str> {
        self.0.strip_prefix("  - ").map(str::trim)
    }

    fn value_part(self) -> Option<&'a str> {
        self.0.split_once(':').map(|(_, value)| value.trim())
    }
}

#[derive(Clone, Copy)]
struct RawFrontmatter<'a>(&'a str);

impl<'a> RawFrontmatter<'a> {
    fn extract_block(self) -> Option<&'a str> {
        let rest = self.0.strip_prefix("---")?;
        let rest = rest
            .strip_prefix('\n')
            .or_else(|| rest.strip_prefix("\r\n"))?;
        let end = rest.find("\n---")?;
        Some(&rest[..end])
    }

    /// Fallback parser for when gray_matter fails to parse YAML (returns raw string).
    /// Extracts simple `key: value` lines, handling booleans, numbers, quoted strings,
    /// and YAML lists.
    fn parse_fallback(self) -> HashMap<String, serde_json::Value> {
        let mut map = HashMap::new();
        let mut list_key: Option<String> = None;
        let mut list_items: Vec<serde_json::Value> = Vec::new();

        for line in self.0.lines() {
            let yaml_line = YamlLine(line);

            // Accumulate list items under the current key
            if list_key.is_some() {
                if let Some(item) = yaml_line.list_item() {
                    list_items.push(YamlScalar(item).parse());
                    continue;
                }
                flush_list(&mut map, &mut list_key, &mut list_items);
            }

            let Some(key) = yaml_line.key() else {
                continue;
            };
            let value_part = yaml_line.value_part().unwrap_or("");
            if value_part.is_empty() {
                list_key = Some(key.to_string());
            } else {
                map.insert(key.to_string(), YamlScalar(value_part).parse());
            }
        }

        flush_list(&mut map, &mut list_key, &mut list_items);
        map
    }
}

/// Flush a pending list accumulator into the map.
fn flush_list(
    map: &mut HashMap<String, serde_json::Value>,
    key: &mut Option<String>,
    items: &mut Vec<serde_json::Value>,
) {
    if let Some(k) = key.take() {
        if !items.is_empty() {
            map.insert(k, serde_json::Value::Array(std::mem::take(items)));
        }
    }
}

/// Extract frontmatter, relationships, and custom properties from parsed gray_matter data.
/// When gray_matter fails to parse YAML (e.g. malformed quotes from Notion exports),
/// `raw_content` is used as a fallback: simple key:value pairs are extracted line-by-line
/// so that critical fields like Trashed, Archived, type are not silently lost.
pub(crate) fn extract_fm_and_rels(
    data: Option<gray_matter::Pod>,
    raw_content: &str,
) -> (
    Frontmatter,
    HashMap<String, Vec<String>>,
    HashMap<String, serde_json::Value>,
) {
    let json_map = match data {
        Some(gray_matter::Pod::Hash(map)) => {
            map.into_iter().map(|(k, v)| (k, pod_to_json(v))).collect()
        }
        _ => {
            // gray_matter returned Null, String, or None — YAML parse failed.
            // Fall back to line-by-line extraction from the raw frontmatter block.
            match RawFrontmatter(raw_content).extract_block() {
                Some(raw) => RawFrontmatter(raw).parse_fallback(),
                None => return (Frontmatter::default(), HashMap::new(), HashMap::new()),
            }
        }
    };
    (
        parse_frontmatter(&json_map),
        extract_relationships(&json_map),
        extract_properties(&json_map),
    )
}
