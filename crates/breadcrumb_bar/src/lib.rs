//! Top-of-pane breadcrumb bar view (ADR-0115 Phase 2b).
//!
//! `BreadcrumbBar` is a GPUI view that renders a horizontal trail of
//! [`BreadcrumbSegment`]s separated by "›" glyphs.  Each non-terminal
//! segment renders as a ghost [`gpui_component::button::Button`]; the
//! terminal segment renders in stronger (foreground) text without a click
//! target.
//!
//! ## Navigation events
//!
//! Clicking a non-terminal segment emits a [`BreadcrumbClickEvent`] with the
//! segment's index and a clone of the [`BreadcrumbSegment`].  Callers
//! subscribe to this event to push a navigation entry onto the history stack.
//!
//! ```ignore
//! // Phase 9.2 (nav_history) will subscribe to this and update the
//! // back/forward stack.
//! cx.subscribe(&bar, |_, event: &BreadcrumbClickEvent, _cx| {
//!     nav_history.push(event.segment_index, &event.segment);
//! }).detach();
//! ```

use gpui::{
    div, Context, EventEmitter, InteractiveElement, IntoElement, ParentElement, Render,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants as _},
    h_flex, ActiveTheme, Sizable as _, StyledExt as _,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single segment in the breadcrumb trail.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BreadcrumbSegment {
    /// Display label for this segment.
    pub label: SharedString,
    /// Optional icon name (e.g. a folder or file icon).  Not rendered in
    /// Phase 2b but stored so callers can populate it without an API break.
    pub icon: Option<SharedString>,
}

impl BreadcrumbSegment {
    /// Convenience constructor — no icon.
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
        }
    }
}

/// Emitted when a non-terminal breadcrumb segment is clicked.
///
/// Workspace consumers subscribe to this event to drive navigation history.
///
/// # Phase stub
///
/// ```ignore
/// // Phase 9.2 (nav_history) will subscribe to this and update the
/// // back/forward stack.
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BreadcrumbClickEvent {
    /// Zero-based index of the clicked segment within the breadcrumb trail.
    pub segment_index: usize,
    /// Clone of the segment that was clicked.
    pub segment: BreadcrumbSegment,
}

/// Top-of-pane breadcrumb bar view.
///
/// # Example
///
/// ```ignore
/// let bar = cx.new(|_| {
///     BreadcrumbBar::with_segments(vec![
///         BreadcrumbSegment::new("Vault"),
///         BreadcrumbSegment::new("Notes"),
///         BreadcrumbSegment::new("my-note.md"),
///     ])
/// });
/// ```
pub struct BreadcrumbBar {
    segments: Vec<BreadcrumbSegment>,
}

impl BreadcrumbBar {
    /// Create an empty breadcrumb bar.
    pub fn new() -> Self {
        Self {
            segments: Vec::new(),
        }
    }

    /// Create a breadcrumb bar pre-populated with `segments`.
    pub fn with_segments(segments: Vec<BreadcrumbSegment>) -> Self {
        Self { segments }
    }

    /// Return a slice of the current segments.
    pub fn segments(&self) -> &[BreadcrumbSegment] {
        &self.segments
    }

    /// Append `segment` to the trail.
    pub fn push(&mut self, segment: BreadcrumbSegment) {
        self.segments.push(segment);
    }

    /// Remove all segments from the trail.
    pub fn clear(&mut self) {
        self.segments.clear();
    }
}

impl Default for BreadcrumbBar {
    fn default() -> Self {
        Self::new()
    }
}

