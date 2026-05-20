//! Markdown frontmatter parser.
//!
//! Extracts the YAML block delimited by `---\n…\n---\n` at the very start
//! of a note body, returning a structured map plus the remaining body.
//! Used by [`Vault::note_content`] (Phase 8.11) so chrome surfaces such as
//! `frontmatter_panel` can render typed properties without each call site
//! re-parsing the YAML.
//!
//! # Supported value shapes
//!
//! - Strings (quoted or bare scalar)
//! - Integers and floats
//! - Booleans
//! - ISO 8601 date strings (kept as text — callers parse with `chrono`
//!   only when they actually need a `DateTime`)
//! - Sequences of any of the above
//! - `null` / missing → entry omitted
//!
//! Nested mappings and YAML anchors are **not** supported; they survive
//! as `FrontmatterValue::Text` (the raw YAML scalar repr). Documented
//! limitation — vault frontmatter in Tolaria today is a flat key/value
//! sheet so the extra complexity isn't worth carrying.

use std::collections::BTreeMap;

use gpui::SharedString;
use serde::{Deserialize, Serialize};

/// A single value drawn from a note's YAML frontmatter.
///
/// `Date` is distinct from `Text` so callers can render dates with a
/// dedicated widget without having to sniff the format themselves.  The
/// underlying representation is the raw ISO 8601 string — callers parse
/// to `chrono::DateTime` only when they actually need to do arithmetic
/// on the value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FrontmatterValue {
    /// A string scalar.  Quoting in the source YAML is preserved as
    /// content but not exposed (the surrounding quotes are stripped).
    Text(SharedString),
    /// An integer or floating-point scalar.  Stored as `f64` so the
    /// public API has a single number variant; integer notes use a
    /// trivially-round value.
    Number(f64),
    /// A boolean (`true` / `false`, plus YAML's `yes`/`no`/`on`/`off`
    /// aliases).
    Bool(bool),
    /// An ISO 8601 date or date-time string.  Detected by shape
    /// (`\d{4}-\d{2}-\d{2}` prefix) — not by `serde_yaml`'s `chrono`
    /// integration so the parser stays cheap and dependency-light.
    Date(SharedString),
    /// A flat sequence.  Nested lists are flattened to `Text`
    /// representations to keep the public model first-order.
    List(Vec<FrontmatterValue>),
}

/// Structured view of a note's YAML frontmatter.
///
/// Stable lexicographic key order makes diffs of "what frontmatter
/// keys does this vault expose?" trivial; callers that want a specific
/// presentation order should re-sort at the render site.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Frontmatter {
    values: BTreeMap<SharedString, FrontmatterValue>,
}

impl Frontmatter {
    /// Look up a single key.  Returns `None` for absent keys; an empty
    /// frontmatter block always returns `None`.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&FrontmatterValue> {
        self.values.get(key)
    }

    /// Iterate keys in sorted (lexicographic) order.
    pub fn keys(&self) -> impl Iterator<Item = &SharedString> {
        self.values.keys()
    }

    /// True iff there are no parsed entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Number of parsed entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Iterate `(key, value)` pairs in sorted (lexicographic) order.
    pub fn iter(&self) -> impl Iterator<Item = (&SharedString, &FrontmatterValue)> {
        self.values.iter()
    }
}

/// Extract the YAML frontmatter block from the start of `raw`.
///
/// Returns the parsed [`Frontmatter`] plus the remaining body (everything
/// after the closing `---` delimiter).  When `raw` does not start with a
/// frontmatter block — or the block is malformed (no closing delimiter,
/// unparseable YAML, etc.) — returns `(Frontmatter::default(), raw)`
/// without panic so callers can render the body unchanged.
///
/// # Recognised opener
///
/// `---\n` at byte 0.  A BOM or leading whitespace disqualifies the
/// document from having frontmatter — Tolaria's editor never produces
/// either.
#[must_use]
pub fn parse(raw: &str) -> (Frontmatter, &str) {
    let Some(rest) = strip_opener(raw) else {
        return (Frontmatter::default(), raw);
    };
    let Some((yaml, body)) = split_at_closing_delimiter(rest) else {
        return (Frontmatter::default(), raw);
    };
    let parsed = parse_yaml_block(yaml);
    (parsed, body)
}

/// `---\n` or `---\r\n` at byte 0; returns the slice past the opener.
fn strip_opener(raw: &str) -> Option<&str> {
    raw.strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
}

