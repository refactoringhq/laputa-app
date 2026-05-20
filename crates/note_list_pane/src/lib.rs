#![forbid(unsafe_code)]
//! Note-list pane view for Tolaria (ADR-0115 Phase 2d).
//!
//! `NoteListPane` is a GPUI view designed to live as the content of a
//! [`workspace::Pane`].  It renders a filterable, selectable list of notes
//! drawn from [`mock_fixtures::MockVault`].
//!
//! # Layout
//!
//! ```text
//! ┌──────────────────────────────────────────┐
//! │ Filter notes…                            │  ← filter strip
//! ├──────────────────────────────────────────┤
//! │  ☐  Writing              Note   May 17   │  ┐
//! │  ☐  Product              Note   May 17   │  │ scrollable list
//! │     …                                    │  ┘
//! ├──────────────────────────────────────────┤
//! │  3 selected   [Delete]  [Archive]        │  ← bulk bar (≥1 selected)
//! └──────────────────────────────────────────┘
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! cx.set_global(MockVault::seeded());
//! let pane = cx.new(|_| NoteListPane::from_or_empty(cx));
//! ```

use std::collections::HashSet;
use std::path::Path as StdPath;

use chrono::{DateTime, Utc};
use gpui::prelude::FluentBuilder as _;
use gpui::rgb;
use gpui::AppContext as _;
use gpui::EventEmitter;
use gpui::{
    div, px, rems, AnyElement, App, Context, Entity, Hsla, InteractiveElement, IntoElement,
    ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, TextOverflow, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    h_flex,
    input::{Input, InputEvent, InputState},
    menu::DropdownMenu as _,
    scroll::ScrollableElement as _,
    v_flex, ActiveTheme, IconName, Sizable as _, StyledExt as _,
};
use mock_fixtures::{MockVault, NoteId, NoteKind};
use ui::tree_dump::DumpAsExt as _;
use vault::Vault;
use workspace::panel::{DockPosition, Panel};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user activates a note row (single-click on the title
/// area).  `TolariaWorkspace` subscribes to this event and routes it
/// through [`TolariaWorkspace::open_note`].
#[derive(Debug, Clone, Copy)]
pub struct OpenNoteEvent {
    /// Identifier of the note the user wants to open.
    pub id: NoteId,
}

/// Emitted when the user clicks Delete or Archive in the bulk action bar.
///
/// The subscriber (typically `TolariaWorkspace`) performs the vault mutation.
/// `NoteListPane` itself immediately calls `clear_selection` after emitting so
/// the bulk bar collapses and the count chip resets without waiting for the
/// workspace round-trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BulkActionEvent {
    /// Permanently delete every currently-selected note.
    DeleteSelected,
    /// Move every currently-selected note to the archive.
    ArchiveSelected,
}

/// Sort order applied to the visible note rows.
///
/// Defaults to [`NoteListSort::ModifiedDesc`] — newest-modified first,
/// matching the React reference.  Persisted on `NoteListPane` and toggled
/// via the sort glyph in the header.
///
/// `Created` (asc/desc) sort variants intentionally absent — neither
/// `vault::Note` nor `mock_fixtures::MockNote` exposes a created-time
/// distinct from modified-time through the shared [`NoteEntry`] shape,
/// so a `Created` variant would silently alias `Modified` and surprise
/// the user.  The variants land when the vault wires a real created
/// timestamp through to `NoteEntry::created`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NoteListSort {
    /// Most recently modified first (default).
    #[default]
    ModifiedDesc,
    /// Oldest modified first.
    ModifiedAsc,
    /// Alphabetical by title, A → Z.
    TitleAsc,
    /// Alphabetical by title, Z → A.
    TitleDesc,
}

impl NoteListSort {
    /// Short label shown in the sort glyph button (mirrors the React header).
    fn label(self) -> &'static str {
        match self {
            Self::ModifiedDesc | Self::ModifiedAsc => "Modified",
            Self::TitleAsc | Self::TitleDesc => "Title",
        }
    }
}

/// Small status glyph rendered at the right edge of certain note rows.
///
/// Mirrors the React `NoteList.tsx` status indicators.  `None` is the
/// common case; non-`None` variants signal structured-content notes
/// (e.g. a note that contains a chart, a linked contact, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RowStatus {
    /// No status glyph.
    #[default]
    None,
    /// Note contains a chart / metric.
    Chart,
    /// Note is a person / contact record.
    Person,
    /// Note is calendar-linked (an event).
    Calendar,
    /// Note is a project or task tracker.
    Project,
}

impl RowStatus {
    /// Derive a row status from a note entry's type icon.  This is a
    /// best-effort heuristic: in Phase 8 the vault has no explicit
    /// status flag, so we mirror the type icon that was already computed
    /// from the `type/<stem>.md` frontmatter during `from_vault`.
    ///
    /// TODO(Phase 10.x): drive `RowStatus` from the note's
    /// `properties["type"]` string instead of the icon.  The icon is a
    /// presentation choice and a user remapping (e.g. `Person → IconName::Star`)
    /// would silently coerce every Person row to `RowStatus::None`.  The
    /// vault's `type/<stem>.md` frontmatter is the load-bearing source of
    /// truth; the icon is just one projection of it.
    fn from_type_icon(icon: IconName) -> Self {
        match icon {
            IconName::ChartPie => Self::Chart,
            IconName::User => Self::Person,
            IconName::Calendar => Self::Calendar,
            IconName::Frame => Self::Project,
            _ => Self::None,
        }
    }