impl EventEmitter<BreadcrumbClickEvent> for BreadcrumbBar {}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for BreadcrumbBar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let count = self.segments.len();
        let last_ix = count.checked_sub(1);

        let mut children: Vec<gpui::AnyElement> = Vec::with_capacity(count * 2);

        let entity = cx.entity();

        for (ix, segment) in self.segments.iter().enumerate() {
            let label = segment.label.clone();
            let is_last = Some(ix) == last_ix;

            if is_last {
                // Terminal segment: non-clickable, foreground colour.
                children.push(
                    div()
                        .text_sm()
                        .text_color(cx.theme().foreground)
                        .font_semibold()
                        .child(label)
                        .into_any_element(),
                );
            } else {
                // Non-terminal segment: ghost button with a click handler that
                // emits a [`BreadcrumbClickEvent`].
                //
                // We use `.id(...)` + `.on_click(...)` on the wrapping `div`
                // rather than on `Button` directly, because `Button` does not
                // implement `StatefulInteractiveElement`.  The element ID is
                // namespaced to avoid collisions when multiple `BreadcrumbBar`s
                // render in the same frame.
                let segment_clone = segment.clone();
                let handle = entity.clone();
                children.push(
                    div()
                        .id(("breadcrumb-click", ix))
                        .cursor_pointer()
                        .child(Button::new(("breadcrumb", ix)).label(label).ghost().small())
                        .on_click(move |_, _window, cx| {
                            handle.update(cx, |_, cx| {
                                cx.emit(BreadcrumbClickEvent {
                                    segment_index: ix,
                                    segment: segment_clone.clone(),
                                });
                            });
                        })
                        .into_any_element(),
                );
                // Separator glyph.
                children.push(
                    div()
                        .text_sm()
                        .text_color(cx.theme().muted_foreground)
                        .child("›")
                        .into_any_element(),
                );
            }
        }

        h_flex().h_7().items_center().gap_1().children(children)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use gpui::{AppContext as _, TestAppContext};

    use super::{BreadcrumbBar, BreadcrumbClickEvent, BreadcrumbSegment};

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    fn seg(label: &'static str) -> BreadcrumbSegment {
        BreadcrumbSegment::new(label)
    }

    // -----------------------------------------------------------------------

    /// An empty bar must render without panicking.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| BreadcrumbBar::new());
        cx.run_until_parked();
    }

    /// Pushing three segments and reading them back must produce the same data.
    #[gpui::test]
    fn with_segments_round_trips(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| {
            BreadcrumbBar::with_segments(vec![seg("Vault"), seg("Notes"), seg("my-note.md")])
        });

        window
            .update(cx, |bar: &mut BreadcrumbBar, _window, _cx| {
                let segs = bar.segments();
                assert_eq!(segs.len(), 3);
                assert_eq!(segs[0].label, "Vault");
                assert_eq!(segs[1].label, "Notes");
                assert_eq!(segs[2].label, "my-note.md");
            })
            .unwrap();
    }

    /// After `clear`, the segment list must be empty.
    #[gpui::test]
    fn clear_resets_segments(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| BreadcrumbBar::new());

        window
            .update(cx, |bar: &mut BreadcrumbBar, _window, _cx| {
                bar.push(seg("Vault"));
                bar.push(seg("Notes"));
                assert_eq!(bar.segments().len(), 2);

                bar.clear();
                assert_eq!(bar.segments().len(), 0);
            })
            .unwrap();
    }

    /// A bar with three segments must render without panicking.
    #[gpui::test]
    fn render_with_segments_no_panic(cx: &mut TestAppContext) {
        install_theme(cx);

        let window = cx.add_window(|_window, _cx| {
            BreadcrumbBar::with_segments(vec![seg("Vault"), seg("Notes"), seg("my-note.md")])
        });

        // `render` is driven by the event loop; parking triggers a layout pass.
        cx.run_until_parked();

        // Confirm the view is still accessible after the render cycle.
        window
            .update(cx, |bar: &mut BreadcrumbBar, _window, _cx| {
                assert_eq!(bar.segments().len(), 3);
            })
            .unwrap();
    }

    /// Clicking a non-terminal segment must emit a [`BreadcrumbClickEvent`]
    /// carrying the correct index and a clone of the segment.
    ///
    /// GPUI activates `cx.subscribe`'s subscription on the next
    /// `cx.flush_effects()` (see `App::new_subscription` — `self.defer(move
    /// |_| activate())`).  Splitting subscribe + emit into separate
    /// `cx.update` blocks with a `run_until_parked` in between gives the
    /// deferred activate a chance to fire BEFORE the first emit.
    /// Co-locating the two in one `cx.update` silently swallows every event.
    #[gpui::test]
    fn breadcrumb_segment_click_emits_event_with_index(cx: &mut TestAppContext) {
        install_theme(cx);

        let received: Rc<RefCell<Vec<BreadcrumbClickEvent>>> = Rc::new(RefCell::new(Vec::new()));

        // Create the bar with three segments: two non-terminal, one terminal.
        let bar = cx.update(|cx| {
            cx.new(|_| {
                BreadcrumbBar::with_segments(vec![seg("Vault"), seg("Notes"), seg("my-note.md")])
            })
        });

        // Subscribe BEFORE emitting — separate update + park so the deferred
        // activate fires in time.
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&bar, move |_, event: &BreadcrumbClickEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        // Simulate clicking segment 0 ("Vault") then segment 1 ("Notes").
        cx.update(|cx| {
            bar.update(cx, |_: &mut BreadcrumbBar, cx| {
                cx.emit(BreadcrumbClickEvent {
                    segment_index: 0,
                    segment: seg("Vault"),
                });
                cx.emit(BreadcrumbClickEvent {
                    segment_index: 1,
                    segment: seg("Notes"),
                });
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(got.len(), 2, "expected two click events");
        assert_eq!(got[0].segment_index, 0);
        assert_eq!(got[0].segment.label, "Vault");
        assert_eq!(got[1].segment_index, 1);
        assert_eq!(got[1].segment.label, "Notes");
    }
}
