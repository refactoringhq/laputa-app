#![forbid(unsafe_code)]
//! Inspector panel for the Tolaria right dock (ADR-0115 Phase 2d / 8.4).
//!
//! Shows contextual metadata for the active note in seven collapsible
//! accordion sections: Properties, Outline, Backlinks, Instances,
//! ReferencedBy, Relationships, and GitHistory.
//!
//! # Resolver strategy (Phase 8.4)
//!
//! All sub-panel data is derived from [`InspectorState`], which holds the
//! active note's body plus a snapshot of every other note's body so wikilink
//! scanning can run synchronously inside the render path.
//!
//! * **Outline** — line-scan of the active note's markdown body for H1/H2/H3
//!   headings (`# …`, `## …`, `### …`).
//! * **Backlinks** — scan every other note's body for `[[stem]]` tokens that
//!   resolve to the active note's file-stem.
//! * **Instances** — list every other note that shares the same `type`
//!   property value as the active note (sibling notes of the same type).
//! * **Referenced By** — alias of Backlinks for now; diverges once
//!   `frontmatter references:` lists land (Phase 10.x).
//!   TODO(Phase 10.x): split ReferencedBy to use `frontmatter references:`
//! * **Relationships** — `[[wikilinks]]` that go *out* of the active note
//!   (inverse of backlinks; empty when the note has no outbound links).
//! * **Git History** — still uses [`MockGit`] (Phase 10.1 swaps to real).
//!
//! # Usage
//!
//! ```rust,ignore
//! cx.set_global(MockVault::seeded());
//! cx.set_global(MockGit::seeded());
//! let panel = cx.new(|_window, cx| InspectorPanel::from_mock(cx));
//! ```

use std::collections::HashSet;

use gpui::{
    div, px, AnyElement, App, Context, InteractiveElement, IntoElement, ParentElement, Pixels,
    Render, SharedString, StatefulInteractiveElement, Styled, Window,
};
use gpui_component::{ActiveTheme, StyledExt as _};
use mock_fixtures::{MockCommit, MockGit, MockNote, MockVault, NoteId};
use workspace::panel::{DockPosition, Panel};

// ---------------------------------------------------------------------------
// Wikilink scanner
// ---------------------------------------------------------------------------

/// Extract all `[[target]]` stems from `text`.
///
/// Handles the common `[[stem]]` and `[[stem|alias]]` forms; returns the
/// part before the first `|` (if present) so that aliased links still
/// resolve to the correct note.
fn scan_wikilinks(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find("[[") {
        rest = &rest[open + 2..];
        let Some(close) = rest.find("]]") else {
            break;
        };
        let inner = &rest[..close];
        let stem = inner.split('|').next().unwrap_or(inner).trim();
        if !stem.is_empty() {
            out.push(stem.to_string());
        }
        rest = &rest[close + 2..];
    }
    out
}

// ---------------------------------------------------------------------------
// InspectorSection
// ---------------------------------------------------------------------------

/// One collapsible section of the inspector accordion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InspectorSection {
    Properties,
    Outline,
    Backlinks,
    Instances,
    ReferencedBy,
    Relationships,
    GitHistory,
}

impl InspectorSection {
    /// All sections in stable display order.
    pub const ALL: &'static [Self] = &[
        Self::Properties,
        Self::Outline,
        Self::Backlinks,
        Self::Instances,
        Self::ReferencedBy,
        Self::Relationships,
        Self::GitHistory,
    ];

    /// Human-readable label shown in the section header row.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Properties => "Properties",
            Self::Outline => "Outline",
            Self::Backlinks => "Backlinks",
            Self::Instances => "Instances",
            Self::ReferencedBy => "Referenced By",
            Self::Relationships => "Relationships",
            Self::GitHistory => "Git History",
        }
    }
}

// ---------------------------------------------------------------------------
// InspectorState
// ---------------------------------------------------------------------------

