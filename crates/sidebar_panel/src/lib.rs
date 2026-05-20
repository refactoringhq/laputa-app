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
//! Selection is internal-state-only at this layer: clicking a row
//! updates [`SidebarPanel::selected`] and emits a
//! [`SidebarSelectionChangedEvent`] so the workspace can route the
//! new selection to dependent views (e.g. the note-list pane's scope
//! filter).  The sidebar itself does not know about other panels.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use gpui::{
    div, px, rgb, AnyElement, App, Context, EventEmitter, Hsla, InteractiveElement, IntoElement,
    ParentElement, Pixels, Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{tooltip::Tooltip, ActiveTheme, IconName, StyledExt as _};
use mock_fixtures::{MockVault, NoteKind};
use std::path::{Path, PathBuf};
use ui::tree_dump::DumpAsExt as _;
use vault::Vault;
use workspace::panel::{DockPosition, Panel};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Emitted when [`SidebarPanel::select`] changes the highlighted row.
///
/// The workspace (`crates/tolaria/src/main.rs`) subscribes to this
/// event and routes the new selection to dependent views — the
/// note-list pane's scope filter in Phase 8.1, plus future consumers
/// (status bar workspace chip, breadcrumb bar, etc.).  Re-selecting
/// the already-selected row is a no-op: no event fires and no
/// observers are notified.
///
/// `display_label` carries the row's visible label so consumers that
/// want a human-readable string (e.g. the note-list-pane header in
/// worklist 2.1) don't have to re-derive it.  For [`SidebarSelection::Folder`]
/// the payload is the *path* (stable identifier), whereas the
/// `display_label` is the folder's last segment — they are NOT the
/// same string and consumers should prefer `display_label` for chrome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarSelectionChangedEvent {
    /// The newly-selected row.
    pub selection: SidebarSelection,
    /// Visible label of the selected row (e.g. "Inbox", "All Notes",
    /// "Archive", a type's `sidebar label`, a saved view's name, or a
    /// folder's display segment).
    pub display_label: SharedString,
}

/// Identifies one of the three collapsible sections in the sidebar.
/// The top fixed group (Inbox / All Notes / Archive) has no header and
/// is intentionally not addressable here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SidebarSection {
    Views,
    Types,
    Folders,
}

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
///
/// `icon`, `color`, and `display_label` come from the type's own
/// frontmatter (`<vault_root>/type/<name>.md`) when one exists:
///
/// ```yaml
/// ---
/// type: Type
/// icon: calendar
/// color: orange
/// sidebar label: Events
/// ---
/// ```
///
/// `icon` maps the frontmatter glyph name to the closest available
/// [`IconName`] (icon SVGs are bundled via `gpui-component-assets`);
/// missing names fall back to [`IconName::File`].  `color` maps the
/// frontmatter colour token to a 24-bit hex value (see
/// [`type_color`]).
#[derive(Clone)]
pub struct TypeEntry {
    /// Display label (preferred from `sidebar label:` frontmatter,
    /// else derived from the filename prefix).
    pub label: SharedString,
    /// Leading-glyph fill colour.
    pub color: Hsla,
    /// Leading icon — sourced from `icon:` frontmatter when present.
    ///
    /// `IconName` from `gpui-component` does not implement `Debug` /
    /// `PartialEq`, so this struct intentionally drops those derives;
    /// tests that need to compare TYPES rows do so via
    /// `(label, count)` pairs.
    pub icon: IconName,
    /// Number of notes in this type.
    pub count: usize,
}

/// A saved-view entry (synthesised demo data for Phase 2d).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedView {
    pub name: SharedString,
    pub count: usize,
}

/// A folder row derived from note file paths.  `path` stays stable
/// regardless of presentation so it can key
/// [`SidebarSelection::Folder`]; `display` and `depth` are derived
/// from the path *relative to the vault root* so the visual indent
/// starts at the vault root (depth 0) rather than the filesystem
/// root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderEntry {
    /// Stable identifier — relative to the vault root (`""` for the
    /// vault root itself).
    pub path: SharedString,
    /// Display label — the trailing path segment, or the vault root's
    /// file_name when `path == ""`.
    pub display: SharedString,
    /// Indent depth (0 = vault root, 1 = its direct children, …).
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
    /// Per-section collapse state.  `true` means the section is
    /// collapsed (children hidden, chevron rotated).  Defaults to all
    /// `false` (every section expanded), matching the visual baseline.
    /// The top fixed group (Inbox / All Notes / Archive) has no header
    /// and therefore is not collapsible.
    collapsed: SectionCollapseState,
    position: DockPosition,
}

