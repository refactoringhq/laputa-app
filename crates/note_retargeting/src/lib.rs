#![forbid(unsafe_code)]
//! Note-rename wikilink ripple preview (ADR-0115 Phase 8.20, Strand B).
//!
//! Mirrors the Tauri-era `src/components/note-retargeting/
//! RetargetNoteDialog.tsx` + `NoteRetargetingDialogs.tsx` shape:
//! when a note is renamed, scan every other note's body for
//! `[[old_stem]]` wikilinks and present a confirmation dialog
//! showing which notes will be rewritten and how many occurrences
//! each contains.
//!
//! # Usage
//!
//! ```rust,ignore
//! cx.set_global(MockVault::seeded());
//! let view = cx.new(|_window, cx| {
//!     NoteRetargeting::from_rename("note-on-clear-prose", "clear-prose", cx)
//! });
//! cx.subscribe(&view, |_, e: &RetargetAcceptEvent, _| {
//!     // Apply the rewrites via the workspace.
//! }).detach();
//! ```

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme, StyledExt as _};
use mock_fixtures::MockVault;

// ---------------------------------------------------------------------------
// RewriteCandidate
// ---------------------------------------------------------------------------

/// One note whose body contains at least one `[[old_stem]]` wikilink
/// that would be rewritten by the rename operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteCandidate {
    /// Stable identifier of the note that contains the wikilink(s).
    pub note_id: u64,
    /// Display title of that note.
    pub note_title: SharedString,
    /// Number of `[[old_stem]]` occurrences in the note's body.
    pub occurrence_count: usize,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user confirms the rewrite.  Workspace subscribers
/// (Phase 9+) apply the actual `vault::save` mutations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetargetAcceptEvent {
    pub old_stem: SharedString,
    pub new_stem: SharedString,
    /// Snapshot of the candidates shown to the user at confirm time.
    pub candidates: Vec<RewriteCandidate>,
}

/// Emitted when the user dismisses the dialog without accepting.
/// Carries no payload — the workspace simply closes the modal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetargetCancelEvent;

// ---------------------------------------------------------------------------
// Wikilink scanner
// ---------------------------------------------------------------------------

/// Count `[[old_stem]]` (or `[[old_stem|alias]]`) occurrences in
/// `body`.  Case-insensitive match on the stem.  Stem in the body's
/// link must equal `old_stem` after `to_ascii_lowercase().trim()`
/// — same matching contract as `inspector_panel`'s wikilink scanner
/// so the two crates stay consistent.
fn count_wikilink_occurrences(body: &str, old_stem: &str) -> usize {
    let target = old_stem.trim().to_ascii_lowercase();
    let mut count = 0;
    let mut rest = body;
    while let Some(open) = rest.find("[[") {
        rest = &rest[open + 2..];
        let Some(close) = rest.find("]]") else { break };
        let inner = &rest[..close];
        let stem = inner.split('|').next().unwrap_or(inner).trim();
        if stem.to_ascii_lowercase() == target {
            count += 1;
        }
        rest = &rest[close + 2..];
    }
    count
}

// ---------------------------------------------------------------------------
// NoteRetargeting
// ---------------------------------------------------------------------------

/// Phase 8.20 note-rename ripple preview view.
pub struct NoteRetargeting {
    old_stem: SharedString,
    new_stem: SharedString,
    candidates: Vec<RewriteCandidate>,
}

impl EventEmitter<RetargetAcceptEvent> for NoteRetargeting {}
impl EventEmitter<RetargetCancelEvent> for NoteRetargeting {}