/// Resolved data for the currently active note, pre-computed so all
/// `render_*_body` methods are pure reads with no async I/O.
///
/// Build via [`InspectorState::resolve`] or [`InspectorState::empty`].
#[derive(Debug, Clone, Default)]
pub struct InspectorState {
    /// The active note (if any).
    pub note: Option<MockNote>,
    /// H1/H2/H3 heading text extracted from the active note's body.
    pub outline: Vec<String>,
    /// Titles of notes whose body contains a `[[wikilink]]` pointing at
    /// the active note (by file-stem).
    pub backlinks: Vec<String>,
    /// Titles of notes that share the active note's `type` property value.
    pub instances: Vec<String>,
    /// Stems from `[[wikilinks]]` going *out* of the active note.
    /// TODO(Phase 10.x): split ReferencedBy to use `frontmatter references:`
    pub outbound_links: Vec<String>,
}

impl InspectorState {
    /// Empty state — no note selected.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Build resolved state for `active_id` by fetching every note from the
    /// [`MockVault`] global installed on `cx` and delegating to
    /// [`InspectorState::resolve_from_notes`].
    ///
    /// Returns [`InspectorState::empty`] when no `MockVault` global is
    /// installed, so callers don't need to gate the call themselves.
    ///
    /// TODO(Phase 10.x): swap the synchronous `block_on` pump for an async
    /// path that drives resolution via `cx.spawn` and re-renders through
    /// `cx.notify()` once the backing service settles.  Today the calls are
    /// always-ready (`Task::ready(...)`) so the UI thread isn't actually
    /// pinned, but the same shape against a real vault service would hang
    /// the foreground executor.
    pub fn resolve(active_id: NoteId, cx: &mut App) -> Self {
        let Some(notes) = collect_mock_notes(cx) else {
            return Self::empty();
        };
        Self::resolve_from_notes(active_id, &notes)
    }

    /// Build resolved state for `active_id` from a pre-fetched slice of all
    /// vault notes.
    ///
    /// The caller must extract `notes` from the vault *before* calling this
    /// function so that no `cx` borrow is held across the call.
    pub fn resolve_from_notes(active_id: NoteId, notes: &[MockNote]) -> Self {
        let Some(active) = notes.iter().find(|n| n.id == active_id) else {
            return Self::empty();
        };

        let outline = extract_outline(&active.content);
        let outbound_links = scan_wikilinks(&active.content);

        let active_stem = active
            .path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let active_type = note_type(active).map(str::to_owned);

        let mut backlinks: Vec<String> = Vec::new();
        let mut instances: Vec<String> = Vec::new();

        for other in notes {
            if other.id == active_id {
                continue;
            }

            // Backlinks: does `other` link to the active note?  Lowercase
            // each scanned stem exactly once and reuse the result for the
            // direct-match and trailing-segment checks — the original code
            // allocated two `String`s per stem per scan.
            let links = scan_wikilinks(&other.content);
            let points_here = links.iter().any(|stem| {
                let key = stem.trim().to_ascii_lowercase();
                key == active_stem || key.rsplit('/').next().unwrap_or(key.as_str()) == active_stem
            });
            if points_here {
                backlinks.push(other.title.to_string());
            }

            // Instances: same `type` property value.
            if let Some(ref target_type) = active_type {
                if note_type(other) == Some(target_type.as_str()) {
                    instances.push(other.title.to_string());
                }
            }
        }

        Self {
            note: Some(active.clone()),
            outline,
            backlinks,
            instances,
            outbound_links,
        }
    }
}

/// Extract the `"type"` property value from a note as a `&str`, if present.
fn note_type(note: &MockNote) -> Option<&str> {
    note.properties.get("type")?.as_str()
}

/// Drain every note out of the [`MockVault`] global, if one is installed.
///
/// Returns `None` when no `MockVault` global is present so callers can
/// distinguish "no vault" from "empty vault" without re-checking
/// `cx.try_global` themselves.
fn collect_mock_notes(cx: &mut App) -> Option<Vec<MockNote>> {
    let vault = cx.try_global::<MockVault>()?.clone();
    let ids = cx.foreground_executor().block_on(vault.notes());
    let mut notes = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(note) = cx.foreground_executor().block_on(vault.note(id)) {
            notes.push(note);
        }
    }
    Some(notes)
}

/// Scan `body` for H1/H2/H3 heading lines; return the heading text without
/// the leading `#` characters.
fn extract_outline(body: &str) -> Vec<String> {
    body.lines()
        .filter(|line| {
            line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### ")
        })
        .map(|line| line.trim_start_matches('#').trim().to_owned())
        .collect()
}

// ---------------------------------------------------------------------------
// InspectorPanel
// ---------------------------------------------------------------------------