/// Per-section collapse bookkeeping.  Three booleans rather than a
/// `HashSet` so we sidestep an allocation in the common (empty) case
/// and keep the struct trivially `Default`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct SectionCollapseState {
    views: bool,
    types: bool,
    folders: bool,
}

impl SectionCollapseState {
    fn get(self, section: SidebarSection) -> bool {
        match section {
            SidebarSection::Views => self.views,
            SidebarSection::Types => self.types,
            SidebarSection::Folders => self.folders,
        }
    }

    fn toggle(&mut self, section: SidebarSection) {
        match section {
            SidebarSection::Views => self.views = !self.views,
            SidebarSection::Types => self.types = !self.types,
            SidebarSection::Folders => self.folders = !self.folders,
        }
    }
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
            collapsed: SectionCollapseState::default(),
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
        let root = Some(vault.root().to_path_buf());
        let note_ids = executor.block_on(vault.notes());
        let mut samples = Vec::with_capacity(note_ids.len());
        for id in note_ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                samples.push((note.kind, note.path));
            }
        }
        Self::build_from_samples(samples, root)
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
        Self::build_from_samples(samples, None)
    }

    /// Common post-processing for both [`from_mock`] and [`from_vault`].
    ///
    /// `vault_root`, when supplied, is the on-disk path Vault::open_at
    /// was rooted at.  We strip it from every note's parent path so
    /// folder rows are indented relative to the vault root rather than
    /// the filesystem root — see issue 002 in
    /// `docs/plans/native-gpui-chrome/visual-issues.md`.
    fn build_from_samples(samples: Vec<(NoteKind, PathBuf)>, vault_root: Option<PathBuf>) -> Self {
        let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
        // Set of relative paths from the vault root.  `""` is the
        // root itself.  Notes that live in the root are recorded as
        // belonging to the root folder so the root row always exists.
        let mut folder_rels: BTreeSet<String> = BTreeSet::new();
        let total_count = samples.len();

        for (kind, path) in samples {
            let label = match kind {
                NoteKind::Markdown => type_label_for(&path),
                NoteKind::Asset => "Assets",
                NoteKind::Folder => "Folders",
            };
            *counts.entry(label).or_insert(0) += 1;

            let Some(parent) = path.parent() else {
                continue;
            };
            let rel = match vault_root.as_deref() {
                Some(root) => parent.strip_prefix(root).unwrap_or(parent),
                None => parent,
            };
            // `strip_prefix` of an exactly-matching root returns the
            // empty path; treat it as the vault root.  Skip any
            // path that we could not normalise to a vault-relative
            // form (e.g. absolute paths outside the vault).
            let rel_str = rel.to_string_lossy();
            if rel_str.is_empty() {
                folder_rels.insert(String::new());
            } else if !rel.is_absolute() {
                // Every ancestor needs a row so children render
                // visually nested under their parent.
                folder_rels.insert(String::new());
                folder_rels.insert(rel_str.into_owned());
            }
        }

        // Read each `<vault_root>/type/<stem>.md` and project its
        // YAML frontmatter into a (display-label → style) map so the
        // TYPES rows pick up the icon / colour / sidebar-label
        // contract the demo vault encodes there.
        let styles = vault_root
            .as_deref()
            .map(|r| load_type_styles(r))
            .unwrap_or_default();

        let mut types: Vec<TypeEntry> = counts
            .into_iter()
            .map(|(default_label, count)| {
                let style = styles.get(default_label);
                let label = style
                    .map(|s| s.label.clone())
                    .unwrap_or_else(|| SharedString::new_static(default_label));
                let color = style
                    .map(|s| s.color)
                    .unwrap_or_else(|| type_color(default_label));
                let icon = style.map(|s| s.icon.clone()).unwrap_or(IconName::File);
                TypeEntry {
                    label,
                    color,
                    icon,
                    count,
                }
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

        let root_display: SharedString = vault_root
            .as_deref()
            .and_then(|r| r.file_name())
            .and_then(|n| n.to_str())
            .map(|s| SharedString::from(s.to_owned()))
            .unwrap_or_else(|| SharedString::new_static("Vault"));

        let folders: Vec<FolderEntry> = folder_rels
            .into_iter()
            .map(|rel| {
                if rel.is_empty() {
                    FolderEntry {
                        path: SharedString::default(),
                        display: root_display.clone(),
                        depth: 0,
                    }
                } else {
                    let depth = u8::try_from(rel.bytes().filter(|&b| b == b'/').count() + 1)
                        .unwrap_or(u8::MAX);
                    let display = Path::new(&rel)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| SharedString::from(s.to_owned()))
                        .unwrap_or_else(|| SharedString::from(rel.clone()));
                    FolderEntry {
                        path: SharedString::from(rel),
                        display,
                        depth,
                    }
                }
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
            collapsed: SectionCollapseState::default(),
            position: DockPosition::Left,
        }
    }

    /// Switch the highlighted row, trigger a redraw, and emit a
    /// [`SidebarSelectionChangedEvent`].  Re-selecting the already
    /// selected row is a no-op (no event, no notify) so workspace
    /// observers don't churn on idempotent clicks.
    pub fn select(&mut self, sel: SidebarSelection, cx: &mut Context<Self>) {
        if self.selected != sel {
            let display_label = self.display_label_for(&sel);
            self.selected = sel.clone();
            cx.emit(SidebarSelectionChangedEvent {
                selection: sel,
                display_label,
            });
            cx.notify();
        }
    }

    /// Visible label for a [`SidebarSelection`].  Used to populate the
    /// `display_label` field on [`SidebarSelectionChangedEvent`] so
    /// downstream chrome (e.g. the note-list-pane header) can show a
    /// human-readable name without re-deriving it.
    ///
    /// Inbox / AllNotes / Archive map to their fixed display strings.
    /// View / Type carry their display name in the variant payload.
    /// Folder selections carry a *path* in the payload, so we look the
    /// matching [`FolderEntry::display`] up in `self.folders`; if no
    /// match exists (vault tree rebuilt mid-flight), we fall back to
    /// the trailing path segment to stay graceful.
    fn display_label_for(&self, sel: &SidebarSelection) -> SharedString {
        match sel {
            SidebarSelection::Inbox => SharedString::new_static("Inbox"),
            SidebarSelection::AllNotes => SharedString::new_static("All Notes"),
            SidebarSelection::Archive => SharedString::new_static("Archive"),
            SidebarSelection::View(name) => name.clone(),
            SidebarSelection::Type(label) => label.clone(),
            SidebarSelection::Folder(path) => self
                .folders
                .iter()
                .find(|f| f.path == *path)
                .map(|f| f.display.clone())
                .unwrap_or_else(|| folder_display_fallback(path)),
        }
    }

    /// Currently-highlighted row (test / debugging hook).
    #[must_use]
    pub fn selected(&self) -> &SidebarSelection {
        &self.selected
    }

    /// Whether `section` is currently collapsed (children hidden).
    /// `false` means the section is expanded (rows visible).
    #[must_use]
    pub fn is_section_collapsed(&self, section: SidebarSection) -> bool {
        self.collapsed.get(section)
    }

    /// Flip the collapse state of `section` and request a redraw.
    /// Worklist 2.6: clicking a section header toggles the visibility
    /// of its rows.
    pub fn toggle_section(&mut self, section: SidebarSection, cx: &mut Context<Self>) {
        self.collapsed.toggle(section);
        cx.notify();
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

impl EventEmitter<SidebarSelectionChangedEvent> for SidebarPanel {}

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

/// Fallback display label for a [`SidebarSelection::Folder`] whose
/// path is not (yet) tracked by `self.folders` — picks the trailing
/// path segment so consumers still get a human-readable string instead
/// of the full relative path.  Empty path means the vault root and
/// degrades to the literal `""` (only observable in tests where the
/// panel is empty); `display_label_for` only takes this branch when
/// the folder list and the selection have drifted apart.
fn folder_display_fallback(path: &SharedString) -> SharedString {
    path.rsplit_once('/')
        .map(|(_, tail)| SharedString::from(tail.to_string()))
        .unwrap_or_else(|| path.clone())
}

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

/// Visual contract for one TYPES row, sourced from a type doc's
/// frontmatter.
#[derive(Clone)]
struct TypeStyle {
    icon: IconName,
    color: Hsla,
    label: SharedString,
}

/// Walk `<vault_root>/type/` and project every type doc's frontmatter
/// into a map keyed by the prefix label our `type_label_for` function
/// emits (e.g. `event.md` → `"Events"`).  Returns an empty map when
/// the directory is missing or unreadable so the caller never panics.
fn load_type_styles(vault_root: &Path) -> std::collections::HashMap<&'static str, TypeStyle> {
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
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        let Some(default_label) = label_for_type_stem(&stem) else {
            continue;
        };
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        let frontmatter = parse_frontmatter(&body);
        let icon = frontmatter
            .get("icon")
            .map(|s| icon_for_frontmatter_name(s))
            .unwrap_or(IconName::File);
        let color = frontmatter
            .get("color")
            .map(|s| color_for_frontmatter_name(s))
            .unwrap_or_else(|| type_color(default_label));
        let label: SharedString = frontmatter
            .get("sidebar label")
            .map(|s| SharedString::from(s.clone()))
            .unwrap_or_else(|| SharedString::new_static(default_label));
        out.insert(default_label, TypeStyle { icon, color, label });
    }
    out
}

/// Reverse of `type_label_for`'s prefix mapping: a lowercase type
/// stem (`event`, `area`, …) → the display label our row counter
/// uses as a map key.  Returns `None` for stems that aren't part of
/// the canonical TYPES set.
fn label_for_type_stem(stem: &str) -> Option<&'static str> {
    match stem {
        "area" => Some("Areas"),
        "event" => Some("Events"),
        "measure" => Some("Measures"),
        "note" => Some("Notes"),
        "person" => Some("People"),
        "procedure" => Some("Procedures"),
        "project" => Some("Projects"),
        "quarter" => Some("Quarters"),
        "responsibility" => Some("Responsibilities"),
        "topic" => Some("Topics"),
        _ => None,
    }
}