    /// Returns the icon name used to render this status, or `None` when
    /// no glyph should be drawn.  Used by the row render to pick a
    /// right-edge status glyph for structured-content notes.
    pub fn icon(self) -> Option<IconName> {
        match self {
            Self::None => None,
            Self::Chart => Some(IconName::ChartPie),
            Self::Person => Some(IconName::User),
            Self::Calendar => Some(IconName::Calendar),
            Self::Project => Some(IconName::Frame),
        }
    }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/// Which slice of the vault the note list is showing.
///
/// Driven by the sidebar panel's selection via the workspace's
/// `SidebarSelectionChangedEvent` subscription (Phase 8.1), combined
/// with the text filter in [`NoteListPane::visible_entries`].
///
/// `Inbox`, `AllNotes`, and `View(_)` all pass through every entry for
/// now — the underlying vault has no triage / saved-view metadata
/// yet, so until Phase 10.9 (`vault_registry`) and Phase 8.18
/// (`filter_builder`) land, these scopes show the full list rather
/// than risk hiding everything behind an empty predicate.  `Archive`
/// returns no entries (no archive flag on `Note` yet).  `Type` and
/// `Folder` are the load-bearing filters and narrow the list to
/// matching entries.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum NoteListScope {
    /// Inbox row in the sidebar.  Treated as a pass-through until
    /// the vault surfaces a triage flag (matches the Phase 7
    /// inbox-count = total-count contract in `sidebar_panel`).
    #[default]
    Inbox,
    /// "All Notes" — every entry that is not archived.  Pass-through.
    AllNotes,
    /// "Archive" — only archived entries.  Returns an empty list
    /// until the vault surfaces an archive flag.
    Archive,
    /// Show only notes whose type label matches.  Display label is
    /// filename-prefix-derived (`event-…` → "Events") and mirrors the
    /// sidebar's [`crate::OpenNoteEvent`]-adjacent
    /// `SidebarSelection::Type` payload.
    Type(SharedString),
    /// Show only notes that live in `path` (vault-root-relative).
    /// `""` matches the vault root.  Folder matching is recursive —
    /// descendants of the named folder are included.
    Folder(SharedString),
    /// Show notes flagged by `name`'s saved view.  Phase 9 work; for
    /// the visual-fidelity pass this passes through unchanged.
    View(SharedString),
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Pre-rendered display data for one row in the note list.
///
/// Projected from [`NoteEntry`] during `render()` so that the element-tree
/// closures can be `move` without borrowing `self`.
struct RowData {
    id: NoteId,
    title: SharedString,
    snippet: SharedString,
    modified_label: SharedString,
    created_label: SharedString,
    type_icon: IconName,
    type_color: Hsla,
    checked: bool,
    selected: bool,
    /// Status glyph derived from the note's type at projection time.
    row_status: RowStatus,
}

/// Mix `color` with `base` at the given alpha so it reads as a soft
/// tinted background.  Mirrors `sidebar_panel::palette_tinted_with` —
/// keeps the selected-row highlight at the type's accent hue without
/// turning it into a saturated block.
fn light_tint(color: Hsla, alpha: f32) -> Hsla {
    Hsla {
        h: color.h,
        s: color.s,
        l: color.l,
        a: alpha,
    }
}

/// Format a UTC date as `MMM D, YYYY` — used for the modified /
/// created labels in the note-row footer (issue 010).  Phase 9.8
/// (`localization`) will route this through `lara`; until then the
/// English-only `chrono` formatter is good enough.
fn date_label(when: DateTime<Utc>) -> SharedString {
    SharedString::from(when.format("%b %-d, %Y").to_string())
}

/// Format the "Created MMM D, YYYY" half of the metadata row.
fn created_label(when: DateTime<Utc>) -> SharedString {
    SharedString::from(format!("Created {}", date_label(when)))
}

/// Snapshot of one note's list-view metadata.
///
/// `type_*` fields carry the per-note typography accents used by the
/// reference (issue 010) — the row tint, the trailing icon, and the
/// selected-state highlight all draw from these.  Built once at
/// `from_vault` time by looking up the note's filename prefix in a
/// vault-level type-style table; falls back to neutral defaults when
/// no matching `type/<stem>.md` exists.
#[derive(Clone)]
pub struct NoteEntry {
    /// Stable identifier for the underlying note.
    pub id: NoteId,
    /// Display title.
    pub title: SharedString,
    /// File-level note kind.
    pub kind: NoteKind,
    /// Last-modified timestamp (UTC).
    pub modified: DateTime<Utc>,
    /// First non-frontmatter, non-heading line of the note body,
    /// truncated to fit the row.  Empty when the body is empty or
    /// the loader did not populate it.
    pub snippet: SharedString,
    /// Trailing-corner icon for this note's type (e.g. `Calendar`
    /// for Events).  Falls back to `IconName::File`.
    pub type_icon: IconName,
    /// Accent colour for this note's type (orange for Events, …).
    /// Drives the trailing icon tint and the selected-row light
    /// background.
    pub type_color: Hsla,
    /// Display label of this note's type, used by
    /// [`NoteListScope::Type`] to narrow the visible list.  Mirrors
    /// the sidebar's `SidebarSelection::Type` payload — derived from
    /// the filename prefix (`event-foo.md` → `"Events"`), defaults to
    /// `"Notes"` for anything that doesn't match a known prefix.
    pub type_label: SharedString,
    /// Vault-root-relative parent directory, used by
    /// [`NoteListScope::Folder`] to narrow the visible list.  `""`
    /// means the vault root.  For the mock-fixture launch path
    /// (`MockVault`, no vault root) this is left empty so the
    /// folder-scope filter is a no-op.
    pub parent_path: SharedString,
    /// YAML frontmatter `type` value (e.g. `"Project"`, `"Person"`),
    /// used by [`NoteListScope::View`] to narrow the visible list to
    /// entries that match a saved view's filter predicate.  Empty when
    /// the note has no `type` frontmatter — those notes are excluded
    /// from every view filter.  Distinct from [`Self::type_label`],
    /// which is filename-prefix-derived and drives the sidebar's TYPES
    /// section; the saved-view filter uses the frontmatter value
    /// instead because it survives renames and matches the YAML
    /// definition in `<vault>/views/*.yml`.
    pub view_type: SharedString,
}

/// Default header-strip title — mirrors the sidebar's default
/// highlight ([`SidebarSelection::Inbox`]) so the pane opens in sync
/// with the sidebar before any selection event fires.
#[inline]
fn default_header_title() -> SharedString {
    SharedString::new_static("Inbox")
}

/// Extract a display title from a note body — first H1 heading,
/// else a YAML frontmatter `title:` field, else `None`.  Mirrors the
/// `extractH1TitleFromContent` / `extractFrontmatterTitleFromContent`
/// pair in `src/utils/noteTitle.ts` so the native chrome surfaces
/// the same display string as the Tauri-era app.
fn extract_title(body: &str) -> Option<String> {
    let mut frontmatter_title: Option<String> = None;
    let mut lines = body.lines().peekable();

    if lines.peek().map(|l| l.trim()) == Some("---") {
        let _ = lines.next();
        for line in lines.by_ref() {
            let trimmed = line.trim();
            if trimmed == "---" {
                break;
            }
            if frontmatter_title.is_none() {
                if let Some(rest) = trimmed.strip_prefix("title:") {
                    let v = rest.trim().trim_matches(|c| c == '"' || c == '\'');
                    if !v.is_empty() {
                        frontmatter_title = Some(v.to_string());
                    }
                }
            }
        }
    }

    for line in lines {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Some(rest) = t.strip_prefix("# ") {
            let h1 = rest.trim();
            if !h1.is_empty() {
                return Some(h1.to_string());
            }
        }
        break;
    }

    frontmatter_title
}

/// Soft upper bound on the length of a single snippet line passed to
/// GPUI's text layout (in graphemes).  GPUI wraps at word boundaries
/// and `line_clamp(2)` decides which line to cut on, so the *visible*
/// truncation point depends on the resizable note-list column width
/// at paint time — not on this constant.  We only cap the source
/// string so a pathological 100-kB single-line note doesn't force
/// the layout engine through every codepoint just to discard 99% of
/// the resulting wrapped output.  Generous enough that any realistic
/// preview fits before the cap kicks in.
const SNIPPET_SOFT_MAX_CHARS: usize = 2000;

/// Extract a multi-line preview from a note's raw markdown body.
///
/// Strips a YAML frontmatter block (when present), then returns the
/// first non-empty, non-heading line **verbatim** (modulo whitespace
/// trim).  Visual truncation — including the wrap point and the
/// trailing `...` ellipsis — is done by GPUI at paint time via
/// `line_clamp(2) + text_overflow(Truncate("..."))`, so the snippet
/// reflows when the user resizes the note-list column.
fn extract_snippet(body: &str) -> String {
    let mut lines = body.lines().peekable();

    // Skip a leading YAML frontmatter block: `---` ... `---`.
    if lines.peek().map(|l| l.trim()) == Some("---") {
        let _ = lines.next();
        let mut closed = false;
        for line in lines.by_ref() {
            if line.trim() == "---" {
                closed = true;
                break;
            }
        }
        if !closed {
            return String::new();
        }
    }

    for line in lines {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        // Guard against pathological single-line megabytes — the
        // word-wrap pass would visit every codepoint otherwise.
        // Cut at a UTF-8 char boundary, not a byte boundary.
        if t.chars().count() > SNIPPET_SOFT_MAX_CHARS {
            return t.chars().take(SNIPPET_SOFT_MAX_CHARS).collect();
        }
        return t.to_string();
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Type-style lookup
// ---------------------------------------------------------------------------

/// Visual contract for one note type, sourced from the
/// `<vault_root>/type/<stem>.md` frontmatter.  Mirrors the per-type
/// resolution `sidebar_panel` does for its TYPES rows — kept inline
/// here (rather than pulled from a shared crate) so the note-list
/// rewrite stays self-contained while the wider chrome lands.
#[derive(Clone)]
struct NoteTypeStyle {
    icon: IconName,
    color: Hsla,
}

impl NoteTypeStyle {
    fn fallback() -> Self {
        Self {
            icon: IconName::File,
            color: rgb(0x6B7280).into(),
        }
    }
}

/// Map a note's filename stem prefix to the canonical type label that
/// `<vault_root>/type/<stem>.md` is keyed by (`event-team-sync.md` →
/// `Some("event")`).
fn type_stem_for_path(path: &StdPath) -> Option<String> {
    let stem = path.file_stem().and_then(|s| s.to_str())?;
    let prefix = stem.split_once('-').map(|(p, _)| p).unwrap_or(stem);
    Some(prefix.to_ascii_lowercase())
}

/// Map a filename's prefix to its display TYPES label.  Mirrors
/// `sidebar_panel::type_label_for` so the sidebar's
/// `SidebarSelection::Type` payloads round-trip cleanly into
/// [`NoteListScope::Type`] without a cross-crate dep — kept inline
/// while the Phase 9 cross-cutting `view_state` extraction is still
/// pending.  Returns `"Notes"` for anything that doesn't match a
/// known prefix, matching the sidebar's fallback bucket.
fn type_label_for(path: &StdPath) -> &'static str {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    let prefix = stem
        .split_once('-')
        .map(|(p, _)| p)
        .unwrap_or(stem)
        .to_ascii_lowercase();
    match prefix.as_str() {
        "area" => "Areas",
        "event" => "Events",
        "measure" => "Measures",
        "person" => "People",
        "procedure" => "Procedures",
        "responsibility" => "Responsibilities",
        "topic" => "Topics",
        "project" => "Projects",
        "quarter" => "Quarters",
        _ => "Notes",
    }
}

/// Read the frontmatter `type` value as a [`SharedString`], or an
/// empty string when the note has no `type` declaration.  Used to
/// populate [`NoteEntry::view_type`] from a real `vault::Note` so
/// [`NoteListScope::View`] can narrow the list to e.g. `type: Project`
/// entries.  Only `FrontmatterValue::Text` participates — numeric /
/// boolean / list values are treated as "no type" because a saved
/// view's `value` field is always a string in the YAML schema.
fn frontmatter_view_type(fm: &vault::Frontmatter) -> SharedString {
    match fm.get("type") {
        Some(vault::FrontmatterValue::Text(s)) => s.clone(),
        _ => SharedString::default(),
    }
}

/// Read the `MockNote::properties["type"]` value as a [`SharedString`].
/// Mirrors [`frontmatter_view_type`] for the demo-mode launch path so
/// `cargo run --bin tolaria` with `TOLARIA_MOCK=1` exercises the same
/// saved-view filter as the real-vault path.  Falls back to an empty
/// string for missing / non-string properties — the same "absent"
/// signal we use for real notes.
fn mock_view_type(note: &mock_fixtures::MockNote) -> SharedString {
    note.properties
        .get("type")
        .and_then(|v| v.as_str())
        .map(SharedString::from)
        .unwrap_or_default()
}

/// Project `path`'s parent onto a vault-root-relative string.  `""`
/// means the vault root.  When `vault_root` is `None` (mock-fixture
/// path with no real on-disk vault) the parent is left empty so the
/// folder-scope filter is a no-op rather than narrowing against
/// fictional absolute paths.
fn vault_relative_parent(path: &StdPath, vault_root: Option<&StdPath>) -> SharedString {
    let Some(parent) = path.parent() else {
        return SharedString::default();
    };
    let rel = match vault_root {
        Some(root) => parent.strip_prefix(root).unwrap_or(parent),
        None => return SharedString::default(),
    };
    let s = rel.to_string_lossy();
    if s.is_empty() {
        SharedString::default()
    } else {
        SharedString::from(s.into_owned())
    }
}

/// Walk `<vault_root>/type/*.md` and build a (stem → style) map.
/// Empty when the directory is missing or unreadable; render-side
/// callers fall back to [`NoteTypeStyle::fallback`].
fn load_note_type_styles(vault_root: &StdPath) -> std::collections::HashMap<String, NoteTypeStyle> {
    let mut out = std::collections::HashMap::new();
    let dir = vault_root.join("type");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
        else {
            continue;
        };
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        let frontmatter = parse_note_frontmatter(&body);
        let icon = frontmatter
            .get("icon")
            .map(|s| icon_for_frontmatter_name(s))
            .unwrap_or(IconName::File);
        let color = frontmatter
            .get("color")
            .map(|s| color_for_frontmatter_name(s))
            .unwrap_or_else(|| rgb(0x6B7280).into());
        out.insert(stem, NoteTypeStyle { icon, color });
    }
    out
}

/// Minimal YAML frontmatter parser — `key: value` lines between two
/// `---` markers, quotes stripped.  Same shape as
/// `sidebar_panel::parse_frontmatter`; duplicated to avoid a
/// cross-crate dep just for the visual-fidelity pass.
fn parse_note_frontmatter(body: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let mut lines = body.lines();
    let Some(first) = lines.next() else {
        return out;
    };
    if first.trim() != "---" {
        return out;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
        if !value.is_empty() {
            out.insert(key, value.to_owned());
        }
    }
    out
}

fn icon_for_frontmatter_name(name: &str) -> IconName {
    match name.to_ascii_lowercase().as_str() {
        "calendar" => IconName::Calendar,
        "folder" | "folders" => IconName::FolderClosed,
        "book" | "books" | "book-open" => IconName::BookOpen,
        "chart" | "chart-line-up" | "chart-pie" => IconName::ChartPie,
        "user" | "person" => IconName::User,
        "rocket" => IconName::Frame,
        "clock" | "clock-countdown" | "timer" => IconName::Calendar,
        "note" | "note-pencil" => IconName::File,
        "star" => IconName::Star,
        "settings" | "gear" => IconName::Settings,
        "globe" => IconName::Globe,
        _ => IconName::File,
    }
}

/// Per-entry scope predicate — returns whether `entry` belongs in the
/// list when the active scope is `scope`.  Lifted out of
/// [`NoteListPane::visible_entries`] so the row-level rule is easy to
/// scan independently of the closure plumbing.
///
/// Recursive folder match: `Folder("foo")` includes everything under
/// `foo/` plus the folder itself (`parent_path` == `"foo"`), so
/// selecting a non-leaf in the sidebar yields the union of every
/// descendant.  Matches the React tree's "click folder = show
/// everything inside" semantics.
fn scope_matches(scope: &NoteListScope, entry: &NoteEntry) -> bool {
    match scope {
        NoteListScope::Inbox | NoteListScope::AllNotes => true,
        NoteListScope::Archive => false,
        NoteListScope::Type(label) => entry.type_label.as_ref() == label.as_ref(),
        NoteListScope::Folder(path) => {
            // Empty path = vault root = every entry passes.
            if path.is_empty() {
                return true;
            }
            let ep = entry.parent_path.as_ref();
            ep == path.as_ref() || ep.starts_with(&format!("{path}/"))
        }
        NoteListScope::View(name) => view_matches(name, entry),
    }
}

/// Predicate for the built-in saved views shown in the sidebar's
/// VIEWS section.  Each arm mirrors the YAML definition in
/// `<vault>/views/*.yml` (e.g. `active-projects.yml` filters
/// `type == Project`); the lookup is a small `match` rather than a
/// runtime parse so the hot path on every entry stays branch-only.
///
/// Unknown view names fall back to "pass everything through" so a
/// future user-defined view in the sidebar list doesn't silently empty
/// the note list before Phase 8.18 (`filter_builder`) wires the real
/// YAML-driven engine.
fn view_matches(name: &SharedString, entry: &NoteEntry) -> bool {
    match name.as_ref() {
        "Active Projects" => entry.view_type.as_ref() == "Project",
        _ => true,
    }
}

fn color_for_frontmatter_name(name: &str) -> Hsla {
    let rgb_u32: u32 = match name.to_ascii_lowercase().as_str() {
        "amber" => 0xF59E0B,
        "orange" => 0xD9730D,
        "yellow" => 0xD69E2E,
        "red" => 0xE53E3E,
        "rose" => 0xE11D48,
        "pink" => 0xEC4899,
        "violet" => 0x8B5CF6,
        "purple" => 0x805AD5,
        "indigo" => 0x6366F1,
        "blue" => 0x155DFF,
        "sky" => 0x38BDF8,
        "cyan" => 0x06B6D4,
        "teal" => 0x14B8A6,
        "emerald" => 0x10B981,
        "green" => 0x38A169,
        "slate" => 0x64748B,
        "gray" | "grey" => 0x6B7280,
        _ => 0x6B7280,
    };
    rgb(rgb_u32).into()
}

// ---------------------------------------------------------------------------
// NoteListPane view
// ---------------------------------------------------------------------------

/// Filterable, selectable note-list view for the workspace centre pane.
///
/// # Constructors
///
/// | Constructor | When to use |
/// |---|---|
/// | [`NoteListPane::new`] | Empty list; use in tests or before vault loads. |
/// | [`NoteListPane::from_mock`] | Pre-populate from [`MockVault`] global. |
/// | [`NoteListPane::from_or_empty`] | Degrade gracefully when mock not installed. |
pub struct NoteListPane {
    entries: Vec<NoteEntry>,
    filter: SharedString,
    /// Slice of the vault the list is currently scoped to.  Defaults
    /// to [`NoteListScope::Inbox`] — pass-through until the workspace
    /// routes a different scope in via the sidebar's selection event
    /// (Phase 8.1).
    scope: NoteListScope,
    /// Title shown in the header strip.  Mirrors the display label of
    /// the currently-selected sidebar row so the user sees which slice
    /// of the vault the list is showing (worklist 2.1).  Defaults to
    /// `"Inbox"` because the sidebar opens with the Inbox row
    /// highlighted.  Workspace updates this through
    /// [`Self::set_header_title`] when a `SidebarSelectionChangedEvent`
    /// fires.
    header_title: SharedString,
    selected: HashSet<NoteId>,
    /// Id of the note currently shown in the editor.  Drives the
    /// pale-accent background on the matching row — mirrors the
    /// "active note" highlight in the reference screenshots.
    selected_id: Option<NoteId>,
    position: DockPosition,
    /// Current sort order applied to [`Self::visible_entries`].
    /// Defaults to [`NoteListSort::ModifiedDesc`].
    sort_order: NoteListSort,
    /// Whether the inline filter text strip is visible below the header.
    filter_open: bool,
    /// GPUI input state for the filter text strip.  Created lazily when
    /// the user first opens the strip and retained afterwards so the
    /// query survives open/close toggles without being wiped.
    filter_input: Option<Entity<InputState>>,
}

impl NoteListPane {
    /// Create an empty pane with no entries and no filter.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            filter: SharedString::default(),
            scope: NoteListScope::default(),
            header_title: default_header_title(),
            selected: HashSet::new(),
            selected_id: None,
            position: DockPosition::Left,
            sort_order: NoteListSort::default(),
            filter_open: false,
            filter_input: None,
        }
    }

    /// Build a pane pre-populated from the [`MockVault`] global.
    ///
    /// All vault calls return `Task::ready(…)` so `block_on` resolves
    /// immediately without blocking the foreground thread.
    ///
    /// # Panics
    ///
    /// Panics if the [`MockVault`] global is not installed on `cx`.
    pub fn from_mock(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<MockVault>();
        let ids = executor.block_on(vault.notes());
        let mut entries = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                // MockVault has no on-disk `type/*.md`, so every row
                // takes the neutral default (`File` glyph in slate).
                let style = NoteTypeStyle::fallback();
                entries.push(NoteEntry {
                    id: note.id,
                    title: note.title.clone(),
                    kind: note.kind,
                    modified: note.modified,
                    // MockVault doesn't expose bodies; snippets stay
                    // empty for the demo-mode path.  Real bodies show
                    // up via `from_vault`.
                    snippet: SharedString::default(),
                    type_icon: style.icon,
                    type_color: style.color,
                    // `type_label_for` only consumes the filename
                    // prefix, so MockVault paths (which lack a real
                    // vault root) round-trip the sidebar's
                    // `SidebarSelection::Type` payloads correctly.
                    type_label: SharedString::new_static(type_label_for(&note.path)),
                    // Mock paths aren't rooted at a real vault, so
                    // we leave `parent_path` empty — the folder-scope
                    // filter then no-ops, which matches what users
                    // expect in `TOLARIA_MOCK=1`.
                    parent_path: vault_relative_parent(&note.path, None),
                    // `MockNote::properties` mirrors the on-disk YAML
                    // frontmatter — the seed sets `properties["type"]`
                    // for every fixture note, so saved-view filters
                    // (e.g. Active Projects) work without a real vault.
                    view_type: mock_view_type(&note),
                });
            }
        }
        // Worklist 2.2 — startup must mirror the React variant, which
        // opens with no row highlighted and the center pane in its
        // empty state.  Auto-selecting the first entry would route a
        // click-equivalent through `selected_id` and surface the
        // pale-accent highlight before the user has touched anything.
        // The first user click flips this via `open()` / `set_active`.
        let selected_id: Option<NoteId> = None;
        Self {
            entries,
            filter: SharedString::default(),
            scope: NoteListScope::default(),
            header_title: default_header_title(),
            selected: HashSet::new(),
            selected_id,
            position: DockPosition::Left,
            sort_order: NoteListSort::default(),
            filter_open: false,
            filter_input: None,
        }
    }

    /// Build a pane pre-populated from the real `vault::Vault` global.
    ///
    /// # Panics
    ///
    /// Panics if the [`Vault`] global is not installed on `cx`.
    pub fn from_vault(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<Vault>();
        let vault_root = vault.root().to_path_buf();
        let type_styles = load_note_type_styles(&vault_root);
        let ids = executor.block_on(vault.notes());
        let mut entries = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                // Load the body to derive a one-line preview AND the
                // display title (H1 / frontmatter, falling back to the
                // filename stem).  Cheap for the demo vault (~30
                // files); future work can batch this through a
                // vault-side snippet cache.
                let body = executor.block_on(vault.note_content(id)).ok();
                let title: SharedString = body
                    .as_deref()
                    .and_then(extract_title)
                    .map(SharedString::from)
                    .unwrap_or_else(|| note.title.clone());
                let snippet = body
                    .as_deref()
                    .map(extract_snippet)
                    .unwrap_or_default()
                    .into();
                let style = type_stem_for_path(&note.path)
                    .and_then(|stem| type_styles.get(&stem).cloned())
                    .unwrap_or_else(NoteTypeStyle::fallback);
                entries.push(NoteEntry {
                    id: note.id,
                    title,
                    kind: note.kind,
                    modified: note.modified,
                    snippet,
                    type_icon: style.icon,
                    type_color: style.color,
                    type_label: SharedString::new_static(type_label_for(&note.path)),
                    parent_path: vault_relative_parent(&note.path, Some(&vault_root)),
                    // Pull the frontmatter `type` value so saved-view
                    // filters (`NoteListScope::View`) can narrow to
                    // notes whose YAML declares e.g. `type: Project`.
                    view_type: frontmatter_view_type(note.frontmatter()),
                });
            }
        }
        // Worklist 2.2 — see comment in `from_mock`.  No row is
        // pre-selected at startup so the workspace boots into the
        // empty-note placeholder, matching the React variant.
        let selected_id: Option<NoteId> = None;
        Self {
            entries,
            filter: SharedString::default(),
            scope: NoteListScope::default(),
            header_title: default_header_title(),
            selected: HashSet::new(),
            selected_id,
            position: DockPosition::Left,
            sort_order: NoteListSort::default(),
            filter_open: false,
            filter_input: None,
        }
    }

    /// Build from `vault::Vault` if installed, else [`MockVault`], else
    /// an empty pane.  Phase 5-MVP precedence: real > mock > empty.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::new()
        }
    }

    /// Update the substring filter and notify observers.
    ///
    /// An empty `query` shows all entries.  Matching is case-insensitive
    /// substring search on [`NoteEntry::title`].
    pub fn set_filter(&mut self, query: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.filter = query.into();
        cx.notify();
    }

    /// Switch the active [`NoteListScope`] — re-renders if the scope
    /// actually changes.  Workspace consumers call this from the
    /// `SidebarSelectionChangedEvent` subscription (Phase 8.1) so
    /// clicking a sidebar row narrows the visible list immediately.
    pub fn set_scope(&mut self, scope: NoteListScope, cx: &mut Context<Self>) {
        if self.scope != scope {
            self.scope = scope;
            cx.notify();
        }
    }

    /// Active [`NoteListScope`].  Test / debugging hook.
    #[must_use]
    pub fn scope(&self) -> &NoteListScope {
        &self.scope
    }

    /// Update the header strip title (worklist 2.1).  Workspace calls
    /// this from the `SidebarSelectionChangedEvent` subscription so the
    /// header reflects the display label of the highlighted sidebar
    /// row ("Inbox", "All Notes", "Archive", a type name, a saved
    /// view name, or a folder's display label).  No-op when the title
    /// already matches.
    pub fn set_header_title(&mut self, title: impl Into<SharedString>, cx: &mut Context<Self>) {
        let title = title.into();
        if self.header_title != title {
            self.header_title = title;
            cx.notify();
        }
    }

    /// Current header title.  Test / debugging hook.
    #[must_use]
    pub fn header_title(&self) -> &SharedString {
        &self.header_title
    }

    /// Toggle selection of `id`: adds if absent, removes if present.
    pub fn toggle_selection(&mut self, id: NoteId, cx: &mut Context<Self>) {
        if !self.selected.remove(&id) {
            self.selected.insert(id);
        }
        cx.notify();
    }

    /// Clear all selected entries.
    pub fn clear_selection(&mut self, cx: &mut Context<Self>) {
        self.selected.clear();
        cx.notify();
    }

    /// Number of currently selected entries.
    pub fn selection_count(&self) -> usize {
        self.selected.len()
    }

    /// Entries that pass the current filter AND scope, sorted by
    /// [`Self::sort_order`].
    ///
    /// Returns every entry when both filter and scope are
    /// pass-throughs (the default — empty filter, scope =
    /// [`NoteListScope::Inbox`]).  Allocates a `Vec` for the sort
    /// step; the unsorted path (no filter, no scope) just iterates.
    pub fn visible_entries(&self) -> impl Iterator<Item = &NoteEntry> + '_ {
        // MSRV is 1.77 — `Option::is_none_or` (1.82) is not available,
        // so we keep the `map_or(true, …)` predicate.
        let q = (!self.filter.is_empty()).then(|| self.filter.to_lowercase());
        let scope = self.scope.clone();
        let mut out: Vec<&NoteEntry> = self
            .entries
            .iter()
            .filter(move |e| {
                if !scope_matches(&scope, e) {
                    return false;
                }
                q.as_deref()
                    .map_or(true, |q| e.title.to_lowercase().contains(q))
            })
            .collect();
        // Title is used as a stable tie-breaker for the time-based sorts so
        // notes with identical `modified` timestamps (e.g. files written
        // back-to-back in a test fixture) produce a deterministic order
        // instead of leaking filesystem-walk order through to the UI.
        match self.sort_order {
            NoteListSort::ModifiedDesc => out.sort_by(|a, b| {
                b.modified
                    .cmp(&a.modified)
                    .then_with(|| a.title.cmp(&b.title))
            }),
            NoteListSort::ModifiedAsc => out.sort_by(|a, b| {
                a.modified
                    .cmp(&b.modified)
                    .then_with(|| a.title.cmp(&b.title))
            }),
            NoteListSort::TitleAsc => out.sort_by(|a, b| a.title.cmp(&b.title)),
            NoteListSort::TitleDesc => out.sort_by(|a, b| b.title.cmp(&a.title)),
        }
        out.into_iter()
    }

    /// Current sort order.  Test / debugging hook.
    #[must_use]
    pub fn sort_order(&self) -> NoteListSort {
        self.sort_order
    }

    /// Update the sort order and re-render.
    pub fn set_sort_order(&mut self, order: NoteListSort, cx: &mut Context<Self>) {
        if self.sort_order != order {
            self.sort_order = order;
            cx.notify();
        }
    }

    /// Whether the inline filter strip is currently open.
    #[must_use]
    pub fn filter_open(&self) -> bool {
        self.filter_open
    }

    /// Toggle the inline filter strip.  Opening it lazily creates
    /// (or reuses) the [`InputState`] and subscribes to its
    /// [`InputEvent::Change`] so every keystroke calls [`Self::set_filter`].
    pub fn toggle_filter_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.filter_open = !self.filter_open;
        if self.filter_open && self.filter_input.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx).placeholder("Filter notes…"));
            // GPUI's `Context::subscribe` wraps the event dispatch in
            // `pane.update(cx, …)`, so the closure receives the pane
            // as `&mut Self` *inside* the borrow.  Operate on that
            // borrow directly — `cx.entity().update(…)` here would
            // re-enter the slot lease and panic on the first
            // keystroke (worklist 1.1 regression).
            cx.subscribe(
                &input,
                move |pane, input: Entity<InputState>, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Change) {
                        let text = input.read(cx).value();
                        pane.set_filter(text, cx);
                    }
                },
            )
            .detach();
            self.filter_input = Some(input);
        }
        cx.notify();
    }

    /// Emit a [`BulkActionEvent`] and immediately clear the selection so
    /// the bulk bar collapses without waiting for the workspace round-trip.
    pub fn bulk_action(&mut self, action: BulkActionEvent, cx: &mut Context<Self>) {
        cx.emit(action);
        self.clear_selection(cx);
    }
}

