//! macOS input-synthesis adapter behind periscope's CLI subcommands.
//!
//! Posts low-level `CGEvent` mouse / keyboard events via
//! `CGEventCreateMouseEvent` + `CGEventCreateKeyboardEvent`.  GPUI draws
//! its own controls into the Metal layer and the embedded WKWebView is a
//! sibling NSView — neither shows up in the Accessibility hierarchy, so
//! `AXUIElementPerformAction` is not an option.  Synthesising at the OS
//! event-queue level is the only path that actually reaches GPUI's
//! hit-testing *and* WKWebView's input handlers.
//!
//! The mouse path (`click_macos`, `hover_macos`, `double_click_macos`)
//! shares a `prepare_mouse_point` helper that resolves the window, derives
//! the global screen coordinate, and builds a fresh `CGEventSource`.  The
//! keyboard path (`type_text_macos`, `key_press_macos`) uses a separate
//! `keyboard_source` helper since keyboard events don't need a screen
//! point.

use anyhow::{anyhow, Context as _, Result};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;

use crate::keyboard::{KeyCode, ModifierFlags};
use crate::WindowTarget;

/// Time the synthetic press is held before release.  Empirically tuned —
/// anything below ~10 ms occasionally lands as a "no click" on a busy
/// machine; 20 ms is safe without being perceptibly slow.
const CLICK_PRESS_HOLD: std::time::Duration = std::time::Duration::from_millis(20);

/// Gap between the first click's mouse-up and the second click's
/// mouse-down in [`double_click_macos`].  AppKit's default
/// `doubleClickInterval` is ~500 ms; we sit comfortably under that so the
/// pair coalesces, but well above the press-hold so the OS sees discrete
/// events.
const DOUBLE_CLICK_GAP: std::time::Duration = std::time::Duration::from_millis(60);

/// Default inter-character delay for [`type_text_macos`].  Each keystroke
/// posts a separate `CGEvent`; without a short breather the OS event queue
/// can coalesce them and the editor's IME state machine drops the burst.
/// 8 ms is empirically stable for WKWebView and still types ~125 chars/s.
pub(crate) const DEFAULT_TYPE_DELAY_MS: u64 = 8;

/// Resolve `target` to a window-local point translated into global screen
/// space, plus a fresh `CGEventSource` ready to post mouse events.
/// Shared by every mouse-side synthesizer so the translation logic lives
/// in one place.
fn prepare_mouse_point(target: &WindowTarget, x: f64, y: f64) -> Result<(CGEventSource, CGPoint)> {
    let window = crate::capture::find_window(target)?;
    let win_x = window.x().context("xcap::Window::x")?;
    let win_y = window.y().context("xcap::Window::y")?;
    let point = CGPoint::new(f64::from(win_x) + x, f64::from(win_y) + y);
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| anyhow!("CGEventSource::new(HIDSystemState) failed"))?;
    Ok((source, point))
}

/// Fresh `CGEventSource` for keyboard events.  Keyboard synth doesn't need
/// a window resolution step — events are dispatched to whatever has
/// focus — so this is a thin wrapper around the constructor.
fn keyboard_source() -> Result<CGEventSource> {
    CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| anyhow!("CGEventSource::new(HIDSystemState) failed"))
}

/// Post a `LeftMouseDown` + `LeftMouseUp` pair at `point`.  Shared by
/// [`click_macos`] and [`double_click_macos`] (the latter calls it twice
/// with an inter-pair `clickState` boost).
///
/// When `click_state` is provided it's written to both halves of the pair
/// via `EventField::MOUSE_EVENT_CLICK_STATE`, which is how macOS tags a
/// keydown/up pair as part of a multi-click sequence.  A click with no
/// click-state attribute is treated as `1` by default.
fn post_left_click(source: &CGEventSource, point: CGPoint, click_state: Option<i64>) -> Result<()> {
    let down = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseDown,
        point,
        CGMouseButton::Left,
    )
    .map_err(|_| anyhow!("CGEvent::new_mouse_event(LeftMouseDown) failed"))?;
    if let Some(state) = click_state {
        down.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, state);
    }
    down.post(CGEventTapLocation::HID);

    std::thread::sleep(CLICK_PRESS_HOLD);

    let up = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseUp,
        point,
        CGMouseButton::Left,
    )
    .map_err(|_| anyhow!("CGEvent::new_mouse_event(LeftMouseUp) failed"))?;
    if let Some(state) = click_state {
        up.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, state);
    }
    up.post(CGEventTapLocation::HID);
    Ok(())
}