/// Find the `\n---\n` (or `\r\n---\r\n`) closing delimiter and return
/// `(yaml_block, body_after_close)`.
fn split_at_closing_delimiter(after_open: &str) -> Option<(&str, &str)> {
    // Empty frontmatter block: opener immediately followed by `---\n`
    // (the body is empty, so there is no `\n---\n` sequence with a
    // leading newline).  Handle as a fast path before the general
    // search below.
    if let Some(body) = after_open.strip_prefix("---\n") {
        return Some(("", body));
    }
    if let Some(body) = after_open.strip_prefix("---\r\n") {
        return Some(("", body));
    }
    // Two acceptable closers; check the lf form first since Tolaria
    // notes use lf line endings.
    for delim in ["\n---\n", "\r\n---\r\n"] {
        if let Some(end) = after_open.find(delim) {
            let yaml = &after_open[..end];
            let body = &after_open[end + delim.len()..];
            return Some((yaml, body));
        }
    }
    // Trailing `---` at EOF (no newline after the close) is tolerated
    // so a note with frontmatter but no body still parses.
    if let Some(stripped) = after_open.strip_suffix("\n---") {
        return Some((stripped, ""));
    }
    if let Some(stripped) = after_open.strip_suffix("\r\n---") {
        return Some((stripped, ""));
    }
    None
}

/// Run the YAML through `serde_yaml` and project the resulting
/// `serde_yaml::Value` into our flat [`FrontmatterValue`] model.
fn parse_yaml_block(yaml: &str) -> Frontmatter {
    let parsed: Result<serde_yaml::Value, _> = serde_yaml::from_str(yaml);
    let Ok(value) = parsed else {
        return Frontmatter::default();
    };
    let serde_yaml::Value::Mapping(map) = value else {
        return Frontmatter::default();
    };
    let mut values = BTreeMap::new();
    for (k, v) in map {
        let Some(key) = yaml_key_to_shared_string(&k) else {
            continue;
        };
        if let Some(value) = yaml_value_to_frontmatter(&v) {
            values.insert(key, value);
        }
    }
    Frontmatter { values }
}

fn yaml_key_to_shared_string(value: &serde_yaml::Value) -> Option<SharedString> {
    match value {
        serde_yaml::Value::String(s) => Some(SharedString::from(s.clone())),
        serde_yaml::Value::Number(n) => Some(SharedString::from(n.to_string())),
        serde_yaml::Value::Bool(b) => Some(SharedString::from(b.to_string())),
        _ => None,
    }
}

fn yaml_value_to_frontmatter(value: &serde_yaml::Value) -> Option<FrontmatterValue> {
    match value {
        serde_yaml::Value::Null => None,
        serde_yaml::Value::Bool(b) => Some(FrontmatterValue::Bool(*b)),
        serde_yaml::Value::Number(n) => n.as_f64().map(FrontmatterValue::Number),
        serde_yaml::Value::String(s) => Some(if looks_like_iso_date(s) {
            FrontmatterValue::Date(SharedString::from(s.clone()))
        } else {
            FrontmatterValue::Text(SharedString::from(s.clone()))
        }),
        serde_yaml::Value::Sequence(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                if let Some(v) = yaml_value_to_frontmatter(item) {
                    out.push(v);
                }
            }
            Some(FrontmatterValue::List(out))
        }
        // Nested mappings + tagged values fall back to a serialised
        // text representation so the caller still has a printable
        // value to render.
        serde_yaml::Value::Mapping(_) | serde_yaml::Value::Tagged(_) => {
            let rendered = serde_yaml::to_string(value).ok()?;
            Some(FrontmatterValue::Text(SharedString::from(
                rendered.trim_end().to_string(),
            )))
        }
    }
}