impl Default for NoteListPane {
    fn default() -> Self {
        Self::new()
    }
}

impl EventEmitter<OpenNoteEvent> for NoteListPane {}
impl EventEmitter<BulkActionEvent> for NoteListPane {}

impl Panel for NoteListPane {
    fn persistent_name(&self) -> &str {
        "NoteListPane"
    }

    fn panel_key(&self) -> &str {
        "note-list"
    }

    fn position(&self, _cx: &App) -> DockPosition {
        self.position
    }

    fn set_position(&mut self, position: DockPosition, cx: &mut Context<Self>) {
        self.position = position;
        cx.notify();
    }

    fn default_size(&self, _cx: &App) -> gpui::Pixels {
        gpui::px(280.0)
    }

    fn icon(&self) -> Option<&str> {
        Some("list")
    }

    fn toggle_action(&self) -> Box<dyn gpui::Action> {
        // Reuses `ToggleSidebar` for MVP — the left column is one
        // panel slot from the user's perspective.  A dedicated
        // `ToggleNoteList` action lands when the chrome supports
        // multiple visible left-column panels.
        Box::new(actions::ToggleSidebar)
    }

    fn starts_open(&self, _cx: &App) -> bool {
        true
    }
}

impl NoteListPane {
    /// Emit an [`OpenNoteEvent`] for `id`.  Called by the row click
    /// handler; exposed publicly so test harnesses can drive the event
    /// without simulating a click.  The row itself is immediately
    /// marked as the active note so the pale-accent highlight tracks
    /// the click without waiting for the workspace to round-trip the
    /// event.
    pub fn open(&mut self, id: NoteId, cx: &mut Context<Self>) {
        self.selected_id = Some(id);
        cx.emit(OpenNoteEvent { id });
        cx.notify();
    }

