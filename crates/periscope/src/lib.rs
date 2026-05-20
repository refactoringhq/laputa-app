#![forbid(unsafe_code)]
#![warn(missing_docs)]
//! Periscope — Rust e2e test harness for the Tolaria native shell
//! (ADR-0115 Phase 6-MVP).
//!
//! Captures PNG screenshots of a running `tolaria` macOS application
//! so Claude (the AI assistant) can observe the live app between
//! conversational turns via its multimodal `Read` tool.  The harness
//! is an external observer (subprocess + OS compositor capture) — see
//! `docs/plans/native-gpui-chrome/e2e-harness.md` for the workflow.
//!
//! # Why not in-process?
//!
//! GPUI's `Window::render_to_image()` reads the Metal drawable
//! texture, which contains the GPUI chrome drawing only.  The
//! embedded WKWebView editor body is a sibling NSView composited by
//! the OS — captures would show it as a black rectangle.  Since the
//! editor is the central feature of ADR-0115, external compositor
//! capture (via `xcap`) is required.
//!
//! # Platforms
//!
//! macOS only.  Other platforms compile a stub that errors at the
//! public API surface — the harness has no purpose off-Tolaria's
//! target platform.

use anyhow::Result;
use std::fmt;
use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
pub(crate) mod capture;
#[cfg(target_os = "macos")]
pub(crate) mod input;
pub mod keyboard;
pub mod tree_dump;
#[cfg(target_os = "macos")]
pub(crate) mod windows;

/// Which window the harness targets.
///
/// `ByTitle` is the canonical channel — `tolaria` sets its window
/// title to `"Tolaria"` at `crates/tolaria/src/main.rs:214`.  `ByPid`
/// is for the smoke test that spawns its own child and already knows
/// the process id.
#[derive(Debug, Clone)]
pub enum WindowTarget {
    /// Match by exact window title.
    ByTitle(String),
    /// Match by owning process id.
    ByPid(u32),
}

impl WindowTarget {
    /// Build a [`WindowTarget::ByTitle`] from anything string-like.
    pub fn by_title(title: impl Into<String>) -> Self {
        Self::ByTitle(title.into())
    }

    /// Build a [`WindowTarget::ByPid`].
    pub fn by_pid(pid: u32) -> Self {
        Self::ByPid(pid)
    }
}

impl fmt::Display for WindowTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ByTitle(t) => write!(f, "title={t:?}"),
            Self::ByPid(p) => write!(f, "pid={p}"),
        }
    }
}

/// Diagnostic metadata for a single visible window.  Returned by
/// [`list_windows`] to debug "window not found" issues.
#[derive(Debug, Clone)]
pub struct WindowSummary {
    /// Owning process id.
    pub pid: u32,
    /// Window title as the OS reports it.
    pub title: String,
    /// Application name that owns the window.
    pub app_name: String,
}

/// Capture one matching window and write a PNG to `out`.  Returns the
/// canonical path on success.
///
/// # Errors
///
/// - No window matches `target`.
/// - The OS denies screen capture (Screen Recording permission
///   missing).  Detected by all-black / tiny output and converted to
///   a remediation-message error.
/// - `out` cannot be written.
pub fn screenshot(target: &WindowTarget, out: &Path) -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        capture::screenshot_macos(target, out)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, out);
        anyhow::bail!("periscope screenshots are macOS-only (Phase 6-MVP)")
    }
}

/// Capture one matching window, crop to the bounds of the named element, and
/// write a PNG to `out`.  Returns the canonical path on success.
///
/// `bounds` are in **window-frame logical points** as reported by the
/// `tree_dump` JSON.  The function derives the device pixel ratio from the
/// captured image's pixel dimensions vs the window's logical size, then crops
/// accordingly.  The crop is clamped to the image bounds — if the element is
/// fully off-screen this returns an error rather than writing an empty file.
///
/// # Errors
///
/// - No window matches `target`.
/// - Screen Recording permission missing (all-black frame).
/// - Element bounds clamp to an empty rectangle (element off-screen).
/// - `out` cannot be written.
pub fn screenshot_cropped(
    target: &WindowTarget,
    bounds: tree_dump::NamedBounds,
    out: &Path,
) -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        capture::screenshot_cropped_macos(target, bounds, out)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, bounds, out);
        anyhow::bail!("periscope screenshots are macOS-only (Phase 6-MVP)")
    }
}

