#![forbid(unsafe_code)]
//! Left-dock sidebar panel chrome view for Tolaria
//! (ADR-0115 Phase 2d → Phase 7 visual-fidelity redo).
//!
//! `SidebarPanel` implements [`workspace::panel::Panel`] for the Left
//! Dock.  It renders four clusters mirroring the reference screenshots
//! (`tolaria-demo-vault-v2-{light,dark}.png`):
//!
//! ```text
//! ┌────────────────────────────┐
//! │ 📥 Inbox               21  │  ← top fixed group: Inbox / All / Archive
//! │ 📄 All Notes           31  │
//! │ 🗄  Archive                │
//! │ VIEWS                  +   │
//! │ ✶ Active Projects       3  │
//! │ TYPES                ⇅ +   │  ← section header has trailing actions
//! │ ● Areas                 1  │
//! │ ● Events                2  │
//! │ FOLDERS                +   │
//! │ ▾ 📁 demo-vault-v2         │  ← root folder collapsible, caret + icon
//! │     📁 attachments         │
//! │     📁 views               │
//! └────────────────────────────┘
//! ```
//!
//! Selection is internal-state-only: clicking a row updates
//! [`SidebarPanel::selected`] and emits the row with the full-width
//! primary-accent fill.  Wiring the selection to a workspace-level
//! "current view" model is Phase 9 work (real services), so for the
//! visual-fidelity pass we keep the highlight local.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use gpui::{
    div, px, rgb, AnyElement, App, Context, Hsla, InteractiveElement, IntoElement, ParentElement,
    Pixels, Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{ActiveTheme, IconName, StyledExt as _};
use mock_fixtures::{MockVault, NoteKind};
use std::path::{Path, PathBuf};
use ui::tree_dump::DumpAsExt as _;
use vault::Vault;
use workspace::panel::{DockPosition, Panel};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Which sidebar row is currently highlighted with the full-width
/// primary-accent fill.  Defaults to [`SidebarSelection::Inbox`] so the
/// chrome opens with a visible highlight (matches the reference).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SidebarSelection {
    /// "Inbox" — unfiled notes.
    #[default]
    Inbox,
    /// "All Notes" — every entry that is not archived.
    AllNotes,
    /// "Archive" — soft-deleted entries.
    Archive,
    /// A saved view; payload is the display name.
    View(SharedString),
    /// A typed group (Areas / Events / …).
    Type(SharedString),
    /// A folder path.
    Folder(SharedString),
}

/// One typed group of notes shown in the `TYPES` section.
#[derive(Debug, Clone, PartialEq)]
pub struct TypeEntry {
    /// Display label.
    pub label: SharedString,
    /// Leading-glyph fill colour.
    pub color: Hsla,
    /// Number of notes in this type.
    pub count: usize,
}

/// A saved-view entry (synthesised demo data for Phase 2d).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedView {
    pub name: SharedString,
    pub count: usize,
}

/// A folder path entry derived from note file paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderEntry {
    pub path: SharedString,
    /// Nesting depth, derived from the number of `/` separators in the path.
    pub depth: u8,
}

// ---------------------------------------------------------------------------
// SidebarPanel view
// ---------------------------------------------------------------------------

/// Activation priority used when wiring this panel into the workspace dock.
///
/// A lower value means higher priority (appears first in the dock bar).
pub const ACTIVATION_PRIORITY: u32 = 10;

/// Left-dock sidebar panel view for `TolariaWorkspace`.
pub struct SidebarPanel {
    /// Number of unfiled notes — shown next to the "Inbox" row.  For
    /// Phase 7 we treat every Markdown note as "inbox" until the
    /// real vault surfaces a triaged-or-not flag.
    inbox_count: usize,
    /// Total number of notes — drives the "All Notes" row's count chip.
    total_count: usize,
    /// Number of archived notes — shown next to the "Archive" row.
    /// Phase 7 synthesises this as 0 since the real vault has no
    /// archive flag yet.
    archive_count: usize,
    types: Vec<TypeEntry>,
    views: Vec<SavedView>,
    folders: Vec<FolderEntry>,
    /// Currently-highlighted row.  Updated by row click handlers; the
    /// renderer paints the matching row with the primary-accent fill.
    selected: SidebarSelection,
    position: DockPosition,
}