/// Right-dock panel showing note metadata in seven collapsible accordion sections.
///
/// Construct via [`InspectorPanel::new`] for an empty state, or
/// [`InspectorPanel::from_mock`] to pre-populate from installed mock globals.
pub struct InspectorPanel {
    expanded: HashSet<InspectorSection>,
    note_id: Option<NoteId>,
    position: DockPosition,
    /// Resolved data for the active note.
    state: InspectorState,
    /// Cached git history — up to 5 commits shown (Phase 10.1 wires live data).
    git_history: Vec<MockCommit>,
}

impl InspectorPanel {
    /// Create an empty panel: no note selected, all sections collapsed.
    pub fn new() -> Self {
        Self {
            expanded: HashSet::new(),
            note_id: None,
            position: DockPosition::Right,
            state: InspectorState::empty(),
            git_history: Vec::new(),
        }
    }

    /// Build from [`MockVault`] and [`MockGit`] globals: selects the first note
    /// and pre-caches its data and git history.
    ///
    /// # Panics
    ///
    /// Panics if either the [`MockVault`] or [`MockGit`] global is not installed
    /// on `cx`, or if either service returns a non-ready task (Phase 10 will
    /// replace this with async service injection).
    pub fn from_mock(cx: &mut App) -> Self {
        let ids_task = cx.global::<MockVault>().notes();
        let ids = cx.foreground_executor().block_on(ids_task);

        let note_id = ids.first().copied();

        let state = match note_id {
            Some(id) => InspectorState::resolve(id, cx),
            None => InspectorState::empty(),
        };

        let history_task = cx.global::<MockGit>().history();
        let git_history = cx.foreground_executor().block_on(history_task);

        Self {
            expanded: HashSet::new(),
            note_id,
            position: DockPosition::Right,
            state,
            git_history,
        }
    }