/// Parse a minimal subset of YAML frontmatter — `key: value` lines
/// between two `---` markers.  Values are trimmed and stripped of
/// surrounding `"` / `'` quotes.  Anything more elaborate (lists,
/// nested maps) is out of scope for the visual-fidelity pass.
fn parse_frontmatter(body: &str) -> std::collections::HashMap<String, String> {
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

/// Map a frontmatter `icon:` token to the closest available
/// `gpui-component-assets` icon.  Tokens lifted from
/// `demo-vault-v2/type/*.md`; unknown names degrade to
/// [`IconName::File`].
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

/// Map a frontmatter `color:` token to a 24-bit HSL value matching
/// the tailwind / shadcn palette used by the React app.
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
///
/// Selection treatment mirrors `src/index.css` — `--state-selected`
/// (pale-blue, [`theme.list_active`]) on the row body with
/// `--accent-blue` ([`theme.primary`]) text and icon.  The dark-blue
/// fill is reserved for the count pill on the *selected* row, where it
/// inverts to white text.  Unselected count pills get the muted
/// surface treatment from `NavItemCount` in `SidebarParts.tsx`.
struct Palette {
    bg: Hsla,
    border: Hsla,
    fg: Hsla,
    muted_fg: Hsla,
    /// Row fill on the selected row — pale-blue (`--state-selected`).
    selection_bg: Hsla,
    /// Label + leading-icon colour on the selected row — accent-blue
    /// (`--accent-blue`).
    selection_fg: Hsla,
    /// Row hover fill (`--state-hover-subtle`).  Unselected rows
    /// pick this up via `.hover(...)` so the platform's default
    /// highlight doesn't bleed through.
    hover_bg: Hsla,
    /// Count-pill fill when the row is *not* selected — `--muted`.
    pill_bg: Hsla,
    /// Count-pill fill when the row *is* selected — `--accent-blue`.
    pill_selected_bg: Hsla,
    /// Count-pill text when the row is selected — `--text-inverse`
    /// (white).
    pill_selected_fg: Hsla,
}

impl Palette {
    fn from(cx: &App) -> Self {
        let theme = cx.theme();
        Self {
            bg: theme.sidebar,
            border: theme.sidebar_border,
            fg: theme.sidebar_foreground,
            muted_fg: theme.muted_foreground,
            selection_bg: theme.list_active,
            selection_fg: theme.primary,
            hover_bg: theme.list_hover,
            pill_bg: theme.muted,
            pill_selected_bg: theme.primary,
            pill_selected_fg: theme.primary_foreground,
        }
    }
}

/// Pill-shaped count badge.  Unselected rows get the muted surface
/// from `NavItemCount` in `SidebarParts.tsx`; the selected row
/// inverts to accent-blue on white so it reads as a strong indicator
/// against the pale-blue row fill.
fn count_pill(count: usize, selected: bool, p: &Palette) -> Option<AnyElement> {
    if count == 0 {
        return None;
    }
    let (bg_color, text_color) = if selected {
        (p.pill_selected_bg, p.pill_selected_fg)
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

/// Section header — the whole row is a click target that toggles the
/// section's collapse state.  The leading chevron rotates between
/// `ChevronDown` (expanded) and `ChevronRight` (collapsed) so the
/// affordance is visually obvious.  Trailing `actions` (e.g. `+`,
/// `⇅`) stay separate so their own click handlers (when wired) don't
/// bubble into the toggle.
///
/// `id` doubles as the stateful GPUI element id and the periscope
/// `dump_as` tag (e.g. `sidebar-section-views-header`).  The convention
/// permits container-leaf overlap and every call site uses the same
/// string for both, so collapsing them keeps the signature lean.
fn section_header(
    id: &'static str,
    label: &'static str,
    collapsed: bool,
    p: &Palette,
    actions: Vec<AnyElement>,
    on_toggle: impl Fn(&mut App) + 'static,
) -> gpui::AnyElement {
    let chevron = icon_glyph(
        if collapsed {
            IconName::ChevronRight
        } else {
            IconName::ChevronDown
        },
        p.muted_fg,
    );
    let leading_box = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(6.0))
        .child(chevron)
        .child(SharedString::new_static(label));

    let tooltip_text: &'static str = if collapsed { "Expand" } else { "Collapse" };
    let mut row = div()
        .id(SharedString::new_static(id))
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
        .cursor_pointer()
        .child(leading_box);
    if !actions.is_empty() {
        let actions_box = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .children(actions);
        row = row.child(actions_box);
    }
    row.on_click(move |_, _window, cx| on_toggle(cx))
        .tooltip(move |window, cx| Tooltip::new(tooltip_text).build(window, cx))
        .dump_as(id)
        .into_any_element()
}

/// Trailing-action glyph in a section header (`+`, `⇅`, …).  Tagged via
/// `dump_as` so periscope can target it by id.
///
/// Swallows mouse-down events so clicks on the action don't bubble up
/// to the parent section header's collapse toggle (worklist 2.6).
/// When a real `on_click` handler is wired for the action later, it
/// can be installed alongside this guard.  `tooltip` is the hover hint
/// shown on the glyph (worklist 2.4).
fn header_action(
    id: &'static str,
    icon: IconName,
    tooltip: &'static str,
    p: &Palette,
) -> AnyElement {
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
        .on_mouse_down(gpui::MouseButton::Left, |_, _window, cx| {
            cx.stop_propagation();
        })
        .tooltip(move |window, cx| Tooltip::new(tooltip).build(window, cx))
        .child(icon)
        .dump_as(id)
        .into_any_element()
}

/// Build a clickable row — generic over the leading glyph slot.  Used
/// by every concrete row builder below (top-nav, view, type, folder).
///
/// `gpui_id` is the unique GPUI element id (used for stateful
/// interactivity — distinct rows must never share one or
/// `.on_click` collisions silently swallow events).  `dump_id` is the
/// periscope tag and may be shared across "row kinds" (e.g. every
/// type row carries `sidebar-type-row`) — periscope's tree-dump JSON
/// keys by the most-recent paint, so duplicates are acceptable for
/// click-by-id targeting of the *last* visible row of the kind.
#[allow(clippy::too_many_arguments)]
fn build_row(
    gpui_id: impl Into<gpui::ElementId>,
    dump_id: &'static str,
    label: &str,
    leading: AnyElement,
    count: usize,
    selected: bool,
    p: &Palette,
    on_click: impl Fn(&mut App) + 'static,
) -> AnyElement {
    let label = SharedString::from(label.to_string());
    let (row_bg, label_color) = if selected {
        (Some(p.selection_bg), p.selection_fg)
    } else {
        (None, p.fg)
    };
    let chip = count_pill(count, selected, p);

    let hover_bg = p.hover_bg;
    let mut row = div()
        .id(gpui_id)
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
    } else {
        // Only paint a hover fill on unselected rows; the selection
        // bg already dominates so a hover overlay there would just
        // flicker the colour.
        row = row.hover(move |this| this.bg(hover_bg));
    }
    row.on_click(move |_, _window, cx| on_click(cx))
        .dump_as(dump_id)
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

        let views_collapsed = self.collapsed.get(SidebarSection::Views);
        let types_collapsed = self.collapsed.get(SidebarSection::Types);
        let folders_collapsed = self.collapsed.get(SidebarSection::Folders);

        // --- VIEWS section ---
        let view_rows: Vec<AnyElement> = if views_collapsed {
            Vec::new()
        } else {
            self.views
                .iter()
                .map(|view| {
                    let selected = matches!(
                        &self.selected,
                        SidebarSelection::View(name) if name == &view.name
                    );
                    sidebar_view_row(view, selected, p, &entity)
                })
                .collect()
        };

        // --- TYPES section ---
        let type_rows: Vec<AnyElement> = if types_collapsed {
            Vec::new()
        } else {
            self.types
                .iter()
                .map(|entry| {
                    let selected = matches!(
                        &self.selected,
                        SidebarSelection::Type(label) if label == &entry.label
                    );
                    sidebar_type_row(entry, selected, p, &entity)
                })
                .collect()
        };

        // --- FOLDERS section ---
        let folder_rows: Vec<AnyElement> = if folders_collapsed {
            Vec::new()
        } else {
            self.folders
                .iter()
                .enumerate()
                .map(|(ix, folder)| sidebar_folder_row(ix, folder, &self.selected, p, &entity))
                .collect()
        };

        let views_header = section_header(
            "sidebar-section-views-header",
            "VIEWS",
            views_collapsed,
            p,
            vec![header_action(
                "sidebar-views-add",
                IconName::Plus,
                "New view",
                p,
            )],
            toggle_section_handler(&entity, SidebarSection::Views),
        );
        let views_section = div()
            .flex()
            .flex_col()
            .w_full()
            .child(views_header)
            .children(view_rows)
            .dump_as("sidebar-section-views");

        let types_header = section_header(
            "sidebar-section-types-header",
            "TYPES",
            types_collapsed,
            p,
            vec![
                header_action(
                    "sidebar-types-sort",
                    IconName::ChevronsUpDown,
                    "Sort types",
                    p,
                ),
                header_action("sidebar-types-add", IconName::Plus, "New type", p),
            ],
            toggle_section_handler(&entity, SidebarSection::Types),
        );
        let types_section = div()
            .flex()
            .flex_col()
            .w_full()
            .child(types_header)
            .children(type_rows)
            .dump_as("sidebar-section-types");

        let folders_header = section_header(
            "sidebar-section-folders-header",
            "FOLDERS",
            folders_collapsed,
            p,
            vec![header_action(
                "sidebar-folders-add",
                IconName::Plus,
                "New folder",
                p,
            )],
            toggle_section_handler(&entity, SidebarSection::Folders),
        );
        let folders_section = div()
            .flex()
            .flex_col()
            .w_full()
            .child(folders_header)
            .children(folder_rows)
            .dump_as("sidebar-section-folders");

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
            .child(views_section)
            .child(types_section)
            .child(folders_section)
            .dump_as("sidebar")
    }
}

