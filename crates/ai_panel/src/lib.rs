#![forbid(unsafe_code)]
//! AI conversation panel for Tolaria (ADR-0115 Phase 2d).
//!
//! Renders the active conversation thread in the Right dock.  Alternates
//! visibility with the Inspector panel — `starts_open = false` so the Inspector
//! takes the Right dock by default.
//!
//! # Usage
//!
//! ```rust,ignore
//! // In mock / dev mode — global must be installed first:
//! cx.set_global(MockAi::seeded());
//! let panel = cx.new(|_| AiPanel::from_mock(cx));
//! ```

use gpui::{
    div, px, AnyElement, App, BorrowAppContext as _, Context, EventEmitter, IntoElement,
    ParentElement, Pixels, Render, SharedString, Styled, Window,
};
use gpui_component::{scroll::ScrollableElement as _, ActiveTheme};
use mock_fixtures::{MessageRole, MockAi, MockThread, ThreadId};
use workspace::DockPosition;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user sends a message via the composer.
///
/// Workspace subscribers (Phase 10.4) can route this to real AI backends.
#[derive(Debug, Clone)]
pub struct AiSendEvent {
    pub thread_id: ThreadId,
    pub text: SharedString,
}

// ---------------------------------------------------------------------------
// Tool-call card
// ---------------------------------------------------------------------------

/// Parsed representation of a tool-use message from the fixture.
struct ToolCall {
    tool: String,
    /// Raw JSON of the `input` field, presented collapsed.
    args: String,
    /// Raw output string (may be absent for pending calls).
    output: Option<String>,
    status: ToolCallStatus,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum ToolCallStatus {
    Pending,
    Success,
    /// Mirrors `AiActionStatus = 'error'` from `AiActionCard.tsx`; not yet
    /// produced by the fixture but present so the match is exhaustive.
    #[allow(dead_code)]
    Error,
}

impl ToolCall {
    /// Parse a tool-use message content string into a [`ToolCall`].
    ///
    /// The fixture encodes tool messages as JSON:
    /// `{"tool": "…", "input": {…}, "output": "…"}`.
    ///
    /// Returns `None` for any of: non-JSON content (malformed message),
    /// missing required `tool` field, or `tool` field present but not a
    /// string — so callers can fall back to plain-text rendering without
    /// panicking.  The `input` and `output` fields are best-effort: a
    /// missing `input` renders as an empty `args` string and a missing
    /// `output` produces a pending-status card.
    fn parse(content: &str) -> Option<Self> {
        // Minimal manual parse — avoids adding a serde dependency just for
        // this path.  The fixture format is simple enough.
        let v: serde_json::Value = serde_json::from_str(content).ok()?;
        let tool = v.get("tool")?.as_str()?.to_string();
        let args = v
            .get("input")
            .map(|inp| inp.to_string())
            .unwrap_or_default();
        let output = v.get("output").and_then(|o| o.as_str()).map(str::to_string);
        let status = if output.is_some() {
            ToolCallStatus::Success
        } else {
            ToolCallStatus::Pending
        };
        Some(Self {
            tool,
            args,
            output,
            status,
        })
    }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// AI conversation panel rendered in the Right dock.
///
/// Constructed via [`AiPanel::new`] for an empty panel or
/// [`AiPanel::from_mock`] to populate from the installed [`MockAi`] global.
///
/// # Panics
///
/// [`AiPanel::from_mock`] panics if the [`MockAi`] global has not been
/// installed on `cx` prior to the call.
pub struct AiPanel {
    thread: Option<MockThread>,
    /// Mutable composer input buffer.
    ///
    /// Uses `String` (heap-allocated, cheaply mutated per keystroke) rather
    /// than the immutable `SharedString` (`Arc<str>`) of the earlier stub.
    /// Phase 10 will replace this with a GPUI `Editor` entity.
    composer_buffer: String,
    position: DockPosition,
}

impl AiPanel {
    /// An empty AI panel with no thread loaded.
    pub fn new() -> Self {
        Self {
            thread: None,
            composer_buffer: String::new(),
            position: DockPosition::Right,
        }
    }

