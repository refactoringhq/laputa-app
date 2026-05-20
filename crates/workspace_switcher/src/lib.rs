#![forbid(unsafe_code)]
//! Vault picker + multi-vault management surface (ADR-0115 Phase 8.19, Strand B).
//!
//! Mirrors the Tauri-era React surfaces that together form the
//! workspace switcher:
//!
//! - `src/components/WorkspaceSelector.tsx` — combobox / popover that
//!   lets the user switch between mounted vaults.
//! - `src/components/WorkspaceMoveButtons.tsx` — reorder controls for
//!   the recents list.
//! - `src/components/WorkspaceInitialsBadge.tsx` — the 1–2 letter
//!   badge rendered next to each vault row.
//! - `src/components/status-bar/VaultMenu.tsx` — status-bar entry
//!   point that opens the switcher popover.
//! - `src/components/WorkspaceSettingsRows.tsx` — Settings panel
//!   workspace section that lists the same set with manage actions.
//!
//! This crate ships the scaffold: a [`Workspace`] entry, a single
//! active-vault index, and a panel view that emits
//! [`VaultSwitchEvent`] when the user picks a different vault.  Phase
//! 10.9's `vault_registry` will replace the single-vault fallback
//! with a persisted recents list.
//!
//! # Usage
//!
//! ```rust,ignore
//! cx.set_global(MockVault::seeded());
//! let switcher = cx.new(|_window, cx| WorkspaceSwitcher::from_or_empty(cx));
//! cx.subscribe(&switcher, |_, event: &VaultSwitchEvent, _cx| {
//!     log::info!("vault switch requested: {}", event.path.display());
//! }).detach();
//! ```

use std::path::{Path, PathBuf};

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme};
use mock_fixtures::MockVault;
use vault::Vault;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/// One vault entry in the switcher's recents list.  `name` is the
/// human-readable label rendered next to the [`initials`](Self::initials)
/// badge; `path` is the canonical vault root used as the switch
/// payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    /// Canonical filesystem path of the vault root.
    pub path: PathBuf,
    /// Display label rendered in the row body.
    pub name: SharedString,
    /// 1–2 character badge derived from [`name`](Self::name).
    pub initials: SharedString,
}

impl Workspace {
    /// Build a [`Workspace`] for `path` with a human-readable `name`.
    /// [`initials`](Self::initials) is computed from `name` via
    /// [`initials_from_name`].
    #[must_use]
    pub fn new(path: PathBuf, name: impl Into<SharedString>) -> Self {
        let name = name.into();
        let initials = initials_from_name(&name);
        Self {
            path,
            name,
            initials,
        }
    }

    /// Build a [`Workspace`] from a vault root path alone, deriving
    /// `name` from the final path segment (or `"Vault"` if the path
    /// has none).
    #[must_use]
    pub fn from_path(path: PathBuf) -> Self {
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Vault".to_string());
        Self::new(path, SharedString::from(name))
    }
}

