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

use chrono::{DateTime, Datelike, Utc};
use gpui::prelude::FluentBuilder as _;
use gpui::EventEmitter;
use gpui::{
    div, px, rems, AnyElement, App, Context, Hsla, InteractiveElement, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement, Styled, Window,
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
#[derive(Debug)]
struct RowData {
    id: NoteId,
    title: SharedString,
    snippet: SharedString,
    metadata: SharedString,
    checked: bool,
    selected: bool,
}

/// Render the metadata line shown below the snippet — mirrors the
/// reference screenshots' `May 2, 2026 · Created May 2, 2026`
/// pattern.  Phase 7 uses the on-disk modified timestamp for both
/// halves until the vault surfaces a separate created-at field
/// (Phase 9 vault rewrite — see `TODO(visual-parity)`).
fn metadata_line(modified: DateTime<Utc>) -> SharedString {
    let label = format!(
        "{month} {day}, {year} \u{00B7} Created {month} {day}, {year}",
        month = month_abbr(modified.month()),
        day = modified.day(),
        year = modified.year(),
    );
    SharedString::from(label)
}

/// 3-letter English month abbreviation (Jan, Feb, …) used by the
/// metadata line.  Avoids pulling in a localisation crate for the
/// Phase 7 visual-fidelity pass — Phase 9.8 (`localization`) will
/// route this through `lara`.
fn month_abbr(month: u32) -> &'static str {
    match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => "—",
    }
}

/// Snapshot of one note's list-view metadata.
#[derive(Debug, Clone)]
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

/// Extract a one-line preview from a note's raw markdown body.
///
/// Strips a YAML frontmatter block (when present), then returns the
/// first non-empty, non-heading line truncated to `SNIPPET_MAX_CHARS`
/// graphemes with a trailing ellipsis if the line was longer.
fn extract_snippet(body: &str) -> String {
    const SNIPPET_MAX_CHARS: usize = 120;

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
        let count = t.chars().count();
        if count <= SNIPPET_MAX_CHARS {
            return t.to_string();
        }
        let mut out: String = t.chars().take(SNIPPET_MAX_CHARS).collect();
        out.push('…');
        return out;
    }
    String::new()
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
                entries.push(NoteEntry {
                    id: note.id,
                    title: note.title.clone(),
                    kind: note.kind,
                    modified: note.modified,
                    // MockVault doesn't expose bodies; snippets stay
                    // empty for the demo-mode path.  Real bodies show
                    // up via `from_vault`.
                    snippet: SharedString::default(),
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
                entries.push(NoteEntry {
                    id: note.id,
                    title,
                    kind: note.kind,
                    modified: note.modified,
                    snippet,
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
        let active_row_bg = cx.theme().list_active;

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
                metadata: metadata_line(e.modified),
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
            .items_center()
            .justify_between()
            .px(px(16.0))
            .border_b_1()
            .border_color(border_color)
            .child(
                div()
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
            );

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
                    // Card-style row matching `component/NoteListItem`
                    // in `ui-design.pen`: padding [14, 16], gap 8,
                    // title-row (Inter 13/500) above a snippet line
                    // (Inter 12, muted, line-height 1.5), then an
                    // 11-px muted metadata line mirroring the
                    // `May 17 · Created May 17` pattern in the
                    // reference screenshots.
                    let is_selected = row.selected;
                    let metadata = row.metadata.clone();
                    let content = v_flex()
                        .flex_1()
                        .gap_1()
                        .child(
                            h_flex()
                                .w_full()
                                .justify_between()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .text_sm()
                                        .font_medium()
                                        .text_color(fg)
                                        .child(row.title),
                                ),
                        )
                        .when(!row.snippet.is_empty(), |this| {
                            this.child(
                                div()
                                    .text_xs()
                                    .text_color(muted)
                                    .line_height(rems(1.5))
                                    .child(row.snippet),
                            )
                        })
                        .child(div().text_xs().text_color(muted).child(metadata));

                    // Trailing status glyph — mirrors the reference's
                    // right-side "type marker" (chart icon, blue
                    // circle).  Phase 7 stub: a small file glyph in
                    // muted-fg until per-type icons land in Phase 9.
                    let trailing = div()
                        .flex_shrink_0()
                        .w(px(16.0))
                        .h(px(16.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(muted)
                        .child(IconName::File);

                    let row_div = h_flex()
                        .id(("nlp-row", ix as u64))
                        .w_full()
                        .items_start()
                        .gap_2()
                        .px(px(16.0))
                        .py(px(14.0))
                        .border_b_1()
                        .border_color(border_color)
                        .cursor_pointer()
                        .on_click(move |_, _window, cx| {
                            open_handle.update(cx, |this, cx| this.open(note_id, cx));
                        })
                        .child(checkbox)
                        .child(content)
                        .child(trailing);
                    if is_selected {
                        row_div.bg(active_row_bg)
                    } else {
                        row_div
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
            .child(header_strip)
            .child(list)
            .children(bulk_bar)
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

    /// Long lines must be truncated with an ellipsis.
    #[test]
    fn extract_snippet_truncates_long_lines() {
        let long: String = "x".repeat(200);
        let snippet = extract_snippet(&long);
        assert_eq!(snippet.chars().count(), 121, "120 chars + 1 ellipsis");
        assert!(snippet.ends_with('…'));
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

    /// `metadata_line` formats a UTC modified timestamp as the
    /// `MMM D, YYYY · Created MMM D, YYYY` line shown below each row's
    /// snippet.  Year is added in Phase 7 visual-fidelity to match the
    /// reference screenshots exactly.
    #[test]
    fn metadata_line_format() {
        use chrono::TimeZone as _;
        let m = chrono::Utc.with_ymd_and_hms(2026, 5, 17, 12, 0, 0).unwrap();
        assert_eq!(
            metadata_line(m).as_ref(),
            "May 17, 2026 \u{00B7} Created May 17, 2026"
        );
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