/// Click a point inside `target` window.
///
/// `x` / `y` are in window-local points (origin at the window's top-left,
/// matching GPUI's coordinate convention).  We translate to global screen
/// space using `xcap::Window::x()` + `.y()` before posting the event.
///
/// The function emits one full click cycle (mouse-down then mouse-up at the
/// same point) and waits ~20 ms in between — empirically required for GPUI's
/// gesture recognizer to register the press / release pair as a click.
pub(crate) fn click_macos(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    let (source, point) = prepare_mouse_point(target, x, y)?;
    post_left_click(&source, point, None)?;
    log::info!(
        "click: window={target} window-local=({x:.1},{y:.1}) screen=({:.1},{:.1})",
        point.x,
        point.y,
    );
    Ok(())
}

/// Synthesize a double-click at window-local point `(x, y)`.
///
/// Implemented as two `LeftMouseDown`/`LeftMouseUp` pairs separated by
/// [`DOUBLE_CLICK_GAP`] (well under AppKit's `doubleClickInterval` of
/// ~500 ms).  Both pairs set `MOUSE_EVENT_CLICK_STATE` — `1` on the first,
/// `2` on the second — so AppKit treats the pair as a *single* double-click
/// gesture rather than two independent single-clicks.  This is how macOS
/// itself fires double-clicks when the user double-presses the physical
/// mouse button.
pub(crate) fn double_click_macos(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    let (source, point) = prepare_mouse_point(target, x, y)?;
    post_left_click(&source, point, Some(1))?;
    std::thread::sleep(DOUBLE_CLICK_GAP);
    post_left_click(&source, point, Some(2))?;
    log::info!(
        "double-click: window={target} window-local=({x:.1},{y:.1}) screen=({:.1},{:.1})",
        point.x,
        point.y,
    );
    Ok(())
}

/// Move the cursor to window-local point `(x, y)` without pressing any
/// button.  Posts a single `MouseMoved` `CGEvent`.
///
/// Used by hover-only scenarios — e.g. the BlockNote side-menu handle
/// only appears while the cursor sits over an editor block.  Coordinates
/// and translation match [`click_macos`].
pub(crate) fn hover_macos(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    let (source, point) = prepare_mouse_point(target, x, y)?;
    let event =
        CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left)
            .map_err(|_| anyhow!("CGEvent::new_mouse_event(MouseMoved) failed"))?;
    event.post(CGEventTapLocation::HID);
    log::info!(
        "hover: window={target} window-local=({x:.1},{y:.1}) screen=({:.1},{:.1})",
        point.x,
        point.y,
    );
    Ok(())
}

/// Synthesize a single key press (keydown + keyup) on the focused window.
///
/// `keycode` is the macOS Carbon virtual keycode (resolved upstream from
/// a human-readable name via [`crate::keyboard::key_name_to_keycode`]);
/// `flags` is a `CGEventFlags` bit-set of held modifiers.  The function
/// posts the keydown with `flags` applied, sleeps [`CLICK_PRESS_HOLD`] (so
/// the OS sees a discrete press / release pair just like a real key), then
/// posts the keyup with the same flags so apps that key off
/// `flagsChanged` don't see a phantom modifier-release between the two.
///
/// The `target` argument is only used to surface a friendlier error if
/// the requested process disappears between the resolve and the post; the
/// event itself is dispatched to whatever has keyboard focus at the
/// moment of the post.  Callers that need a specific window in front
/// should invoke [`crate::raise`] first.
pub(crate) fn key_press_macos(
    target: &WindowTarget,
    keycode: KeyCode,
    flags: ModifierFlags,
) -> Result<()> {
    // Resolve the target only to fail fast when the window doesn't exist
    // — the actual keyboard CGEvent posts globally to the focused process,
    // not to a specific window handle.
    let _ = crate::capture::find_window(target)?;
    let source = keyboard_source()?;
    let cg_flags = CGEventFlags::from_bits_truncate(flags.bits());

    let down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(down) failed"))?;
    down.set_flags(cg_flags);
    down.post(CGEventTapLocation::HID);

    std::thread::sleep(CLICK_PRESS_HOLD);

    let up = CGEvent::new_keyboard_event(source, keycode, false)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(up) failed"))?;
    up.set_flags(cg_flags);
    up.post(CGEventTapLocation::HID);

    log::info!(
        "key: window={target} keycode=0x{keycode:02X} flags=0x{:x}",
        flags.bits(),
    );
    Ok(())
}

