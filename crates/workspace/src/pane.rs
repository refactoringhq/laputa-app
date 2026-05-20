//! `Pane` view — ordered list of open items with an active index (ADR-0115 Phase 2a).
//!
//! Phase 2a ships a single-tab-capable pane: a `Vec<Box<dyn ItemHandle>>` and
//! an active index.  The tab-strip UI, drag-to-reorder, and multi-pane splits
//! are Phase 2b additions, modelled on `zed/crates/workspace/src/pane.rs:397`.
//!
//! Phase 8.13 grows `Pane` with the event surface that the workspace and
//! downstream subscribers need to react to user-driven tab actions and
//! pane bounds changes:
//!
//! - [`TabClosed`] — emitted by [`Pane::close_active`] / [`Pane::close_tab_at`]
//!   when a tab is actually removed.
//! - [`TabReordered`] — emitted by [`Pane::reorder_tab`] when a tab
//!   actually moves to a new position.
//! - [`PaneResized`] — emitted by [`Pane::notify_resized`] when the
//!   renderer reports a new pane bounds.  Subscribers (most importantly
//!   `note_item`'s embedded WKWebView) re-sync their native surface so
//!   it doesn't smear during live resize.

use gpui::{
    div, px, AnyElement, Bounds, Context, EventEmitter, IntoElement, ParentElement, Pixels, Render,
    SharedString, Styled, Window,
};
use gpui_component::ActiveTheme as _;
use ui::tree_dump::DumpAsExt as _;

use crate::item::ItemHandle;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/// Controls whether a newly added item immediately becomes the active (visible)
/// item in the pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Activation {
    /// Make the new item the active (visible) item.
    Activate,
    /// Append the item without changing the currently active item.
    Defer,
}

// ---------------------------------------------------------------------------
// Events (Phase 8.13)
// ---------------------------------------------------------------------------

/// Emitted by [`Pane::close_active`] or [`Pane::close_tab_at`] when a
/// tab is actually removed.  `idx` is the position the tab occupied
/// before removal, so subscribers that mirror the pane's items can
/// drop the entry at the same offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TabClosed {
    /// Pre-removal index of the closed tab.
    pub idx: usize,
}

/// Emitted by [`Pane::reorder_tab`] when a tab actually changes
/// position.  Same-index reorders and out-of-bounds requests are
/// silent no-ops and do not emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TabReordered {
    /// Pre-move index of the tab.
    pub from: usize,
    /// Post-move index of the tab.
    pub to: usize,
}

/// Emitted by [`Pane::notify_resized`] when the renderer reports a
/// new bounds for this pane.  Subscribers re-sync any embedded native
/// surfaces (WKWebView, etc.) so they don't smear during live resize
/// — see the WKWebView resize-artifact note in [`Pane::render`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaneResized {
    /// The pane's new bounds, in logical pixels.
    pub bounds: Bounds<Pixels>,
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

/// An ordered list of open [`Item`][crate::item::Item]s with one active.
///
/// Phase 2a renders the active item in the full available area.  The tab
/// strip, split controls, and drag-to-reorder are Phase 2b.
pub struct Pane {
    items: Vec<Box<dyn ItemHandle>>,
    /// Index into `items` of the currently visible item.
    ///
    /// # Invariant
    /// `active_item_index < items.len()` whenever `items` is non-empty.
    /// When `items` is empty this field is `0` (a harmless sentinel).
    active_item_index: usize,
}

impl EventEmitter<TabClosed> for Pane {}
impl EventEmitter<TabReordered> for Pane {}
impl EventEmitter<PaneResized> for Pane {}