/// Bring `target` to the foreground before capture.  Uses the macOS
/// Accessibility API so it works on cross-process windows.
///
/// # Errors
///
/// - Accessibility permission missing for the harness binary.
/// - No window matches `target`.
pub fn raise(target: &WindowTarget) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        windows::raise_macos(target)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        anyhow::bail!("periscope raise is macOS-only (Phase 6-MVP)")
    }
}

/// Synthesize a left-click inside `target` at window-local point `(x, y)`.
///
/// Coordinates are in window points with the origin at the top-left
/// corner of the window (matching GPUI's coordinate convention).  The
/// harness resolves `target` via `xcap` first (so a missing window
/// errors fast) and translates to global screen space using the
/// resolved window's reported origin before posting `CGEvent` mouse-down
/// + mouse-up at the point.
///
/// `target` must already be raised — callers that need the window in
/// the foreground should invoke [`raise`] first.  Once the target is
/// resolved the event is posted via the **global** `CGEvent` queue at
/// `CGEventTapLocation::HID`, so a covered or off-screen window still
/// receives the event (it just may not be visible).  If reliability
/// matters, raise first.
///
/// # Errors
///
/// - No window matches `target`.
/// - The CoreGraphics event-source / event-create call fails (rare;
///   typically indicates a sandbox / TCC restriction on the harness
///   binary's parent process).
pub fn click(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        input::click_macos(target, x, y)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, x, y);
        anyhow::bail!("periscope click is macOS-only (Phase 6-MVP)")
    }
}

/// Synthesize a double-click inside `target` at window-local point
/// `(x, y)`.  Two `LeftMouseDown`/`LeftMouseUp` pairs separated by ~60 ms;
/// the second pair carries `MOUSE_EVENT_CLICK_STATE = 2` so AppKit sees the
/// pair as a single double-click gesture.
///
/// # Errors
///
/// Same failure modes as [`click`].
pub fn double_click(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        input::double_click_macos(target, x, y)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, x, y);
        anyhow::bail!("periscope double-click is macOS-only (Phase 6-MVP)")
    }
}

/// Move the mouse cursor to window-local point `(x, y)` without clicking.
/// Posts a single `MouseMoved` `CGEvent`.  Used for hover-only flows
/// (e.g. surfacing BlockNote's side-menu handle).
///
/// # Errors
///
/// Same failure modes as [`click`].
pub fn hover(target: &WindowTarget, x: f64, y: f64) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        input::hover_macos(target, x, y)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, x, y);
        anyhow::bail!("periscope hover is macOS-only (Phase 6-MVP)")
    }
}

/// Type a string into whichever element has keyboard focus inside
/// `target`.  Each character is dispatched as a `CGEvent` keyboard pair
/// with `CGEventKeyboardSetUnicodeString` so non-ASCII characters work
/// regardless of the host keyboard layout.  `\n` and `\t` are mapped to
/// `Return` and `Tab` virtual keys (not the literal control chars), which
/// matters because BlockNote treats those as keystrokes rather than
/// inserted text.
///
/// `delay_ms` is the per-character pause; `0` is allowed but practically
/// unstable on busy machines.  See [`DEFAULT_TYPE_DELAY_MS`] for the
/// recommended floor.
///
/// # Errors
///
/// - No window matches `target`.
/// - The CoreGraphics event-source / event-create call fails.
pub fn type_text(target: &WindowTarget, text: &str, delay_ms: u64) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        input::type_text_macos(target, text, delay_ms)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, text, delay_ms);
        anyhow::bail!("periscope type-text is macOS-only (Phase 6-MVP)")
    }
}