/// Build the `on_click` closure that toggles a section's collapse
/// state, capturing a strong handle to the panel so the click lands
/// on the same entity even after re-renders.
fn toggle_section_handler(
    entity: &gpui::Entity<SidebarPanel>,
    section: SidebarSection,
) -> impl Fn(&mut App) + 'static {
    let handle = entity.clone();
    move |cx: &mut App| {
        handle.update(cx, |this, cx| this.toggle_section(section, cx));
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
    let leading = icon_glyph(icon, if selected { p.selection_fg } else { p.muted_fg });
    let sel_clone = sel.clone();
    let handle = entity.clone();
    build_row(
        SharedString::new_static(id),
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
        if selected { p.selection_fg } else { p.muted_fg },
    );
    let name = view.name.clone();
    let handle = entity.clone();
    let gpui_id: SharedString = format!("sidebar-view-{}", view.name).into();
    build_row(
        gpui_id,
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

/// TYPES section row builder — Phosphor-style icon in the type's
/// accent colour.  When the row is selected the whole `Palette` is
/// re-tinted with the type's colour so the row bg, label, icon, and
/// count pill all switch to the type's hue (matches the React
/// `SectionHeader` selection styling).
fn sidebar_type_row(
    entry: &TypeEntry,
    selected: bool,
    p: &Palette,
    entity: &gpui::Entity<SidebarPanel>,
) -> AnyElement {
    // Per the reference, the type icon always renders in the type's
    // colour — selection only swaps the row bg/text, not the icon
    // hue.  Matches `SectionHeader` in `SidebarParts.tsx`.
    let leading = icon_glyph(entry.icon.clone(), entry.color);
    let label = entry.label.clone();
    let handle = entity.clone();
    let type_palette = palette_tinted_with(p, entry.color);
    let gpui_id: SharedString = format!("sidebar-type-{}", entry.label).into();
    build_row(
        gpui_id,
        "sidebar-type-row",
        entry.label.as_ref(),
        leading,
        entry.count,
        selected,
        &type_palette,
        move |cx: &mut App| {
            let label = label.clone();
            handle.update(cx, |this, cx| {
                this.select(SidebarSelection::Type(label), cx)
            });
        },
    )
}

/// Build a per-row Palette whose selection treatment uses `tint`
/// instead of the global primary.  The row bg becomes a soft tint of
/// the colour (~14 % alpha) so it reads as an "orange-light /
/// green-light / …" highlight; the text and count pill take the full
/// colour.  Mirrors the type's accent treatment in
/// `SidebarSections.tsx`.
fn palette_tinted_with(base: &Palette, tint: Hsla) -> Palette {
    let mut light = tint;
    light.a = 0.14;
    Palette {
        bg: base.bg,
        border: base.border,
        fg: base.fg,
        muted_fg: base.muted_fg,
        selection_bg: light,
        selection_fg: tint,
        hover_bg: base.hover_bg,
        pill_bg: base.pill_bg,
        pill_selected_bg: tint,
        pill_selected_fg: base.pill_selected_fg,
    }
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
    let is_selected = matches!(selected, SidebarSelection::Folder(path) if path == &folder.path);
    let leading_color = if is_selected {
        p.selection_fg
    } else {
        p.muted_fg
    };
    // The collapse caret for the whole FOLDERS group lives on the
    // section header (`sidebar-folders-caret`).  Every folder row —
    // root included — gets the closed-folder glyph as its only
    // leading icon, mirroring `FolderTree` in the React source.
    let leading = icon_glyph(IconName::FolderClosed, leading_color);

    let path = folder.path.clone();
    let handle = entity.clone();
    let dump_id: &'static str = if folder.depth == 0 {
        "sidebar-folder"
    } else {
        "sidebar-folder-child"
    };
    let gpui_id: SharedString = format!("sidebar-folder-{}", folder.path).into();
    let pad_left = px(12.0 + f32::from(folder.depth) * 16.0);

    let label = folder.display.clone();
    let (row_bg, label_color) = if is_selected {
        (Some(p.selection_bg), p.selection_fg)
    } else {
        (None, p.fg)
    };

    let hover_bg = p.hover_bg;
    let mut row = div()
        .id(gpui_id)
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
    } else {
        row = row.hover(move |this| this.bg(hover_bg));
    }
    row.on_click(move |_, _window, cx| {
        let path = path.clone();
        handle.update(cx, |this, cx| {
            this.select(SidebarSelection::Folder(path), cx)
        });
    })
    .dump_as(dump_id)
    .into_any_element()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{AppContext as _, TestAppContext};
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
        let panel = SidebarPanel::build_from_samples(samples, None);
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

    /// Phase 8.1 — `select` emits a [`SidebarSelectionChangedEvent`]
    /// when (and only when) the highlighted row actually changes.
    /// Workspace consumers subscribe to this event to drive dependent
    /// views; idempotent clicks must NOT churn the workspace.
    ///
    /// GPUI activates `cx.subscribe`'s subscription on the next
    /// `cx.flush_effects()` — see `App::new_subscription` in
    /// `crates/gpui/src/app.rs` (`self.defer(move |_| activate())`).
    /// Splitting subscribe + emit into separate `cx.update` blocks
    /// with a `run_until_parked` in between gives the deferred
    /// activate a chance to fire BEFORE the first emit.  Co-locating
    /// the two in one update silently swallows every event.
    #[gpui::test]
    fn select_emits_event_only_on_change(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<SidebarSelection>>> = Rc::new(RefCell::new(Vec::new()));

        let panel = cx.update(|cx| cx.new(|_| SidebarPanel::new()));

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(
                &panel,
                move |_panel, event: &SidebarSelectionChangedEvent, _cx| {
                    recv.borrow_mut().push(event.selection.clone());
                },
            )
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |panel, cx| {
                panel.select(SidebarSelection::AllNotes, cx);
                panel.select(SidebarSelection::Type("Areas".into()), cx);
                // Re-selecting the same row must NOT emit.
                panel.select(SidebarSelection::Type("Areas".into()), cx);
                panel.select(SidebarSelection::Folder("attachments".into()), cx);
            });
        });
        cx.run_until_parked();

        let got: Vec<SidebarSelection> = received.borrow().clone();
        assert_eq!(
            got,
            vec![
                SidebarSelection::AllNotes,
                SidebarSelection::Type("Areas".into()),
                SidebarSelection::Folder("attachments".into()),
            ],
            "select must emit on change and skip redundant re-selects",
        );
    }

    /// Worklist 2.1 — every `select` carries the row's visible label
    /// so consumers (note-list-pane header) don't have to re-derive
    /// it.  Inbox / AllNotes / Archive map to fixed strings; type /
    /// view labels round-trip from the variant payload; folder
    /// payloads carry a path so the label is looked up from the
    /// panel's folder list.
    #[gpui::test]
    fn select_emits_display_label(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<(SidebarSelection, SharedString)>>> =
            Rc::new(RefCell::new(Vec::new()));

        // Build a panel with one synthesised folder so we exercise the
        // folder lookup branch.  All other rows don't need any
        // populated state.
        let panel = cx.update(|cx| {
            cx.new(|_| {
                let mut p = SidebarPanel::new();
                p.folders = vec![FolderEntry {
                    path: SharedString::new_static("inbox"),
                    display: SharedString::new_static("inbox"),
                    depth: 1,
                }];
                p
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(
                &panel,
                move |_panel, event: &SidebarSelectionChangedEvent, _cx| {
                    recv.borrow_mut()
                        .push((event.selection.clone(), event.display_label.clone()));
                },
            )
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |panel, cx| {
                panel.select(SidebarSelection::AllNotes, cx);
                panel.select(SidebarSelection::Archive, cx);
                panel.select(SidebarSelection::Type("Events".into()), cx);
                panel.select(SidebarSelection::View("Active Projects".into()), cx);
                panel.select(SidebarSelection::Folder("inbox".into()), cx);
                panel.select(SidebarSelection::Inbox, cx);
            });
        });
        cx.run_until_parked();

        let got: Vec<(SidebarSelection, String)> = received
            .borrow()
            .iter()
            .map(|(s, l)| (s.clone(), l.to_string()))
            .collect();
        assert_eq!(
            got,
            vec![
                (SidebarSelection::AllNotes, "All Notes".to_string()),
                (SidebarSelection::Archive, "Archive".to_string()),
                (
                    SidebarSelection::Type("Events".into()),
                    "Events".to_string()
                ),
                (
                    SidebarSelection::View("Active Projects".into()),
                    "Active Projects".to_string(),
                ),
                (
                    SidebarSelection::Folder("inbox".into()),
                    "inbox".to_string()
                ),
                (SidebarSelection::Inbox, "Inbox".to_string()),
            ],
        );
    }

    /// Worklist 2.6 — every collapsible section defaults to expanded
    /// so the chrome opens with full visibility (matches the
    /// reference baseline).  The top fixed group has no header and is
    /// intentionally not part of the collapse API.
    #[gpui::test]
    fn sections_default_expanded(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|_cx| {
            let panel = SidebarPanel::new();
            for section in [
                SidebarSection::Views,
                SidebarSection::Types,
                SidebarSection::Folders,
            ] {
                assert!(
                    !panel.is_section_collapsed(section),
                    "{section:?} must default to expanded",
                );
            }
        });
    }

    /// Worklist 2.6 — `toggle_section` flips collapse state per
    /// section without touching the others, and is idempotent across
    /// pairs (toggle twice → back to original).
    #[gpui::test]
    fn toggle_section_flips_only_target(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| SidebarPanel::new());
        for section in [
            SidebarSection::Views,
            SidebarSection::Types,
            SidebarSection::Folders,
        ] {
            window
                .update(cx, |panel, _window, cx| {
                    panel.toggle_section(section, cx);
                    assert!(
                        panel.is_section_collapsed(section),
                        "{section:?} should be collapsed after first toggle",
                    );
                    for other in [
                        SidebarSection::Views,
                        SidebarSection::Types,
                        SidebarSection::Folders,
                    ] {
                        if other != section {
                            assert!(
                                !panel.is_section_collapsed(other),
                                "{other:?} must not be touched when toggling {section:?}",
                            );
                        }
                    }
                    panel.toggle_section(section, cx);
                    assert!(
                        !panel.is_section_collapsed(section),
                        "{section:?} should expand again after second toggle",
                    );
                })
                .unwrap();
        }
    }

    /// Worklist 2.6 — clicking the section header (simulated via
    /// `toggle_section`) drives a redraw + render cycle without
    /// panicking when child rows are populated but hidden.
    #[gpui::test]
    fn toggle_section_renders_after_collapse(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockVault::seeded()));
        let window = cx.update(|cx| {
            let panel = SidebarPanel::from_mock(cx);
            cx.open_window(Default::default(), |_window, cx| cx.new(|_| panel))
                .unwrap()
        });
        cx.run_until_parked();
        window
            .update(cx, |panel, _window, cx| {
                assert!(!panel.types.is_empty(), "fixture must seed TYPES rows");
                panel.toggle_section(SidebarSection::Types, cx);
                panel.toggle_section(SidebarSection::Views, cx);
                panel.toggle_section(SidebarSection::Folders, cx);
            })
            .unwrap();
        cx.run_until_parked();
    }
}