impl Pane {
    /// Create an empty pane with no items.
    #[must_use]
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            active_item_index: 0,
        }
    }

    /// Append `item` to the pane.
    ///
    /// If `activation` is [`Activation::Activate`] the new item becomes the
    /// active one immediately.
    ///
    /// # Postconditions
    /// `item_count()` is one greater than before.  When `activation ==
    /// Activation::Activate`, `active_item()` returns the newly appended item.
    pub fn add_item(
        &mut self,
        item: impl ItemHandle + 'static,
        activation: Activation,
        cx: &mut Context<Self>,
    ) {
        self.items.push(Box::new(item));
        if activation == Activation::Activate {
            self.active_item_index = self.items.len() - 1;
        }
        cx.notify();
    }

    /// The currently active item, or `None` if the pane is empty.
    #[must_use]
    pub fn active_item(&self) -> Option<&dyn ItemHandle> {
        self.items.get(self.active_item_index).map(|b| b.as_ref())
    }

    /// Zero-based index of the currently active item.  Returns `0` when
    /// the pane is empty (the harmless sentinel — pair with
    /// [`Self::item_count`] when distinguishing empty vs occupied).
    #[must_use]
    pub fn active_index(&self) -> usize {
        self.active_item_index
    }

    /// Close the active item and activate the preceding one.
    ///
    /// Emits [`TabClosed { idx }`][TabClosed] where `idx` is the
    /// pre-removal position of the active item.  No-op (and no event)
    /// when the pane is already empty.
    pub fn close_active(&mut self, cx: &mut Context<Self>) {
        if self.items.is_empty() {
            return;
        }
        let closed_idx = self.active_item_index;
        self.items.remove(closed_idx);
        self.active_item_index = if self.items.is_empty() {
            0
        } else {
            closed_idx.saturating_sub(1)
        };
        cx.emit(TabClosed { idx: closed_idx });
        cx.notify();
    }

    /// Close the tab at `idx`.  Returns `true` if an item was removed,
    /// `false` for out-of-bounds requests.
    ///
    /// Emits [`TabClosed { idx }`][TabClosed] only on the success
    /// branch — out-of-bounds requests are silent no-ops.  When the
    /// closed tab was the active one, the activation rule matches
    /// [`Self::close_active`]: activate the preceding tab (or `0` when
    /// the pane is left empty).  Closing a non-active tab _below_ the
    /// active one shifts `active_index` down by one to keep pointing
    /// at the same item; closing a non-active tab _above_ leaves
    /// `active_index` untouched.
    pub fn close_tab_at(&mut self, idx: usize, cx: &mut Context<Self>) -> bool {
        if idx >= self.items.len() {
            return false;
        }
        self.items.remove(idx);
        self.active_item_index = if self.items.is_empty() {
            0
        } else if idx <= self.active_item_index {
            self.active_item_index.saturating_sub(1)
        } else {
            self.active_item_index
        };
        cx.emit(TabClosed { idx });
        cx.notify();
        true
    }

    /// Move the tab at `from` to position `to`.  Returns `true` when
    /// the tab actually moved.
    ///
    /// Silent no-op (returns `false`, emits nothing) when:
    /// - `from == to`,
    /// - `from >= items.len()`, or
    /// - `to >= items.len()`.
    ///
    /// The active tab follows the move: if `active_index == from`, the
    /// active index becomes `to`.  Otherwise the active index is
    /// recomputed to keep pointing at the same item across the
    /// remove-then-reinsert.
    pub fn reorder_tab(&mut self, from: usize, to: usize, cx: &mut Context<Self>) -> bool {
        if from == to || from >= self.items.len() || to >= self.items.len() {
            return false;
        }
        let item = self.items.remove(from);
        self.items.insert(to, item);
        self.active_item_index = if self.active_item_index == from {
            to
        } else if from < self.active_item_index && to >= self.active_item_index {
            // Item moved from before active to at-or-after active —
            // the active item shifts down by one.
            self.active_item_index - 1
        } else if from > self.active_item_index && to <= self.active_item_index {
            // Item moved from after active to at-or-before active —
            // the active item shifts up by one.
            self.active_item_index + 1
        } else {
            self.active_item_index
        };
        cx.emit(TabReordered { from, to });
        cx.notify();
        true
    }

    /// Number of items currently open in this pane.
    #[must_use]
    pub fn item_count(&self) -> usize {
        self.items.len()
    }

    /// Report a new bounds for this pane.  Emits
    /// [`PaneResized { bounds }`][PaneResized] so subscribers (most
    /// importantly `note_item`'s embedded WKWebView) re-sync their
    /// native surface.
    ///
    /// The renderer is expected to call this from its layout closure
    /// whenever the pane's [`Bounds`] change.  Hooking a real
    /// `Window::observe_bounds` signal is a Phase 9 wiring concern;
    /// this shim gives the workspace an event surface to subscribe to
    /// today.
    pub fn notify_resized(&mut self, bounds: Bounds<Pixels>, cx: &mut Context<Self>) {
        cx.emit(PaneResized { bounds });
    }
}