    /// Build from the [`MockAi`] global if it is installed; otherwise return
    /// an empty panel.  Used by `TolariaWorkspace` so the panel populates
    /// under `TOLARIA_MOCK=1` and degrades gracefully in normal launches
    /// before Phase 3 services land.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<MockAi>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::new()
        }
    }

    /// Build an AI panel populated from the [`MockAi`] global installed on
    /// `cx`.
    ///
    /// Takes the first available thread.  Returns an empty panel (thread =
    /// `None`) if the fixture service has no threads.
    ///
    /// Both [`MockAi::threads`] and [`MockAi::thread`] return
    /// `Task::ready(…)`, so `block_on` returns immediately without blocking
    /// the foreground thread.  Phase 3 will replace this constructor with an
    /// async-safe service injection path.
    ///
    /// # Panics
    ///
    /// Panics if the [`MockAi`] global is not installed on `cx`.
    pub fn from_mock(cx: &mut App) -> Self {
        let ids_task = cx.global::<MockAi>().threads();
        let ids = cx.foreground_executor().block_on(ids_task);

        let thread = ids.into_iter().next().and_then(|id| {
            let thread_task = cx.global::<MockAi>().thread(id);
            cx.foreground_executor().block_on(thread_task)
        });

        Self {
            thread,
            composer_buffer: String::new(),
            position: DockPosition::Right,
        }
    }

    /// Replace the composer buffer text and request a redraw.
    pub fn set_composer_text(&mut self, text: impl Into<String>, cx: &mut Context<Self>) {
        self.composer_buffer = text.into();
        cx.notify();
    }

    /// Send the current composer buffer to the mock backend, clear the
    /// composer, and emit [`AiSendEvent`] so workspace subscribers can route
    /// the message to real backends in Phase 10.4.
    ///
    /// No-ops when the composer is empty or no thread is loaded.
    pub fn send(&mut self, cx: &mut Context<Self>) {
        let text = self.composer_buffer.trim().to_string();
        if text.is_empty() {
            return;
        }
        let Some(thread) = &self.thread else { return };
        let thread_id = thread.id;

        // Append to mock backend so the thread view updates immediately.
        cx.update_global::<MockAi, _>(|ai: &mut MockAi, _| {
            ai.send_message(thread_id, &text).detach();
        });

        // Reload thread from global so newly appended messages are visible.
        // TODO(Phase 10.4): swap `block_on` for `cx.spawn` so a real backend
        // doesn't pin the foreground executor inside the send-path update.
        // `MockAi::thread` returns `Task::ready(...)` so this is a no-op
        // wait today, but the same code against a real `cli_agents` service
        // would block the UI thread until the backend response arrives.
        let thread_task = cx.global::<MockAi>().thread(thread_id);
        self.thread = cx.foreground_executor().block_on(thread_task);

        // Emit event for workspace consumers before clearing the buffer.
        cx.emit(AiSendEvent {
            thread_id,
            text: SharedString::from(text),
        });

        self.composer_buffer.clear();
        cx.notify();
    }
}

impl Default for AiPanel {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

impl EventEmitter<AiSendEvent> for AiPanel {}

// ---------------------------------------------------------------------------
// Panel impl
// ---------------------------------------------------------------------------

impl workspace::Panel for AiPanel {
    fn persistent_name(&self) -> &str {
        "AiPanel"
    }

    fn panel_key(&self) -> &str {
        "ai"
    }

    fn position(&self, _cx: &App) -> DockPosition {
        self.position
    }

    fn set_position(&mut self, position: DockPosition, _cx: &mut Context<Self>) {
        self.position = position;
    }

    fn default_size(&self, _cx: &App) -> Pixels {
        px(320.0)
    }

    fn icon(&self) -> Option<&str> {
        Some("sparkles")
    }

    fn toggle_action(&self) -> Box<dyn gpui::Action> {
        // Phase 2e will add a dedicated ToggleAiPanel action; for now we
        // reuse ToggleInspector as a placeholder so the dock machinery has a
        // valid action without forward-declaring an unused symbol.
        Box::new(actions::ToggleInspector)
    }