/// Synthesize a single key press inside `target` with the given
/// modifiers held.  `keycode` is the macOS Carbon virtual keycode —
/// callers should produce it via [`keyboard::key_name_to_keycode`].
/// `modifier_flags` is a [`keyboard::ModifierFlags`] newtype; produce it
/// via [`keyboard::parse_modifier_list`] or combine the
/// `ModifierFlags::*` constants with `|`.
///
/// # Errors
///
/// - No window matches `target`.
/// - The CoreGraphics event-source / event-create call fails.
pub fn key_press(
    target: &WindowTarget,
    keycode: keyboard::KeyCode,
    modifier_flags: keyboard::ModifierFlags,
) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        input::key_press_macos(target, keycode, modifier_flags)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, keycode, modifier_flags);
        anyhow::bail!("periscope key is macOS-only (Phase 6-MVP)")
    }
}

/// Convenience wrapper over [`key_press`] that accepts a key name and a
/// comma-separated modifier list.  Spares smoke-test callers the
/// three-call dance of `key_name_to_keycode` + `parse_modifier_list` +
/// `key_press`.
///
/// `modifiers` matches the CLI's `--modifiers` semantics: empty string
/// `""` resolves to [`keyboard::ModifierFlags::NONE`], otherwise it's a
/// comma-separated list parsed by [`keyboard::parse_modifier_list`].
///
/// # Errors
///
/// Errors propagate from [`keyboard::key_name_to_keycode`],
/// [`keyboard::parse_modifier_list`], and [`key_press`].
pub fn press_named_key(target: &WindowTarget, key: &str, modifiers: &str) -> Result<()> {
    let keycode = keyboard::key_name_to_keycode(key)?;
    let flags = keyboard::parse_modifier_list(modifiers)?;
    key_press(target, keycode, flags)
}

/// Recommended default per-character delay for [`type_text`].  Re-exported
/// from the macOS adapter so the CLI's clap default and the library
/// caller see the same constant.
#[cfg(target_os = "macos")]
pub const DEFAULT_TYPE_DELAY_MS: u64 = input::DEFAULT_TYPE_DELAY_MS;

/// Recommended default per-character delay for [`type_text`].  The
/// non-macOS stub keeps the constant present so cross-platform callers
/// compile; the function itself errors at runtime off macOS.
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_TYPE_DELAY_MS: u64 = 8;

/// Resolve `target` to an owning PID via `xcap` window enumeration.
/// `ByPid` returns the pid directly; `ByTitle` looks up the first
/// visible window whose title equals the requested string.
///
/// Used by the `click --id` CLI subcommand so it can derive the
/// `tree_dump` JSON path even when the caller only knows the
/// window title.
///
/// # Errors
///
/// - No window matches `target`.
/// - `xcap` enumeration fails (rare; usually a permission issue).
pub fn resolve_pid(target: &WindowTarget) -> Result<u32> {
    match target {
        WindowTarget::ByPid(p) => Ok(*p),
        WindowTarget::ByTitle(want) => {
            for w in list_windows()? {
                if &w.title == want {
                    return Ok(w.pid);
                }
            }
            anyhow::bail!("no visible window with title {want:?}");
        }
    }
}