impl Default for Pane {
    fn default() -> Self {
        Self::new()
    }
}

/// Primary copy of the empty-pane placeholder.  Mirrors the React
/// variant's `editor.empty.selectNote` so the GPUI chrome opens with
/// the same welcome message the user already knows from the Tauri
/// build (`src/components/Editor.tsx` →
/// `src/lib/locales/en.json:editor.empty.selectNote`).
pub(crate) const EMPTY_STATE_PRIMARY: &str = "Select a note to start editing";

/// Secondary copy of the empty-pane placeholder.  Mirrors
/// `editor.empty.shortcuts` from the React variant — keymap-driven
/// shortcuts so a fresh user has at least one hint how to populate
/// the pane.  The literal glyphs come from
/// `src/lib/locales/en.json:editor.empty.shortcuts` after macro
/// substitution.
pub(crate) const EMPTY_STATE_SECONDARY: &str = "⌘P / ⌘O to search · ⌘N to create";

impl Render for Pane {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // No `.bg(...)` on the pane wrapper: the workspace root div already
        // fills the full surface with `theme.background`.  Every additional
        // opaque quad stacked on top of the WKWebView region creates a
        // one-frame trailing-strip artifact during live resize because GPUI
        // redraws synchronously while WKWebView's remote CALayer lags one
        // IPC round-trip behind.  Keep bg only for the empty-pane
        // placeholder where there is no WebView layer to composite through.
        // (WKWebView resize artifact fix — see follow-up plan §6.)
        let content: AnyElement = if let Some(item) = self.items.get(self.active_item_index) {
            item.to_any().into_any_element()
        } else {
            render_empty_state(cx)
        };
        div()
            .size_full()
            .child(content)
            .dump_as("workspace-center-pane")
    }
}

