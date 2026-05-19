//! `TolariaWorkspace` root view (ADR-0115 Phase 1 → 2a).
//!
//! Phase 1 shipped an empty shell.  Phase 2a grows it with the 3-dock +
//! `PaneGroup` topology:
//!
//! ```text
//! ┌─────────────────────────────────────┐
//! │ native title bar spacer (28 pt)     │
//! ├──────────┬──────────────┬───────────┤
//! │ Left     │              │ Right     │
//! │ Dock     │ PaneGroup    │ Dock      │
//! │          │ (centre)     │           │
//! ├──────────┴──────────────┴───────────┤
//! │ Bottom Dock                         │
//! ├─────────────────────────────────────┤
//! │ status bar slot (empty Phase 2a)    │
//! └─────────────────────────────────────┘
//! ModalLayer / ToastLayer rendered as overlays above all content.
//! ```
//!
//! Dock panels (Sidebar, Inspector, etc.) are added in Phase 2b.  The Phase 1
//! public API (`push_toast`, `toggle_modal`, `dismiss_modal`, `has_active_modal`,
//! `toast_count`) is unchanged.

use gpui::{
    div, px, AnyView, App, AppContext as _, Context, Entity, IntoElement, ParentElement, Render,
    Styled, Window,
};
use gpui_component::{
    resizable::{h_resizable, resizable_panel},
    ActiveTheme,
};
use status_bar::StatusBar;
use toasts::Toast;

/// Height of the macOS native title-bar spacer inserted at the top
/// of the workspace render tree, in logical points.
///
/// Reused by `ui::tree_dump` so the periscope-side click coordinate
/// system stays in lockstep with what GPUI lays out — see the
/// `set_window_y_offset` block in `crates/tolaria/src/main.rs`.
/// Bumping this constant requires bumping the offset wired in
/// `main.rs` too; keeping it as a single named constant avoids two
/// magic numbers drifting apart.
pub const NATIVE_TITLE_BAR_HEIGHT_PT: f32 = 28.0;

use crate::{
    dock::Dock,
    modal_layer::{ModalLayer, ModalView},
    pane_group::PaneGroup,
    panel::DockPosition,
    title_bar::TitleBar,
    toast_layer::ToastLayer,
};

/// Root GPUI view for the Tolaria application window.
///
/// Instantiate via [`TolariaWorkspace::empty`] inside `cx.add_window`'s root
/// closure; GPUI wraps the returned `Self` in an `Entity<TolariaWorkspace>`
/// automatically.
pub struct TolariaWorkspace {
    title_bar: Entity<TitleBar>,
    modal_layer: Entity<ModalLayer>,
    toast_layer: Entity<ToastLayer>,
    left_dock: Entity<Dock>,
    /// Fixed-position column between the left dock and the center
    /// `PaneGroup`.  Holds the vault note list — mirrors the two-column
    /// "vault tree | note list" structure of `tolaria-demo-vault-v2.png`
    /// where the left dock carries `sidebar_panel` and this column
    /// carries `note_list_pane`.  `None` for tests / when no note list
    /// is attached.
    note_list_column: Option<AnyView>,
    right_dock: Entity<Dock>,
    bottom_dock: Entity<Dock>,
    center_group: Entity<PaneGroup>,
    status_bar: Entity<StatusBar>,
}

impl TolariaWorkspace {
    /// Construct the root workspace view with the 3-dock + pane-group layout.
    ///
    /// All docks start empty and closed; Phase 2b chrome crates attach panels
    /// via [`Dock::set_panel`][crate::dock::Dock::set_panel].
    ///
    /// Called from inside the `cx.add_window(|window, cx| …)` closure in
    /// `crates/tolaria/src/main.rs`.
    pub fn empty(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        let modal_layer = cx.new(|_| ModalLayer::default());
        let toast_layer = cx.new(|_| ToastLayer::default());
        let left_dock = cx.new(|_| Dock::new(DockPosition::Left));
        let right_dock = cx.new(|_| Dock::new(DockPosition::Right));
        let bottom_dock = cx.new(|_| Dock::new(DockPosition::Bottom));
        let center_group = cx.new(|_| PaneGroup::new());
        let title_bar = cx.new(|_| TitleBar::new());
        // `StatusBar::from_or_empty` populates from mock globals if installed
        // (TOLARIA_MOCK=1 launches), or returns an empty bar otherwise.
        let status_bar = cx.new(|cx| StatusBar::from_or_empty(cx));
        Self {
            title_bar,
            modal_layer,
            toast_layer,
            left_dock,
            note_list_column: None,
            right_dock,
            bottom_dock,
            center_group,
            status_bar,
        }
    }

