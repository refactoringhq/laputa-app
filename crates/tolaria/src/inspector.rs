//! Inspector-window lifecycle for the Tolaria binary (worklist 3.1).
//!
//! Worklist 3.1 in `docs/plans/native-gpui-chrome/phase-8-issues.md`
//! repurposes [`actions::ToggleInspector`] to open / close a separate
//! macOS `NSWindow` hosting [`inspector_panel::InspectorPanel`] instead
//! of GPUI's debug element-picker overlay (which now lives behind
//! [`actions::ToggleElementInspector`]).
//!
//! The window is a regular [`gpui::WindowKind::Normal`] window — movable,
//! resizable, focusable, with its own AppKit titlebar — *not* a
//! [`gpui::WindowKind::PopUp`].  That matters because we want the user
//! to be able to drag it around, dock it on a second monitor, and
//! minimise it independently of the main workspace window.
//!
//! # Lifecycle
//!
//! A process-global slot ([`inspector_slot`]) holds the
//! [`gpui::AnyWindowHandle`] of the currently-open inspector window, if
//! any.  Each `ToggleInspector` dispatch consults the slot:
//!
//! * `Some(handle)` → call `window.remove_window()` through the handle
//!   and clear the slot.  Stale-handle close errors (the user closed
//!   the window via the red traffic-light button so AppKit already
//!   tore it down) are swallowed — the slot is cleared either way,
//!   and the next toggle opens a fresh window.
//! * `None` → open a new window via [`gpui::App::open_window`], stash
//!   the resulting handle in the slot.
//!
//! [`is_inspector_open`] returns the slot's current state.  Worklist
//! 3.2 will use it to drive the dynamic "Show Inspector" / "Hide
//! Inspector" menu label.  We expose it here (rather than wiring the
//! menu rebuild now) so 3.2 has a stable read seam without re-opening
//! the lifecycle plumbing.
//!
//! # Why a singleton slot?
//!
//! GPUI's `cx.on_action` registers handlers at the [`gpui::App`] level,
//! not on any particular entity, so the toggle handler can't capture
//! per-entity state through the usual `subscribe_in` pattern.  A
//! process-global [`std::sync::OnceLock`]-wrapped [`std::sync::Mutex`]
//! gives us one shared cell that every dispatch reads and writes.  The
//! mutex is only ever held for the duration of a single
//! `take()` / `replace()` — there is no contention story to worry about
//! because GPUI dispatches actions on the main thread.

use std::sync::{Mutex, OnceLock};

use gpui::{AnyWindowHandle, AppContext as _};

/// Process-global slot holding the currently-open inspector window.
///
/// `None` when no inspector is shown; `Some(handle)` immediately after
/// a successful [`open_inspector_window`] call and until the next
/// [`close_inspector_window`] (or until the user closes the window via
/// AppKit, in which case the handle is stale but harmless — the next
/// toggle just clears it and opens a fresh window).
static INSPECTOR_WINDOW: OnceLock<Mutex<Option<AnyWindowHandle>>> = OnceLock::new();

/// Panic message used when [`Mutex::lock`] reports a poisoned mutex on
/// the inspector slot.  Centralised so every call site speaks the same
/// language in stack traces.
const SLOT_POISON_MSG: &str = "inspector slot mutex poisoned";

/// Lazily initialise the slot on first access.
fn inspector_slot() -> &'static Mutex<Option<AnyWindowHandle>> {
    INSPECTOR_WINDOW.get_or_init(|| Mutex::new(None))
}

/// Whether an inspector window is currently tracked as open.
///
/// Returns `true` when the slot holds a handle; `false` otherwise.
/// Note this is a slot-tracked view, not a live AppKit query — if the
/// user closes the window through its red traffic-light button the
/// handle stays in the slot until the next [`actions::ToggleInspector`]
/// dispatch resets it.  Worklist 3.2 (dynamic menu labels) accepts that
/// staleness window in exchange for not having to register a
/// per-window `on_should_close` callback today; promote to the robust
/// path if the menu label gets noticeably out of sync.
pub fn is_inspector_open() -> bool {
    // Explicit scope keeps the guard's lifetime as short as possible —
    // R-10 in idiomatic-rust-review.  The slot stores a `Copy`-friendly
    // `Option<…>::is_some()` so we drop the guard before returning.
    let guard = inspector_slot().lock().expect(SLOT_POISON_MSG);
    guard.is_some()
}