impl SidebarPanel {
    /// Create an empty sidebar panel with no entries.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inbox_count: 0,
            total_count: 0,
            archive_count: 0,
            types: Vec::new(),
            views: Vec::new(),
            folders: Vec::new(),
            selected: SidebarSelection::default(),
            position: DockPosition::Left,
        }
    }

    /// Build from `vault::Vault` if installed, falling back to
    /// [`MockVault`] (TOLARIA_MOCK=1 mode), then to an empty panel
    /// (no vault selected yet).  Phase 5-MVP precedence: real > mock > empty.
    #[must_use]
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::new()
        }
    }

    /// Build from the real `vault::Vault` global.
    #[must_use]
    pub fn from_vault(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<Vault>();
        let note_ids = executor.block_on(vault.notes());
        let mut samples = Vec::with_capacity(note_ids.len());
        for id in note_ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                samples.push((note.kind, note.path));
            }
        }
        Self::build_from_samples(samples)
    }

    /// Build a sidebar panel populated from the [`MockVault`] global.
    #[must_use]
    pub fn from_mock(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<MockVault>();
        let note_ids = executor.block_on(vault.notes());
        let mut samples = Vec::with_capacity(note_ids.len());
        for id in note_ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                samples.push((note.kind, note.path));
            }
        }
        Self::build_from_samples(samples)
    }

    /// Common post-processing for both [`from_mock`] and [`from_vault`].
    fn build_from_samples(samples: Vec<(NoteKind, PathBuf)>) -> Self {
        let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
        let mut folder_paths: BTreeSet<SharedString> = BTreeSet::new();
        let total_count = samples.len();

        for (kind, path) in samples {
            let label = match kind {
                NoteKind::Markdown => type_label_for(&path),
                NoteKind::Asset => "Assets",
                NoteKind::Folder => "Folders",
            };
            *counts.entry(label).or_insert(0) += 1;

            if let Some(parent) = path.parent() {
                let s = parent.to_string_lossy();
                if !s.is_empty() {
                    folder_paths.insert(SharedString::from(s.into_owned()));
                }
            }
        }

        let mut types: Vec<TypeEntry> = counts
            .into_iter()
            .map(|(label, count)| TypeEntry {
                label: SharedString::new_static(label),
                color: type_color(label),
                count,
            })
            .collect();
        // Stable, alphabetical order — matches the reference's row order.
        types.sort_by(|a, b| a.label.cmp(&b.label));

        // Reference shows a single saved view: "Active Projects · 3".
        // Phase 9 wires real persisted view definitions.
        let views = vec![SavedView {
            name: "Active Projects".into(),
            count: 3,
        }];

        let folders: Vec<FolderEntry> = folder_paths
            .into_iter()
            .map(|path| {
                let depth =
                    u8::try_from(path.bytes().filter(|&b| b == b'/').count()).unwrap_or(u8::MAX);
                FolderEntry { path, depth }
            })
            .collect();

        Self {
            inbox_count: total_count,
            total_count,
            archive_count: 0,
            types,
            views,
            folders,
            selected: SidebarSelection::default(),
            position: DockPosition::Left,
        }
    }

    /// Switch the highlighted row and trigger a redraw.
    pub fn select(&mut self, sel: SidebarSelection, cx: &mut Context<Self>) {
        if self.selected != sel {
            self.selected = sel;
            cx.notify();
        }
    }

    /// Currently-highlighted row (test / debugging hook).
    #[must_use]
    pub fn selected(&self) -> &SidebarSelection {
        &self.selected
    }

    #[cfg(test)]
    fn types(&self) -> &[TypeEntry] {
        &self.types
    }
}

impl Default for SidebarPanel {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Panel impl
// ---------------------------------------------------------------------------

impl Panel for SidebarPanel {
    fn persistent_name(&self) -> &str {
        "SidebarPanel"
    }

    fn panel_key(&self) -> &str {
        "sidebar"
    }

    fn position(&self, _cx: &App) -> DockPosition {
        self.position
    }

    fn set_position(&mut self, position: DockPosition, cx: &mut Context<Self>) {
        self.position = position;
        cx.notify();
    }

    fn default_size(&self, _cx: &App) -> Pixels {
        px(240.0)
    }

    fn icon(&self) -> Option<&str> {
        Some("sidebar")
    }

    fn toggle_action(&self) -> Box<dyn gpui::Action> {
        Box::new(actions::ToggleSidebar)
    }