    /// Set the active-note highlight without emitting an
    /// [`OpenNoteEvent`].  Used by the workspace to keep the pale
    /// accent in sync when the open-note flow originates elsewhere
    /// (e.g. a keymap action, future quick-open palette).
    pub fn set_active(&mut self, id: Option<NoteId>, cx: &mut Context<Self>) {
        if self.selected_id != id {
            self.selected_id = id;
            cx.notify();
        }
    }

    /// Id of the note currently rendered with the pale-accent
    /// highlight.  Test / debugging hook.
    #[must_use]
    pub fn active(&self) -> Option<NoteId> {
        self.selected_id
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/// Header-strip icon action — a 16-pt icon, optionally paired with a
/// short text label (used by the "Modified" sort indicator).  Tagged
/// via `dump_as` so periscope can target it by id.
fn header_icon_action(
    id: &'static str,
    icon: IconName,
    label: Option<&'static str>,
    muted: Hsla,
    hover: Hsla,
) -> AnyElement {
    let mut row = h_flex()
        .id(id)
        .items_center()
        .gap(px(4.0))
        .text_xs()
        .text_color(muted)
        .cursor_pointer()
        .hover(|this| this.text_color(hover));
    if let Some(text) = label {
        row = row.child(SharedString::new_static(text));
    }
    row.child(icon).dump_as(id).into_any_element()
}

impl Render for NoteListPane {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Pre-extract theme colours to avoid repeated borrows inside closures.
        let border_color = cx.theme().border;
        let muted = cx.theme().muted_foreground;
        let fg = cx.theme().foreground;
        let bg = cx.theme().background;
        let hover_bg = cx.theme().list_hover;

        let entity = cx.entity();
        let n_selected = self.selection_count();
        let has_selection = n_selected > 0;
        let selected_id = self.selected_id;

        let rows: Vec<RowData> = self
            .visible_entries()
            .map(|e| RowData {
                id: e.id,
                title: e.title.clone(),
                snippet: e.snippet.clone(),
                modified_label: date_label(e.modified),
                created_label: created_label(e.modified),
                type_icon: e.type_icon.clone(),
                type_color: e.type_color,
                checked: self.selected.contains(&e.id),
                selected: selected_id == Some(e.id),
                row_status: RowStatus::from_type_icon(e.type_icon.clone()),
            })
            .collect();

        // --- Header strip: title + sort indicator + action glyphs ---
        // Mirrors `NoteListHeader.tsx` — 52-pt tall, left-aligned
        // title (reflects the selected sidebar row, worklist 2.1),
        // right-aligned cluster of icon actions (ChevronsUpDown sort
        // + Search + Plus).
        let header_title = self.header_title.clone();
        let sort_label = self.sort_order.label();
        let sort_entity = cx.entity();
        let search_entity = cx.entity();

        // Sort button — `Button` implements `DropdownMenu` so we can
        // call `.dropdown_menu(...)` directly on a `Button`.
        let sort_button = Button::new("note-list-sort")
            .ghost()
            .small()
            .label(SharedString::new_static(sort_label))
            .icon(IconName::ChevronsUpDown)
            .dropdown_menu(move |menu: gpui_component::menu::PopupMenu, _window, _cx| {
                let e = sort_entity.clone();
                menu.item(
                    gpui_component::menu::PopupMenuItem::new("Modified (newest first)").on_click(
                        move |_, _, cx| {
                            e.update(cx, |p, cx| p.set_sort_order(NoteListSort::ModifiedDesc, cx));
                        },
                    ),
                )
                .item(
                    gpui_component::menu::PopupMenuItem::new("Modified (oldest first)").on_click({
                        let e = sort_entity.clone();
                        move |_, _, cx| {
                            e.update(cx, |p, cx| p.set_sort_order(NoteListSort::ModifiedAsc, cx));
                        }
                    }),
                )
                .item(
                    gpui_component::menu::PopupMenuItem::new("Title A → Z").on_click({
                        let e = sort_entity.clone();
                        move |_, _, cx| {
                            e.update(cx, |p, cx| p.set_sort_order(NoteListSort::TitleAsc, cx));
                        }
                    }),
                )
                .item(
                    gpui_component::menu::PopupMenuItem::new("Title Z → A").on_click({
                        let e = sort_entity.clone();
                        move |_, _, cx| {
                            e.update(cx, |p, cx| p.set_sort_order(NoteListSort::TitleDesc, cx));
                        }
                    }),
                )
            });

        // Search glyph — clicking toggles the inline filter strip.
        let search_button = h_flex()
            .id("note-list-search")
            .items_center()
            .gap(px(4.0))
            .text_xs()
            .text_color(muted)
            .cursor_pointer()
            .hover(|this| this.text_color(fg))
            .child(IconName::Search)
            .on_click(move |_, window, cx| {
                search_entity.update(cx, |pane, cx| pane.toggle_filter_open(window, cx));
            })
            .dump_as("note-list-search");

        let header_strip = h_flex()
            .h(px(52.0))
            .min_h(px(52.0))
            .items_center()
            .justify_between()
            .px(px(16.0))
            .border_b_1()
            .border_color(border_color)
            .child(
                div()
                    .items_center()
                    .text_sm()
                    .font_semibold()
                    .text_color(fg)
                    // Sidebar labels are short enough (longest is
                    // "Responsibilities" at 16 chars) that the 52-pt
                    // header strip fits every label without
                    // truncation.  Skipping `text_overflow` keeps the
                    // element non-stateful, matching `note-list-header`
                    // children for consistency.
                    .child(header_title)
                    .dump_as("note-list-pane-header-title")
                    .into_any_element(),
            )
            .child(
                h_flex()
                    .items_center()
                    .gap(px(12.0))
                    .text_color(muted)
                    .child(sort_button)
                    .child(search_button)
                    .child(header_icon_action(
                        "note-list-new",
                        IconName::Plus,
                        None,
                        muted,
                        fg,
                    )),
            )
            .dump_as("note-list-header");

        // --- Filter strip (shown when filter_open) ---
        let filter_strip: Option<AnyElement> = if self.filter_open {
            self.filter_input.as_ref().map(|input_state| {
                h_flex()
                    .h(px(36.0))
                    .items_center()
                    .px(px(8.0))
                    .border_b_1()
                    .border_color(border_color)
                    .child(Input::new(input_state))
                    .dump_as("note-list-filter-strip")
                    .into_any_element()
            })
        } else {
            None
        };

        // --- Scrollable list ---
        let list: AnyElement = if rows.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .child(div().text_sm().text_color(muted).child("No notes"))
                .into_any_element()
        } else {
            div()
                .flex_1()
                .overflow_y_scrollbar()
                .children(rows.into_iter().enumerate().map(|(ix, row)| {
                    let note_id = row.id;
                    let e = entity.clone();
                    let checked = row.checked;

                    let checkbox: AnyElement = if has_selection {
                        Checkbox::new(("nlp-chk", ix as u64))
                            .checked(checked)
                            .on_click(move |_, _window, cx| {
                                e.update(cx, |this, cx| this.toggle_selection(note_id, cx));
                            })
                            .into_any_element()
                    } else {
                        div().into_any_element()
                    };

                    let open_handle = entity.clone();
                    // Issue 011 — row layout matched to the Tauri/React
                    // reference:
                    //   - reduced row padding (px-3, py-2.5) so each
                    //     card reads as tightly grouped block.
                    //   - title row carries the trailing type icon at
                    //     a small (14 pt) size so the snippet below
                    //     spans the full content width.
                    //   - snippet wraps to at most two lines with an
                    //     ASCII `...` ellipsis on overflow.
                    //   - metadata footer keeps the split (modified
                    //     left / created right).
                    //   - selected row picks up a 4-pt left accent
                    //     bar in the type's full accent colour, with
                    //     a lighter tint as the row background.
                    let is_selected = row.selected;
                    // Phase 8.2 status icons — `row_status` drives the
                    // trailing-icon slot.  `RowStatus::None` falls back
                    // to the bare type glyph so untyped notes still
                    // show a minimal marker; the variants that do map
                    // to a structured-content status (Chart/Person/
                    // Calendar/Project) pick up their dedicated icon
                    // via `RowStatus::icon`.
                    let trailing_icon = row.row_status.icon().unwrap_or(row.type_icon);
                    let type_color = row.type_color;
                    let modified_label = row.modified_label.clone();
                    let created_label = row.created_label.clone();
                    let snippet = row.snippet.clone();

                    // Trailing top-right type marker: small icon in
                    // the type's accent colour, anchored alongside the
                    // title row so the snippet/metadata rows below get
                    // the row's full content width.  A `w()`/`h()`-
                    // sized wrapper is required: a bare `IconName` has
                    // no intrinsic size and otherwise renders zero-px.
                    let trailing = div()
                        .flex_shrink_0()
                        .ml(px(8.0))
                        .w(px(8.0))
                        .h(px(8.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(type_color)
                        .child(trailing_icon);

                    let content = v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(4.0))
                        .child(
                            h_flex()
                                .w_full()
                                .items_start()
                                .justify_between()
                                .gap(px(8.0))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .text_sm()
                                        .font_semibold()
                                        .text_color(fg)
                                        .child(row.title),
                                )
                                .child(trailing),
                        )
                        .when(!snippet.is_empty(), |this| {
                            // GPUI clamps the snippet to two visual
                            // lines (`line_clamp(2)`) and word-wraps
                            // against the resizable column width.
                            // `text_overflow(Truncate("..."))` lets
                            // the layout engine pick the ellipsis
                            // insertion point at the last word
                            // boundary that fits — no manual
                            // character truncation in `extract_snippet`
                            // (see `gpui/examples/text_wrapper.rs` for
                            // the canonical multi-line+ellipsis
                            // pattern).
                            this.child(
                                div()
                                    .text_xs()
                                    .text_color(muted)
                                    .line_height(rems(1.4))
                                    .text_overflow(TextOverflow::Truncate("...".into()))
                                    .line_clamp(2)
                                    .child(snippet),
                            )
                        })
                        .child(
                            h_flex()
                                .w_full()
                                .items_center()
                                .justify_between()
                                .pt(px(2.0))
                                .child(div().text_xs().text_color(muted).child(modified_label))
                                .child(div().text_xs().text_color(muted).child(created_label)),
                        );

                    let selection_bg = light_tint(type_color, 0.14);
                    // 2-pt accent strip on the left edge — coloured
                    // with the type's accent on the selected row and
                    // transparent otherwise.  Rendered as a flex
                    // sibling rather than a `border_l_color` because
                    // GPUI's `Styled` exposes a single per-element
                    // border colour (all four sides), so a coloured
                    // left edge can't coexist with the muted bottom
                    // row separator.
                    let accent_color = if is_selected {
                        type_color
                    } else {
                        gpui::transparent_black()
                    };
                    let accent_strip = div()
                        .flex_shrink_0()
                        .w(px(4.0))
                        .self_stretch()
                        .bg(accent_color);
                    let row_div = h_flex()
                        .id(("nlp-row", ix as u64))
                        .w_full()
                        .items_stretch()
                        .border_b_1()
                        .border_color(border_color)
                        .cursor_pointer()
                        .on_click(move |_, _window, cx| {
                            open_handle.update(cx, |this, cx| this.open(note_id, cx));
                        })
                        .child(accent_strip)
                        .child(
                            // Horizontal padding halved (issue 012):
                            // React `NoteItem.tsx:334` uses
                            // `padding: '14px 16px'`, but the native
                            // chrome target reads tighter.
                            //
                            // Split into `pl(6) / pr(8)` (issue 013)
                            // so the visible text inset stays
                            // symmetric across the row: the 2-pt
                            // accent strip sits *outside* this
                            // padded area, so left inset = 2 + 6 = 8
                            // pt matches the right inset = 8 pt.
                            h_flex()
                                .flex_1()
                                .min_w_0()
                                .items_start()
                                .gap_2()
                                .pl(px(6.0))
                                .pr(px(16.0))
                                .py(px(10.0))
                                .child(checkbox)
                                .child(content),
                        );
                    if is_selected {
                        // Selected rows already paint the type-accent
                        // tint — skip the hover overlay so the
                        // selection fill stays stable (mirrors
                        // `sidebar_panel`'s behaviour where the row
                        // hover is only drawn on unselected rows).
                        row_div.bg(selection_bg)
                    } else {
                        // Issue 015 — match the sidebar's hover
                        // treatment: paint `theme.list_hover`
                        // (= `--state-hover-subtle`) under the cursor
                        // so the platform's default cursor-pointer
                        // tint doesn't surface as a greenish glow on
                        // the warm note-list palette.
                        row_div.hover(move |this| this.bg(hover_bg))
                    }
                }))
                .into_any_element()
        };

        // --- Bulk action bar (only visible when ≥1 entry is selected) ---
        let bulk_bar: Option<AnyElement> = if has_selection {
            Some(
                h_flex()
                    .h(px(36.0))
                    .items_center()
                    .px(px(8.0))
                    .gap_2()
                    .border_t_1()
                    .border_color(border_color)
                    .child(
                        div()
                            .flex_1()
                            .text_sm()
                            .text_color(fg)
                            .child(SharedString::from(format!("{n_selected} selected"))),
                    )
                    .child(Button::new("nlp-delete").label("Delete").ghost())
                    .child(Button::new("nlp-archive").label("Archive").ghost())
                    .into_any_element(),
            )
        } else {
            None
        };

        v_flex()
            .size_full()
            .bg(bg)
            // The vertical divider between this column and the note
            // container is painted by gpui-component's
            // `ResizeHandle` (1 pt, `theme.border`).  An explicit
            // `border_r_1` here would stack on top of the handle and
            // read as a 2-pt seam at the top of the column (issue
            // #019 follow-up reported by the user as "extra pixel
            // border between top note panel and top note list
            // panel").
            .child(header_strip)
            .children(filter_strip)
            .child(list)
            .children(bulk_bar)
            .dump_as("note-list")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use mock_fixtures::MockVault;

    /// Install the `gpui_component::Theme` global required by any view that
    /// reads it during render (mirrors `embed_poc/src/layout.rs`).
    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An empty pane must render without panicking.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| NoteListPane::new());
        cx.run_until_parked();
    }

    /// `from_mock` must load all 30 seeded notes.
    #[gpui::test]
    fn from_mock_loads_30_entries(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let pane = NoteListPane::from_mock(cx);
            assert_eq!(
                pane.entries.len(),
                30,
                "from_mock must load exactly 30 notes from MockVault::seeded()"
            );
        });
    }

    /// `from_vault` must load every `.md` file from a real on-disk vault.
    #[gpui::test]
    fn from_vault_loads_real_notes(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.md"), "alpha").unwrap();
        fs::write(dir.path().join("b.md"), "beta").unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| {
            cx.set_global(vault);
            let pane = NoteListPane::from_vault(cx);
            assert_eq!(
                pane.entries.len(),
                2,
                "from_vault must load both .md files from the temp dir"
            );
        });
    }

    /// `from_or_empty` must prefer `vault::Vault` over `MockVault` when both
    /// are installed.  Phase 5-MVP precedence contract.
    #[gpui::test]
    fn from_or_empty_prefers_real_vault(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("only.md"), "x").unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| {
            cx.set_global(MockVault::seeded()); // 30 notes
            cx.set_global(vault); // 1 note
            let pane = NoteListPane::from_or_empty(cx);
            assert_eq!(
                pane.entries.len(),
                1,
                "real Vault must win over MockVault when both globals present"
            );
        });
    }

    /// A filter substring must narrow `visible_entries` to matching titles.
    #[gpui::test]
    fn filter_narrows_visible(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));

        let window = cx.add_window(|_window, cx| NoteListPane::from_mock(cx));

        window
            .update(cx, |pane, _window, cx| {
                // "Laputa" appears in notes 14 ("Start Laputa App Project"),
                // 15 ("Laputa App V1"), 16 ("Laputa App V2"), and 28
                // ("Laputa QA Reference") — 4 matches.
                pane.set_filter("laputa", cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    4,
                    "filter 'laputa' must match exactly 4 titles"
                );
            })
            .unwrap();
    }

    /// `toggle_selection` twice on the same id must leave selection empty.
    #[gpui::test]
    fn toggle_selection_round_trips(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| NoteListPane::new());

        window
            .update(cx, |pane, _window, cx| {
                pane.toggle_selection(NoteId::from_raw(1), cx);
                assert_eq!(
                    pane.selection_count(),
                    1,
                    "count must be 1 after first toggle"
                );
                pane.toggle_selection(NoteId::from_raw(1), cx);
                assert_eq!(
                    pane.selection_count(),
                    0,
                    "count must return to 0 after second toggle on the same id"
                );
            })
            .unwrap();
    }

    /// After toggling a selection the bulk action bar must be logically
    /// present (selection_count > 0) and the view must render without panic.
    #[gpui::test]
    fn bulk_bar_appears_when_selected(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));

        let window = cx.add_window(|_window, cx| NoteListPane::from_mock(cx));

        window
            .update(cx, |pane, _window, cx| {
                pane.toggle_selection(NoteId::from_raw(1), cx);
                assert!(
                    pane.selection_count() > 0,
                    "selection_count must be > 0 so bulk bar renders"
                );
            })
            .unwrap();

        // Trigger a render cycle to exercise the bulk-bar branch.
        cx.run_until_parked();
    }

    /// Worklist 1.1 regression: clicking the search glyph and then
    /// typing into the filter input must not panic.
    ///
    /// Root cause of the original crash: the subscription closure
    /// installed by [`NoteListPane::toggle_filter_open`] used to
    /// reach back to the pane handle via `cx.entity().update(…)`.
    /// GPUI's [`gpui::Context::subscribe`] already wraps the event
    /// dispatch in `pane.update(cx, …)`, so the closure ran *inside*
    /// a mutable borrow of the pane entity — the nested
    /// `entity.update(cx, …)` then re-borrowed the same slot and the
    /// `EntityMap` slot-lease assertion panicked on the first
    /// keystroke after opening the filter.  The fix is to operate
    /// on the `&mut Self` the closure already receives.
    #[gpui::test]
    fn toggle_filter_open_then_type_does_not_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));

        let window = cx.add_window(|_window, cx| NoteListPane::from_mock(cx));

        let input_entity = window
            .update(cx, |pane, window, cx| {
                pane.toggle_filter_open(window, cx);
                assert!(pane.filter_open(), "first toggle must open the strip");
                pane.filter_input
                    .clone()
                    .expect("toggle_filter_open must construct the filter input")
            })
            .unwrap();

        // Simulate a keystroke by emitting `InputEvent::Change`
        // directly from the input entity.  This is exactly what the
        // live `InputState::replace_text_in_range` path does after a
        // typed character, and it is the live panic trigger.
        window
            .update(cx, |_pane, _window, cx| {
                input_entity.update(cx, |_state, cx| cx.emit(InputEvent::Change));
            })
            .unwrap();
        cx.run_until_parked();

        // Second toggle closes the strip; the cached input entity
        // and its subscription must survive a close/reopen cycle.
        window
            .update(cx, |pane, window, cx| {
                pane.toggle_filter_open(window, cx);
                assert!(!pane.filter_open(), "second toggle must close the strip");
                pane.toggle_filter_open(window, cx);
                assert!(pane.filter_open(), "third toggle must reopen the strip");
            })
            .unwrap();
        window
            .update(cx, |_pane, _window, cx| {
                input_entity.update(cx, |_state, cx| cx.emit(InputEvent::Change));
            })
            .unwrap();
        cx.run_until_parked();
    }

    /// `extract_snippet` skips a YAML frontmatter block, then takes
    /// the first non-empty, non-heading line.
    #[test]
    fn extract_snippet_skips_frontmatter_and_headings() {
        let body = "---\n\
                    type: Topic\n\
                    aliases: [foo]\n\
                    ---\n\
                    \n\
                    # Heading\n\
                    \n\
                    The body line we want to preview.\n\
                    Trailing content that should not appear.\n";
        assert_eq!(
            extract_snippet(body),
            "The body line we want to preview.",
            "snippet must be the first non-empty, non-heading line after frontmatter"
        );
    }

    /// `extract_snippet` no longer hard-truncates at a character
    /// limit — GPUI's `line_clamp(2) + text_overflow(Truncate("..."))`
    /// handles word-boundary wrapping + ellipsis at paint time, so the
    /// resizable note-list column drives the visible cut.  Issue 012:
    /// the extractor returns the full first content line, modulo the
    /// `SNIPPET_SOFT_MAX_CHARS` guard against pathological inputs.
    #[test]
    fn extract_snippet_returns_full_line() {
        let long: String = "x".repeat(200);
        let snippet = extract_snippet(&long);
        assert_eq!(
            snippet.chars().count(),
            200,
            "short-enough lines pass through verbatim"
        );
        assert!(
            !snippet.ends_with("..."),
            "extractor must not append an ellipsis"
        );
    }

    /// Pathological mega-lines must still be capped to bound the cost
    /// of the GPUI word-wrap pass (which visits every codepoint).
    #[test]
    fn extract_snippet_caps_pathological_lines() {
        let huge: String = "x".repeat(SNIPPET_SOFT_MAX_CHARS * 2);
        let snippet = extract_snippet(&huge);
        assert_eq!(
            snippet.chars().count(),
            SNIPPET_SOFT_MAX_CHARS,
            "lines longer than the soft cap get cut at the cap"
        );
    }

    /// An unterminated frontmatter must yield an empty snippet rather
    /// than spilling the frontmatter contents into the preview.
    #[test]
    fn extract_snippet_handles_unterminated_frontmatter() {
        let body = "---\n\
                    type: Topic\n\
                    aliases: [foo]\n";
        assert_eq!(extract_snippet(body), "");
    }

    /// A body with no frontmatter still picks the first non-heading
    /// content line.
    #[test]
    fn extract_snippet_no_frontmatter() {
        let body = "# Title\n\n  \nActual preview line.\nMore.\n";
        assert_eq!(extract_snippet(body), "Actual preview line.");
    }

    /// `from_vault` populates `NoteEntry::snippet` from each file body.
    #[gpui::test]
    fn from_vault_populates_snippet(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(
            dir.path().join("a.md"),
            "---\ntype: Topic\n---\n\n# Heading\nFirst preview line.\nSecond line.\n",
        )
        .unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| {
            cx.set_global(vault);
            let pane = NoteListPane::from_vault(cx);
            assert_eq!(pane.entries.len(), 1);
            assert_eq!(pane.entries[0].snippet.as_ref(), "First preview line.");
        });
    }

    /// `open` flips `selected_id` so the row gets the pale-accent
    /// highlight without waiting for the workspace to round-trip the
    /// event.  Phase 7.7 visual-parity contract.
    #[gpui::test]
    fn open_sets_active_id(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| NoteListPane::new());

        window
            .update(cx, |pane, _window, cx| {
                assert!(pane.active().is_none(), "fresh pane has no active note");
                pane.open(NoteId::from_raw(7), cx);
                assert_eq!(
                    pane.active(),
                    Some(NoteId::from_raw(7)),
                    "open must set the pale-accent highlight target",
                );
            })
            .unwrap();
    }

    /// `set_active` updates the highlight without emitting an
    /// `OpenNoteEvent` — used by the workspace to sync after a
    /// keymap-driven open.
    #[gpui::test]
    fn set_active_updates_without_emitting(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| NoteListPane::new());

        window
            .update(cx, |pane, _window, cx| {
                pane.set_active(Some(NoteId::from_raw(42)), cx);
                assert_eq!(pane.active(), Some(NoteId::from_raw(42)));
                pane.set_active(None, cx);
                assert!(pane.active().is_none());
            })
            .unwrap();
    }

    /// `date_label` / `created_label` format a UTC timestamp as the
    /// split modified-left / created-right pair shown in each row's
    /// metadata footer (issue 010).
    #[test]
    fn date_labels_format() {
        use chrono::TimeZone as _;
        let m = chrono::Utc.with_ymd_and_hms(2026, 5, 17, 12, 0, 0).unwrap();
        assert_eq!(date_label(m).as_ref(), "May 17, 2026");
        assert_eq!(created_label(m).as_ref(), "Created May 17, 2026");
    }

    /// `from_vault` must pick up per-note type styles from
    /// `<vault_root>/type/<stem>.md` frontmatter — proves that the
    /// row's trailing icon and selection tint will receive the
    /// per-type accent rather than the neutral fallback (issue 010).
    #[gpui::test]
    fn from_vault_loads_per_note_type_styles(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("type")).expect("create type dir");
        fs::write(
            dir.path().join("type").join("event.md"),
            "---\nicon: calendar\ncolor: orange\n---\n",
        )
        .expect("write type/event.md");
        fs::write(
            dir.path().join("event-kickoff.md"),
            "# Kickoff\nFirst event line.\n",
        )
        .expect("write event-kickoff.md");
        fs::write(dir.path().join("misc.md"), "# Misc\nUntyped body line.\n")
            .expect("write misc.md");
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| {
            cx.set_global(vault);
            let pane = NoteListPane::from_vault(cx);
            let event = pane
                .entries
                .iter()
                .find(|e| e.title.as_ref() == "Kickoff")
                .expect("event row");
            assert!(
                matches!(event.type_icon, IconName::Calendar),
                "event-prefixed note must pick up the calendar icon from type/event.md"
            );
            let misc = pane
                .entries
                .iter()
                .find(|e| e.title.as_ref() == "Misc")
                .expect("misc row");
            assert!(
                matches!(misc.type_icon, IconName::File),
                "note with no matching type/<stem>.md must fall back to the neutral File icon"
            );
        });
    }

    #[test]
    fn extract_title_prefers_h1() {
        let body = "# My Note Title\n\nbody text";
        assert_eq!(extract_title(body), Some("My Note Title".to_string()));
    }

    #[test]
    fn extract_title_falls_back_to_frontmatter() {
        let body = "---\ntitle: Frontmatter Title\n---\n\nbody";
        assert_eq!(extract_title(body), Some("Frontmatter Title".to_string()));
    }

    #[test]
    fn extract_title_h1_beats_frontmatter_when_both_present() {
        let body = "---\ntitle: From Frontmatter\n---\n\n# From H1\n";
        assert_eq!(extract_title(body), Some("From H1".to_string()));
    }

    #[test]
    fn extract_title_returns_none_when_absent() {
        let body = "no title here\nbody text\n";
        assert_eq!(extract_title(body), None);
    }

    /// Phase 8.1 — `set_scope(Type("Events"))` narrows the visible
    /// list to entries whose filename prefix is `event-…`.  Mirrors
    /// the end-to-end click path: sidebar Areas row click →
    /// SidebarSelectionChangedEvent → workspace → note_list.set_scope.
    #[gpui::test]
    fn set_scope_type_narrows_visible_entries(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("event-one.md"), "# Event One\nbody").unwrap();
        fs::write(dir.path().join("event-two.md"), "# Event Two\nbody").unwrap();
        fs::write(dir.path().join("area-x.md"), "# Area X\nbody").unwrap();
        fs::write(dir.path().join("untyped.md"), "# Untyped\nbody").unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| cx.set_global(vault));

        let window = cx.add_window(|_window, cx| NoteListPane::from_vault(cx));

        window
            .update(cx, |pane, _window, cx| {
                assert_eq!(
                    pane.visible_entries().count(),
                    4,
                    "default Inbox scope passes every entry through",
                );
                pane.set_scope(NoteListScope::Type("Events".into()), cx);
                // Sort titles for the membership assertion so the test is
                // not sensitive to the default ModifiedDesc ordering, which
                // depends on filesystem mtime ordering of files written
                // back-to-back in this temp dir.
                let mut titles: Vec<&str> =
                    pane.visible_entries().map(|e| e.title.as_ref()).collect();
                titles.sort();
                assert_eq!(
                    titles,
                    vec!["Event One", "Event Two"],
                    "Type(Events) scope must narrow to event-prefixed notes",
                );
                pane.set_scope(NoteListScope::Type("Areas".into()), cx);
                let titles: Vec<&str> = pane.visible_entries().map(|e| e.title.as_ref()).collect();
                assert_eq!(titles, vec!["Area X"]);
                pane.set_scope(NoteListScope::AllNotes, cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    4,
                    "AllNotes scope returns to pass-through",
                );
            })
            .unwrap();
    }

    /// Phase 8.1 — `set_scope(Folder(path))` narrows to entries whose
    /// vault-relative parent is `path` or a descendant.  Empty path
    /// matches the vault root and passes every entry through.
    #[gpui::test]
    fn set_scope_folder_narrows_visible_entries(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("root.md"), "# Root\nbody").unwrap();
        fs::create_dir(dir.path().join("inbox")).unwrap();
        fs::write(dir.path().join("inbox").join("a.md"), "# A\nbody").unwrap();
        fs::write(dir.path().join("inbox").join("b.md"), "# B\nbody").unwrap();
        fs::create_dir(dir.path().join("inbox").join("nested")).unwrap();
        fs::write(
            dir.path().join("inbox").join("nested").join("c.md"),
            "# C\nbody",
        )
        .unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| cx.set_global(vault));

        let window = cx.add_window(|_window, cx| NoteListPane::from_vault(cx));

        window
            .update(cx, |pane, _window, cx| {
                pane.set_scope(NoteListScope::Folder("inbox".into()), cx);
                let titles: std::collections::BTreeSet<&str> =
                    pane.visible_entries().map(|e| e.title.as_ref()).collect();
                assert_eq!(
                    titles,
                    ["A", "B", "C"].into_iter().collect(),
                    "Folder(inbox) must include descendants recursively",
                );
                pane.set_scope(NoteListScope::Folder("".into()), cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    4,
                    "Folder('') means vault root and passes every entry through",
                );
                pane.set_scope(NoteListScope::Archive, cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    0,
                    "Archive scope returns 0 until the vault surfaces an archive flag",
                );
            })
            .unwrap();
    }

    /// Worklist 2.3 — `set_scope(View("Active Projects"))` must narrow
    /// the visible list to entries whose frontmatter declares
    /// `type: Project`.  Mirrors the click path: sidebar VIEWS row →
    /// `SidebarSelectionChangedEvent::View("Active Projects")` →
    /// workspace → `note_list.set_scope(View(...))` →
    /// `view_matches("Active Projects")` predicate.
    ///
    /// The seeded `MockVault` contains exactly three Project notes
    /// (ids 14, 15, 16 — "Start Laputa App Project", "Laputa App V1",
    /// "Laputa App V2"), matching the hardcoded sidebar count `3`.
    #[gpui::test]
    fn set_scope_view_active_projects_narrows_to_project_entries(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));

        let window = cx.add_window(|_window, cx| NoteListPane::from_mock(cx));

        window
            .update(cx, |pane, _window, cx| {
                assert_eq!(
                    pane.visible_entries().count(),
                    30,
                    "default Inbox scope passes every seeded entry through",
                );
                pane.set_scope(NoteListScope::View("Active Projects".into()), cx);
                let mut titles: Vec<&str> =
                    pane.visible_entries().map(|e| e.title.as_ref()).collect();
                titles.sort();
                assert_eq!(
                    titles,
                    vec!["Laputa App V1", "Laputa App V2", "Start Laputa App Project"],
                    "View(Active Projects) must narrow to the three type:Project notes",
                );
                pane.set_scope(NoteListScope::AllNotes, cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    30,
                    "AllNotes scope returns to pass-through",
                );
            })
            .unwrap();
    }

    /// Worklist 2.3 — unknown view names must not silently empty the
    /// list while the Phase 8.18 `filter_builder` engine is still
    /// pending.  Falling back to pass-through keeps any future
    /// user-defined view in the sidebar harmless (an empty list would
    /// look like a hang to the user).
    #[gpui::test]
    fn set_scope_view_unknown_name_passes_through(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));

        let window = cx.add_window(|_window, cx| NoteListPane::from_mock(cx));

        window
            .update(cx, |pane, _window, cx| {
                pane.set_scope(NoteListScope::View("Unknown View".into()), cx);
                assert_eq!(
                    pane.visible_entries().count(),
                    30,
                    "unknown view names must pass every entry through",
                );
            })
            .unwrap();
    }

    /// Phase 8.1 — `from_vault` populates `type_label` and
    /// `parent_path` on every entry so the scope filter can match
    /// against them without re-walking the path on each call.
    #[gpui::test]
    fn from_vault_populates_type_label_and_parent_path(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("event-x.md"), "# Event\nx").unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        cx.update(|cx| {
            cx.set_global(vault);
            let pane = NoteListPane::from_vault(cx);
            let e = pane.entries.first().expect("one entry");
            assert_eq!(e.type_label.as_ref(), "Events");
            assert_eq!(e.parent_path.as_ref(), "sub");
        });
    }

    /// Worklist 2.1 — `set_header_title` must update the visible
    /// header strip so the pane reflects which sidebar row is
    /// selected.  We render the pane (the header label lives inside
    /// `Render::render`) and confirm the underlying state changes
    /// observably via `header_title()`.  Rendering the pane through a
    /// window also exercises the render path that consumes the field,
    /// so a wiring regression (e.g. someone re-hardcoding "Inbox" in
    /// `render`) would surface here as a compile / runtime mismatch.
    #[gpui::test]
    fn set_header_title_updates_header(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| NoteListPane::new());

        window
            .update(cx, |pane, _window, cx| {
                assert_eq!(
                    pane.header_title().as_ref(),
                    "Inbox",
                    "header defaults to the sidebar's default selection",
                );

                pane.set_header_title("Archive", cx);
                assert_eq!(
                    pane.header_title().as_ref(),
                    "Archive",
                    "set_header_title must update the visible label",
                );

                pane.set_header_title("Events", cx);
                assert_eq!(
                    pane.header_title().as_ref(),
                    "Events",
                    "set_header_title must reflect successive sidebar selections",
                );
            })
            .unwrap();

        cx.run_until_parked();
    }

    /// `clear_selection` must reset selection count to zero.
    #[gpui::test]
    fn clear_selection_resets(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| NoteListPane::new());

        window
            .update(cx, |pane, _window, cx| {
                pane.toggle_selection(NoteId::from_raw(1), cx);
                pane.toggle_selection(NoteId::from_raw(2), cx);
                pane.toggle_selection(NoteId::from_raw(3), cx);
                assert_eq!(pane.selection_count(), 3);
                pane.clear_selection(cx);
                assert_eq!(
                    pane.selection_count(),
                    0,
                    "clear_selection must empty the selected set"
                );
            })
            .unwrap();
    }
}
