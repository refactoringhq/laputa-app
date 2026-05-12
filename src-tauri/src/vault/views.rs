use chrono::Utc;
use regex::{Regex, RegexBuilder};
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::cmp::Ordering;
use std::fmt;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use super::view_date_filters::parse_date_filter_timestamp;
use super::view_migration::{is_view_definition_file, migrate_views};
use super::view_relationships::{evaluate_relationship_op, relationship_candidates};
use super::view_value_conversions::{
    json_scalar_to_string, yaml_value_to_string, yaml_value_to_string_vec,
};
use super::VaultEntry;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ViewDefinition {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(
        default,
        rename = "listPropertiesDisplay",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub list_properties_display: Vec<String>,
    pub filters: FilterGroup,
}

#[derive(Debug, Clone)]
pub enum FilterGroup {
    All(Vec<FilterNode>),
    Any(Vec<FilterNode>),
}

impl Serialize for FilterGroup {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(1))?;
        match self {
            FilterGroup::All(nodes) => map.serialize_entry("all", nodes)?,
            FilterGroup::Any(nodes) => map.serialize_entry("any", nodes)?,
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for FilterGroup {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct FilterGroupVisitor;

        impl<'de> Visitor<'de> for FilterGroupVisitor {
            type Value = FilterGroup;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a map with key 'all' or 'any'")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<FilterGroup, M::Error> {
                let key: String = map
                    .next_key()?
                    .ok_or_else(|| de::Error::custom("expected 'all' or 'any' key"))?;
                match key.as_str() {
                    "all" => {
                        let nodes: Vec<FilterNode> = map.next_value()?;
                        Ok(FilterGroup::All(nodes))
                    }
                    "any" => {
                        let nodes: Vec<FilterNode> = map.next_value()?;
                        Ok(FilterGroup::Any(nodes))
                    }
                    other => Err(de::Error::unknown_field(other, &["all", "any"])),
                }
            }
        }

        deserializer.deserialize_map(FilterGroupVisitor)
    }
}

#[derive(Debug, Clone)]
pub enum FilterNode {
    Condition(FilterCondition),
    Group(FilterGroup),
}

impl Serialize for FilterNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            FilterNode::Condition(c) => c.serialize(serializer),
            FilterNode::Group(g) => g.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for FilterNode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Deserialize into a generic YAML value, then try group first, then condition
        let value = serde_yaml::Value::deserialize(deserializer)?;
        if let serde_yaml::Value::Mapping(ref m) = value {
            // If the map has an "all" or "any" key, it's a group
            let all_key = serde_yaml::Value::String("all".to_string());
            let any_key = serde_yaml::Value::String("any".to_string());
            if m.contains_key(&all_key) || m.contains_key(&any_key) {
                let group: FilterGroup =
                    serde_yaml::from_value(value).map_err(de::Error::custom)?;
                return Ok(FilterNode::Group(group));
            }
        }
        let cond: FilterCondition = serde_yaml::from_value(value).map_err(de::Error::custom)?;
        Ok(FilterNode::Condition(cond))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilterCondition {
    pub field: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Option<serde_yaml::Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub regex: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum FilterOp {
    #[serde(rename = "equals")]
    Equals,
    #[serde(rename = "not_equals")]
    NotEquals,
    #[serde(rename = "contains")]
    Contains,
    #[serde(rename = "not_contains")]
    NotContains,
    #[serde(rename = "any_of")]
    AnyOf,
    #[serde(rename = "none_of")]
    NoneOf,
    #[serde(rename = "is_empty")]
    IsEmpty,
    #[serde(rename = "is_not_empty")]
    IsNotEmpty,
    #[serde(rename = "before")]
    Before,
    #[serde(rename = "after")]
    After,
}

/// A view file on disk: filename + parsed definition.
#[derive(Debug, Serialize, Clone)]
pub struct ViewFile {
    pub filename: String,
    pub definition: ViewDefinition,
}

fn read_view_file(path: &Path) -> Option<ViewFile> {
    if !is_view_definition_file(path) {
        return None;
    }

    let filename = path.file_name()?.to_string_lossy().to_string();
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            log::warn!("Failed to read view file {}: {}", filename, error);
            return None;
        }
    };
    let definition = match serde_yaml::from_str::<ViewDefinition>(&content) {
        Ok(definition) => definition,
        Err(error) => {
            log::warn!("Failed to parse view {}: {}", filename, error);
            return None;
        }
    };

    Some(ViewFile {
        filename,
        definition,
    })
}