    fn starts_open(&self, _cx: &App) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// Helpers — type extraction + colour palette
// ---------------------------------------------------------------------------

/// Map a `demo-vault-v2`-style filename prefix to its display type.
fn type_label_for(path: &Path) -> &'static str {
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

/// Accent colour for a typed group's leading glyph.
fn type_color(label: &str) -> Hsla {
    let rgb_u32: u32 = match label {
        "Areas" => 0x8B5CF6,            // violet
        "Events" => 0x14B8A6,           // teal
        "Measures" => 0x3B82F6,         // blue
        "Notes" => 0x38BDF8,            // sky-blue
        "People" => 0xEF4444,           // red
        "Procedures" => 0x22C55E,       // green
        "Projects" => 0xF97316,         // orange
        "Quarters" => 0x06B6D4,         // cyan
        "Responsibilities" => 0xF59E0B, // amber
        "Topics" => 0xEC4899,           // pink
        "Types" => 0x3B82F6,            // blue
        "Assets" => 0x64748B,           // slate
        "Folders" => 0x6B7280,          // gray
        _ => 0x6B7280,                  // gray fallback
    };
    rgb(rgb_u32).into()
}

// ---------------------------------------------------------------------------
// Render — palette helpers + element builders
// ---------------------------------------------------------------------------

/// Colour palette used by every row builder — extracted once per render
/// so the row helpers can stay pure functions.
struct Palette {
    bg: Hsla,
    border: Hsla,
    fg: Hsla,
    muted_fg: Hsla,
    accent_bg: Hsla,
    accent_fg: Hsla,
    pill_bg: Hsla,
}

impl Palette {
    fn from(cx: &App) -> Self {
        let theme = cx.theme();
        Self {
            bg: theme.sidebar,
            border: theme.sidebar_border,
            fg: theme.sidebar_foreground,
            muted_fg: theme.muted_foreground,
            accent_bg: theme.primary,
            accent_fg: theme.primary_foreground,
            pill_bg: theme.muted,
        }
    }
}

/// Pill-shaped count badge — `bg(theme.muted)` when unselected,
/// `bg(theme.primary_foreground / 18%)` when the row is selected so
/// the badge stays legible against the accent fill.
fn count_pill(count: usize, selected: bool, p: &Palette) -> Option<AnyElement> {
    if count == 0 {
        return None;
    }
    let (bg_color, text_color) = if selected {
        // On the accent fill, the badge needs its own colour pair so
        // it doesn't disappear into the background.  18 % alpha on the
        // primary_foreground reads as a translucent chip.
        let mut tint = p.accent_fg;
        tint.a = 0.2;
        (tint, p.accent_fg)
    } else {
        (p.pill_bg, p.muted_fg)
    };
    Some(
        div()
            .flex()
            .items_center()
            .justify_center()
            .h(px(18.0))
            .min_w(px(22.0))
            .px(px(6.0))
            .rounded_full()
            .bg(bg_color)
            .text_color(text_color)
            .text_xs()
            .child(SharedString::from(format!("{count}")))
            .into_any_element(),
    )
}

/// 8-px colour dot used as the leading glyph in TYPES rows.
fn color_dot(color: Hsla) -> AnyElement {
    div()
        .w(px(8.0))
        .h(px(8.0))
        .flex_shrink_0()
        .rounded_full()
        .bg(color)
        .into_any_element()
}

/// Wrap an [`IconName`] in a fixed-size box so the leading-icon column
/// stays aligned across rows that mix SVG icons with colour dots.
fn icon_glyph(icon: IconName, color: Hsla) -> AnyElement {
    div()
        .w(px(16.0))
        .h(px(16.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .text_color(color)
        .child(icon)
        .into_any_element()
}

/// Section header — small-caps muted label with optional trailing
/// action glyphs (`+` / `⇅`).  Mirrors `SidebarGroupHeader.tsx`.
fn section_header(label: &'static str, p: &Palette, actions: Vec<AnyElement>) -> gpui::AnyElement {
    let mut row = div()
        .flex()
        .flex_row()
        .items_center()
        .justify_between()
        .w_full()
        .px(px(12.0))
        .pt(px(14.0))
        .pb(px(4.0))
        .text_color(p.muted_fg)
        .text_xs()
        .font_semibold()
        .child(SharedString::new_static(label));
    if !actions.is_empty() {
        let actions_box = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .children(actions);
        row = row.child(actions_box);
    }
    row.into_any_element()
}

/// Trailing-action glyph in a section header (`+`, `⇅`, …).  Tagged via
/// `dump_as` so periscope can target it by id.
fn header_action(id: &'static str, icon: IconName, p: &Palette) -> AnyElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .h(px(16.0))
        .w(px(16.0))
        .rounded_sm()
        .cursor_pointer()
        .text_color(p.muted_fg)
        .hover(|this| this.text_color(p.fg))
        .child(icon)
        .dump_as(id)
        .into_any_element()
}

/// Build a clickable row — generic over the leading glyph slot.  Used
/// by every concrete row builder below (top-nav, view, type, folder).
#[allow(clippy::too_many_arguments)]
fn build_row(
    id: &'static str,
    label: &str,
    leading: AnyElement,
    count: usize,
    selected: bool,
    p: &Palette,
    on_click: impl Fn(&mut App) + 'static,
) -> AnyElement {
    let label = SharedString::from(label.to_string());
    let (row_bg, label_color) = if selected {
        (Some(p.accent_bg), p.accent_fg)
    } else {
        (None, p.fg)
    };
    let chip = count_pill(count, selected, p);

    let mut row = div()
        .id(id)
        .flex()
        .flex_row()
        .items_center()
        .w_full()
        .px(px(12.0))
        .py(px(5.0))
        .text_sm()
        .text_color(label_color)
        .cursor_pointer()
        .gap(px(8.0))
        .child(leading)
        .child(
            div()
                .flex_1()
                .text_color(label_color)
                .child(label)
                .into_any_element(),
        );
    if let Some(chip) = chip {
        row = row.child(chip);
    }
    if let Some(bg) = row_bg {
        row = row.bg(bg);
    }
    row.on_click(move |_, _window, cx| on_click(cx))
        .dump_as(id)
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for SidebarPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = Palette::from(cx);
        let p = &palette;
        let entity = cx.entity();

        // --- Top fixed group: Inbox / All Notes / Archive ---
        let inbox_sel = matches!(self.selected, SidebarSelection::Inbox);
        let all_sel = matches!(self.selected, SidebarSelection::AllNotes);
        let arch_sel = matches!(self.selected, SidebarSelection::Archive);

        let row_inbox = sidebar_top_row(
            "sidebar-inbox",
            "Inbox",
            IconName::Inbox,
            self.inbox_count,
            inbox_sel,
            p,
            &entity,
            SidebarSelection::Inbox,
        );
        let row_all = sidebar_top_row(
            "sidebar-all-notes",
            "All Notes",
            IconName::File,
            self.total_count,
            all_sel,
            p,
            &entity,
            SidebarSelection::AllNotes,
        );
        let row_arch = sidebar_top_row(
            "sidebar-archive",
            "Archive",
            IconName::Folder,
            self.archive_count,
            arch_sel,
            p,
            &entity,
            SidebarSelection::Archive,
        );

        // --- VIEWS section ---
        let view_rows: Vec<AnyElement> = self
            .views
            .iter()
            .map(|view| {
                let selected = matches!(
                    &self.selected,
                    SidebarSelection::View(name) if name == &view.name
                );
                sidebar_view_row(view, selected, p, &entity)
            })
            .collect();

        // --- TYPES section ---
        let type_rows: Vec<AnyElement> = self
            .types
            .iter()
            .map(|entry| {
                let selected = matches!(
                    &self.selected,
                    SidebarSelection::Type(label) if label == &entry.label
                );
                sidebar_type_row(entry, selected, p, &entity)
            })
            .collect();

        // --- FOLDERS section ---
        let folder_rows: Vec<AnyElement> = self
            .folders
            .iter()
            .enumerate()
            .map(|(ix, folder)| sidebar_folder_row(ix, folder, &self.selected, p, &entity))
            .collect();

        div()
            .flex()
            .flex_col()
            .h_full()
            .w_full()
            .bg(p.bg)
            .text_color(p.fg)
            .border_r_1()
            .border_color(p.border)
            .py(px(8.0))
            .child(row_inbox)
            .child(row_all)
            .child(row_arch)
            .child(section_header(
                "VIEWS",
                p,
                vec![header_action("sidebar-views-add", IconName::Plus, p)],
            ))
            .children(view_rows)
            .child(section_header(
                "TYPES",
                p,
                vec![
                    header_action("sidebar-types-sort", IconName::ChevronsUpDown, p),
                    header_action("sidebar-types-add", IconName::Plus, p),
                ],
            ))
            .children(type_rows)
            .child(section_header(
                "FOLDERS",
                p,
                vec![header_action("sidebar-folders-add", IconName::Plus, p)],
            ))
            .children(folder_rows)
    }
}

/// Top-nav row builder (Inbox / All Notes / Archive).  Uses an
/// [`IconName`] leading glyph in the muted-foreground colour by
/// default, switching to the accent foreground when the row is
/// selected so the icon stays legible on the primary fill.
#[allow(clippy::too_many_arguments)]
fn sidebar_top_row(
    id: &'static str,
    label: &'static str,
    icon: IconName,
    count: usize,
    selected: bool,
    p: &Palette,
    entity: &gpui::Entity<SidebarPanel>,
    sel: SidebarSelection,
) -> AnyElement {
    let leading = icon_glyph(icon, if selected { p.accent_fg } else { p.muted_fg });
    let sel_clone = sel.clone();
    let handle = entity.clone();
    build_row(
        id,
        label,
        leading,
        count,
        selected,
        p,
        move |cx: &mut App| {
            let s = sel_clone.clone();
            handle.update(cx, |this, cx| this.select(s, cx));
        },
    )
}

/// VIEWS section row builder — uses a leading star icon to mark the
/// row as a saved view.
fn sidebar_view_row(
    view: &SavedView,
    selected: bool,
    p: &Palette,
    entity: &gpui::Entity<SidebarPanel>,
) -> AnyElement {
    let leading = icon_glyph(
        IconName::Star,
        if selected { p.accent_fg } else { p.muted_fg },
    );
    let name = view.name.clone();
    let handle = entity.clone();
    build_row(
        "sidebar-view-row",
        view.name.as_ref(),
        leading,
        view.count,
        selected,
        p,
        move |cx: &mut App| {
            let name = name.clone();
            handle.update(cx, |this, cx| this.select(SidebarSelection::View(name), cx));
        },
    )
}

/// TYPES section row builder — 8-px colour dot in the type accent.
fn sidebar_type_row(
    entry: &TypeEntry,
    selected: bool,
    p: &Palette,
    entity: &gpui::Entity<SidebarPanel>,
) -> AnyElement {
    let leading = div()
        .w(px(16.0))
        .h(px(16.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .child(color_dot(entry.color))
        .into_any_element();
    let label = entry.label.clone();
    let handle = entity.clone();
    build_row(
        "sidebar-type-row",
        entry.label.as_ref(),
        leading,
        entry.count,
        selected,
        p,
        move |cx: &mut App| {
            let label = label.clone();
            handle.update(cx, |this, cx| {
                this.select(SidebarSelection::Type(label), cx)
            });
        },
    )
}

/// FOLDERS section row builder.  Root folder (`depth == 0`) gets a
/// leading caret-down so users see the collapsible affordance; nested
/// folders show the closed-folder icon.
fn sidebar_folder_row(
    _ix: usize,
    folder: &FolderEntry,
    selected: &SidebarSelection,
    p: &Palette,
    entity: &gpui::Entity<SidebarPanel>,
) -> AnyElement {
    let leaf = Path::new(folder.path.as_ref())
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(folder.path.as_ref());
    let is_selected = matches!(selected, SidebarSelection::Folder(path) if path == &folder.path);
    let is_root = folder.depth == 0;
    let leading_color = if is_selected { p.accent_fg } else { p.muted_fg };
    let leading = if is_root {
        div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(4.0))
            .child(icon_glyph(IconName::ChevronDown, leading_color))
            .child(icon_glyph(IconName::FolderClosed, leading_color))
            .into_any_element()
    } else {
        icon_glyph(IconName::FolderClosed, leading_color)
    };

    let path = folder.path.clone();
    let handle = entity.clone();
    let id: &'static str = if is_root {
        "sidebar-folder-root"
    } else {
        "sidebar-folder-child"
    };
    let pad_left = px(12.0 + f32::from(folder.depth) * 16.0);

    let label = SharedString::from(leaf.to_string());
    let (row_bg, label_color) = if is_selected {
        (Some(p.accent_bg), p.accent_fg)
    } else {
        (None, p.fg)
    };

    let mut row = div()
        .id(id)
        .flex()
        .flex_row()
        .items_center()
        .w_full()
        .pl(pad_left)
        .pr(px(12.0))
        .py(px(5.0))
        .gap(px(8.0))
        .text_sm()
        .text_color(label_color)
        .cursor_pointer()
        .child(leading)
        .child(div().flex_1().child(label));
    if let Some(bg) = row_bg {
        row = row.bg(bg);
    }
    row.on_click(move |_, _window, cx| {
        let path = path.clone();
        handle.update(cx, |this, cx| {
            this.select(SidebarSelection::Folder(path), cx)
        });
    })
    .dump_as(id)
    .into_any_element()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use mock_fixtures::MockVault;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| SidebarPanel::new());
        cx.run_until_parked();
    }