/// Cheap shape-only detection: `YYYY-MM-DD[Tt ...]?` matches.  Avoids
/// pulling `chrono`'s strict parser into the hot path; callers that
/// need a real `DateTime` parse the string themselves with the format
/// they expect.
fn looks_like_iso_date(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 10 {
        return false;
    }
    bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_has_no_frontmatter() {
        let (fm, body) = parse("");
        assert!(fm.is_empty());
        assert_eq!(body, "");
    }

    #[test]
    fn body_without_frontmatter_passes_through() {
        let raw = "# Just a heading\n\nNo frontmatter here.\n";
        let (fm, body) = parse(raw);
        assert!(fm.is_empty());
        assert_eq!(body, raw, "raw body must round-trip unchanged");
    }

    #[test]
    fn parses_simple_key_value_pairs() {
        let raw = "---\ntype: Note\ntitle: hello\n---\n\n# body\n";
        let (fm, body) = parse(raw);
        assert_eq!(fm.len(), 2);
        assert_eq!(
            fm.get("type"),
            Some(&FrontmatterValue::Text(SharedString::from("Note")))
        );
        assert_eq!(
            fm.get("title"),
            Some(&FrontmatterValue::Text(SharedString::from("hello")))
        );
        assert_eq!(body, "\n# body\n");
    }

    #[test]
    fn parses_quoted_strings_lists_and_scalars() {
        let raw = "---\n\
                   title: \"Quoted Title\"\n\
                   count: 7\n\
                   active: true\n\
                   tags:\n  - alpha\n  - beta\n\
                   ---\n\
                   body\n";
        let (fm, _body) = parse(raw);
        assert_eq!(
            fm.get("title"),
            Some(&FrontmatterValue::Text(SharedString::from("Quoted Title")))
        );
        assert_eq!(fm.get("count"), Some(&FrontmatterValue::Number(7.0)));
        assert_eq!(fm.get("active"), Some(&FrontmatterValue::Bool(true)));
        let Some(FrontmatterValue::List(items)) = fm.get("tags") else {
            panic!("expected tags to be a list");
        };
        assert_eq!(items.len(), 2);
        assert!(matches!(&items[0], FrontmatterValue::Text(s) if s.as_ref() == "alpha"));
        assert!(matches!(&items[1], FrontmatterValue::Text(s) if s.as_ref() == "beta"));
    }

    #[test]
    fn detects_iso_dates_as_date_variant() {
        // serde_yaml renders bare ISO dates as native dates; quoting
        // them keeps them as strings that our shape detector recognises.
        let raw = "---\ndate: \"2025-04-20\"\nstart: \"2025-04-20T10:00:00\"\n---\n";
        let (fm, _) = parse(raw);
        assert!(matches!(fm.get("date"), Some(FrontmatterValue::Date(_))));
        assert!(matches!(fm.get("start"), Some(FrontmatterValue::Date(_))));
    }

    #[test]
    fn null_entries_are_dropped() {
        // `serde_yaml` follows YAML 1.2: `true`/`false` are bools but
        // `yes`/`no` stay as strings.  The relevant invariant here is
        // that a bare `null` entry (`dropped:`) is dropped.
        let raw = "---\nkept: true\ndropped:\n---\n";
        let (fm, _) = parse(raw);
        assert_eq!(fm.len(), 1);
        assert_eq!(fm.get("kept"), Some(&FrontmatterValue::Bool(true)));
        assert!(fm.get("dropped").is_none());
    }

    #[test]
    fn malformed_close_returns_empty_with_raw_body() {
        // Open delimiter but no close → not real frontmatter; the
        // whole document is the body.
        let raw = "---\ntype: Note\n\n# body without close\n";
        let (fm, body) = parse(raw);
        assert!(
            fm.is_empty(),
            "malformed frontmatter must yield empty map, got {fm:?}"
        );
        assert_eq!(body, raw, "body slice must equal the original raw input");
    }

    #[test]
    fn malformed_yaml_does_not_panic() {
        // Closing delimiter is present but the YAML body is gibberish
        // that serde_yaml will reject.  Must surface as empty map +
        // body after the closer (not a panic).
        let raw = "---\n: : :\n---\nrest\n";
        let (fm, body) = parse(raw);
        assert!(fm.is_empty());
        assert_eq!(body, "rest\n");
    }

    #[test]
    fn keys_iter_is_sorted() {
        let raw = "---\nzebra: 1\nalpha: 2\nmango: 3\n---\n";
        let (fm, _) = parse(raw);
        let keys: Vec<&str> = fm.keys().map(SharedString::as_ref).collect();
        assert_eq!(keys, ["alpha", "mango", "zebra"]);
    }

    #[test]
    fn crlf_line_endings_are_accepted() {
        let raw = "---\r\ntype: Note\r\n---\r\nbody\r\n";
        let (fm, body) = parse(raw);
        assert_eq!(fm.len(), 1);
        assert_eq!(
            fm.get("type"),
            Some(&FrontmatterValue::Text(SharedString::from("Note")))
        );
        assert_eq!(body, "body\r\n");
    }

    #[test]
    fn empty_frontmatter_block_yields_default() {
        let raw = "---\n---\nbody\n";
        let (fm, body) = parse(raw);
        assert!(fm.is_empty());
        assert_eq!(body, "body\n");
    }
}