/// Render the centred "Select a note to start editing" placeholder
/// shown when the pane carries no items.  Worklist 2.2 — matches the
/// React variant's `EditorEmptyState` so the GPUI chrome boots with
/// the same welcome surface the user already knows.
///
/// Background is the theme's window colour because there is no
/// WKWebView under this region (the resize-artifact rule only forbids
/// `.bg()` on the active-item branch, where a WebView would otherwise
/// be obscured).  Primary copy uses `foreground`; the secondary line
/// uses `muted_foreground` to match the React shortcut hint.
///
/// The container carries `dump_as("workspace-center-pane-empty-state")`
/// per the prefixed-hierarchy convention from
/// `docs/plans/native-gpui-chrome/e2e-harness.md` so periscope can
/// `screenshot --id workspace-center-pane-empty-state` for cropped
/// regression diffs.
fn render_empty_state(cx: &mut Context<Pane>) -> AnyElement {
    let theme = cx.theme();
    let bg = theme.background;
    let fg = theme.foreground;
    let muted = theme.muted_foreground;
    div()
        .size_full()
        .bg(bg)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(8.0))
        .child(
            div()
                .text_color(fg)
                .child(SharedString::new_static(EMPTY_STATE_PRIMARY)),
        )
        .child(
            div()
                .text_xs()
                .text_color(muted)
                .child(SharedString::new_static(EMPTY_STATE_SECONDARY)),
        )
        .dump_as("workspace-center-pane-empty-state")
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Tests (Phase 8.13)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock_note_item::MockNoteItem;
    use gpui::{point, px, size, AppContext as _, Entity, TestAppContext};
    use std::cell::RefCell;
    use std::rc::Rc;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// Helper: build a fresh pane entity with `count` items appended,
    /// the last of which is active (default `Activation::Activate`
    /// behaviour).
    fn pane_with_items(cx: &mut TestAppContext, count: usize) -> Entity<Pane> {
        let window = cx.add_window(|_window, _cx| Pane::new());
        window
            .update(cx, |pane, _window, cx| {
                for i in 0..count {
                    let item = cx
                        .new(|_| MockNoteItem::new(format!("Note {i}"), format!("vault/n{i}.md")));
                    pane.add_item(item, Activation::Activate, cx);
                }
            })
            .unwrap();
        window.root(cx).unwrap()
    }

    // -----------------------------------------------------------------------
    // close_active
    // -----------------------------------------------------------------------

    #[gpui::test]
    fn close_active_emits_tab_closed_with_active_idx(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 2);
        // After two `Activate` adds, active_index == 1.
        let events: Rc<RefCell<Vec<TabClosed>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabClosed, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            pane.update(cx, |p, cx| p.close_active(cx));
        });
        cx.run_until_parked();

        let got = events.borrow();
        assert_eq!(got.len(), 1, "expected exactly one TabClosed event");
        assert_eq!(got[0], TabClosed { idx: 1 });
    }

    #[gpui::test]
    fn close_active_on_empty_pane_is_silent_no_op(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 0);
        let events: Rc<RefCell<Vec<TabClosed>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabClosed, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            pane.update(cx, |p, cx| p.close_active(cx));
        });
        cx.run_until_parked();

        assert!(
            events.borrow().is_empty(),
            "close_active on empty pane must not emit"
        );
    }

    // -----------------------------------------------------------------------
    // close_tab_at
    // -----------------------------------------------------------------------

    #[gpui::test]
    fn close_tab_at_valid_idx_emits_and_removes(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 2);
        let events: Rc<RefCell<Vec<TabClosed>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabClosed, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let removed = cx.update(|cx| pane.update(cx, |p, cx| p.close_tab_at(0, cx)));
        cx.run_until_parked();

        assert!(removed, "close_tab_at(0) on 2-item pane must return true");
        let got = events.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0], TabClosed { idx: 0 });
        cx.update(|cx| {
            assert_eq!(pane.read(cx).item_count(), 1);
        });
    }

    #[gpui::test]
    fn close_tab_at_out_of_bounds_is_silent_no_op(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 1);
        let events: Rc<RefCell<Vec<TabClosed>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabClosed, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let removed = cx.update(|cx| pane.update(cx, |p, cx| p.close_tab_at(5, cx)));
        cx.run_until_parked();

        assert!(!removed, "out-of-bounds close_tab_at must return false");
        assert!(events.borrow().is_empty());
        cx.update(|cx| {
            assert_eq!(pane.read(cx).item_count(), 1);
        });
    }

    // -----------------------------------------------------------------------
    // reorder_tab
    // -----------------------------------------------------------------------

    #[gpui::test]
    fn reorder_tab_emits_when_position_changes(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 3);
        let events: Rc<RefCell<Vec<TabReordered>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabReordered, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let moved = cx.update(|cx| pane.update(cx, |p, cx| p.reorder_tab(0, 2, cx)));
        cx.run_until_parked();

        assert!(moved, "reorder_tab(0, 2) on 3-item pane must return true");
        let got = events.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0], TabReordered { from: 0, to: 2 });
    }

    #[gpui::test]
    fn reorder_tab_same_index_is_silent_no_op(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 3);
        let events: Rc<RefCell<Vec<TabReordered>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabReordered, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let moved = cx.update(|cx| pane.update(cx, |p, cx| p.reorder_tab(1, 1, cx)));
        cx.run_until_parked();

        assert!(!moved, "reorder_tab(1, 1) must return false");
        assert!(events.borrow().is_empty());
    }

    #[gpui::test]
    fn reorder_tab_out_of_bounds_is_silent_no_op(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 2);
        let events: Rc<RefCell<Vec<TabReordered>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &TabReordered, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let moved_from_oob = cx.update(|cx| pane.update(cx, |p, cx| p.reorder_tab(9, 0, cx)));
        let moved_to_oob = cx.update(|cx| pane.update(cx, |p, cx| p.reorder_tab(0, 9, cx)));
        cx.run_until_parked();

        assert!(!moved_from_oob);
        assert!(!moved_to_oob);
        assert!(events.borrow().is_empty());
    }

    #[gpui::test]
    fn reorder_tab_preserves_active_when_active_moves(cx: &mut TestAppContext) {
        install_theme(cx);
        // 3 items added with Activate ⇒ active_index == 2.  Re-activate
        // the first item explicitly so the test exercises the
        // active-moves branch.
        let pane = pane_with_items(cx, 3);
        cx.update(|cx| {
            pane.update(cx, |p, _cx| {
                p.active_item_index = 0;
            });
        });

        cx.update(|cx| {
            let moved = pane.update(cx, |p, cx| p.reorder_tab(0, 2, cx));
            assert!(moved);
        });
        cx.run_until_parked();

        cx.update(|cx| {
            assert_eq!(pane.read(cx).active_index(), 2);
        });
    }

    // -----------------------------------------------------------------------
    // notify_resized
    // -----------------------------------------------------------------------

    #[gpui::test]
    fn notify_resized_emits_pane_resized_with_bounds(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 0);
        let events: Rc<RefCell<Vec<PaneResized>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = events.clone();
            cx.subscribe(&pane, move |_, ev: &PaneResized, _| {
                recv.borrow_mut().push(*ev);
            })
            .detach();
        });
        cx.run_until_parked();

        let expected = Bounds {
            origin: point(px(10.0), px(20.0)),
            size: size(px(800.0), px(600.0)),
        };
        cx.update(|cx| {
            pane.update(cx, |p, cx| p.notify_resized(expected, cx));
        });
        cx.run_until_parked();

        let got = events.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0], PaneResized { bounds: expected });
    }

    // -----------------------------------------------------------------------
    // Worklist 2.2 — empty-state placeholder
    // -----------------------------------------------------------------------

    /// A freshly-constructed pane has no active item, so the render
    /// path must walk the empty-state branch.  Locks the worklist 2.2
    /// invariant: an unpopulated center pane reports
    /// `item_count == 0` and `active_item() == None`, which the
    /// renderer translates into the "Select a note to start editing"
    /// placeholder.
    #[gpui::test]
    fn empty_pane_renders_empty_state_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 0);
        cx.update(|cx| {
            assert_eq!(pane.read(cx).item_count(), 0);
            assert!(pane.read(cx).active_item().is_none());
        });
        cx.run_until_parked();
    }

    /// Empty-state copy must match the React variant's
    /// `editor.empty.selectNote` / `editor.empty.shortcuts` so the
    /// GPUI chrome boots with the same welcome surface the user
    /// already knows from the Tauri build.  Worklist 2.2.
    #[gpui::test]
    fn empty_state_copy_matches_react_variant(_cx: &mut TestAppContext) {
        assert_eq!(super::EMPTY_STATE_PRIMARY, "Select a note to start editing");
        assert_eq!(
            super::EMPTY_STATE_SECONDARY,
            "⌘P / ⌘O to search · ⌘N to create"
        );
    }

    /// Transition: an empty pane → `add_item` flips the renderer from
    /// the empty-state branch to the active-item branch.  Worklist
    /// 2.2 — guards against a regression where the empty state would
    /// linger after the first user click.
    #[gpui::test]
    fn add_item_transitions_pane_away_from_empty_state(cx: &mut TestAppContext) {
        install_theme(cx);
        let pane = pane_with_items(cx, 0);
        cx.update(|cx| {
            assert!(
                pane.read(cx).active_item().is_none(),
                "fresh pane must start in empty state"
            );
        });

        cx.update(|cx| {
            pane.update(cx, |p, cx| {
                let item = cx.new(|_| MockNoteItem::new("First Open", "vault/first.md"));
                p.add_item(item, Activation::Activate, cx);
            });
        });
        cx.run_until_parked();

        cx.update(|cx| {
            assert_eq!(pane.read(cx).item_count(), 1);
            assert!(
                pane.read(cx).active_item().is_some(),
                "pane must leave the empty state once the first item lands"
            );
        });
    }
}