    // -----------------------------------------------------------------------
    // Phase 1 public API — must remain intact through all Phase 2+ work.
    // -----------------------------------------------------------------------

    /// Show or toggle a modal view inside the workspace's `ModalLayer`.
    ///
    /// Re-entering with the same `V` type closes the active modal (toggle
    /// semantics, see `ModalLayer::toggle_modal`).
    pub fn toggle_modal<V, B>(&self, window: &mut Window, cx: &mut App, build: B)
    where
        V: ModalView,
        B: FnOnce(&mut Window, &mut Context<V>) -> V,
    {
        self.modal_layer
            .update(cx, |layer, cx| layer.toggle_modal(window, cx, build));
    }

    /// Dismiss the active modal, if any.
    pub fn dismiss_modal(&self, cx: &mut App) {
        self.modal_layer.update(cx, |layer, cx| layer.dismiss(cx));
    }

    /// Enqueue a typed [`Toast`] in the workspace's [`ToastLayer`].
    ///
    /// Construct toasts via `Toast::info(...)` / `success` / `warning` /
    /// `error` builders from the `toasts` crate.
    pub fn push_toast(&self, toast: Toast, cx: &mut App) {
        self.toast_layer
            .update(cx, |layer, cx| layer.push(toast, cx));
    }

    /// Whether a modal view is currently shown.
    pub fn has_active_modal(&self, cx: &App) -> bool {
        self.modal_layer.read(cx).has_active_modal()
    }

    /// Number of currently queued toasts (for testing).
    #[cfg(test)]
    pub fn toast_count(&self, cx: &App) -> usize {
        self.toast_layer.read(cx).len()
    }

    /// Attach a [`Panel`][crate::panel::Panel] to the workspace's
    /// left [`Dock`].  Mirrors `attach_right_dock` / `attach_bottom_dock`
    /// (added when the chrome grows beyond the left column).
    pub fn attach_left_dock<P: crate::panel::Panel>(&self, panel: gpui::Entity<P>, cx: &mut App) {
        self.left_dock
            .update(cx, |dock, cx| dock.set_panel(panel, cx));
    }

    /// Mount `view` in the fixed-position column between the left
    /// [`Dock`] and the center [`PaneGroup`].  Used to host
    /// `note_list_pane::NoteListPane` next to the vault-tree sidebar,
    /// matching the two-column layout in `tolaria-demo-vault-v2.png`.
    /// Re-attaching replaces the previous occupant.
    pub fn attach_note_list_column<V: Render + 'static>(&mut self, view: gpui::Entity<V>) {
        self.note_list_column = Some(view.into());
    }

    /// Append `item` to the center [`PaneGroup`]'s active [`Pane`].
    ///
    /// Creates a fresh `Pane` and pushes it onto the group if the group
    /// is currently empty (Phase 5d: the workspace starts without any
    /// panes; the first `open_note` populates one).  The new item
    /// becomes the active item in the target pane.
    pub fn add_item_to_active_pane(
        &self,
        item: impl crate::item::ItemHandle + 'static,
        cx: &mut App,
    ) {
        self.center_group.update(cx, |group, cx| {
            if group.pane_count() == 0 {
                let pane = cx.new(|_| crate::pane::Pane::new());
                group.push(pane);
            }
            if let Some(pane) = group.active_pane().cloned() {
                pane.update(cx, |pane, cx| {
                    pane.add_item(item, crate::pane::Activation::Activate, cx);
                });
            }
        });
    }

    /// Number of items in the active center [`Pane`] (read-only;
    /// useful for downstream tests and assertions).
    pub fn active_pane_item_count(&self, cx: &App) -> usize {
        self.center_group
            .read(cx)
            .active_pane()
            .map(|p| p.read(cx).item_count())
            .unwrap_or(0)
    }
}