    fn starts_open(&self, _cx: &App) -> bool {
        // Inspector takes the Right dock by default; AI panel is hidden until
        // explicitly toggled.
        false
    }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/// Render a single assistant or user message bubble.
fn render_message_bubble(
    role: &MessageRole,
    content: &str,
    muted_bg: gpui::Hsla,
    accent_bg: gpui::Hsla,
) -> AnyElement {
    match role {
        MessageRole::User => {
            // Right-aligned bubble, muted background.
            div()
                .flex()
                .justify_end()
                .px(px(8.0))
                .py(px(2.0))
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(6.0))
                        .rounded(px(8.0))
                        .bg(muted_bg)
                        .max_w(px(240.0))
                        .child(SharedString::from(content.to_string())),
                )
                .into_any_element()
        }
        MessageRole::Assistant => {
            // Left-aligned, no background.
            div()
                .flex()
                .justify_start()
                .px(px(8.0))
                .py(px(2.0))
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(6.0))
                        .max_w(px(240.0))
                        .child(SharedString::from(content.to_string())),
                )
                .into_any_element()
        }
        MessageRole::Tool => render_tool_card(content, accent_bg),
    }
}

/// Render a tool-call card (mirrors `AiActionCard.tsx`).
///
/// Shows tool name, collapsed args JSON, and status indicator.
/// Falls back to a plain-text row when JSON cannot be parsed.
fn render_tool_card(content: &str, accent_bg: gpui::Hsla) -> AnyElement {
    match ToolCall::parse(content) {
        Some(tc) => {
            let status_label = match tc.status {
                ToolCallStatus::Pending => "⏳",
                ToolCallStatus::Success => "✓",
                ToolCallStatus::Error => "✗",
            };
            let header = SharedString::from(format!("{} {} {}", status_label, tc.tool, tc.args));
            let mut card = div()
                .mx(px(8.0))
                .my(px(2.0))
                .px(px(10.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(accent_bg)
                .child(header);
            if let Some(output) = tc.output {
                let out_label =
                    SharedString::from(format!("Output: {}", truncate_str(&output, 120)));
                card = card.child(out_label);
            }
            card.into_any_element()
        }
        None => {
            // Unparseable tool content — fall back to plain muted row.
            div()
                .px(px(8.0))
                .py(px(4.0))
                .child(SharedString::from(content.to_string()))
                .into_any_element()
        }
    }
}

/// Truncate a string to at most `max_chars` characters, appending `…` when
/// the string was shortened.
fn truncate_str(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for AiPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let border_color = theme.border;
        let muted_bg = theme.muted;
        let accent_bg = theme.accent;

        let message_list: AnyElement = match &self.thread {
            Some(thread) => {
                let rows: Vec<AnyElement> = thread
                    .messages
                    .iter()
                    .map(|msg| render_message_bubble(&msg.role, &msg.content, muted_bg, accent_bg))
                    .collect();

                div()
                    .flex_1()
                    .overflow_y_scrollbar()
                    .py(px(8.0))
                    .children(rows)
                    .into_any_element()
            }
            None => div()
                .flex_1()
                .px(px(8.0))
                .py(px(8.0))
                .child(SharedString::from("No conversation loaded."))
                .into_any_element(),
        };

        let composer_text = SharedString::from(if self.composer_buffer.is_empty() {
            "Message AI…".to_string()
        } else {
            self.composer_buffer.clone()
        });

        let input_row = div()
            .h(px(36.0))
            .px(px(8.0))
            .flex()
            .items_center()
            .border_t_1()
            .border_color(border_color)
            .child(composer_text);

        div()
            .flex()
            .flex_col()
            .size_full()
            .child(message_list)
            .child(input_row)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AppContext as _;
    use gpui::TestAppContext;
    use mock_fixtures::{MockAi, ThreadId};
    use workspace::Panel as _;

    /// Install the `gpui_component::Theme` global required by any view that
    /// reads it during render.
    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An empty AI panel must render without panicking.
    #[gpui::test]
    fn empty_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| AiPanel::new());
        cx.run_until_parked();
    }

    /// `from_mock` with a seeded [`MockAi`] global must load a thread.
    #[gpui::test]
    fn from_mock_loads_thread(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockAi::seeded());
            let panel = AiPanel::from_mock(cx);
            assert!(
                panel.thread.is_some(),
                "from_mock must load a thread when MockAi is seeded"
            );
        });
    }

    /// The seeded fixture thread must contain exactly 4 messages.
    #[gpui::test]
    fn thread_has_4_turns(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockAi::seeded());
            let panel = AiPanel::from_mock(cx);
            let count = panel.thread.as_ref().map(|t| t.messages.len()).unwrap_or(0);
            assert_eq!(count, 4, "seeded thread must have 4 messages, got {count}");
        });
    }

    /// The panel position must be Right.
    #[gpui::test]
    fn panel_position_is_right(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = AiPanel::new();
            assert_eq!(
                panel.position(cx),
                DockPosition::Right,
                "AiPanel must occupy the Right dock"
            );
        });
    }

    // -----------------------------------------------------------------------
    // Phase 8.23 tests
    // -----------------------------------------------------------------------

    /// `set_composer_text` must update the buffer and notify GPUI for a
    /// re-render.
    #[gpui::test]
    fn ai_panel_composer_set_text_updates_buffer(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockAi::seeded());
        });

        let panel = cx.update(|cx| cx.new(|cx| AiPanel::from_mock(cx)));

        panel.update(cx, |panel: &mut AiPanel, cx| {
            panel.set_composer_text("Hello from test", cx);
        });

        panel.read_with(cx, |panel: &AiPanel, _cx| {
            assert_eq!(
                panel.composer_buffer, "Hello from test",
                "set_composer_text must update composer_buffer"
            );
        });
    }

    /// `send` must emit [`AiSendEvent`] with the current text and clear the
    /// composer buffer.  Uses the subscribe-then-park pattern from
    /// `sidebar_panel::select_emits_event_only_on_change` so the subscription
    /// is active before the first emit.
    #[gpui::test]
    fn ai_panel_send_emits_event_and_clears_composer(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockAi::seeded());
        });

        let panel = cx.update(|cx| cx.new(|cx| AiPanel::from_mock(cx)));

        let received: Rc<RefCell<Vec<AiSendEvent>>> = Rc::new(RefCell::new(Vec::new()));

        // Subscribe first, then park so the deferred activate fires before
        // the first emit.
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_panel, event: &AiSendEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        // Type a message and send.
        panel.update(cx, |panel: &mut AiPanel, cx| {
            panel.set_composer_text("What is the status?", cx);
            panel.send(cx);
        });
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1, "send must emit exactly one AiSendEvent");
        assert_eq!(
            got[0].text.as_ref(),
            "What is the status?",
            "emitted text must match the composer content"
        );
        assert_eq!(got[0].thread_id, ThreadId(1));

        panel.read_with(cx, |panel: &AiPanel, _cx| {
            assert!(
                panel.composer_buffer.is_empty(),
                "composer_buffer must be cleared after send"
            );
        });
    }

    /// Rendering the seeded thread must include a tool-call card row (the
    /// third message in the fixture is a Tool turn).
    #[gpui::test]
    fn ai_panel_renders_seeded_thread_with_tool_call(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockAi::seeded());
        });

        let _window = cx.add_window(|_window, cx| AiPanel::from_mock(cx));
        // Must not panic on render; tool-call card parsing is exercised here.
        cx.run_until_parked();

        // Verify the fixture tool-message parses correctly.
        let tool_content = concat!(
            r#"{"tool":"get_note","input":{"path":"25q2-laputa-v2.md"},"#,
            r#""output":"Ships wikilink autocomplete, live inspector, and the full command-palette action set."}"#
        );
        let tc =
            ToolCall::parse(tool_content).expect("fixture tool-use JSON must parse into ToolCall");
        assert_eq!(tc.tool, "get_note");
        assert_eq!(tc.status, ToolCallStatus::Success);
        assert!(
            tc.output.as_deref().unwrap_or("").contains("wikilink"),
            "parsed output must contain fixture content"
        );
    }
}
