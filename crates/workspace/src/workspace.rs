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
use ui::tree_dump::DumpAsExt as _;

/// Height of the macOS native title-bar spacer inserted at the top
/// of the workspace render tree, in logical points.
///
/// Matches the floor of Zed's `platform_title_bar_height` formula:
/// `(1.75 * rem_size).max(px(34.))` at the default 16-pt rem size.
/// The live render in `title_bar.rs` applies the dynamic formula;
/// this constant is the static fallback used by `ui::tree_dump` so
/// the periscope-side click coordinate system stays in lockstep with
/// what GPUI lays out — see the `set_window_y_offset` block in
/// `crates/tolaria/src/main.rs`.  Bumping this constant requires
/// bumping the offset wired in `main.rs` too; keeping it as a single
/// named constant avoids two magic numbers drifting apart.
pub const NATIVE_TITLE_BAR_HEIGHT_PT: f32 = 34.0;

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
    pub fn empty(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let modal_layer = cx.new(|_| ModalLayer::default());
        let toast_layer = cx.new(|_| ToastLayer::default());
        let left_dock = cx.new(|_| Dock::new(DockPosition::Left));
        let right_dock = cx.new(|_| Dock::new(DockPosition::Right));
        let bottom_dock = cx.new(|_| Dock::new(DockPosition::Bottom));
        let center_group = cx.new(|_| PaneGroup::new());
        let title_bar = cx.new(|_| TitleBar::new(left_dock.clone()));
        // `StatusBar::from_or_empty` populates from mock globals if installed
        // (TOLARIA_MOCK=1 launches), or returns an empty bar otherwise.
        // `window` is forwarded so the status bar can register a
        // focus-loss observer that dismisses the vault menu on window
        // blur (worklist 2.4).
        let status_bar = cx.new(|cx| StatusBar::from_or_empty(window, cx));

        // Observe the left dock so the workspace re-renders when the
        // sidebar toggle (visual-issue #020) flips
        // `DockState::Open` ↔ `DockState::Closed`.  Without this, the
        // dock's own `cx.notify()` only re-runs `Dock::render` (which
        // returns an empty `div()` when closed) — the workspace's
        // outer `render` is never called, so the resizable column
        // stays 200 pt wide even though the sidebar contents
        // disappeared.  Re-rendering the workspace lets the panels
        // vec skip the left-dock entry entirely when `is_open()` is
        // false, collapsing the column.
        cx.observe(&left_dock, |_, _, cx| cx.notify()).detach();

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

    /// Phase 8.13 — handler form of [`Self::dismiss_modal`] callable
    /// from `cx.on_action(|_: &Dismiss, cx| ...)` paths via
    /// `dispatch_to_workspace`.  No-op when no modal is shown so the
    /// action can be bound globally without interfering with input
    /// fields that have their own Escape semantics.
    pub fn dismiss_active_modal(&self, cx: &mut Context<Self>) {
        if !self.has_active_modal(cx) {
            return;
        }
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

    /// Flip the left [`Dock`] between `Open` and `Closed`.  Phase 8.8
    /// `actions::ToggleSidebar` dispatches through this method so the
    /// keymap-driven shortcut matches the title-bar toggle button
    /// (which calls `Dock::toggle` directly).
    pub fn toggle_left_dock(&self, cx: &mut App) {
        self.left_dock.update(cx, |dock, cx| dock.toggle(cx));
    }

    /// Close the active item in the center pane group's active pane.
    /// Phase 8.8 `actions::CloseTab` dispatches through this method so
    /// the keymap-driven shortcut and any future tab-strip context
    /// menu share one code path.  No-op when no pane is active.
    pub fn close_active_tab(&self, cx: &mut App) {
        let Some(active_pane) = self.center_group.read(cx).active_pane().cloned() else {
            return;
        };
        active_pane.update(cx, |pane, cx| pane.close_active(cx));
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
        // Visual-issue #020: collapse the left-dock column when the
        // sidebar toggle closes it.  The panel slot must stay in the
        // resizable group at the same index — gpui-component's
        // `ResizableState::sync_panels_count` truncates per-panel
        // sizes from the *end* when the count drops, so removing the
        // first panel would shift the saved widths down one slot and
        // squash the note-list to the sidebar's width.  Using
        // `.visible(false)` keeps the slot ordering stable; the panel
        // renders as a zero-width div and the freed space flows to
        // the flex (center) panel.  The workspace's
        // `cx.observe(&left_dock, …)` in [`TolariaWorkspace::empty`]
        // triggers a re-render when `Dock::toggle` flips state, so
        // this `is_open()` snapshot always reflects the latest toggle.
        let left_dock = self.left_dock.clone();
        let left_dock_visible = self.left_dock.read(cx).is_open();
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
            //
            // Each panel child is wrapped in a tagged div so periscope
            // can crop to e.g. `workspace-left-dock` via `screenshot --id`.
            .child({
                let mut panels: Vec<gpui_component::resizable::ResizablePanel> = Vec::new();
                panels.push(
                    resizable_panel()
                        .size(px(200.0))
                        .visible(left_dock_visible)
                        .child(
                            div()
                                .size_full()
                                .child(left_dock)
                                .dump_as("workspace-left-dock"),
                        ),
                );
                // Sized siblings call `.flex_none()` so they don't
                // absorb the freed sidebar width when the left dock
                // toggles hidden — the gpui-component author flagged
                // this as the load-bearing case in
                // `gpui-component/.../resizable/panel.rs`.  Without
                // it, every sized panel inherits the resizable group's
                // `flex_grow()` default and grows proportionally; the
                // user reported the note-list column getting wider on
                // sidebar collapse and shrinking back on restore.  The
                // unsized center panel keeps the `flex_grow` default,
                // so it's the sole destination for freed width.
                if let Some(view) = note_list_column {
                    panels.push(
                        resizable_panel()
                            .size(px(300.0))
                            .flex_none()
                            .child(div().size_full().child(view).dump_as("workspace-note-list")),
                    );
                }
                panels.push(
                    resizable_panel().child(
                        div()
                            .size_full()
                            .child(center_group)
                            .dump_as("workspace-center"),
                    ),
                );
                if let Some(right_dock) = right_dock {
                    panels.push(
                        resizable_panel().size(px(240.0)).flex_none().child(
                            div()
                                .size_full()
                                .child(right_dock)
                                .dump_as("workspace-right-dock"),
                        ),
                    );
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
            .child(
                div()
                    .child(self.bottom_dock.clone())
                    .dump_as("workspace-bottom-dock"),
            )
            // Status bar (Phase 2c — empty unless mock globals installed).
            .child(self.status_bar.clone())
            // Overlay layers rendered on top (absolute-positioned internally).
            .child(self.modal_layer.clone())
            .child(self.toast_layer.clone())
            .dump_as("workspace")
    }
}