impl Render for TolariaWorkspace {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let title_bar = self.title_bar.clone();
        let left_dock = self.left_dock.clone();
        // Phase 7 visual-fidelity: hide the right dock entirely when
        // nothing is attached to it — the reference shows the editor
        // extending to the right edge of the window, and until
        // `inspector_panel` lands the dock is just an empty 240-pt
        // blank vertical bar that eats editor width.
        let right_dock = self
            .right_dock
            .read(cx)
            .active_panel()
            .is_some()
            .then(|| self.right_dock.clone());
        let center_group = self.center_group.clone();
        let note_list_column = self.note_list_column.clone();
        // Paint our own `theme.background` instead of relying on
        // `gpui_component::Root` to bleed through.  Each pane/dock
        // returns a transparent `div()`, but the Metal window default
        // is opaque black — so without an explicit bg on the
        // workspace's root, Light theme renders as a black canvas with
        // text-only foreground.  Discovered via periscope captures of
        // `--theme light` vs `--theme dark`: sampling the center pane
        // at RGB level reported `#000000` in both modes pre-fix.
        let theme = cx.theme();
        let bg = theme.background;
        let fg = theme.foreground;

        div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .bg(bg)
            .text_color(fg)
            // Custom title-bar strip (Phase 7.8) — replaces the bare
            // spacer that earlier phases used to pad below the macOS
            // traffic-light region.  [`NATIVE_TITLE_BAR_HEIGHT_PT`]
            // doubles as the value
            // `ui::tree_dump::set_window_y_offset` is initialised with
            // — bump them together if the chrome ever uses a
            // different title-bar style.
            .child(title_bar)
            // Horizontal split: Left Dock | (Note List Column?) |
            // Center PaneGroup | Right Dock.
            //
            // `.size(...)` on each panel is the *initial* width; the
            // resizable group keeps its own keyed `ResizableState`
            // (via the "workspace-main-layout" id), so the user's
            // drag-resize survives subsequent renders.  Left, note
            // list, and right are pinned to their dock defaults; the
            // center gets the remaining space implicitly.  Without an
            // initial width the panels split the row evenly, which
            // hides the chrome at ~25% of window width on the first
            // paint.
            //
            // The note-list column is rendered between the left dock
            // and the center group when one is attached
            // (`attach_note_list_column`) — matches the two-column
            // sidebar + note-list layout in `tolaria-demo-vault-v2.png`.
            .child({
                let mut panels: Vec<gpui_component::resizable::ResizablePanel> =
                    vec![resizable_panel().size(px(200.0)).child(left_dock)];
                if let Some(view) = note_list_column {
                    panels.push(resizable_panel().size(px(300.0)).child(view));
                }
                panels.push(resizable_panel().child(center_group));
                if let Some(right_dock) = right_dock {
                    panels.push(resizable_panel().size(px(240.0)).child(right_dock));
                }
                // `min_h_0` + `overflow_hidden` is the classic flex
                // trick that lets this row shrink below its content's
                // natural height.  Without it, an overflowing panel
                // (e.g. a tall sidebar list) pushes its flex_col
                // siblings — title spacer, bottom dock, status bar —
                // off the bottom of the window and they become
                // invisible.
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(h_resizable("workspace-main-layout").children(panels))
            })
            // Bottom dock (empty placeholder in Phase 2a).
            .child(self.bottom_dock.clone())
            // Status bar (Phase 2c — empty unless mock globals installed).
            .child(self.status_bar.clone())
            // Overlay layers rendered on top (absolute-positioned internally).
            .child(self.modal_layer.clone())
            .child(self.toast_layer.clone())
    }
}