/// Derive a 1–2 character uppercase badge from a workspace `name`.
///
/// - Splits on whitespace and takes the first character of up to the
///   first two non-empty words.
/// - For a single-word name, returns just that word's first character.
/// - For an all-whitespace / empty name, returns `"?"`.
///
/// Each word contributes exactly one badge char — the first scalar
/// value yielded by `char::to_uppercase()`.  Pathological multi-char
/// uppercase forms (e.g. `ß` → `"SS"`) are clipped to their first
/// scalar so the badge never grows beyond 2 chars regardless of
/// input.
#[must_use]
pub fn initials_from_name(name: &str) -> SharedString {
    let mut out = String::with_capacity(2);
    for word in name.split_whitespace().take(2) {
        if let Some(first_scalar) = word.chars().next().and_then(|c| c.to_uppercase().next()) {
            out.push(first_scalar);
        }
    }
    if out.is_empty() {
        SharedString::new_static("?")
    } else {
        SharedString::from(out)
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user picks a vault row that isn't already active.
/// Workspace subscribers route this through the vault-lifecycle state
/// machine to mount the new vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultSwitchEvent {
    /// Canonical filesystem path of the requested vault root.
    pub path: PathBuf,
}

// ---------------------------------------------------------------------------
// WorkspaceSwitcher
// ---------------------------------------------------------------------------

/// Phase 8.19 vault picker view.
///
/// Construct via [`WorkspaceSwitcher::from_or_empty`] to inherit the
/// Phase-5 `Vault > MockVault > empty` precedence; the dedicated
/// [`from_vault`](Self::from_vault) / [`from_mock`](Self::from_mock)
/// branches are exposed so tests can drive each path explicitly.
pub struct WorkspaceSwitcher {
    workspaces: Vec<Workspace>,
    active: Option<usize>,
}

impl EventEmitter<VaultSwitchEvent> for WorkspaceSwitcher {}

impl WorkspaceSwitcher {
    /// Construct a switcher with an explicit list of `workspaces` and
    /// the index of the currently-active row (or `None` when no vault
    /// is mounted yet).  Out-of-range `active` values are clamped to
    /// `None` so callers can't construct a view with a dangling
    /// highlight.
    #[must_use]
    pub fn new(workspaces: Vec<Workspace>, active: Option<usize>) -> Self {
        let active = active.filter(|&ix| ix < workspaces.len());
        Self { workspaces, active }
    }

    /// An empty switcher — no workspaces, no active index.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            workspaces: Vec::new(),
            active: None,
        }
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `vault::Vault > MockVault > empty`.  Both real and mock paths
    /// surface the single open vault as the only entry — Phase 10.9
    /// (`vault_registry`) will widen this with persisted recents.
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
    /// [`from_or_empty`](Self::from_or_empty) instead when uncertain.
    pub fn from_vault(cx: &mut App) -> Self {
        let vault = cx.global::<Vault>();
        let entry = Workspace::from_path(vault.root().to_path_buf());
        Self::new(vec![entry], Some(0))
    }

    /// Build from the [`MockVault`] global.  The mock launch path
    /// doesn't carry a real filesystem root, so the entry is
    /// synthesized at `"/mock-vault"` with the display name `"Mock
    /// Vault"`.  Phase 10.9's `vault_registry` will replace this with
    /// a persisted recents list once mock + recent vault state share
    /// a storage backend.
    ///
    /// # Panics
    ///
    /// Panics if no `MockVault` global is installed.
    pub fn from_mock(cx: &mut App) -> Self {
        let _ = cx.global::<MockVault>(); // panic semantics match folder_tree::from_mock
        let entry = Workspace::new(PathBuf::from("/mock-vault"), "Mock Vault");
        Self::new(vec![entry], Some(0))
    }

    /// All workspace rows currently surfaced.
    #[must_use]
    pub fn workspaces(&self) -> &[Workspace] {
        &self.workspaces
    }

    /// Index of the currently-active row, if any.
    #[must_use]
    pub fn active_index(&self) -> Option<usize> {
        self.active
    }

    /// Path of the currently-active vault, if any.  Convenience
    /// accessor for subscribers that only care about the path.
    #[must_use]
    pub fn active_path(&self) -> Option<&Path> {
        self.active
            .and_then(|ix| self.workspaces.get(ix))
            .map(|w| w.path.as_path())
    }

    /// Switch the active row to `idx` and emit [`VaultSwitchEvent`]
    /// when the requested index points at a different vault than the
    /// one already active.  Out-of-bounds indices and same-index
    /// clicks are silent no-ops so subscribers don't get re-mount
    /// churn.
    pub fn switch_to(&mut self, idx: usize, cx: &mut Context<Self>) {
        if idx >= self.workspaces.len() || self.active == Some(idx) {
            return;
        }
        let path = self.workspaces[idx].path.clone();
        self.active = Some(idx);
        cx.emit(VaultSwitchEvent { path });
        cx.notify();
    }

    /// Set the active index without emitting an event.  Used by the
    /// workspace to keep the highlight in sync when the active vault
    /// changes from outside this view (e.g. a CLI-driven vault swap).
    pub fn set_active(&mut self, active: Option<usize>, cx: &mut Context<Self>) {
        let active = active.filter(|&ix| ix < self.workspaces.len());
        if self.active == active {
            return;
        }
        self.active = active;
        cx.notify();
    }
}