pub fn scan_views(vault_path: &Path) -> Vec<ViewFile> {
    migrate_views(vault_path);
    let views_dir = vault_path.join("views");
    if !views_dir.is_dir() {
        return Vec::new();
    }

    let mut views = Vec::new();
    let entries = match fs::read_dir(&views_dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to read views directory: {}", e);
            return Vec::new();
        }
    };

    for entry in entries.flatten() {
        if let Some(view) = read_view_file(&entry.path()) {
            views.push(view);
        }
    }

    views.sort_by(compare_views);
    views
}

fn compare_views(left: &ViewFile, right: &ViewFile) -> Ordering {
    let order = left
        .definition
        .order
        .unwrap_or(i64::MAX)
        .cmp(&right.definition.order.unwrap_or(i64::MAX));
    order.then_with(|| left.filename.cmp(&right.filename))
}

/// Save a view definition as YAML to `vault_path/views/{filename}`.
pub fn save_view(
    vault_path: &Path,
    filename: &str,
    definition: &ViewDefinition,
) -> Result<(), String> {
    if !filename.ends_with(".yml") {
        return Err("Filename must end with .yml".to_string());
    }
    let views_dir = vault_path.join("views");
    fs::create_dir_all(&views_dir)
        .map_err(|e| format!("Failed to create views directory: {}", e))?;
    let yaml = serde_yaml::to_string(definition)
        .map_err(|e| format!("Failed to serialize view: {}", e))?;
    fs::write(views_dir.join(filename), yaml)
        .map_err(|e| format!("Failed to write view file: {}", e))
}

/// Delete a view file at `vault_path/views/{filename}`.
pub fn delete_view(vault_path: &Path, filename: &str) -> Result<(), String> {
    let path = vault_path.join("views").join(filename);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to delete view: {}", error)),
    }
}

/// Evaluate a view definition against vault entries, returning indices of matching entries.
pub fn evaluate_view(definition: &ViewDefinition, entries: &[VaultEntry]) -> Vec<usize> {
    entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| evaluate_group(&definition.filters, entry))
        .map(|(i, _)| i)
        .collect()
}

fn evaluate_group(group: &FilterGroup, entry: &VaultEntry) -> bool {
    match group {
        FilterGroup::All(nodes) => nodes.iter().all(|n| evaluate_node(n, entry)),
        FilterGroup::Any(nodes) => nodes.iter().any(|n| evaluate_node(n, entry)),
    }
}

fn evaluate_node(node: &FilterNode, entry: &VaultEntry) -> bool {
    match node {
        FilterNode::Condition(cond) => evaluate_condition(cond, entry),
        FilterNode::Group(group) => evaluate_group(group, entry),
    }
}

fn build_regex(pattern: &str) -> Option<regex::Regex> {
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .ok()
}

fn supports_regex(op: &FilterOp) -> bool {
    matches!(
        op,
        FilterOp::Contains | FilterOp::Equals | FilterOp::NotContains | FilterOp::NotEquals
    )
}

enum ConditionField<'a> {
    Scalar(Option<String>),
    Relationship(&'a [String]),
}

fn evaluate_condition(cond: &FilterCondition, entry: &VaultEntry) -> bool {
    let field = cond.field.as_str();
    if let Some(result) = evaluate_condition_bool_field(field, entry, &cond.op, &cond.value) {
        return result;
    }

    let field_value = resolve_condition_field(field, entry);
    let cond_value = cond.value.as_ref().and_then(yaml_value_to_string);
    let regex = condition_regex(cond, cond_value.as_deref());

    if invalid_regex_requested(cond, regex.as_ref()) {
        return false;
    }

    if let Some(re) = regex.as_ref() {
        return evaluate_regex_condition(&cond.op, &field_value, re);
    }

    match field_value {
        ConditionField::Relationship(rels) => evaluate_relationship_op(&cond.op, rels, &cond.value),
        ConditionField::Scalar(value) => evaluate_scalar_op(
            &cond.op,
            value.as_deref(),
            cond_value.as_deref(),
            &cond.value,
        ),
    }
}

fn evaluate_condition_bool_field(
    field: &str,
    entry: &VaultEntry,
    op: &FilterOp,
    value: &Option<serde_yaml::Value>,
) -> Option<bool> {
    match field {
        "archived" => Some(evaluate_bool_field(entry.archived, op, value)),
        "favorite" => Some(evaluate_bool_field(entry.favorite, op, value)),
        _ => None,
    }
}

fn resolve_condition_field<'a>(field: &str, entry: &'a VaultEntry) -> ConditionField<'a> {
    match field {
        "type" | "isA" => ConditionField::Scalar(entry.is_a.clone()),
        "status" => ConditionField::Scalar(entry.status.clone()),
        "title" => ConditionField::Scalar(Some(entry.title.clone())),
        "body" => ConditionField::Scalar(Some(entry.snippet.clone())),
        _ => resolve_dynamic_condition_field(field, entry),
    }
}