impl NoteRetargeting {
    /// An empty preview — no candidates, used as the placeholder
    /// constructor when no rename is in flight.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            old_stem: SharedString::default(),
            new_stem: SharedString::default(),
            candidates: Vec::new(),
        }
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `MockVault > empty`.  The mock path needs explicit `from_rename`
    /// to produce candidates; `from_or_empty` is the constructor used
    /// before a rename is in flight.
    pub fn from_or_empty(_cx: &mut App) -> Self {
        Self::empty()
    }

    /// Scan every note in the [`MockVault`] global, count `[[old_stem]]`
    /// wikilinks in each, and surface the matching notes as
    /// [`RewriteCandidate`]s.  Returns an [`empty`](Self::empty)
    /// preview when no `MockVault` global is installed.
    pub fn from_rename(
        old_stem: impl Into<SharedString>,
        new_stem: impl Into<SharedString>,
        cx: &mut App,
    ) -> Self {
        let old_stem = old_stem.into();
        let new_stem = new_stem.into();
        let Some(vault) = cx.try_global::<MockVault>() else {
            return Self {
                old_stem,
                new_stem,
                candidates: Vec::new(),
            };
        };
        let executor = cx.foreground_executor().clone();
        let ids = executor.block_on(vault.notes());
        let mut candidates = Vec::new();
        for id in ids {
            if let Some(note) = executor.block_on(cx.global::<MockVault>().note(id)) {
                let count = count_wikilink_occurrences(&note.content, old_stem.as_ref());
                if count > 0 {
                    candidates.push(RewriteCandidate {
                        note_id: id.get(),
                        note_title: note.title.clone(),
                        occurrence_count: count,
                    });
                }
            }
        }
        Self {
            old_stem,
            new_stem,
            candidates,
        }
    }

    /// Emit [`RetargetAcceptEvent`] with the current candidate list.
    /// Workspace subscribers apply the rewrites; this method does not
    /// mutate the vault itself.
    pub fn accept(&mut self, cx: &mut Context<Self>) {
        cx.emit(RetargetAcceptEvent {
            old_stem: self.old_stem.clone(),
            new_stem: self.new_stem.clone(),
            candidates: self.candidates.clone(),
        });
    }

    /// Emit [`RetargetCancelEvent`].  No mutation; the workspace
    /// closes the modal in response.
    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        cx.emit(RetargetCancelEvent);
    }

    /// Candidate list — test / debug helper.
    #[must_use]
    pub fn candidates(&self) -> &[RewriteCandidate] {
        &self.candidates
    }

    /// The old stem being retargeted.
    #[must_use]
    pub fn old_stem(&self) -> &SharedString {
        &self.old_stem
    }

    /// The new stem the wikilinks will point at.
    #[must_use]
    pub fn new_stem(&self) -> &SharedString {
        &self.new_stem
    }
}

impl Default for NoteRetargeting {
    fn default() -> Self {
        Self::empty()
    }
}

impl workspace::ModalView for NoteRetargeting {}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for NoteRetargeting {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let entity = cx.entity();

        let header = SharedString::from(format!(
            "Rewrite wikilinks: [[{}]] → [[{}]]",
            self.old_stem, self.new_stem
        ));

