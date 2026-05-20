//! Toast notification layer for `TolariaWorkspace` (ADR-0115 Phase 2c).
//!
//! Phase 1 stored toasts as `SharedString`; Phase 2c switched to typed
//! [`Toast`]s from the `toasts` crate and renders each via [`render_toast`].
//! The layer pins itself to the top-right with a vertical stack.
//!
//! # Auto-dismiss
//!
//! Each call to [`ToastLayer::push`] schedules a background timer (via
//! `cx.background_executor().timer`) that fires after the toast's
//! [`auto_dismiss_duration`](toasts::Toast::auto_dismiss_duration).  When the
//! timer fires the toast is removed and the layer re-renders.
//!
//! # Click-to-dismiss
//!
//! If a toast carries an [`on_click`](toasts::Toast::on_click) handler the
//! handler is invoked before the toast is dismissed.  Clicks on toasts without
//! a handler still dismiss the toast.

use gpui::{div, px, Context, IntoElement, ParentElement, Render, Styled, Window};
use toasts::{render_toast, Toast, ToastId};

/// Layer that displays ephemeral toast messages above all other content.
#[derive(Default)]
pub struct ToastLayer {
    toasts: Vec<Toast>,
}

impl ToastLayer {
    /// Construct an empty [`ToastLayer`] with no queued messages.
    pub fn new() -> Self {
        Self::default()
    }

    /// Enqueue a [`Toast`] and schedule its auto-dismiss timer.
    ///
    /// The timer duration is determined by
    /// [`Toast::auto_dismiss_duration`]: 5 s for info/success, 8 s for
    /// warning, 10 s for error.  The timer runs on the background executor
    /// so it can be driven by `cx.executor().advance_clock(...)` in tests.
    pub fn push(&mut self, toast: Toast, cx: &mut Context<Self>) {
        let id = toast.id();
        let duration = toast.auto_dismiss_duration();
        self.toasts.push(toast);
        cx.notify();

        let timer = cx.background_executor().timer(duration);
        cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |layer, cx| {
                layer.dismiss(id, cx);
            });
        })
        .detach();
    }

    /// Remove the toast identified by `id` and re-render.
    ///
    /// Called automatically by the auto-dismiss timer.  Also suitable for
    /// click-dismiss: callers obtain the id from [`Toast::id`] and pass it
    /// here together with an [`App`] context.
    pub fn dismiss(&mut self, id: ToastId, cx: &mut Context<Self>) {
        let before = self.toasts.len();
        self.toasts.retain(|t| t.id() != id);
        if self.toasts.len() != before {
            cx.notify();
        }
    }

    /// Handle a click on the toast identified by `id`.
    ///
    /// Fires the registered [`on_click`](Toast::on_click) handler (if any),
    /// then dismisses the toast.  The user callback is deferred via
    /// [`Context::defer`] so it runs after the current entity-borrow has
    /// fully unwound — running the callback inline would let the callback
    /// re-enter the [`ToastLayer`] (e.g. by pushing another toast) while
    /// we still hold `&mut self`, which is exactly the re-entrancy footgun
    /// the indirection avoids.
    pub fn handle_click(&mut self, id: ToastId, cx: &mut Context<Self>) {
        // Extract the handler before removing the toast so we can call it
        // without holding a borrow on `self.toasts`.
        let handler = self
            .toasts
            .iter()
            .find(|t| t.id() == id)
            .and_then(|t| t.click_handler().cloned());

        self.dismiss(id, cx);

        if let Some(f) = handler {
            cx.defer(move |cx| f(cx));
        }
    }

    /// Number of currently queued toasts.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.toasts.len()
    }

    /// Whether there are no queued toasts.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.toasts.is_empty()
    }
}

impl Render for ToastLayer {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        // Top-right vertical stack of toasts. Empty layer renders an invisible
        // anchor div so the absolute-positioned overlay slot stays valid.
        div()
            .absolute()
            .right(px(16.0))
            .top(px(40.0))
            .flex()
            .flex_col()
            .gap_2()
            .children(self.toasts.iter().map(render_toast))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use gpui::{AppContext as _, TestAppContext};

    use toasts::Toast;

    use super::ToastLayer;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An info toast must be removed automatically after its 5-second timer fires.
    #[gpui::test]
    fn toast_layer_auto_dismiss_timer_fires_after_5s(cx: &mut TestAppContext) {
        install_theme(cx);

        let layer = cx.new(|_cx| ToastLayer::new());

        // Push an info toast (auto-dismiss = 5 s).
        layer.update(cx, |l, cx| {
            l.push(Toast::info("hello"), cx);
        });

        // Toast is present immediately after push.
        let count = layer.update(cx, |l, _cx| l.len());
        assert_eq!(count, 1, "toast must be present right after push");

        // Advance the clock past the 5-second window and let the timer fire.
        cx.executor().advance_clock(Duration::from_secs(6));
        cx.run_until_parked();

        let count_after = layer.update(cx, |l, _cx| l.len());
        assert_eq!(count_after, 0, "toast must be removed after timer fires");
    }

    /// Clicking a toast must invoke its action handler and then dismiss it.
    #[gpui::test]
    fn toast_click_invokes_action_and_dismisses(cx: &mut TestAppContext) {
        install_theme(cx);

        let fired = Arc::new(Mutex::new(false));
        let fired_clone = Arc::clone(&fired);

        let layer = cx.new(|_cx| ToastLayer::new());

        // Push a toast with an on_click handler.
        let id = layer.update(cx, |l, cx| {
            let toast = Toast::info("click me").on_click(move |_app| {
                *fired_clone.lock().unwrap() = true;
            });
            let id = toast.id();
            l.push(toast, cx);
            id
        });

        // Simulate the click.
        layer.update(cx, |l, cx| {
            l.handle_click(id, cx);
        });

        cx.run_until_parked();

        assert!(
            *fired.lock().unwrap(),
            "on_click handler must have been called"
        );

        let count = layer.update(cx, |l, _cx| l.len());
        assert_eq!(count, 0, "toast must be dismissed after click");
    }
}
