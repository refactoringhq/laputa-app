use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A node in the vault's folder tree. Only contains directories, not files.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FolderNode {
    /// Folder name (last path component).
    pub name: String,
    /// Path relative to the vault root, using `/` separators (e.g. "projects/laputa").
    pub path: String,
    /// Child folders (sorted alphabetically).
    pub children: Vec<FolderNode>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct VaultEntry {
    pub path: String,
    pub filename: String,
    pub title: String,
    #[serde(rename = "isA")]
    pub is_a: Option<String>,
    pub aliases: Vec<String>,
    #[serde(rename = "belongsTo")]
    pub belongs_to: Vec<String>,
    #[serde(rename = "relatedTo")]
    pub related_to: Vec<String>,
    pub status: Option<String>,
    pub archived: bool,
    #[serde(rename = "modifiedAt")]
    pub modified_at: Option<u64>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<u64>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub snippet: String,
    /// Generic relationship fields: any frontmatter key whose value contains wikilinks.
    /// Key is the original frontmatter field name (e.g. "Has", "Topics", "Events").
    pub relationships: HashMap<String, Vec<String>>,
    /// Phosphor icon name (kebab-case) for Type entries, e.g. "cooking-pot".
    pub icon: Option<String>,
    /// Accent color key for Type entries: "red", "purple", "blue", "green", "yellow", "orange".
    pub color: Option<String>,
    /// Display order for Type entries in sidebar (lower = higher). None = use default order.
    pub order: Option<i64>,
    /// Custom sidebar section label for Type entries, overriding auto-pluralization.
    #[serde(rename = "sidebarLabel")]
    pub sidebar_label: Option<String>,
    /// Markdown template for notes of this Type. When a new note is created
    /// with this type, the template body is pre-filled after the frontmatter.
    pub template: Option<String>,
    /// Default sort preference for the note list when viewing instances of this Type.
    /// Stored as "option:direction" (e.g. "modified:desc", "title:asc", "property:Priority:asc").
    pub sort: Option<String>,
    /// Default view mode for the note list when viewing instances of this Type.
    /// Stored as a string: "all", "editor-list", or "editor-only".
    pub view: Option<String>,
    /// Whether this Type is visible in the sidebar. Defaults to true when absent.
    pub visible: Option<bool>,
    /// Whether this note has been explicitly organized (removed from Inbox).
    pub organized: bool,
    /// Whether this note is a user favorite (shown in FAVORITES sidebar section).
    pub favorite: bool,
    /// Display order within the FAVORITES section (lower = higher).
    #[serde(rename = "favoriteIndex")]
    pub favorite_index: Option<i64>,
    /// Word count of the note body (excludes frontmatter and H1 title).
    #[serde(rename = "wordCount")]
    pub word_count: u32,
    /// All wikilink targets found in the note body (excludes frontmatter).
    /// Extracted from `[[target]]` and `[[target|display]]` patterns.
    #[serde(rename = "outgoingLinks", default)]
    pub outgoing_links: Vec<String>,
    /// Custom scalar frontmatter properties (non-relationship, non-structural).
    /// Only includes strings, numbers, and booleans — arrays/objects are excluded.
    #[serde(default)]
    pub properties: HashMap<String, serde_json::Value>,
    /// Properties to display as chips in the note list for this Type's notes.
    /// Configured via `_list_properties_display` in the type file's frontmatter.
    #[serde(rename = "listPropertiesDisplay", default)]
    pub list_properties_display: Vec<String>,
    /// Whether the note body has an H1 heading on the first non-empty line.
    /// Used by the frontend to decide whether to show the TitleField.
    #[serde(rename = "hasH1")]
    pub has_h1: bool,
    /// File kind: "markdown", "text", or "binary".
    /// Determines how the frontend renders and opens the file.
    #[serde(rename = "fileKind", default = "default_file_kind")]
    pub file_kind: String,
}

fn default_file_kind() -> String {
    "markdown".to_string()
}