        v_flex()
            .p(px(16.0))
            .gap(px(8.0))
            .text_sm()
            .text_color(fg)
            .child(div().font_semibold().child(header))
            .child(
                div()
                    .text_color(muted)
                    .text_xs()
                    .child(SharedString::from(format!(
                        "{} note(s) will be rewritten.",
                        self.candidates.len()
                    ))),
            )
            .children(self.candidates.iter().enumerate().map(|(ix, c)| {
                div()
                    .id(("retarget-row", ix))
                    .flex()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .py(px(4.0))
                    .child(c.note_title.clone())
                    .child(
                        div()
                            .text_color(muted)
                            .text_xs()
                            .child(SharedString::from(format!(
                                "{} occurrence(s)",
                                c.occurrence_count
                            ))),
                    )
            }))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(8.0))
                    .when(!self.candidates.is_empty(), |this| {
                        let accept_entity = entity.clone();
                        this.child(
                            div()
                                .id("retarget-accept")
                                .px(px(8.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(theme.accent)
                                .text_color(theme.accent_foreground)
                                .cursor_pointer()
                                .on_click(move |_, _window, cx| {
                                    accept_entity.update(cx, |this, cx| this.accept(cx));
                                })
                                .child(SharedString::new_static("Accept")),
                        )
                    })
                    .child({
                        let cancel_entity = entity.clone();
                        div()
                            .id("retarget-cancel")
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(4.0))
                            .bg(theme.muted)
                            .text_color(fg)
                            .cursor_pointer()
                            .on_click(move |_, _window, cx| {
                                cancel_entity.update(cx, |this, cx| this.cancel(cx));
                            })
                            .child(SharedString::new_static("Cancel"))
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

    /// An empty preview renders without panic.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| NoteRetargeting::empty());
        cx.run_until_parked();
    }

    /// `count_wikilink_occurrences` counts plain + aliased links,
    /// is case-insensitive on the stem, and ignores unrelated links.
    #[test]
    fn count_handles_plain_aliased_and_case() {
        let body = "See [[note-a]] and [[Note-A|aliased]] and [[other]] but not [[note-b]].";
        assert_eq!(count_wikilink_occurrences(body, "note-a"), 2);
        assert_eq!(count_wikilink_occurrences(body, "NOTE-A"), 2);
        assert_eq!(count_wikilink_occurrences(body, "note-b"), 1);
        assert_eq!(count_wikilink_occurrences(body, "missing"), 0);
    }

    /// `from_rename` produces candidates for notes whose body contains
    /// `[[old_stem]]`.  The seeded vault has a note `note-on-clear-prose`
    /// referenced from the `Writing` topic note via `[[note-on-clear-prose]]`,
    /// so retargeting that stem must surface at least one candidate.
    #[gpui::test]
    fn from_rename_finds_seeded_backlinks(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let view = NoteRetargeting::from_rename("note-on-clear-prose", "clear-prose", cx);
            assert!(
                !view.candidates().is_empty(),
                "seeded vault must contain ≥1 backlink to note-on-clear-prose"
            );
            assert!(
                view.candidates().iter().all(|c| c.occurrence_count >= 1),
                "every candidate must report ≥1 occurrence"
            );
        });
    }

    /// `accept` emits `RetargetAcceptEvent` with the snapshot of
    /// candidates shown to the user at confirm time.
    #[gpui::test]
    fn accept_emits_with_candidate_snapshot(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<NoteRetargeting> = cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.new(|cx| NoteRetargeting::from_rename("note-on-clear-prose", "clear-prose", cx))
        });

        let received: Rc<RefCell<Vec<RetargetAcceptEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, event: &RetargetAcceptEvent, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| view.update(cx, |this, cx| this.accept(cx)));
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1, "accept must emit exactly one event");
        assert_eq!(got[0].old_stem.as_ref(), "note-on-clear-prose");
        assert_eq!(got[0].new_stem.as_ref(), "clear-prose");
        assert!(
            !got[0].candidates.is_empty(),
            "event payload must carry the candidate list"
        );
    }

    /// `cancel` emits `RetargetCancelEvent` and performs no mutation.
    #[gpui::test]
    fn cancel_emits_without_mutation(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<NoteRetargeting> = cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.new(|cx| NoteRetargeting::from_rename("note-on-clear-prose", "clear-prose", cx))
        });

        let cancelled: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = cancelled.clone();
            cx.subscribe(&view, move |_, _event: &RetargetCancelEvent, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| view.update(cx, |this, cx| this.cancel(cx)));
        cx.run_until_parked();

        assert_eq!(*cancelled.borrow(), 1, "cancel must emit exactly once");
        // Candidate list must be unchanged after cancel.
        cx.update(|cx| {
            assert!(
                !view.read(cx).candidates().is_empty(),
                "cancel must not mutate candidates"
            );
        });
    }

    /// `from_or_empty` returns an empty preview when no globals
    /// installed.
    #[gpui::test]
    fn from_or_empty_returns_empty_without_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let view = NoteRetargeting::from_or_empty(cx);
            assert!(view.candidates().is_empty());
            assert!(view.old_stem().is_empty());
        });
    }
}