fn resolve_dynamic_condition_field<'a>(field: &str, entry: &'a VaultEntry) -> ConditionField<'a> {
    if let Some(prop) = entry.properties.get(field) {
        return ConditionField::Scalar(json_scalar_to_string(prop));
    }
    if let Some(relationships) = entry.relationships.get(field) {
        return ConditionField::Relationship(relationships);
    }
    ConditionField::Scalar(None)
}

fn condition_regex(cond: &FilterCondition, cond_value: Option<&str>) -> Option<Regex> {
    if !cond.regex {
        return None;
    }
    if !supports_regex(&cond.op) {
        return None;
    }
    cond_value.and_then(build_regex)
}

fn invalid_regex_requested(cond: &FilterCondition, regex: Option<&Regex>) -> bool {
    if !cond.regex {
        return false;
    }
    if !supports_regex(&cond.op) {
        return false;
    }
    regex.is_none()
}

fn evaluate_regex_condition(op: &FilterOp, field: &ConditionField<'_>, regex: &Regex) -> bool {
    let matched = match field {
        ConditionField::Scalar(Some(value)) => regex.is_match(value),
        ConditionField::Relationship(values) => values.iter().any(|item| {
            relationship_candidates(item)
                .into_iter()
                .any(|candidate| regex.is_match(&candidate))
        }),
        ConditionField::Scalar(None) => false,
    };

    match op {
        FilterOp::Contains | FilterOp::Equals => matched,
        FilterOp::NotContains | FilterOp::NotEquals => !matched,
        _ => false,
    }
}

fn evaluate_scalar_op(
    op: &FilterOp,
    field_value: Option<&str>,
    cond_value: Option<&str>,
    raw_value: &Option<serde_yaml::Value>,
) -> bool {
    match op {
        FilterOp::Equals => scalar_equals(field_value, cond_value),
        FilterOp::NotEquals => !scalar_equals(field_value, cond_value),
        FilterOp::Contains => scalar_contains(field_value, cond_value),
        FilterOp::NotContains => !scalar_contains(field_value, cond_value),
        FilterOp::AnyOf => scalar_matches_any(field_value, raw_value),
        FilterOp::NoneOf => !scalar_matches_any(field_value, raw_value),
        FilterOp::IsEmpty => field_value.map_or(true, str::is_empty),
        FilterOp::IsNotEmpty => field_value.is_some_and(|s| !s.is_empty()),
        FilterOp::Before => {
            scalar_date_compare(field_value, cond_value, |field, target| field < target)
        }
        FilterOp::After => {
            scalar_date_compare(field_value, cond_value, |field, target| field > target)
        }
    }
}

fn scalar_equals(field_value: Option<&str>, cond_value: Option<&str>) -> bool {
    match (field_value, cond_value) {
        (Some(field), Some(value)) => field.eq_ignore_ascii_case(value),
        (None, None) => true,
        _ => false,
    }
}

fn scalar_contains(field_value: Option<&str>, cond_value: Option<&str>) -> bool {
    match (field_value, cond_value) {
        (Some(field), Some(value)) => field.to_lowercase().contains(&value.to_lowercase()),
        _ => false,
    }
}

fn scalar_matches_any(field_value: Option<&str>, raw_value: &Option<serde_yaml::Value>) -> bool {
    let Some(field) = field_value else {
        return false;
    };
    raw_value
        .as_ref()
        .and_then(yaml_value_to_string_vec)
        .unwrap_or_default()
        .iter()
        .any(|value| field.eq_ignore_ascii_case(value))
}

fn scalar_date_compare(
    field_value: Option<&str>,
    cond_value: Option<&str>,
    predicate: impl FnOnce(i64, i64) -> bool,
) -> bool {
    let (Some(field), Some(value)) = (field_value, cond_value) else {
        return false;
    };
    let reference = Utc::now();
    match (
        parse_date_filter_timestamp(field, reference),
        parse_date_filter_timestamp(value, reference),
    ) {
        (Some(field_ts), Some(target_ts)) => predicate(field_ts, target_ts),
        _ => false,
    }
}

fn evaluate_bool_field(field_val: bool, op: &FilterOp, value: &Option<serde_yaml::Value>) -> bool {
    match op {
        FilterOp::Equals => {
            let expected = value.as_ref().and_then(|v| v.as_bool()).unwrap_or(true);
            field_val == expected
        }
        FilterOp::NotEquals => {
            let expected = value.as_ref().and_then(|v| v.as_bool()).unwrap_or(true);
            field_val != expected
        }
        FilterOp::IsEmpty => !field_val,
        FilterOp::IsNotEmpty => field_val,
        _ => false,
    }
}
