#![forbid(unsafe_code)]
//! Interactive folder browser for Tolaria (ADR-0115 Phase 8.17, Strand B).
//!
//! Mirrors the Tauri-era `src/components/FolderTree.tsx` shape: a flat,
//! depth-indented list of folder paths derived from every note's parent
//! directory.  Selecting a folder emits [`FolderSelectedEvent`] so the
//! workspace can route the selection to the note-list pane (Phase 8.1
//! already wired `SidebarPanel`'s `Folder(path)` scope variant — this
//! crate produces the same scope payload from a richer browser).
//!
//! # Usage
//!
//! ```rust,ignore
//! cx.set_global(MockVault::seeded());
//! let tree = cx.new(|_window, cx| FolderTree::from_or_empty(cx));
//! cx.subscribe(&tree, |_, event: &FolderSelectedEvent, _cx| {
//!     log::info!("folder selected: {}", event.path);
//! }).detach();
//! ```

use std::collections::BTreeSet;

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme};
use mock_fixtures::MockVault;
use vault::Vault;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user clicks a folder row.  Workspace subscribers
/// route this through `NoteListPane::set_scope(NoteListScope::Folder(path))`
/// so the note list narrows to the folder's contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderSelectedEvent {
    /// Vault-root-relative folder path (`""` for the vault root).
    pub path: SharedString,
}

// ---------------------------------------------------------------------------
// FolderEntry
// ---------------------------------------------------------------------------

/// One row in the rendered folder list.  Lifted from a vault note's
/// `parent_path` and de-duplicated into a sorted, depth-aware projection
/// at construction time so render stays free of business logic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderEntry {
    /// Vault-root-relative path (`""` for the vault root).
    pub path: SharedString,
    /// Indentation depth — derived from `path.matches('/').count()`,
    /// clamped to a reasonable maximum so a pathological deep tree
    /// doesn't push subsequent rows off-screen.
    pub depth: usize,
    /// Display label — the last segment of `path`, or `"(root)"`
    /// for the vault root.
    pub label: SharedString,
}

// ---------------------------------------------------------------------------
// FolderTree
// ---------------------------------------------------------------------------

/// Phase 8.17 folder browser view.
///
/// Construct via [`FolderTree::from_or_empty`] to inherit the Phase-5
/// `Vault > MockVault > empty` precedence; [`FolderTree::from_mock`]
/// builds from the [`MockVault`] global directly for tests / mock-mode
/// launches.
pub struct FolderTree {
    folders: Vec<FolderEntry>,
    selected: Option<SharedString>,
}

impl EventEmitter<FolderSelectedEvent> for FolderTree {}

