#![forbid(unsafe_code)]
//! Filter pill builder for Tolaria (ADR-0115 Phase 8.18, Strand B).
//!
//! Mirrors the Tauri-era `src/components/FilterBuilder.tsx` +
//! `FilterPills.tsx` shape: a horizontal row of pill chips, each
//! representing one [`FilterPredicate`].  Adding / removing a pill
//! emits [`FilterChangedEvent`] so workspace subscribers can route the
//! updated filter list into the note-list pane.
//!
//! # Usage
//!
//! ```rust,ignore
//! let builder = cx.new(|_| FilterBuilder::empty());
//! builder.update(cx, |b, cx| {
//!     b.add_filter(FilterPredicate::TypeIs("Person".into()), cx);
//! });
//! ```

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{h_flex, ActiveTheme};
use mock_fixtures::MockVault;

// ---------------------------------------------------------------------------
// FilterPredicate
// ---------------------------------------------------------------------------

/// One filter applied to the note-list scope.  Variants are flat
/// (each carries a single `SharedString` payload) so the wire shape is
/// trivial to serialise into a settings file once Phase 9 wires
/// persistent filter sets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterPredicate {
    /// Narrow to notes whose `type` property equals the given label
    /// (e.g. `"Person"`, `"Event"`).
    TypeIs(SharedString),
    /// Narrow to notes whose vault-root-relative parent path equals
    /// the given folder (e.g. `"projects"`, `"areas/work"`).
    FolderIs(SharedString),
    /// Narrow to notes whose title contains the given substring
    /// (case-insensitive comparison handled by the consumer; this
    /// crate stores the raw query verbatim).
    TitleContains(SharedString),
}

impl FilterPredicate {
    /// Short display label rendered inside the pill chip.
    pub fn label(&self) -> SharedString {
        match self {
            Self::TypeIs(s) => SharedString::from(format!("Type: {s}")),
            Self::FolderIs(s) => SharedString::from(format!("Folder: {s}")),
            Self::TitleContains(s) => SharedString::from(format!("Title contains: {s}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted whenever [`FilterBuilder::add_filter`] or
/// [`FilterBuilder::remove_filter`] mutates the predicate list.
/// Workspace subscribers consume the new list to update the
/// note-list pane's scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterChangedEvent {
    /// Snapshot of the filter list *after* the mutation that fired
    /// the event.  Callers should treat this as the authoritative
    /// state — no need to re-read from the builder.
    pub filters: Vec<FilterPredicate>,
}

// ---------------------------------------------------------------------------
// FilterBuilder
// ---------------------------------------------------------------------------

/// Phase 8.18 filter pill builder view.
pub struct FilterBuilder {
    filters: Vec<FilterPredicate>,
}

impl EventEmitter<FilterChangedEvent> for FilterBuilder {}

impl FilterBuilder {
    /// An empty builder — no filters applied.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            filters: Vec::new(),
        }
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `MockVault > empty`.  The mock path doesn't pre-populate any
    /// filter — it's just here so the constructor signature mirrors
    /// the rest of the chrome crates' `from_or_empty(cx)` shape.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::empty()
        }
    }

    /// Build from the [`MockVault`] global.  Currently identical to
    /// [`empty`] — the mock launch path doesn't seed default
    /// filters; the constructor exists so `from_or_empty` has a
    /// branch shape that matches every other chrome crate.
    ///
    /// # Panics
    ///
    /// Panics if no `MockVault` global is installed.  Use
    /// [`from_or_empty`] instead when uncertain.
    pub fn from_mock(cx: &mut App) -> Self {
        let _ = cx.global::<MockVault>(); // panic semantics match folder_tree::from_mock
        Self::empty()
    }

    /// Append `predicate` to the filter list and emit
    /// [`FilterChangedEvent`].  Duplicates are intentionally kept —
    /// the UI may surface them as distinct pills the user can dismiss
    /// individually; de-duplication is a consumer concern.
    pub fn add_filter(&mut self, predicate: FilterPredicate, cx: &mut Context<Self>) {
        self.filters.push(predicate);
        cx.emit(FilterChangedEvent {
            filters: self.filters.clone(),
        });
        cx.notify();
    }

    /// Remove the pill at `index`; no-op when out of bounds.  Emits
    /// [`FilterChangedEvent`] only when a removal actually occurs so
    /// out-of-bounds dispatches don't churn subscribers.
    pub fn remove_filter(&mut self, index: usize, cx: &mut Context<Self>) {
        if index >= self.filters.len() {
            return;
        }
        self.filters.remove(index);
        cx.emit(FilterChangedEvent {
            filters: self.filters.clone(),
        });
        cx.notify();
    }

    /// The current filter list.  Read-only — mutations go through
    /// [`add_filter`] / [`remove_filter`] so every change emits the
    /// event.
    #[must_use]
    pub fn filters(&self) -> &[FilterPredicate] {
        &self.filters
    }
}

impl Default for FilterBuilder {
    fn default() -> Self {
        Self::empty()
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for FilterBuilder {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let pill_bg = theme.muted;
        let hover_bg = theme.list_hover;
        let entity = cx.entity();

        h_flex()
            .gap(px(4.0))
            .children(self.filters.iter().enumerate().map(|(ix, pred)| {
                let label = pred.label();
                let row_entity = entity.clone();
                div()
                    .id(("filter-pill", ix))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(4.0))
                    .px(px(8.0))
                    .py(px(2.0))
                    .text_xs()
                    .text_color(fg)
                    .bg(pill_bg)
                    .rounded(px(12.0))
                    .cursor_pointer()
                    .hover(move |this| this.bg(hover_bg))
                    .on_click(move |_, _window, cx| {
                        row_entity.update(cx, |b, cx| b.remove_filter(ix, cx));
                    })
                    .child(label)
                    .child(div().text_color(muted).child(SharedString::new_static("×")))
            }))
            .when(self.filters.is_empty(), |this| {
                this.child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .text_xs()
                        .text_color(muted)
                        .child(SharedString::new_static("No filters applied")),
                )
            })
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