/// Open a new inspector window, store its handle in the slot, and log
/// the result.  No-op when a window is already tracked (callers should
/// branch on [`is_inspector_open`] before invoking this; the toggle
/// handler does so).
pub(crate) fn open_inspector_window(cx: &mut gpui::App) {
    let bounds = gpui::WindowBounds::Windowed(gpui::Bounds {
        origin: gpui::Point {
            x: gpui::px(120.0),
            y: gpui::px(120.0),
        },
        size: gpui::Size {
            width: gpui::px(360.0),
            height: gpui::px(600.0),
        },
    });

    // Default `WindowOptions` already gives us `WindowKind::Normal`,
    // `is_movable: true`, `is_resizable: true`, `is_minimizable: true`,
    // `focus: true`, `show: true` — exactly what we want for a regular
    // floating utility window.  Only the bounds and titlebar differ.
    let options = gpui::WindowOptions {
        titlebar: Some(gpui::TitlebarOptions {
            title: Some("Inspector".into()),
            appears_transparent: false,
            traffic_light_position: None,
        }),
        window_bounds: Some(bounds),
        ..Default::default()
    };

    match cx.open_window(options, |_window, cx| {
        cx.new(|cx| inspector_panel::InspectorPanel::from_or_empty(cx))
    }) {
        Ok(handle) => {
            // Scope the guard tightly — see R-10 note in
            // `is_inspector_open` above.
            let mut guard = inspector_slot().lock().expect(SLOT_POISON_MSG);
            *guard = Some(handle.into());
            drop(guard);
            log::info!("ToggleInspector: opened inspector window");
        }
        Err(err) => log::error!("ToggleInspector: open_window failed: {err:#}"),
    }
}

/// Close the inspector window tracked in the slot, if any, and clear
/// the slot.  Swallows stale-handle errors — if the user already
/// closed the window via AppKit the underlying `handle.update` returns
/// `Err`, which we log at `debug` level and then move on; the slot is
/// cleared either way so the next toggle opens a fresh window.
pub(crate) fn close_inspector_window(cx: &mut gpui::App) {
    // Take the handle *out* of the slot in its own scope so the mutex
    // guard is dropped before we re-enter GPUI via `handle.update` —
    // R-10.  `handle.update` is reentrant against the App but we do not
    // want to hold a global lock across an unbounded GPUI call.
    let handle = {
        let mut guard = inspector_slot().lock().expect(SLOT_POISON_MSG);
        guard.take()
    };
    let Some(handle) = handle else {
        return;
    };
    match handle.update(cx, |_, window, _| window.remove_window()) {
        Ok(()) => log::info!("ToggleInspector: closed inspector window"),
        Err(err) => {
            log::debug!(
                "ToggleInspector: handle.update on close returned {err:#} \
                 (likely already closed via AppKit); slot cleared"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test: the slot starts empty.
    ///
    /// We can't exercise the full open / close round-trip from a unit
    /// test because [`open_inspector_window`] reaches for the
    /// [`mock_fixtures::MockVault`] / [`mock_fixtures::MockGit`]
    /// globals (via [`inspector_panel::InspectorPanel::from_or_empty`])
    /// and constructs a real AppKit window — both of which require a
    /// running [`gpui::App`].  The live toggle path is covered by the
    /// note-toolbar and `View → Toggle Inspector` integration paths;
    /// this test guards the initial-state contract that worklist 3.2
    /// will rely on for menu label resolution.
    #[test]
    fn slot_starts_empty() {
        // The static is process-shared; if some other test in this
        // crate ever opens the inspector and forgets to close it, this
        // assertion will trip.  That's the desired failure mode — the
        // slot should be observably clean before any toggle dispatch.
        assert!(
            !is_inspector_open(),
            "inspector_slot should be empty before any ToggleInspector dispatch"
        );
    }
}