/// Type a string into the focused window one Unicode scalar at a time.
///
/// Each character is dispatched as a `CGEventCreateKeyboardEvent` pair
/// (keydown + keyup) with the Unicode scalar attached via
/// `CGEventKeyboardSetUnicodeString` (a.k.a. `CGEvent::set_string`).  This
/// is the standard pattern for synthesising layout-independent text input
/// on macOS: the keycode field stays `0` and the OS routes the event by
/// the attached string, so non-ASCII characters and dead-key sequences
/// work without the harness having to know the user's layout.
///
/// `\n` and `\t` in the input are dispatched as `Return` and `Tab` key
/// events (with no attached string) instead of typing the raw control
/// character — matters because BlockNote and most text fields handle
/// those as discrete keypresses, not as inserted text.
///
/// `delay_ms` is the per-character pause between events.  See
/// [`DEFAULT_TYPE_DELAY_MS`] for the recommended floor.
pub(crate) fn type_text_macos(target: &WindowTarget, text: &str, delay_ms: u64) -> Result<()> {
    // Resolve the target only to fail fast when the window doesn't exist
    // — the actual keyboard CGEvent posts globally to the focused process,
    // not to a specific window handle.
    let _ = crate::capture::find_window(target)?;
    let source = keyboard_source()?;
    let delay = std::time::Duration::from_millis(delay_ms);

    for ch in text.chars() {
        match ch {
            '\n' => synth_named_key(&source, 0x24)?, // Return
            '\t' => synth_named_key(&source, 0x30)?, // Tab
            other => synth_unicode_char(&source, other)?,
        }
        if !delay.is_zero() {
            std::thread::sleep(delay);
        }
    }

    log::info!(
        "type-text: window={target} chars={} delay_ms={delay_ms}",
        text.chars().count(),
    );
    Ok(())
}

/// Dispatch a keydown/keyup pair carrying a single Unicode scalar via
/// `CGEventKeyboardSetUnicodeString`.  Keycode stays `0` — the OS routes
/// the event by the attached string.
fn synth_unicode_char(source: &CGEventSource, ch: char) -> Result<()> {
    let mut buf = [0u16; 2];
    let utf16 = ch.encode_utf16(&mut buf);

    let down = CGEvent::new_keyboard_event(source.clone(), 0, true)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(down) failed"))?;
    down.set_string_from_utf16_unchecked(utf16);
    down.post(CGEventTapLocation::HID);

    let up = CGEvent::new_keyboard_event(source.clone(), 0, false)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(up) failed"))?;
    up.set_string_from_utf16_unchecked(utf16);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

/// Dispatch a keydown/keyup pair for a named virtual key (Return / Tab in
/// the type-text path).  No attached string — the receiving app sees a
/// real keypress for that physical key.
fn synth_named_key(source: &CGEventSource, keycode: KeyCode) -> Result<()> {
    let down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(down) failed"))?;
    down.post(CGEventTapLocation::HID);

    let up = CGEvent::new_keyboard_event(source.clone(), keycode, false)
        .map_err(|_| anyhow!("CGEvent::new_keyboard_event(up) failed"))?;
    up.post(CGEventTapLocation::HID);
    Ok(())
}
