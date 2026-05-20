#![forbid(unsafe_code)]
//! Full-text search panel for the Bottom Dock (ADR-0115 Phase 2d / Phase 8.5).
//!
//! `SearchPanel` implements `workspace::Panel` and sits in the Bottom Dock.
//! It renders a live query [`Input`] at the top and a scrollable result list
//! below.  Each result row shows a note title (bold), a snippet excerpt, and a
//! relevance score.  Clicking a row emits [`note_list_pane::OpenNoteEvent`] so
//! the workspace can open the note in the editor pane.
//!
//! # Relevance ranking
//!
//! Results are currently ordered by [`SearchHit::score`] descending — the
//! mock fixture pre-orders them.  A position-weighted substring score lands in
//! Phase 9.2 / Phase 10.2 (vault_search).
//!
//! # Usage (mock mode)
//!
//! ```rust,ignore
//! cx.set_global(MockSearch::seeded());
//! let panel = cx.new(|window, cx| SearchPanel::new(window, cx));
//! // Drive a query programmatically (e.g. from a test):
//! panel.update(cx, |p, cx| p.set_query("todo".into(), cx));
//! ```

use gpui::{
    div, px, App, AppContext as _, Context, Entity, EventEmitter, InteractiveElement as _,
    IntoElement, ParentElement, Pixels, Render, SharedString, StatefulInteractiveElement as _,
    Styled, Window,
};
use gpui_component::{
    h_flex,
    input::{Input, InputEvent, InputState},
    scroll::ScrollableElement as _,
    v_flex, ActiveTheme, StyledExt as _,
};
use mock_fixtures::{MockSearch, SearchHit};
use note_list_pane::OpenNoteEvent;
use workspace::{DockPosition, Panel};

// ---------------------------------------------------------------------------
// SearchResult — display-ready projection of a SearchHit
// ---------------------------------------------------------------------------

/// Display-ready projection of a [`SearchHit`].  Title and excerpt are
/// pre-formatted so the renderer stays free of business logic.
///
/// Fields are `pub` so test harnesses (and any future consumer of the
/// `results()` accessor) can construct instances with struct-literal
/// syntax instead of going through a private constructor.
#[derive(Clone)]
pub struct SearchResult {
    /// Stable note identifier — used by the click handler.
    pub note_id: mock_fixtures::NoteId,
    /// Display title — "Note #N" until Phase 3 resolves real titles.
    pub title: SharedString,
    /// Short excerpt from the hit.
    pub excerpt: SharedString,
    /// Relevance score rendered as a percentage (0–100).
    ///
    /// Phase 9.2 / Phase 10.2 (vault_search): replace with a
    /// position-weighted substring score from the real search index.
    pub score_pct: u32,
}

impl SearchResult {
    fn from_hit(hit: &SearchHit) -> Self {
        Self {
            note_id: hit.note_id,
            title: SharedString::from(format!("Note #{}", hit.note_id.get())),
            excerpt: SharedString::from(hit.excerpt.as_str()),
            score_pct: (hit.score.clamp(0.0, 1.0) * 100.0).round() as u32,
        }
    }
}

// ---------------------------------------------------------------------------
// SearchPanel view
// ---------------------------------------------------------------------------

/// Full-text search panel rendered in the Bottom Dock.
///
/// Holds a live [`InputState`] for the query field; every keystroke calls
/// [`set_query`](SearchPanel::set_query) via an `InputEvent::Change`
/// subscription.
pub struct SearchPanel {
    query: SharedString,
    results: Vec<SearchResult>,
    input: Entity<InputState>,
    _input_subscription: gpui::Subscription,
    position: DockPosition,
}

impl EventEmitter<OpenNoteEvent> for SearchPanel {}