impl Default for WorkspaceSwitcher {
    fn default() -> Self {
        Self::empty()
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for WorkspaceSwitcher {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let active_bg = theme.list_active;
        let hover_bg = theme.list_hover;
        let badge_bg = theme.muted;
        let active = self.active;
        let entity = cx.entity();

        v_flex().id("workspace-switcher").size_full().children(
            self.workspaces.iter().enumerate().map(|(ix, entry)| {
                let is_active = active == Some(ix);
                let label = entry.name.clone();
                let initials = entry.initials.clone();
                let row_entity = entity.clone();
                div()
                    .id(("workspace-row", ix))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(8.0))
                    .py(px(4.0))
                    .text_sm()
                    .text_color(if is_active { fg } else { muted })
                    .when(is_active, |this| this.bg(active_bg))
                    .cursor_pointer()
                    .hover(move |this| this.bg(hover_bg))
                    .on_click(move |_, _window, cx| {
                        row_entity.update(cx, |this, cx| this.switch_to(ix, cx));
                    })
                    .child(
                        div()
                            .px(px(4.0))
                            .py(px(1.0))
                            .text_xs()
                            .text_color(fg)
                            .bg(badge_bg)
                            .rounded(px(3.0))
                            .child(initials),
                    )
                    .child(div().child(label))
            }),
        )
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

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// Constructing a switcher with two workspaces and mounting it on
    /// a window must render without panic.
    #[gpui::test]
    fn new_view_renders_workspace_rows_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| {
            WorkspaceSwitcher::new(
                vec![
                    Workspace::new(PathBuf::from("/tmp/alpha"), "Alpha Vault"),
                    Workspace::new(PathBuf::from("/tmp/beta"), "Beta Notes"),
                ],
                Some(0),
            )
        });
        cx.run_until_parked();
    }

    /// `from_or_empty` returns an empty switcher when no Vault or
    /// MockVault global is installed.
    #[gpui::test]
    fn from_or_empty_falls_through_to_empty_when_no_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let switcher = WorkspaceSwitcher::from_or_empty(cx);
            assert!(switcher.workspaces().is_empty());
            assert!(switcher.active_index().is_none());
        });
    }

    /// `from_or_empty` takes the MockVault branch when a MockVault
    /// global is installed and no real `Vault` is present.  The
    /// resulting switcher must surface exactly one row with the
    /// synthesized mock path.
    #[gpui::test]
    fn from_or_empty_takes_mock_branch_when_mock_present(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let switcher = WorkspaceSwitcher::from_or_empty(cx);
            assert_eq!(switcher.workspaces().len(), 1);
            assert_eq!(switcher.active_index(), Some(0));
            assert_eq!(
                switcher.active_path(),
                Some(Path::new("/mock-vault")),
                "mock branch must synthesize a single entry at /mock-vault"
            );
        });
    }

    /// `switch_to` an index that differs from the active one must
    /// update the highlight and emit `VaultSwitchEvent` carrying the
    /// target path.
    #[gpui::test]
    fn switch_to_different_index_emits_vault_switch_event(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let switcher: Entity<WorkspaceSwitcher> = cx.update(|cx| {
            cx.new(|_| {
                WorkspaceSwitcher::new(
                    vec![
                        Workspace::new(PathBuf::from("/tmp/alpha"), "Alpha Vault"),
                        Workspace::new(PathBuf::from("/tmp/beta"), "Beta Notes"),
                    ],
                    Some(0),
                )
            })
        });

        let received: Rc<RefCell<Vec<VaultSwitchEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&switcher, move |_, event: &VaultSwitchEvent, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            switcher.update(cx, |s, cx| s.switch_to(1, cx));
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(got.len(), 1, "switch to a new index must emit once");
        assert_eq!(got[0].path, PathBuf::from("/tmp/beta"));
        cx.update(|cx| {
            assert_eq!(switcher.read(cx).active_index(), Some(1));
        });
    }

    /// `switch_to` an index that's already active must be a silent
    /// no-op — no event, no notify churn.
    #[gpui::test]
    fn switch_to_same_index_is_silent_no_op(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let switcher: Entity<WorkspaceSwitcher> = cx.update(|cx| {
            cx.new(|_| {
                WorkspaceSwitcher::new(
                    vec![Workspace::new(PathBuf::from("/tmp/alpha"), "Alpha Vault")],
                    Some(0),
                )
            })
        });

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&switcher, move |_, _event: &VaultSwitchEvent, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            switcher.update(cx, |s, cx| s.switch_to(0, cx));
            switcher.update(cx, |s, cx| s.switch_to(42, cx)); // out-of-bounds is also silent
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            0,
            "same-index and out-of-bounds switches must never emit"
        );
    }

    /// Initials derive from up to the first two whitespace-split
    /// words, uppercased; pathological inputs fall back to `"?"`.
    #[test]
    fn initials_derive_from_name_up_to_two_chars() {
        assert_eq!(initials_from_name("Alpha Vault").as_ref(), "AV");
        assert_eq!(initials_from_name("clear prose notes").as_ref(), "CP");
        assert_eq!(initials_from_name("Solo").as_ref(), "S");
        assert_eq!(initials_from_name("  ").as_ref(), "?");
        assert_eq!(initials_from_name("").as_ref(), "?");
        // Non-ASCII uppercase clip — the German `ß` uppercases to
        // `"SS"`, but `initials_from_name` keeps only the first scalar
        // value per word so the badge stays bounded by the 2-char cap.
        assert_eq!(initials_from_name("ßeta vault").as_ref(), "SV");
    }

    /// `new` with an out-of-range active index must clamp to `None`
    /// so the view can't be constructed with a dangling highlight.
    #[test]
    fn new_clamps_out_of_range_active_to_none() {
        let switcher = WorkspaceSwitcher::new(
            vec![Workspace::new(PathBuf::from("/tmp/alpha"), "Alpha Vault")],
            Some(99),
        );
        assert_eq!(switcher.active_index(), None);
    }

    /// `set_active` updates the highlight without emitting an event —
    /// used to mirror externally-driven vault swaps.
    #[gpui::test]
    fn set_active_does_not_emit(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let switcher: Entity<WorkspaceSwitcher> = cx.update(|cx| {
            cx.new(|_| {
                WorkspaceSwitcher::new(
                    vec![
                        Workspace::new(PathBuf::from("/tmp/alpha"), "Alpha Vault"),
                        Workspace::new(PathBuf::from("/tmp/beta"), "Beta Notes"),
                    ],
                    Some(0),
                )
            })
        });

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&switcher, move |_, _event: &VaultSwitchEvent, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            switcher.update(cx, |s, cx| s.set_active(Some(1), cx));
        });
        cx.run_until_parked();

        assert_eq!(*received.borrow(), 0, "set_active must never emit");
        cx.update(|cx| {
            assert_eq!(switcher.read(cx).active_index(), Some(1));
        });
    }
}
