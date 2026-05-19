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
use gpui::EventEmitter;
use gpui::{
    div, px, rems, AnyElement, App, Context, Hsla, InteractiveElement, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement, Styled, TextOverflow, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    h_flex,
    scroll::ScrollableElement as _,
    v_flex, ActiveTheme, IconName, StyledExt as _,
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
    selected: HashSet<NoteId>,
    /// Id of the note currently shown in the editor.  Drives the
    /// pale-accent background on the matching row — mirrors the
    /// "active note" highlight in the reference screenshots.
    selected_id: Option<NoteId>,
    position: DockPosition,
}

impl NoteListPane {
    /// Create an empty pane with no entries and no filter.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            filter: SharedString::default(),
            selected: HashSet::new(),
            selected_id: None,
            position: DockPosition::Left,
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
                });
            }
        }
        let selected_id = entries.first().map(|e| e.id);
        Self {
            entries,
            filter: SharedString::default(),
            selected: HashSet::new(),
            selected_id,
            position: DockPosition::Left,
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
        let type_styles = load_note_type_styles(vault.root());
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
                });
            }
        }
        let selected_id = entries.first().map(|e| e.id);
        Self {
            entries,
            filter: SharedString::default(),
            selected: HashSet::new(),
            selected_id,
            position: DockPosition::Left,
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

    /// Entries that pass the current filter, in original insertion order.
    ///
    /// Returns all entries when the filter is empty.  Lazy: no
    /// allocation per render — the consumer (`render`) drives the
    /// filter inline.  `S-2` follow-up of the Phase 7 review.
    pub fn visible_entries(&self) -> impl Iterator<Item = &NoteEntry> + '_ {
        // MSRV is 1.77 — `Option::is_none_or` (1.82) is not available,
        // so we keep the `map_or(true, …)` predicate.
        let q = (!self.filter.is_empty()).then(|| self.filter.to_lowercase());
        self.entries.iter().filter(move |e| {
            q.as_deref()
                .map_or(true, |q| e.title.to_lowercase().contains(q))
        })
    }
}

impl Default for NoteListPane {
    fn default() -> Self {
        Self::new()
    }
}

impl EventEmitter<OpenNoteEvent> for NoteListPane {}

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
            })
            .collect();

        // --- Header strip: title + sort indicator + action glyphs ---
        // Mirrors `NoteListHeader.tsx` — 52-pt tall, left-aligned
        // "Inbox" title, right-aligned cluster of icon actions
        // (ChevronsUpDown sort + Search + Plus).
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
                    .child(SharedString::new_static("Inbox"))
                    .into_any_element(),
            )
            .child(
                h_flex()
                    .items_center()
                    .gap(px(12.0))
                    .text_color(muted)
                    .child(header_icon_action(
                        "note-list-sort",
                        IconName::ChevronsUpDown,
                        Some("Modified"),
                        muted,
                        fg,
                    ))
                    .child(header_icon_action(
                        "note-list-search",
                        IconName::Search,
                        None,
                        muted,
                        fg,
                    ))
                    .child(header_icon_action(
                        "note-list-new",
                        IconName::Plus,
                        None,
                        muted,
                        fg,
                    )),
            )
            .dump_as("note-list-header");

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
                    let type_icon = row.type_icon;
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
                        .child(type_icon);

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
