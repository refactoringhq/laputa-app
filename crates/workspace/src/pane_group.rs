//! `PaneGroup` — flat list of panes with one active (ADR-0115 Phase 2a).
//!
//! Phase 2a is a `Vec<Entity<Pane>>` with an active-pane index.  Horizontal /
//! vertical tree splits and drag-reorder are deferred to Phase 2b, modelled on
//! `zed/crates/workspace/src/pane_group.rs:30`.

use gpui::{div, Context, Entity, IntoElement, ParentElement, Render, Styled, Window};
use gpui_component::ActiveTheme as _;

use crate::pane::Pane;

// ---------------------------------------------------------------------------
// PaneGroup
// ---------------------------------------------------------------------------

/// A flat group of [`Pane`]s with one active.
///
/// Phase 2a renders only the active pane in the full available area.
/// Tree-based splits are Phase 2b.
pub struct PaneGroup {
    panes: Vec<Entity<Pane>>,
    active_pane_index: usize,
}

impl PaneGroup {
    /// Create an empty pane group.
    #[must_use]
    pub fn new() -> Self {
        Self {
            panes: Vec::new(),
            active_pane_index: 0,
        }
    }

    /// Append a pane to the group.
    pub fn push(&mut self, pane: Entity<Pane>) {
        self.panes.push(pane);
    }

    /// Make the pane at `index` the active one.
    ///
    /// No-op for out-of-range indices.
    pub fn activate_pane(&mut self, index: usize, cx: &mut Context<Self>) {
        if index < self.panes.len() {
            self.active_pane_index = index;
            cx.notify();
        }
    }

    /// The active pane entity, or `None` if the group is empty.
    pub fn active_pane(&self) -> Option<&Entity<Pane>> {
        self.panes.get(self.active_pane_index)
    }

    /// Number of panes in this group.
    pub fn pane_count(&self) -> usize {
        self.panes.len()
    }
}

impl Default for PaneGroup {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for PaneGroup {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // No `.bg(...)` here: the workspace root div already paints
        // `theme.background` over the full window surface.  Painting the
        // same colour again on every intermediate container (pane_group →
        // pane → note_item) stacks redundant opaque quads over the
        // WKWebView region.  During a live resize GPUI redraws those quads
        // synchronously at the new size while the WKWebView's remote
        // CALayer (in the WebKit GPU process) is still one IPC frame behind
        // — producing the visible trailing-strip artifact.  The transparent
        // div lets the workspace root's single bg quad composite cleanly
        // through the Metal surface without obscuring the WebView layer.
        // (WKWebView resize artifact fix — see follow-up plan §6.)
        if let Some(pane) = self.panes.get(self.active_pane_index) {
            div().size_full().child(pane.clone())
        } else {
            let bg = cx.theme().background;
            div()
                .size_full()
                .bg(bg)
                .flex()
                .items_center()
                .justify_center()
                .text_color(cx.theme().muted_foreground)
                .child("No panes open")
        }
    }
}