    /// An empty builder renders without panic and reports zero filters.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| FilterBuilder::empty());
        cx.run_until_parked();
    }

    /// `add_filter` appends and emits `FilterChangedEvent` carrying
    /// the post-mutation list.
    #[gpui::test]
    fn add_filter_appends_and_emits(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let builder: Entity<FilterBuilder> = cx.update(|cx| cx.new(|_| FilterBuilder::empty()));

        let received: Rc<RefCell<Vec<FilterChangedEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&builder, move |_, event: &FilterChangedEvent, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            builder.update(cx, |b, cx| {
                b.add_filter(FilterPredicate::TypeIs("Person".into()), cx);
                b.add_filter(FilterPredicate::FolderIs("projects".into()), cx);
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(got.len(), 2, "two adds must produce two events");
        assert_eq!(
            got[1].filters,
            vec![
                FilterPredicate::TypeIs("Person".into()),
                FilterPredicate::FolderIs("projects".into()),
            ],
            "second event must carry the full post-mutation list"
        );
    }

    /// `remove_filter` at a valid index removes and emits; at an
    /// out-of-bounds index it's a silent no-op.
    #[gpui::test]
    fn remove_filter_handles_in_and_out_of_bounds(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let builder: Entity<FilterBuilder> = cx.update(|cx| cx.new(|_| FilterBuilder::empty()));

        cx.update(|cx| {
            builder.update(cx, |b, cx| {
                b.add_filter(FilterPredicate::TypeIs("Person".into()), cx);
                b.add_filter(FilterPredicate::FolderIs("projects".into()), cx);
            });
        });

        let received: Rc<RefCell<Vec<FilterChangedEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&builder, move |_, event: &FilterChangedEvent, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            builder.update(cx, |b, cx| {
                b.remove_filter(99, cx); // out-of-bounds — silent
                b.remove_filter(0, cx); // removes the TypeIs row
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got.len(),
            1,
            "only the in-bounds remove must emit; out-of-bounds is silent"
        );
        assert_eq!(
            got[0].filters,
            vec![FilterPredicate::FolderIs("projects".into())],
            "remaining filter must be the FolderIs row"
        );
    }

    /// Adding the same predicate twice produces two distinct pills —
    /// de-duplication is a consumer concern.
    #[gpui::test]
    fn add_filter_keeps_duplicates(cx: &mut TestAppContext) {
        install_theme(cx);
        let builder: Entity<FilterBuilder> = cx.update(|cx| cx.new(|_| FilterBuilder::empty()));

        cx.update(|cx| {
            builder.update(cx, |b, cx| {
                b.add_filter(FilterPredicate::TypeIs("Person".into()), cx);
                b.add_filter(FilterPredicate::TypeIs("Person".into()), cx);
            });
        });

        cx.update(|cx| {
            assert_eq!(
                builder.read(cx).filters().len(),
                2,
                "duplicate predicates must be kept (two pills, two distinct removal indices)"
            );
        });
    }

    /// `from_or_empty` returns an empty builder when no globals
    /// installed.
    #[gpui::test]
    fn from_or_empty_returns_empty_without_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let builder = FilterBuilder::from_or_empty(cx);
            assert!(builder.filters().is_empty());
        });
    }

    /// `FilterPredicate::label` renders the canonical "Field: value"
    /// shape that the pill chip uses verbatim.
    #[test]
    fn predicate_label_format() {
        assert_eq!(
            FilterPredicate::TypeIs("Person".into()).label().as_ref(),
            "Type: Person"
        );
        assert_eq!(
            FilterPredicate::FolderIs("projects".into())
                .label()
                .as_ref(),
            "Folder: projects"
        );
        assert_eq!(
            FilterPredicate::TitleContains("ralph".into())
                .label()
                .as_ref(),
            "Title contains: ralph"
        );
    }
}