    #[gpui::test]
    fn from_mock_groups_by_kind(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let panel = SidebarPanel::from_mock(cx);
            assert!(
                !panel.types.is_empty(),
                "expected at least 1 TypeEntry, got none",
            );
        });
    }

    #[gpui::test]
    fn panel_position_is_left(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = SidebarPanel::new();
            assert_eq!(
                panel.position(cx),
                DockPosition::Left,
                "SidebarPanel must occupy the Left dock",
            );
        });
    }

    #[gpui::test]
    fn from_or_empty_falls_back_when_no_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = SidebarPanel::from_or_empty(cx);
            assert!(
                panel.types.is_empty(),
                "expected empty types when no MockVault global is present",
            );
            assert!(
                panel.views.is_empty(),
                "expected empty views when no MockVault global is present",
            );
        });
    }

    /// The reference shows a single Active Projects view.
    #[gpui::test]
    fn synthesised_views_count_is_one(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let panel = SidebarPanel::from_mock(cx);
            assert_eq!(
                panel.views.len(),
                1,
                "expected exactly 1 synthesised saved view, got {}",
                panel.views.len(),
            );
            assert_eq!(panel.views[0].name.as_ref(), "Active Projects");
        });
    }

    #[test]
    fn type_label_extracts_known_prefixes() {
        for (path, expected) in [
            ("area-building.md", "Areas"),
            ("event-team-sync.md", "Events"),
            ("measure-close-rate.md", "Measures"),
            ("person-luca-rossi.md", "People"),
            ("procedure-onboarding.md", "Procedures"),
            ("responsibility-sponsorships.md", "Responsibilities"),
            ("topic-writing.md", "Topics"),
            ("project-laputa.md", "Projects"),
            ("quarter-q2-2026.md", "Quarters"),
            ("24q4.md", "Notes"),
            ("note-on-clear-prose.md", "Notes"),
            ("rtl-mixed-direction-qa.md", "Notes"),
        ] {
            assert_eq!(type_label_for(Path::new(path)), expected, "input={path}");
        }
    }

    #[test]
    fn build_from_samples_groups_by_filename_prefix() {
        let samples = vec![
            (NoteKind::Markdown, PathBuf::from("area-x.md")),
            (NoteKind::Markdown, PathBuf::from("area-y.md")),
            (NoteKind::Markdown, PathBuf::from("event-launch.md")),
            (NoteKind::Markdown, PathBuf::from("untyped.md")),
        ];
        let panel = SidebarPanel::build_from_samples(samples);
        let pairs: Vec<(&str, usize)> = panel
            .types()
            .iter()
            .map(|e| (e.label.as_ref(), e.count))
            .collect();
        assert_eq!(
            pairs,
            vec![("Areas", 2), ("Events", 1), ("Notes", 1)],
            "types must group by prefix and sort alphabetically",
        );
    }

    /// Default highlight is Inbox so the chrome opens with a visible
    /// selection.  Mirrors the reference screenshot where Inbox is
    /// the active filter.
    #[gpui::test]
    fn default_selection_is_inbox(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|_cx| {
            let panel = SidebarPanel::new();
            assert_eq!(panel.selected(), &SidebarSelection::Inbox);
        });
    }

    /// `select` updates the highlight and triggers a redraw.
    #[gpui::test]
    fn select_updates_highlight(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| SidebarPanel::new());
        window
            .update(cx, |panel, _window, cx| {
                panel.select(SidebarSelection::AllNotes, cx);
                assert_eq!(panel.selected(), &SidebarSelection::AllNotes);
                panel.select(SidebarSelection::Type("Areas".into()), cx);
                assert_eq!(panel.selected(), &SidebarSelection::Type("Areas".into()));
            })
            .unwrap();
    }
}
