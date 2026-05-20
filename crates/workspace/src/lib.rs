//! Tolaria workspace root view, overlay layers, and chrome topology (ADR-0115).
//!
//! This crate owns:
//! - [`TolariaWorkspace`] — top-level GPUI view opened as the single app window.
//! - [`ModalLayer`] / [`ToastLayer`] — overlay layers above all content.
//! - [`Dock`] — hosts one [`Panel`] per workspace edge (Left/Right/Bottom).
//! - [`Pane`] / [`PaneGroup`] — ordered sets of open [`Item`]s.
//! - [`Panel`] / [`Item`] traits — implemented by chrome panel / content crates.
//! - [`MockNoteItem`] — stub `Item` for Phase 2a topology testing.
//!
//! Phase 1 shipped the empty workspace shell.  Phase 2a grows it with the
//! 3-dock + pane-group topology modelled on `zed/crates/workspace/src/`.

pub mod dock;
pub mod item;
pub mod mock_note_item;
pub mod modal_layer;
pub mod pane;
pub mod pane_group;
pub mod panel;
pub mod title_bar;
pub mod toast_layer;
pub mod workspace;

pub use dock::Dock;
pub use item::{Item, ItemHandle};
pub use mock_note_item::MockNoteItem;
pub use modal_layer::{ModalLayer, ModalView};
pub use pane::{Activation, Pane};
pub use pane_group::PaneGroup;
pub use panel::{DockPosition, Panel};
pub use title_bar::TitleBar;
pub use toast_layer::ToastLayer;
pub use workspace::{TolariaWorkspace, NATIVE_TITLE_BAR_HEIGHT_PT};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use gpui::{
        px, App, AppContext as _, Context, IntoElement, ParentElement, Pixels, Render,
        SharedString, TestAppContext, Window,
    };

    use crate::{
        Activation, Dock, DockPosition, Item, MockNoteItem, ModalView, Pane, PaneGroup,
        TolariaWorkspace,
    };

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    /// Install the `gpui_component::Theme` global required by any primitive
    /// that reads it during render (mirrors `embed_poc/src/layout.rs:243`).
    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    // -----------------------------------------------------------------------
    // Dummy modal (Phase 1 carry-over)
    // -----------------------------------------------------------------------

    struct DummyModal;

    impl ModalView for DummyModal {}

    impl Render for DummyModal {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            gpui::div().child("modal content")
        }
    }

    // -----------------------------------------------------------------------
    // Minimal Panel impl for dock tests
    // -----------------------------------------------------------------------

    struct MockPanel {
        position: DockPosition,
    }

    impl MockPanel {
        fn left() -> Self {
            Self {
                position: DockPosition::Left,
            }
        }
    }

    impl Render for MockPanel {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            gpui::div().child("panel")
        }
    }

    impl crate::panel::Panel for MockPanel {
        fn persistent_name(&self) -> &str {
            "MockPanel"
        }

        fn panel_key(&self) -> &str {
            "mock"
        }

        fn position(&self, _cx: &App) -> DockPosition {
            self.position
        }

        fn set_position(&mut self, position: DockPosition, _cx: &mut Context<Self>) {
            self.position = position;
        }

        fn default_size(&self, _cx: &App) -> Pixels {
            px(240.0)
        }

        fn toggle_action(&self) -> Box<dyn gpui::Action> {
            Box::new(actions::ToggleSidebar)
        }

        fn starts_open(&self, _cx: &App) -> bool {
            true
        }
    }

    // -----------------------------------------------------------------------
    // Phase 1 carry-over tests
    // -----------------------------------------------------------------------

    /// Constructing an empty workspace must not panic.
    #[gpui::test]
    fn empty_workspace_renders_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(TolariaWorkspace::empty);
        cx.run_until_parked();
    }

    /// Pushing a dummy ModalView and then dismissing it must leave the
    /// active-modal flag false again.
    #[gpui::test]
    fn modal_layer_accepts_and_dismisses_dummy_modal(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(TolariaWorkspace::empty);

        window
            .update(cx, |workspace, window, cx| {
                workspace.toggle_modal::<DummyModal, _>(window, cx, |_window, _cx| DummyModal);
            })
            .unwrap();

        let is_active = window
            .update(cx, |workspace, _window, cx| workspace.has_active_modal(cx))
            .unwrap();
        assert!(is_active, "modal should be active after toggle_modal");

        window
            .update(cx, |workspace, _window, cx| workspace.dismiss_modal(cx))
            .unwrap();

        let is_active_after = window
            .update(cx, |workspace, _window, cx| workspace.has_active_modal(cx))
            .unwrap();
        assert!(!is_active_after, "modal should not be active after dismiss");
    }

    /// Phase 8.13 — `dismiss_active_modal` is the action-handler form
    /// of `dismiss_modal`.  Pushing a modal and then routing through
    /// the new helper must leave the active-modal flag false, and
    /// calling it when no modal is shown must be a no-op (so binding
    /// `escape` globally doesn't interfere with input focus paths).
    #[gpui::test]
    fn dismiss_active_modal_round_trips_and_no_ops_when_empty(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(TolariaWorkspace::empty);

        // No-op path: dismissing with no modal active.
        window
            .update(cx, |workspace, _window, cx| {
                workspace.dismiss_active_modal(cx)
            })
            .unwrap();
        let still_empty = window
            .update(cx, |workspace, _window, cx| workspace.has_active_modal(cx))
            .unwrap();
        assert!(
            !still_empty,
            "dismiss_active_modal must be a no-op when no modal is active"
        );

        // Round-trip: push, confirm active, dismiss via helper, confirm inactive.
        window
            .update(cx, |workspace, window, cx| {
                workspace.toggle_modal::<DummyModal, _>(window, cx, |_window, _cx| DummyModal);
            })
            .unwrap();
        let is_active = window
            .update(cx, |workspace, _window, cx| workspace.has_active_modal(cx))
            .unwrap();
        assert!(is_active, "modal must be active after toggle_modal");

        window
            .update(cx, |workspace, _window, cx| {
                workspace.dismiss_active_modal(cx)
            })
            .unwrap();
        let is_active_after = window
            .update(cx, |workspace, _window, cx| workspace.has_active_modal(cx))
            .unwrap();
        assert!(
            !is_active_after,
            "dismiss_active_modal must clear the active modal"
        );
    }

    /// Pushing a toast message must enqueue it on the `ToastLayer`.
    #[gpui::test]
    fn toast_layer_push_does_not_panic(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(TolariaWorkspace::empty);

        window
            .update(cx, |workspace, _window, cx| {
                workspace.push_toast(toasts::Toast::info("settings UI in Phase 2"), cx);
            })
            .unwrap();

        let len = window
            .update(cx, |workspace, _window, cx| workspace.toast_count(cx))
            .unwrap();
        assert_eq!(len, 1, "toast should be queued after push");
    }

    // -----------------------------------------------------------------------
    // Phase 2a: 3-dock workspace layout
    // -----------------------------------------------------------------------

    /// The Phase 2a workspace with three docks must render without panic.
    #[gpui::test]
    fn three_dock_workspace_renders_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(TolariaWorkspace::empty);
        cx.run_until_parked();
    }

    // -----------------------------------------------------------------------
    // Phase 2a: Dock tests
    // -----------------------------------------------------------------------

    /// A freshly constructed dock has no panel and is closed.
    #[gpui::test]
    fn dock_starts_closed_with_no_panel(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Dock::new(DockPosition::Left));
        window
            .update(cx, |d, _window, _cx| {
                assert!(!d.is_open());
                assert!(d.active_panel().is_none());
            })
            .unwrap();
    }

    /// `toggle` on a dock without a panel is a no-op.
    #[gpui::test]
    fn dock_toggle_without_panel_is_noop(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Dock::new(DockPosition::Right));
        window
            .update(cx, |d, _window, cx| {
                d.toggle(cx);
                assert!(!d.is_open(), "toggle without panel must stay closed");
            })
            .unwrap();
    }

    /// Attaching a panel that returns `starts_open = true` opens the dock;
    /// toggling twice returns to the open state.
    #[gpui::test]
    fn dock_toggle_round_trip(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Dock::new(DockPosition::Left));

        window
            .update(cx, |dock, _window, cx| {
                let panel = cx.new(|_| MockPanel::left());
                dock.set_panel(panel, cx);
                assert!(dock.is_open(), "dock should open when starts_open = true");

                dock.toggle(cx);
                assert!(!dock.is_open(), "closed after first toggle");

                dock.toggle(cx);
                assert!(dock.is_open(), "open after second toggle");
            })
            .unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 2a: Pane tests
    // -----------------------------------------------------------------------

    /// A newly created pane has no items.
    #[gpui::test]
    fn pane_starts_empty(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |p, _window, _cx| {
                assert_eq!(p.item_count(), 0);
                assert!(p.active_item().is_none());
            })
            .unwrap();
    }

    /// `add_item` with `activate = true` makes the new item active.
    #[gpui::test]
    fn pane_add_item_with_activate_true_sets_active(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                let item = cx.new(|_| MockNoteItem::new("Note A", "vault/a.md"));
                pane.add_item(item, Activation::Activate, cx);
                assert_eq!(pane.item_count(), 1);
                assert_eq!(
                    pane.active_item().unwrap().tab_content_text(cx),
                    SharedString::from("Note A"),
                );
            })
            .unwrap();
    }

    /// `close_active` on a single-item pane leaves the pane empty.
    #[gpui::test]
    fn pane_close_active_removes_item(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                let item = cx.new(|_| MockNoteItem::new("Note B", "vault/b.md"));
                pane.add_item(item, Activation::Activate, cx);
                assert_eq!(pane.item_count(), 1);

                pane.close_active(cx);
                assert_eq!(pane.item_count(), 0);
                assert!(pane.active_item().is_none());
            })
            .unwrap();
    }

    /// `close_active` on an empty pane is a no-op.
    #[gpui::test]
    fn pane_close_active_on_empty_is_noop(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                pane.close_active(cx); // must not panic
                assert_eq!(pane.item_count(), 0);
            })
            .unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 2a: PaneGroup tests
    // -----------------------------------------------------------------------

    /// An empty PaneGroup has no active pane.
    #[gpui::test]
    fn pane_group_starts_empty(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| PaneGroup::new());
        window
            .update(cx, |g, _window, _cx| {
                assert_eq!(g.pane_count(), 0);
                assert!(g.active_pane().is_none());
            })
            .unwrap();
    }

    /// Pushing a pane makes it the active pane.
    #[gpui::test]
    fn pane_group_push_pane(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, cx| {
            let pane = cx.new(|_| Pane::new());
            let mut group = PaneGroup::new();
            group.push(pane);
            group
        });
        window
            .update(cx, |g, _window, _cx| {
                assert_eq!(g.pane_count(), 1);
                assert!(g.active_pane().is_some());
            })
            .unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 2a: MockNoteItem + ItemHandle tests
    // -----------------------------------------------------------------------

    /// `MockNoteItem::can_save` returns `true`.
    #[gpui::test]
    fn mock_note_item_can_save_is_true(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| MockNoteItem::new("My Note", "vault/my-note.md"));
        window
            .update(cx, |item, _window, _cx| {
                assert!(item.can_save());
            })
            .unwrap();
    }

    /// `tab_content_text` returns the title passed at construction.
    #[gpui::test]
    fn mock_note_item_tab_content_text_matches_title(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| MockNoteItem::new("My Note", "vault/my-note.md"));
        window
            .update(cx, |item, _window, cx| {
                assert_eq!(item.tab_content_text(cx), SharedString::from("My Note"),);
            })
            .unwrap();
    }

    /// `Entity<MockNoteItem>` as `Box<dyn ItemHandle>` dispatches correctly.
    #[gpui::test]
    fn item_handle_dyn_dispatch_works(cx: &mut TestAppContext) {
        install_theme(cx);
        // Host the item in a Pane and exercise it through the ItemHandle trait.
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                let item = cx.new(|_| MockNoteItem::new("My Note", "vault/my-note.md"));
                pane.add_item(item, Activation::Activate, cx);

                let handle = pane.active_item().expect("item should be active");
                assert_eq!(handle.tab_content_text(cx), SharedString::from("My Note"),);
                assert!(handle.can_save(cx));
                assert!(!handle.is_dirty(cx));
            })
            .unwrap();
    }

    // -----------------------------------------------------------------------
    // WKWebView resize artifact regression (follow-up plan §6)
    // -----------------------------------------------------------------------

    /// A `Pane` with an active item renders without panic and goes through
    /// the no-background-quad code path.  This is a structural regression
    /// guard: if `.bg(bg)` is re-introduced on the item-present branch of
    /// `Pane::render` the transparent-div invariant is broken, which
    /// reintroduces the trailing-strip artifact during WKWebView resize.
    ///
    /// We cannot inspect GPUI's internal style tree from a unit test, so
    /// the test exercises the code path and relies on code-review + grep
    /// to enforce the invariant (documented in pane.rs and pane_group.rs).
    #[gpui::test]
    fn pane_with_active_item_renders_without_bg_quad(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                let item = cx.new(|_| MockNoteItem::new("Test", "vault/test.md"));
                pane.add_item(item, Activation::Activate, cx);
                // Pane has an active item — render must not panic.
                // The active-item branch produces `div().size_full().child(...)`,
                // NOT `div().size_full().bg(bg).child(...)`, so the WKWebView
                // region is not covered by an opaque GPUI quad.
                assert_eq!(pane.item_count(), 1);
            })
            .unwrap();
        cx.run_until_parked();
    }

    /// A `PaneGroup` with a mounted pane renders without panic and goes
    /// through the transparent-div code path (no `.bg(...)` on the
    /// active-pane branch — only the empty-group fallback retains `bg`).
    #[gpui::test]
    fn pane_group_with_active_pane_renders_without_bg_quad(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(|_window, cx| {
            let mut group = PaneGroup::new();
            let pane = cx.new(|_| Pane::new());
            group.push(pane);
            group
        });
        window
            .update(cx, |group, _window, _cx| {
                // One pane mounted — active-pane branch must not panic.
                // Invariant: `div().size_full().child(pane)` with no `.bg(...)`.
                assert_eq!(group.pane_count(), 1);
            })
            .unwrap();
        cx.run_until_parked();
    }
}