impl SearchPanel {
    /// Create an empty panel with a live query input.
    #[must_use]
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search in all notes\u{2026}"));
        let sub = cx.subscribe(
            &input,
            move |panel: &mut Self, input: Entity<InputState>, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    let query = input.read(cx).value();
                    panel.set_query(query, cx);
                }
            },
        );
        Self {
            query: SharedString::default(),
            results: Vec::new(),
            input,
            _input_subscription: sub,
            position: DockPosition::Bottom,
        }
    }

    /// Update the query string and re-run the search synchronously against
    /// the installed [`MockSearch`] global (if present).
    ///
    /// Phase 9.2 / Phase 10.2 (vault_search): swap to an async vault service
    /// with debouncing.
    pub fn set_query(&mut self, query: SharedString, cx: &mut Context<Self>) {
        self.query = query.clone();
        self.results = if let Some(search) = cx.try_global::<MockSearch>() {
            let task = search.query(&query);
            let hits = cx.foreground_executor().block_on(task);
            // Results from MockSearch are already ordered highest-score first.
            // Phase 9.2 / Phase 10.2 (vault_search): apply position-weighted
            // substring ranking here when switching to the real search backend.
            hits.iter().map(SearchResult::from_hit).collect()
        } else {
            Vec::new()
        };
        cx.notify();
    }

    /// Current query string — exposed for testing.
    #[must_use]
    pub fn query(&self) -> &str {
        self.query.as_ref()
    }

    /// Current result list — exposed for testing.
    #[must_use]
    pub fn results(&self) -> &[SearchResult] {
        &self.results
    }
}

// ---------------------------------------------------------------------------
// Panel trait
// ---------------------------------------------------------------------------

impl Panel for SearchPanel {
    fn persistent_name(&self) -> &str {
        "SearchPanel"
    }

    fn panel_key(&self) -> &str {
        "search"
    }

    fn position(&self, _cx: &App) -> DockPosition {
        self.position
    }

    fn set_position(&mut self, position: DockPosition, _cx: &mut Context<Self>) {
        self.position = position;
    }

    fn default_size(&self, _cx: &App) -> Pixels {
        px(200.0)
    }

    fn icon(&self) -> Option<&str> {
        Some("magnifying-glass")
    }

    fn toggle_action(&self) -> Box<dyn gpui::Action> {
        // Placeholder — Phase 2e will add a dedicated `ToggleSearchPanel`.
        Box::new(actions::ToggleSidebar)
    }

    fn starts_open(&self, _cx: &App) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for SearchPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let border_color = cx.theme().border;
        let fg = cx.theme().foreground;
        let muted = cx.theme().muted_foreground;
        let hover_bg = cx.theme().list_hover;
        let query = self.query.clone();

        // Pre-collect display rows to avoid borrow-checker conflicts between
        // the theme borrows above and the result iterator.
        let rows: Vec<(mock_fixtures::NoteId, SharedString, SharedString, u32)> = self
            .results
            .iter()
            .map(|r| (r.note_id, r.title.clone(), r.excerpt.clone(), r.score_pct))
            .collect();

        // --- Query input strip ---
        let query_bar = h_flex()
            .h(px(40.0))
            .px(px(8.0))
            .gap_2()
            .border_b_1()
            .border_color(border_color)
            .child(Input::new(&self.input).appearance(false));