impl FolderTree {
    /// An empty folder tree — no folders, no selection.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            folders: Vec::new(),
            selected: None,
        }
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `vault::Vault > MockVault > empty`.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::empty()
        }
    }

    /// Build from the real `vault::Vault` global.
    ///
    /// # Panics
    ///
    /// Panics if no `Vault` global is installed.  Use
    /// [`FolderTree::from_or_empty`] instead when uncertain.
    pub fn from_vault(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<Vault>();
        let vault_root = vault.root().to_path_buf();
        let ids = executor.block_on(vault.notes());
        let mut paths = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                paths.push(note.path.clone());
            }
        }
        Self::from_paths(paths.iter().map(std::path::PathBuf::as_path), &vault_root)
    }

    /// Build from the [`MockVault`] global.
    ///
    /// # Panics
    ///
    /// Panics if no `MockVault` global is installed.
    pub fn from_mock(cx: &mut App) -> Self {
        let executor = cx.foreground_executor().clone();
        let vault = cx.global::<MockVault>();
        let ids = executor.block_on(vault.notes());
        let mut paths = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(note) = executor.block_on(vault.note(id)) {
                paths.push(note.path.clone());
            }
        }
        Self::from_paths(
            paths.iter().map(std::path::PathBuf::as_path),
            std::path::Path::new(""),
        )
    }

    /// Pure projection: take an iterator of note paths plus a vault
    /// root, and produce a sorted de-duplicated list of folder rows.
    /// Used by [`from_vault`] / [`from_mock`] and exposed so tests can
    /// drive the projection without touching globals.
    pub fn from_paths<'a>(
        paths: impl IntoIterator<Item = &'a std::path::Path>,
        vault_root: &std::path::Path,
    ) -> Self {
        let mut unique: BTreeSet<String> = BTreeSet::new();
        for note_path in paths {
            let relative = note_path
                .strip_prefix(vault_root)
                .unwrap_or(note_path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Add every prefix so a/b/c contributes ["a", "a/b", "a/b/c"].
            let mut acc = String::new();
            for segment in relative.split('/').filter(|s| !s.is_empty()) {
                if !acc.is_empty() {
                    acc.push('/');
                }
                acc.push_str(segment);
                unique.insert(acc.clone());
            }
            // The vault root itself is always present.
            unique.insert(String::new());
        }

        let folders = unique
            .into_iter()
            .map(|path| {
                let depth = if path.is_empty() {
                    0
                } else {
                    path.matches('/').count() + 1
                };
                let label = if path.is_empty() {
                    SharedString::new_static("(root)")
                } else {
                    SharedString::from(path.rsplit('/').next().unwrap_or(&path).to_string())
                };
                FolderEntry {
                    path: SharedString::from(path),
                    depth,
                    label,
                }
            })
            .collect();

        Self {
            folders,
            selected: None,
        }
    }

    /// All folder rows currently surfaced.  Test helper — production
    /// reads via [`Render`].
    #[must_use]
    pub fn folders(&self) -> &[FolderEntry] {
        &self.folders
    }

    /// Currently-selected folder path, if any.
    #[must_use]
    pub fn selected(&self) -> Option<&SharedString> {
        self.selected.as_ref()
    }

    /// Select `path` and emit [`FolderSelectedEvent`] so workspace
    /// subscribers can route the change.  No-op when `path` is
    /// already selected (same-row click should not churn the
    /// note-list pane).
    pub fn select(&mut self, path: SharedString, cx: &mut Context<Self>) {
        if self.selected.as_ref() == Some(&path) {
            return;
        }
        self.selected = Some(path.clone());
        cx.emit(FolderSelectedEvent { path });
        cx.notify();
    }

    /// Set the selection without emitting an event.  Used by the
    /// workspace to keep the highlight in sync when the selection
    /// originates elsewhere (e.g. a sidebar `Folder(path)` selection).
    pub fn set_active(&mut self, path: Option<SharedString>, cx: &mut Context<Self>) {
        if self.selected == path {
            return;
        }
        self.selected = path;
        cx.notify();
    }
}

impl Default for FolderTree {
    fn default() -> Self {
        Self::empty()
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for FolderTree {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let active_bg = theme.list_active;
        let hover_bg = theme.list_hover;
        let selected = self.selected.clone();
        let entity = cx.entity();

        v_flex()
            .size_full()
            .children(self.folders.iter().enumerate().map(|(ix, entry)| {
                let is_selected = selected.as_ref() == Some(&entry.path);
                let row_path = entry.path.clone();
                let row_label = entry.label.clone();
                let indent = px(8.0 + (entry.depth as f32) * 12.0);
                let row_entity = entity.clone();
                div()
                    .id(("folder-tree-row", ix))
                    .flex()
                    .flex_row()
                    .items_center()
                    .pl(indent)
                    .pr(px(8.0))
                    .py(px(4.0))
                    .text_sm()
                    .text_color(if is_selected { fg } else { muted })
                    .when(is_selected, |this| this.bg(active_bg))
                    .cursor_pointer()
                    .hover(move |this| this.bg(hover_bg))
                    .on_click(move |_, _window, cx| {
                        let path = row_path.clone();
                        row_entity.update(cx, |this, cx| this.select(path, cx));
                    })
                    .child(row_label)
            }))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AppContext as _;
    use gpui::Entity;
    use gpui::TestAppContext;
    use std::path::PathBuf;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An empty tree renders without panic and reports zero folders.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| FolderTree::empty());
        cx.run_until_parked();
    }