    /// Build from mock globals if both [`MockVault`] and [`MockGit`] are
    /// installed; otherwise return [`InspectorPanel::new`].
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<MockVault>().is_some() && cx.try_global::<MockGit>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::new()
        }
    }

    /// Update the active note and recompute all resolved state.
    ///
    /// Called by the workspace whenever the focused note changes.
    pub fn set_active(&mut self, note_id: Option<NoteId>, cx: &mut Context<Self>) {
        if self.note_id == note_id {
            return;
        }
        self.note_id = note_id;
        self.state = match note_id {
            Some(id) if cx.try_global::<MockVault>().is_some() => InspectorState::resolve(id, cx),
            _ => InspectorState::empty(),
        };
        cx.notify();
    }

    /// The ID of the currently active note, if any.
    pub fn note_id(&self) -> Option<NoteId> {
        self.note_id
    }

    /// Whether `section` is currently expanded.
    pub fn is_expanded(&self, section: InspectorSection) -> bool {
        self.expanded.contains(&section)
    }

    /// Toggle `section` between expanded and collapsed, then notify the view.
    pub fn toggle(&mut self, section: InspectorSection, cx: &mut Context<Self>) {
        // `HashSet::insert` returns false when the value was already present,
        // meaning the section was expanded — remove it to collapse.
        if !self.expanded.insert(section) {
            self.expanded.remove(&section);
        }
        cx.notify();
    }

    // -----------------------------------------------------------------------
    // Section body renderers
    // -----------------------------------------------------------------------

    fn render_properties_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let Some(note) = &self.state.note else {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No note selected.")
                .into_any_element();
        };

        let mut pairs: Vec<_> = note.properties.iter().collect();
        pairs.sort_by_key(|(k, _)| k.as_str());

        if pairs.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No properties.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_1()
            .children(pairs.into_iter().map(|(key, value)| {
                let value_str: SharedString = value
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| value.to_string())
                    .into();
                div()
                    .flex()
                    .flex_row()
                    .gap_2()
                    .text_sm()
                    .child(
                        div()
                            .text_color(muted)
                            .child(SharedString::from(format!("{key}:"))),
                    )
                    .child(value_str)
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn render_outline_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;

        if self.state.note.is_none() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No note selected.")
                .into_any_element();
        }

        if self.state.outline.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No headings.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_1()
            .children(self.state.outline.iter().map(|heading| {
                div()
                    .text_sm()
                    .child(SharedString::from(heading.clone()))
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn render_backlinks_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;

        if self.state.note.is_none() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No note selected.")
                .into_any_element();
        }

        if self.state.backlinks.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No backlinks.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_1()
            .children(self.state.backlinks.iter().map(|title| {
                div()
                    .text_sm()
                    .child(SharedString::from(title.clone()))
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn render_instances_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;

        if self.state.note.is_none() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No note selected.")
                .into_any_element();
        }

        if self.state.instances.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No other notes of this type.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_1()
            .children(self.state.instances.iter().map(|title| {
                div()
                    .text_sm()
                    .child(SharedString::from(title.clone()))
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn render_referenced_by_body(&self, cx: &mut Context<Self>) -> AnyElement {
        // TODO(Phase 10.x): split ReferencedBy to use `frontmatter references:`
        // lists once they land; for now it mirrors the backlinks resolver.
        self.render_backlinks_body(cx)
    }

    fn render_relationships_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;

        if self.state.note.is_none() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No note selected.")
                .into_any_element();
        }

        if self.state.outbound_links.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No outbound links.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_1()
            .children(self.state.outbound_links.iter().map(|stem| {
                div()
                    .text_sm()
                    .child(SharedString::from(stem.clone()))
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn render_git_history_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;

        if self.git_history.is_empty() {
            return div()
                .text_sm()
                .text_color(muted)
                .child("No commits.")
                .into_any_element();
        }

        div()
            .flex()
            .flex_col()
            .gap_2()
            .children(self.git_history.iter().take(5).map(|commit| {
                let meta: SharedString = format!("{} · {}", commit.sha, commit.author).into();
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .text_sm()
                            .child(SharedString::from(commit.message.clone())),
                    )
                    .child(div().text_sm().text_color(muted).child(meta))
                    .into_any_element()
            }))
            .into_any_element()
    }
}

impl Default for InspectorPanel {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Panel trait
// ---------------------------------------------------------------------------

impl Panel for InspectorPanel {
    fn persistent_name(&self) -> &str {
        "InspectorPanel"
    }

    fn panel_key(&self) -> &str {
        "inspector"
    }

    fn position(&self, _cx: &App) -> DockPosition {
        self.position
    }

    fn set_position(&mut self, position: DockPosition, cx: &mut Context<Self>) {
        self.position = position;
        cx.notify();
    }

    fn default_size(&self, _cx: &App) -> Pixels {
        px(320.0)
    }

    fn icon(&self) -> Option<&str> {
        Some("info")
    }

    fn toggle_action(&self) -> Box<dyn gpui::Action> {
        Box::new(actions::ToggleInspector)
    }

    fn starts_open(&self, _cx: &App) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for InspectorPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let border_color = cx.theme().border;
        let muted = cx.theme().muted_foreground;
        let background = cx.theme().background;
        let foreground = cx.theme().foreground;

        // Snapshot expanded state so we can borrow `self` freely inside the loop.
        let section_states: Vec<(InspectorSection, bool)> = InspectorSection::ALL
            .iter()
            .map(|&s| (s, self.is_expanded(s)))
            .collect();

        let mut children: Vec<AnyElement> = Vec::with_capacity(section_states.len() * 2);

        for (ix, (section, is_expanded)) in section_states.into_iter().enumerate() {
            let chevron: &'static str = if is_expanded { "▾" } else { "▸" };

            // Header row — click to toggle.
            let header = div()
                .id(("inspector-header", ix))
                .flex()
                .flex_row()
                .items_center()
                .justify_between()
                .gap_2()
                .px(px(12.0))
                .py(px(6.0))
                .border_b_1()
                .border_color(border_color)
                .cursor_pointer()
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    this.toggle(section, cx);
                }))
                .child(
                    div()
                        .text_sm()
                        .font_semibold()
                        .child(SharedString::from(section.label())),
                )
                .child(div().text_sm().text_color(muted).child(chevron));

            children.push(header.into_any_element());

            if is_expanded {
                let body_content = match section {
                    InspectorSection::Properties => self.render_properties_body(cx),
                    InspectorSection::Outline => self.render_outline_body(cx),
                    InspectorSection::Backlinks => self.render_backlinks_body(cx),
                    InspectorSection::Instances => self.render_instances_body(cx),
                    InspectorSection::ReferencedBy => self.render_referenced_by_body(cx),
                    InspectorSection::Relationships => self.render_relationships_body(cx),
                    InspectorSection::GitHistory => self.render_git_history_body(cx),
                };
                let body = div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .border_b_1()
                    .border_color(border_color)
                    .child(body_content)
                    .into_any_element();
                children.push(body);
            }
        }

        div()
            .flex()
            .flex_col()
            .h_full()
            .overflow_hidden()
            .bg(background)
            .text_color(foreground)
            .children(children)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use gpui::TestAppContext;
    use gpui_component::ActiveTheme as _;
    use mock_fixtures::{MockGit, MockVault, NoteId};

    use super::{
        extract_outline, scan_wikilinks, InspectorPanel, InspectorSection, InspectorState,
    };
    use workspace::panel::{DockPosition, Panel};

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// `InspectorSection::ALL` must contain exactly 7 sections.
    #[gpui::test]
    fn all_returns_7_sections(_cx: &mut TestAppContext) {
        assert_eq!(InspectorSection::ALL.len(), 7);
    }

    /// A freshly-constructed panel must report `DockPosition::Right`.
    #[gpui::test]
    fn panel_position_is_right(cx: &mut TestAppContext) {
        cx.update(|cx| {
            let panel = InspectorPanel::new();
            assert_eq!(panel.position(cx), DockPosition::Right);
        });
    }

    /// Toggle must move a section from collapsed → expanded → collapsed.
    #[gpui::test]
    fn toggle_round_trips(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| InspectorPanel::new());

        // Initially collapsed.
        window
            .update(cx, |panel, _window, _cx| {
                assert!(!panel.is_expanded(InspectorSection::Outline));
            })
            .unwrap();

        // Expand.
        window
            .update(cx, |panel, _window, cx| {
                panel.toggle(InspectorSection::Outline, cx);
            })
            .unwrap();
        window
            .update(cx, |panel, _window, _cx| {
                assert!(panel.is_expanded(InspectorSection::Outline));
            })
            .unwrap();

        // Collapse again.
        window
            .update(cx, |panel, _window, cx| {
                panel.toggle(InspectorSection::Outline, cx);
            })
            .unwrap();
        window
            .update(cx, |panel, _window, _cx| {
                assert!(!panel.is_expanded(InspectorSection::Outline));
            })
            .unwrap();
    }

    /// `from_mock` must select `NoteId::from_raw(1)` — the first note in the seeded vault.
    #[gpui::test]
    fn from_mock_picks_first_note(cx: &mut TestAppContext) {
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
            let panel = InspectorPanel::from_mock(cx);
            assert_eq!(
                panel.note_id(),
                Some(NoteId::from_raw(1)),
                "first seeded note must be NoteId::from_raw(1)"
            );
        });
    }

    /// With all sections expanded the panel must render without panicking.
    #[gpui::test]
    fn all_sections_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
        });

        let window = cx.add_window(|_window, cx| InspectorPanel::from_mock(cx));

        // Expand every section.
        window
            .update(cx, |panel, _window, cx| {
                for &section in InspectorSection::ALL {
                    panel.toggle(section, cx);
                }
            })
            .unwrap();

        // Drive the render pass — must not panic.
        cx.run_until_parked();
    }

    /// Regression for worklist 3.1: the Inspector window must paint a
    /// real chrome surface, not render black-on-black.  Both the
    /// theme tokens consumed by the root `div` (`background`,
    /// `foreground`) must be fully-opaque fills — if either were ever
    /// `transparent()` the standalone Inspector window would appear as
    /// an all-black void with invisible section labels.
    #[gpui::test]
    fn root_uses_opaque_theme_background_and_foreground(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let theme = cx.theme();
            assert!(
                theme.background.a > 0.0,
                "theme.background must be opaque so the Inspector window is not all-black"
            );
            assert!(
                theme.foreground.a > 0.0,
                "theme.foreground must be opaque so section labels are visible"
            );
        });
    }

    // -----------------------------------------------------------------------
    // Phase 8.4 resolver tests
    // -----------------------------------------------------------------------

    /// Backlinks resolver: note A contains `[[B]]` in its body →
    /// `InspectorState` for note B must list A in `backlinks`.
    #[gpui::test]
    fn inspector_panel_backlinks_resolver_returns_seeded_links(cx: &mut TestAppContext) {
        use chrono::Utc;
        use mock_fixtures::MockNote;
        use mock_fixtures::NoteKind;
        use serde_json::Value;
        use std::path::PathBuf;

        cx.update(|cx| {
            // Build a minimal 2-note vault:
            //   note A (id=1) body links to [[note-b]]
            //   note B (id=2) body has no links
            let now = Utc::now();
            let notes = vec![
                MockNote {
                    id: NoteId::from_raw(1),
                    title: "Note A".into(),
                    path: PathBuf::from("note-a.md"),
                    content: "# Note A\n\nSee also [[note-b]].\n".to_string(),
                    kind: NoteKind::Markdown,
                    created: now,
                    modified: now,
                    properties: [("type".to_string(), Value::String("Note".to_string()))]
                        .into_iter()
                        .collect(),
                },
                MockNote {
                    id: NoteId::from_raw(2),
                    title: "Note B".into(),
                    path: PathBuf::from("note-b.md"),
                    content: "# Note B\n\nStand-alone note.\n".to_string(),
                    kind: NoteKind::Markdown,
                    created: now,
                    modified: now,
                    properties: [("type".to_string(), Value::String("Note".to_string()))]
                        .into_iter()
                        .collect(),
                },
            ];

            cx.set_global(MockVault::from_notes(notes));
            let state = InspectorState::resolve(NoteId::from_raw(2), cx);

            assert_eq!(
                state.backlinks,
                vec!["Note A".to_string()],
                "inspector for note B must list note A as a backlink"
            );
        });
    }

    /// Outline resolver extracts H1, H2, and H3 headings and ignores H4+.
    #[gpui::test]
    fn inspector_panel_outline_extracts_h1_h2_h3(_cx: &mut TestAppContext) {
        let body = "# Top\n\n## Section\n\n### Subsection\n\n#### Deep (ignored)\n\nParagraph.\n";
        let outline = extract_outline(body);
        assert_eq!(
            outline,
            vec!["Top", "Section", "Subsection"],
            "outline must include H1/H2/H3 and skip H4+"
        );
    }

    /// Instances resolver: notes with the same `type` property appear in
    /// `InspectorState::instances` for the active note.
    #[gpui::test]
    fn inspector_panel_instances_returns_same_type_siblings(cx: &mut TestAppContext) {
        use chrono::Utc;
        use mock_fixtures::MockNote;
        use mock_fixtures::NoteKind;
        use serde_json::Value;
        use std::path::PathBuf;

        cx.update(|cx| {
            let now = Utc::now();
            let make =
                |id: u64, title: &'static str, path: &'static str, ty: &'static str| MockNote {
                    id: NoteId::from_raw(id),
                    title: title.into(),
                    path: PathBuf::from(path),
                    content: String::new(),
                    kind: NoteKind::Markdown,
                    created: now,
                    modified: now,
                    properties: [("type".to_string(), Value::String(ty.to_string()))]
                        .into_iter()
                        .collect(),
                };

            cx.set_global(MockVault::from_notes(vec![
                make(1, "Alpha", "alpha.md", "Person"),
                make(2, "Beta", "beta.md", "Person"),
                make(3, "Gamma", "gamma.md", "Topic"), // different type
                make(4, "Delta", "delta.md", "Person"),
            ]));

            // Inspect note 1 (Alpha, type=Person):
            // siblings should be Beta and Delta (not Gamma).
            let state = InspectorState::resolve(NoteId::from_raw(1), cx);

            let mut instances = state.instances.clone();
            instances.sort();
            assert_eq!(
                instances,
                vec!["Beta".to_string(), "Delta".to_string()],
                "instances must list same-type siblings, excluding active note and different types"
            );
        });
    }

    /// `scan_wikilinks` must extract both plain and aliased link stems.
    #[gpui::test]
    fn scan_wikilinks_extracts_plain_and_aliased(_cx: &mut TestAppContext) {
        let text = "See [[note-a]] and [[note-b|Alias for B]] and [[dir/note-c]].\n";
        let links = scan_wikilinks(text);
        assert_eq!(
            links,
            vec!["note-a", "note-b", "dir/note-c"],
            "scan_wikilinks must return stems for plain, aliased, and path links"
        );
    }
}