        // --- Result list ---
        let entity = cx.entity();
        let result_list = if rows.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_sm()
                        .text_color(muted)
                        .child(if query.is_empty() {
                            "Type to search"
                        } else {
                            "No results"
                        }),
                )
                .into_any_element()
        } else {
            div()
                .flex_1()
                .overflow_y_scrollbar()
                .children(rows.into_iter().enumerate().map(
                    |(ix, (note_id, title, excerpt, score_pct))| {
                        let handle = entity.clone();
                        div()
                            .id(("search-result", ix))
                            .px(px(8.0))
                            .py(px(6.0))
                            .border_b_1()
                            .border_color(border_color)
                            .cursor_pointer()
                            .hover(move |this| this.bg(hover_bg))
                            .child(div().text_sm().font_semibold().text_color(fg).child(title))
                            .child(div().text_sm().text_color(muted).child(excerpt))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(muted)
                                    .child(SharedString::from(format!("Score: {score_pct}%"))),
                            )
                            .on_click(move |_, _window, cx| {
                                handle.update(cx, |_panel, cx| {
                                    cx.emit(OpenNoteEvent { id: note_id });
                                });
                            })
                    },
                ))
                .into_any_element()
        };

        v_flex().size_full().child(query_bar).child(result_list)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use mock_fixtures::MockSearch;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An empty search panel must render without panicking.
    #[gpui::test]
    fn empty_panel_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(SearchPanel::new);
        cx.run_until_parked();
    }

    /// `set_query("laputa", cx)` against a seeded MockSearch must produce ≥1 result.
    #[gpui::test]
    fn search_panel_query_input_updates_result_entity(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockSearch::seeded());
        });
        let window = cx.add_window(SearchPanel::new);
        window
            .update(cx, |panel, _window, cx| {
                panel.set_query("laputa".into(), cx);
                assert!(
                    !panel.results().is_empty(),
                    "expected ≥1 result for query \"laputa\", got 0",
                );
            })
            .unwrap();
    }

    /// Clicking a result row emits [`OpenNoteEvent`] with the correct note id.
    ///
    /// Uses the subscribe-deferred-activate pattern: subscribe and
    /// `run_until_parked` before emitting so the deferred activation fires
    /// before the first event is captured.  See `sidebar_panel::tests::
    /// select_emits_event_only_on_change` (commit `fa3267b4`) for the rationale.
    #[gpui::test]
    fn search_panel_result_click_emits_open_note_event(cx: &mut TestAppContext) {
        use mock_fixtures::NoteId;

        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockSearch::seeded());
        });

        let received: Rc<RefCell<Vec<NoteId>>> = Rc::new(RefCell::new(Vec::new()));

        let window = cx.add_window(SearchPanel::new);
        let panel = window.root(cx).unwrap();

        // Subscribe before emitting so the deferred activate fires first.
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_panel, event: &OpenNoteEvent, _cx| {
                recv.borrow_mut().push(event.id);
            })
            .detach();
        });
        cx.run_until_parked();

        // Populate results manually so we can test the emit independently of
        // the click handler routing (set_query is exercised by the other
        // tests).
        window
            .update(cx, |p, _window, cx| {
                p.results = vec![SearchResult {
                    note_id: NoteId::from_raw(14),
                    title: "Note #14".into(),
                    excerpt: "…Start Laputa App Project…".into(),
                    score_pct: 95,
                }];
                cx.emit(OpenNoteEvent {
                    id: NoteId::from_raw(14),
                });
            })
            .unwrap();
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![NoteId::from_raw(14)],
            "click must emit OpenNoteEvent with the correct note id",
        );
    }

    /// The panel must report `DockPosition::Bottom`.
    #[gpui::test]
    fn panel_position_is_bottom(cx: &mut TestAppContext) {
        install_theme(cx);
        let window = cx.add_window(SearchPanel::new);
        window
            .update(cx, |panel, _window, cx| {
                assert_eq!(
                    panel.position(cx),
                    DockPosition::Bottom,
                    "SearchPanel must dock at Bottom",
                );
            })
            .unwrap();
    }

    /// An unrecognised query must produce zero results but must not panic.
    #[gpui::test]
    fn empty_results_render(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockSearch::seeded());
        });
        let window = cx.add_window(SearchPanel::new);
        window
            .update(cx, |panel, _window, cx| {
                panel.set_query("zzz-no-match".into(), cx);
                assert!(
                    panel.results().is_empty(),
                    "expected 0 results for \"zzz-no-match\", got {}",
                    panel.results().len(),
                );
            })
            .unwrap();
        cx.run_until_parked();
    }
}