    /// `from_paths` collects every prefix of every parent path,
    /// deduplicated and sorted, plus an empty root row.
    #[test]
    fn from_paths_collects_unique_prefixes() {
        let paths = [
            PathBuf::from("a/b/note-1.md"),
            PathBuf::from("a/b/note-2.md"),
            PathBuf::from("a/c/note-3.md"),
            PathBuf::from("root-note.md"),
        ];
        let tree =
            FolderTree::from_paths(paths.iter().map(PathBuf::as_path), std::path::Path::new(""));
        let paths: Vec<&str> = tree.folders().iter().map(|e| e.path.as_ref()).collect();
        assert_eq!(paths, ["", "a", "a/b", "a/c"]);
    }

    /// Depth comes from segment count: `""` is depth 0, `"a"` is 1,
    /// `"a/b"` is 2.
    #[test]
    fn depth_tracks_segment_count() {
        let paths = [PathBuf::from("a/b/c/note.md")];
        let tree =
            FolderTree::from_paths(paths.iter().map(PathBuf::as_path), std::path::Path::new(""));
        let depths: Vec<usize> = tree.folders().iter().map(|e| e.depth).collect();
        assert_eq!(depths, [0, 1, 2, 3]);
    }

    /// `from_mock` returns a populated tree when MockVault is seeded.
    #[gpui::test]
    fn from_mock_populates_from_seeded_vault(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let tree = FolderTree::from_mock(cx);
            assert!(
                !tree.folders().is_empty(),
                "seeded MockVault must produce ≥1 folder row (at minimum the root)"
            );
        });
    }

    /// `from_or_empty` returns an empty tree when no globals installed.
    #[gpui::test]
    fn from_or_empty_returns_empty_without_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let tree = FolderTree::from_or_empty(cx);
            assert!(tree.folders().is_empty());
            assert!(tree.selected().is_none());
        });
    }

    /// Selecting a folder must emit `FolderSelectedEvent` exactly
    /// once on the first selection, and re-selecting the same path
    /// must be a no-op (no event).
    #[gpui::test]
    fn select_emits_event_only_on_change(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);

        let tree: Entity<FolderTree> = cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.new(|cx| FolderTree::from_mock(cx))
        });

        let received: Rc<RefCell<Vec<SharedString>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&tree, move |_, event: &FolderSelectedEvent, _| {
                recv.borrow_mut().push(event.path.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            tree.update(cx, |t, cx| t.select(SharedString::new_static(""), cx));
            // Re-select the same path → no-op.
            tree.update(cx, |t, cx| t.select(SharedString::new_static(""), cx));
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![SharedString::new_static("")],
            "select must emit exactly once per distinct selection"
        );
    }

    /// `set_active` updates the highlight without emitting an event —
    /// used by the workspace to keep the tree in sync with the
    /// sidebar's `Folder(path)` selection.
    #[gpui::test]
    fn set_active_does_not_emit(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let tree: Entity<FolderTree> = cx.update(|cx| cx.new(|_| FolderTree::empty()));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&tree, move |_, _event: &FolderSelectedEvent, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            tree.update(cx, |t, cx| {
                t.set_active(Some(SharedString::new_static("a/b")), cx);
            });
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            0,
            "set_active must never emit FolderSelectedEvent"
        );
        cx.update(|cx| {
            assert_eq!(
                tree.read(cx).selected().map(SharedString::as_ref),
                Some("a/b"),
                "set_active must update the highlight"
            );
        });
    }
}