/// Enumerate every visible window with its title / pid / app name.
/// Diagnostic surface for the `periscope list` CLI subcommand and for
/// debugging missing-window errors.
///
/// # Errors
///
/// Propagates `xcap` enumeration failures (rare; typically permission
/// issues).
pub fn list_windows() -> Result<Vec<WindowSummary>> {
    #[cfg(target_os = "macos")]
    {
        capture::list_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

// Build-time guard: the recommended type-delay floor is meant to be a
// non-zero value.  `0` is technically allowed at the API surface but
// documented as unstable; if someone accidentally edits the constant
// to `0`, every smoke script that doesn't pass `--delay-ms` explicitly
// silently degrades.  Lifted out of `#[cfg(test)]` so the assertion
// fires on every build, not just `cargo test`.
const _: () = assert!(DEFAULT_TYPE_DELAY_MS > 0);

#[cfg(test)]
mod tests {
    //! Smoke tests for the synthetic-input library surface.
    //!
    //! These exercise the error-reporting path against an obviously-bogus
    //! target so we have CI coverage that the new entry points are wired
    //! into the platform gate correctly.  The happy path requires a
    //! foreground Tolaria window and is covered by the opt-in
    //! `screenshot_smoke` integration test.
    use super::*;
    use crate::keyboard::{self, ModifierFlags};

    /// PID guaranteed not to own a window.  PID 0 is the kernel
    /// scheduler / swapper — no AX windows, no xcap rows.
    const NOT_A_WINDOW: WindowTarget = WindowTarget::ByPid(0);

    #[test]
    fn type_text_against_missing_window_errors() {
        let err = type_text(&NOT_A_WINDOW, "hello", 0).unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "error should mention the bad target or the platform gate: {msg}"
        );
    }

    #[test]
    fn key_press_against_missing_window_errors() {
        let keycode = keyboard::key_name_to_keycode("Return").unwrap();
        let err = key_press(&NOT_A_WINDOW, keycode, ModifierFlags::COMMAND).unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "error should mention the bad target or the platform gate: {msg}"
        );
    }

    #[test]
    fn hover_against_missing_window_errors() {
        let err = hover(&NOT_A_WINDOW, 1.0, 1.0).unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "error should mention the bad target or the platform gate: {msg}"
        );
    }

    #[test]
    fn double_click_against_missing_window_errors() {
        let err = double_click(&NOT_A_WINDOW, 1.0, 1.0).unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "error should mention the bad target or the platform gate: {msg}"
        );
    }

    #[test]
    fn keyboard_module_is_publicly_re_exported() {
        // Smoke check the public re-export path callers use: a smoke
        // script should be able to compose `key_name_to_keycode` +
        // `parse_modifier_list` without touching internals.
        let kc = keyboard::key_name_to_keycode("s").unwrap();
        let flags = keyboard::parse_modifier_list("cmd").unwrap();
        assert_eq!(kc, 0x01);
        assert_eq!(flags, ModifierFlags::COMMAND);
        assert_eq!(
            keyboard::parse_modifier_list("cmd,shift").unwrap(),
            ModifierFlags::COMMAND | ModifierFlags::SHIFT,
        );
    }

    #[test]
    fn press_named_key_against_missing_window_errors() {
        // The wrapper composes `key_name_to_keycode` +
        // `parse_modifier_list` + `key_press`.  Hitting a bogus target
        // proves the chain is wired end-to-end: the error must come
        // from `key_press` (window resolution), not from the parser
        // helpers.
        let err = press_named_key(&NOT_A_WINDOW, "s", "cmd").unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "wrapper should reach key_press's resolve step: {msg}"
        );
    }

    #[test]
    fn press_named_key_propagates_unknown_key_name() {
        // Errors from the parser helpers must surface verbatim — a
        // typo in a smoke script should fail loud, not silently click
        // something unrelated.
        let err = press_named_key(&NOT_A_WINDOW, "Returnish", "").unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("Returnish"),
            "wrapper should propagate key_name_to_keycode's error: {msg}"
        );
    }

    #[test]
    fn press_named_key_propagates_unknown_modifier() {
        let err = press_named_key(&NOT_A_WINDOW, "s", "hyper").unwrap_err();
        let msg = format!("{err:#}");
        assert!(
            msg.contains("hyper"),
            "wrapper should propagate parse_modifier_list's error: {msg}"
        );
    }

    #[test]
    fn press_named_key_empty_modifiers_is_valid() {
        // Empty modifier string must resolve to NONE rather than
        // erroring — that's the documented CLI semantics and several
        // sweep scenarios use it (e.g. `("Escape", "")`).
        let err = press_named_key(&NOT_A_WINDOW, "Escape", "").unwrap_err();
        let msg = format!("{err:#}");
        // The only error we expect here comes from the missing window,
        // never from the parser stack.
        assert!(
            msg.contains("pid 0") || msg.contains("macOS-only"),
            "empty modifiers must not error in the parser: {msg}"
        );
    }
}
