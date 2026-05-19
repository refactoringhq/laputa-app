//! WKWebView embedding for the ADR-0115 Phase 0 spike (tasks #4 + #5).
//!
//! `gpui_wry::WebView` (longbridge `crates/webview`, package name
//! `gpui-wry`) builds the underlying `wry::WebView` as a sibling `NSView`
//! inside the window's content view. The canonical NSView-as-sibling
//! pattern this builds on lives in upstream Zed at
//! `crates/gpui_macos/src/window.rs:783–884` (content view lookup,
//! autoresizing-mask wiring, `addSubview_`, `makeFirstResponder_`).
//!
//! Task #5 instrumentation: instead of rendering the upstream `WebView`
//! entity directly, we render `InstrumentedWebView`, a thin custom
//! `Element` that mirrors upstream `WebViewElement::prepaint` but adds:
//!   - an epsilon-compare guard (0.5 px tolerance) per ADR-0115 §4 so
//!     same-bounds re-prepaints don't ping `wry::WebView::set_bounds`;
//!   - `frame_sync x= y= w= h=` info logs on real changes and
//!     `frame_sync_skip ...` debug logs on suppressed noop calls.
//!
//! The WebView entity itself is *kept alive* by `RootView` (it owns
//! `Entity<WebView>`), which keeps the underlying `Rc<wry::WebView>`
//! alive, which keeps the NSView attached to the window. We just stop
//! routing through the upstream `Render` impl that would otherwise call
//! `set_bounds` unconditionally.
//!
//! ## Seamless-resize fixes (ADR-0115 §4.1 / §4.2 / §4.3)
//!
//! Three changes applied in `spawn_test_webview` right after
//! `build_as_child` eliminate the trailing-strip artifact observed
//! during live resize and `h_resizable` splitter drags:
//!
//! 1. **Autoresize mask** (`fix_autoresize_mask`): flips the WKWebView's
//!    `NSAutoresizingMaskOptions` from `ViewMinYMargin` (lb-wry child
//!    default) to `ViewWidthSizable | ViewHeightSizable`.  AppKit then
//!    updates the NSView frame inside its own geometry phase — on the
//!    same display-link tick that resizes the window — rather than
//!    waiting for GPUI's next render pass.  Ref:
//!    `wry/0.54.2/src/wkwebview/mod.rs:484-495`.
//!
//! 2. **Window background colour** (`fix_window_background`): sets
//!    `NSWindow.backgroundColor` to `rgb(0x12141a)` (the content-panel
//!    bg defined in `layout.rs:179`) so any residual 1-frame mismatch
//!    between the Metal layer and the WebView's CALayer is invisible
//!    rather than flashing the default light-grey.  We go via objc2
//!    directly because GPUI's `set_background_appearance` only supports
//!    opaque-black or near-transparent.  Ref: ADR-0115 §4.2.
//!
//! 3. **drawsBackground = false** (`fix_draws_background`): sets the
//!    private-but-documented KVC key `drawsBackground` on the
//!    `WKWebViewConfiguration` to `NO`, preventing WebKit from painting
//!    its own opaque-white fill during resize.  Mirrors Tauri's exact
//!    technique at `wry/0.54.2/src/wkwebview/mod.rs:353-371` and
//!    `mod.rs:940-945`.  lb-wry's guard for this flag is gated on
//!    `attributes.transparent` only, so we apply it unconditionally via
//!    KVC after construction.

use std::{cell::Cell, rc::Rc};

use gpui::{
    App, AppContext, Bounds, Context, Element, ElementId, Entity, GlobalElementId, IntoElement,
    LayoutId, Pixels, Size as GpuiSize, Style, Window,
};
use gpui_wry::WebView;
use raw_window_handle::HasWindowHandle;
use wry::{
    dpi::{self, LogicalPosition, LogicalSize},
    Rect, WebViewBuilder,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSAutoresizingMaskOptions, NSColor, NSView};
#[cfg(target_os = "macos")]
use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding};
#[cfg(target_os = "macos")]
use raw_window_handle::RawWindowHandle;
#[cfg(target_os = "macos")]
use wry::WebViewExtMacOS;

const TEST_PAGE_HTML: &str = include_str!("../assets/test-page.html");
const IPC_TARGET: &str = "embed_poc::ipc";
const FOCUS_TARGET: &str = "embed_poc::focus";
const IME_TARGET: &str = "embed_poc::ime";
const FRAME_TARGET: &str = "embed_poc::frame";

/// 0.5-logical-pixel epsilon per ADR-0115 §4. Single source of truth
/// shared between `close_enough` (Bounds-level dedupe inside
/// `InstrumentedWebView::prepaint`) and `layout::same_size`
/// (Size-level dedupe inside `observe_window_bounds`). When the ADR
/// changes the tolerance, only this constant moves.
pub(crate) const FRAME_EPSILON: f32 = 0.5;

/// Construct the spike's WebView entity — built `as_child` of the current
/// `NSWindow`'s content view so it sits next to GPUI's Metal renderer.
///
/// After construction the three seamless-resize fixes described in the
/// module doc are applied: autoresize mask, window background colour, and
/// `drawsBackground = false`.  All three are gated on
/// `#[cfg(target_os = "macos")]` so non-macOS builds (stub path in
/// `main.rs`) are unaffected.
pub fn spawn_test_webview(window: &mut Window, cx: &mut App) -> Entity<WebView> {
    cx.new(|cx: &mut Context<WebView>| {
        let window_handle = window
            .window_handle()
            .expect("window handle unavailable while building WebView");

        let builder = WebViewBuilder::new()
            .with_html(TEST_PAGE_HTML)
            .with_devtools(true)
            .with_ipc_handler(|req| {
                let body = req.body();
                dispatch_ipc(body);
            });

        let webview = builder
            .build_as_child(&window_handle)
            .expect("failed to build child wry::WebView");

        // Fix 1: autoresize mask — must run before WebView::new wraps the
        // wry::WebView in an Rc, because we need the bare wry::WebView to
        // call WebViewExtMacOS::webview().
        #[cfg(target_os = "macos")]
        fix_autoresize_mask(&webview);

        // Fix 3: drawsBackground = false — same timing requirement as Fix 1.
        #[cfg(target_os = "macos")]
        fix_draws_background(&webview);

        // Fix 2: window background colour — we have the raw window handle here
        // and can walk ns_view → window → setBackgroundColor.
        #[cfg(target_os = "macos")]
        fix_window_background(&window_handle);

        WebView::new(webview, window, cx)
    })
}

/// Fix 1 — Autoresize mask (ADR-0115 §4.1).
///
/// lb-wry's `build_as_child` path sets `ViewMinYMargin` only, which keeps
/// the bottom margin constant but does NOT make the WebView track the
/// parent's width or height.  Overriding the mask here makes AppKit
/// propagate frame changes to the WKWebView inside its own geometry phase
/// — the same display-link tick that resizes the window — eliminating the
/// one-frame trailing-strip artifact.
///
/// Reference: `wry/0.54.2/src/wkwebview/mod.rs:484-495`.
#[cfg(target_os = "macos")]
fn fix_autoresize_mask(webview: &wry::WebView) {
    // `webview()` returns a `Retained<WryWebView>` (ARC-managed).
    // `WryWebView` extends `WKWebView` which extends `NSView`, so the
    // deref coercion to `&NSView` is valid.  `setAutoresizingMask` is a
    // safe method in objc2 (no unsafe required here).
    let wk: objc2::rc::Retained<wry::WryWebView> = webview.webview();
    // `WryWebView` extends `WKWebView` which extends `NSView`; auto-deref
    // via `Retained<T>: Deref<Target = T>` resolves `setAutoresizingMask`
    // without an explicit cast.
    wk.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
}

/// Fix 3 — `drawsBackground = false` (ADR-0115 §4.3).
///
/// lb-wry's `drawsBackground` KVC override is gated on
/// `attributes.transparent`, which we do not set.  Apply it ourselves via
/// KVC after construction so WebKit stops painting its own opaque-white fill
/// during resize.
///
/// Reference: `wry/0.54.2/src/wkwebview/mod.rs:353-371` and
/// `mod.rs:940-945`.
#[cfg(target_os = "macos")]
fn fix_draws_background(webview: &wry::WebView) {
    // SAFETY: `webview()` returns a valid `Retained<WryWebView>`.  KVC
    // `setValue:forKey:` is a standard Objective-C message send on NSObject,
    // and `drawsBackground` is a documented (private-API, but stable since
    // macOS 10.14) configuration key on `WKWebViewConfiguration`.  We are on
    // the main thread.
    unsafe {
        let wk: objc2::rc::Retained<wry::WryWebView> = webview.webview();
        let no = NSNumber::numberWithBool(false);
        wk.setValue_forKey(Some(&no), ns_string!("drawsBackground"));
    }
}

/// Fix 2 — NSWindow background colour (ADR-0115 §4.2).
///
/// GPUI's `set_background_appearance` only offers opaque-black or
/// near-transparent modes.  We need the content-panel colour
/// `rgb(0x12141a)` so any 1-frame gap between the Metal layer and the
/// WebView's CALayer is invisible rather than flashing the default
/// light-grey.  We walk `AppKitWindowHandle.ns_view → window() →
/// setBackgroundColor:` directly.
#[cfg(target_os = "macos")]
fn fix_window_background(window_handle: &impl HasWindowHandle) {
    let Ok(handle) = window_handle.window_handle() else {
        log::warn!("fix_window_background: could not obtain window handle");
        return;
    };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        log::warn!("fix_window_background: window handle is not AppKit");
        return;
    };
    // SAFETY: `AppKitWindowHandle.ns_view` is a valid, non-null pointer to an
    // `NSView` that is guaranteed to remain alive for the duration of this
    // call (the window is open and we hold no ownership).  We retain it
    // temporarily via `Retained::retain` to get a safe reference, then walk
    // `.window()` to reach the `NSWindow`.  The colour constants are computed
    // on the stack and do not outlive this function.
    unsafe {
        let ns_view_ptr: *mut NSView = appkit.ns_view.as_ptr().cast();
        let Some(ns_view) = objc2::rc::Retained::retain(ns_view_ptr) else {
            log::warn!("fix_window_background: NSView retain returned nil");
            return;
        };
        let Some(ns_window) = ns_view.window() else {
            log::warn!("fix_window_background: NSView.window() returned nil");
            return;
        };
        // Content-panel background: rgb(0x12, 0x14, 0x1a) == layout.rs:179.
        let color = NSColor::colorWithSRGBRed_green_blue_alpha(
            0x12_u8 as f64 / 255.0,
            0x14_u8 as f64 / 255.0,
            0x1a_u8 as f64 / 255.0,
            1.0,
        );
        ns_window.setBackgroundColor(Some(&color));
    }
}

/// Shared state tracking the bounds we last pushed to `wry::WebView`.
/// Lives on `RootView` so it survives across render passes; cloned into
/// each freshly-constructed `InstrumentedWebView` element.
///
/// `FrameSyncState::default()` is the canonical constructor — it
/// produces `Rc::new(Cell::new(None))`, which is exactly the starting
/// state.
pub type FrameSyncState = Rc<Cell<Option<Bounds<Pixels>>>>;

/// Custom Element wrapping a `WebView` entity that adds:
///   1. Epsilon-compare guard (0.5 px) so noop `set_bounds` calls are
///      logged at debug as `frame_sync_skip` instead of touching the
///      NSView each frame.
///   2. Info-level `frame_sync x= y= w= h=` on every committed bounds
///      change.
///
/// The bounds-translation math (logical pixels via `dpi::Size::Logical`
/// / `dpi::Position::Logical`) mirrors gpui-wry's `WebViewElement::prepaint`
/// at `crates/webview/src/lib.rs:178–204` — we deliberately stay on the
/// logical-pixel API and never multiply by the device scale factor.
pub struct InstrumentedWebView {
    webview: Entity<WebView>,
    last_bounds: FrameSyncState,
}

impl InstrumentedWebView {
    pub fn new(webview: Entity<WebView>, last_bounds: FrameSyncState) -> Self {
        Self {
            webview,
            last_bounds,
        }
    }
}

impl IntoElement for InstrumentedWebView {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for InstrumentedWebView {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = Style {
            size: GpuiSize::full(),
            flex_shrink: 1.0,
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let prev = self.last_bounds.get();
        let same = prev.map(|p| close_enough(p, bounds)).unwrap_or(false);

        if same {
            log::debug!(
                target: FRAME_TARGET,
                "frame_sync_skip x={:.1} y={:.1} w={:.1} h={:.1}",
                f32::from(bounds.origin.x),
                f32::from(bounds.origin.y),
                f32::from(bounds.size.width),
                f32::from(bounds.size.height),
            );
            return;
        }

        log::info!(
            target: FRAME_TARGET,
            "frame_sync x={:.1} y={:.1} w={:.1} h={:.1}",
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width),
            f32::from(bounds.size.height),
        );

        // WebView derefs to wry::WebView, so set_bounds resolves to the
        // underlying wry call. Keeping the WebView entity in RootView
        // ensures the Rc<wry::WebView> + its NSView stay alive.
        //
        // On Err we must NOT advance `last_bounds` — otherwise the
        // epsilon guard above would suppress the next prepaint and the
        // NSView would stay stuck at whatever wry actually managed to
        // commit (often the pre-resize geometry). A warn on a frame-sync
        // path is rare; if it starts firing repeatedly that's the
        // signal that ADR-0115 §4 needs revisiting.
        let rect = Rect {
            size: dpi::Size::Logical(LogicalSize {
                width: bounds.size.width.into(),
                height: bounds.size.height.into(),
            }),
            position: dpi::Position::Logical(LogicalPosition::new(
                bounds.origin.x.into(),
                bounds.origin.y.into(),
            )),
        };
        if let Err(e) = self.webview.read(cx).set_bounds(rect) {
            log::warn!(
                target: FRAME_TARGET,
                "frame_sync set_bounds failed: {e:?}; not advancing last_bounds"
            );
            return;
        }
        self.last_bounds.set(Some(bounds));
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        _: &mut Window,
        _: &mut App,
    ) {
    }
}

/// Two-state focus indicator for `ParsedIpc::WebviewFocus`. Replaces
/// the previous `state: &'static str` (`"in"` / `"out"`) so the
/// dispatch site gets exhaustive matching from the compiler and the
/// log mapping has a single source of truth.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum WebviewFocusState {
    In,
    Out,
}

impl WebviewFocusState {
    /// String used in the `webview_focus state=…` log line. Keeping
    /// this mapping next to the enum means the log format and the
    /// type stay in sync.
    fn as_log_str(self) -> &'static str {
        match self {
            Self::In => "in",
            Self::Out => "out",
        }
    }
}

/// Structured result of parsing the `{k, v}` envelope the test page sends
/// over wry's IPC channel. Extracted as a pure function so the dispatch
/// table can be unit-tested without spinning up GPUI, AppKit, or wry.
#[derive(Debug, PartialEq, Eq, Clone)]
pub(crate) enum ParsedIpc {
    WebviewFocus {
        state: WebviewFocusState,
        target: String,
    },
    Ime {
        phase: String,
        data: String,
        value_len: usize,
    },
    Keydown {
        key: String,
        mods: String,
    },
    Raw {
        body: String,
    },
}

pub(crate) fn parse_ipc_body(body: &str) -> ParsedIpc {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(body) else {
        return ParsedIpc::Raw {
            body: body.to_string(),
        };
    };

    let kind = envelope.get("k").and_then(|v| v.as_str()).unwrap_or("?");
    let value = envelope
        .get("v")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    match kind {
        "focus" | "blur" => {
            let state = if kind == "focus" {
                WebviewFocusState::In
            } else {
                WebviewFocusState::Out
            };
            let target = value.as_str().unwrap_or("?").to_string();
            ParsedIpc::WebviewFocus { state, target }
        }
        "composition" => {
            let phase = value
                .get("phase")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_string();
            let data = value
                .get("data")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value_len = value
                .get("value")
                .and_then(|v| v.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            ParsedIpc::Ime {
                phase,
                data,
                value_len,
            }
        }
        "keydown" => {
            let key = value
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("?")
                .to_string();
            let mods = value
                .get("mods")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            ParsedIpc::Keydown { key, mods }
        }
        _ => ParsedIpc::Raw {
            body: body.to_string(),
        },
    }
}

/// Emit the log line that corresponds to a parsed IPC event. Kept
/// separate from `parse_ipc_body` so tests can assert on the parsed
/// structure without grepping captured logs.
fn dispatch_ipc(body: &str) {
    match parse_ipc_body(body) {
        ParsedIpc::WebviewFocus { state, target } => {
            log::info!(
                target: FOCUS_TARGET,
                "webview_focus state={} target={target}",
                state.as_log_str()
            );
        }
        ParsedIpc::Ime {
            phase,
            data,
            value_len,
        } => {
            log::info!(
                target: IME_TARGET,
                "ime phase={phase} data={data:?} value_len={value_len}"
            );
        }
        ParsedIpc::Keydown { key, mods } => {
            log::info!(target: IPC_TARGET, "keydown key={key} mods={mods}");
        }
        ParsedIpc::Raw { body } => {
            log::info!(target: IPC_TARGET, "ipc raw={body}");
        }
    }
}

pub(crate) fn close_enough(a: Bounds<Pixels>, b: Bounds<Pixels>) -> bool {
    let dx = (f32::from(a.origin.x) - f32::from(b.origin.x)).abs();
    let dy = (f32::from(a.origin.y) - f32::from(b.origin.y)).abs();
    let dw = (f32::from(a.size.width) - f32::from(b.size.width)).abs();
    let dh = (f32::from(a.size.height) - f32::from(b.size.height)).abs();
    dx < FRAME_EPSILON && dy < FRAME_EPSILON && dw < FRAME_EPSILON && dh < FRAME_EPSILON
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{px, Point, Size as GpuiSize};

    fn b(x: f32, y: f32, w: f32, h: f32) -> Bounds<Pixels> {
        Bounds::new(Point::new(px(x), px(y)), GpuiSize::new(px(w), px(h)))
    }

    #[test]
    fn close_enough_is_reflexive() {
        let r = b(10.0, 20.0, 300.0, 400.0);
        assert!(close_enough(r, r));
    }

    #[test]
    fn close_enough_accepts_sub_epsilon_drift() {
        let a = b(10.0, 20.0, 300.0, 400.0);
        let drifted = b(10.4, 20.4, 300.4, 400.4);
        assert!(
            close_enough(a, drifted),
            "drift below 0.5 px must be treated as same bounds"
        );
    }

    #[test]
    fn close_enough_rejects_one_pixel_diff() {
        let a = b(10.0, 20.0, 300.0, 400.0);
        let moved = b(11.0, 20.0, 300.0, 400.0);
        assert!(!close_enough(a, moved));
    }

    #[test]
    fn close_enough_rejects_diff_at_exact_epsilon_boundary() {
        let a = b(10.0, 20.0, 300.0, 400.0);
        let at_boundary = b(10.0 + FRAME_EPSILON, 20.0, 300.0, 400.0);
        assert!(
            !close_enough(a, at_boundary),
            "guard uses strict < FRAME_EPSILON; a diff of exactly FRAME_EPSILON must NOT be suppressed"
        );
    }

    #[test]
    fn close_enough_rejects_size_drift() {
        let a = b(0.0, 0.0, 300.0, 400.0);
        let resized = b(0.0, 0.0, 301.0, 400.0);
        assert!(!close_enough(a, resized));
    }

    #[test]
    fn parse_ipc_focus_event() {
        assert_eq!(
            parse_ipc_body(r#"{"k":"focus","v":"textarea"}"#),
            ParsedIpc::WebviewFocus {
                state: WebviewFocusState::In,
                target: "textarea".into(),
            }
        );
    }

    #[test]
    fn parse_ipc_blur_event() {
        assert_eq!(
            parse_ipc_body(r#"{"k":"blur","v":"single-line"}"#),
            ParsedIpc::WebviewFocus {
                state: WebviewFocusState::Out,
                target: "single-line".into(),
            }
        );
    }

    #[test]
    fn parse_ipc_ime_compositionstart_empty() {
        assert_eq!(
            parse_ipc_body(
                r#"{"k":"composition","v":{"phase":"compositionstart","data":"","value":""}}"#
            ),
            ParsedIpc::Ime {
                phase: "compositionstart".into(),
                data: "".into(),
                value_len: 0,
            }
        );
    }

    #[test]
    fn parse_ipc_ime_value_len_counts_chars_not_bytes() {
        // 5 chars, 15 UTF-8 bytes. README's PASS criterion requires the
        // char count, otherwise CJK compositions report `value_len=15`
        // and the validation script counts them as failures.
        let parsed = parse_ipc_body(
            r#"{"k":"composition","v":{"phase":"compositionend","data":"こんにちは","value":"こんにちは"}}"#,
        );
        assert_eq!(
            parsed,
            ParsedIpc::Ime {
                phase: "compositionend".into(),
                data: "こんにちは".into(),
                value_len: 5,
            }
        );
    }

    #[test]
    fn parse_ipc_keydown() {
        assert_eq!(
            parse_ipc_body(r#"{"k":"keydown","v":{"key":"s","mods":"meta"}}"#),
            ParsedIpc::Keydown {
                key: "s".into(),
                mods: "meta".into()
            }
        );
    }

    #[test]
    fn parse_ipc_unknown_kind_falls_back_to_raw() {
        let body = r#"{"k":"button_click","v":42}"#;
        assert_eq!(parse_ipc_body(body), ParsedIpc::Raw { body: body.into() });
    }

    #[test]
    fn parse_ipc_malformed_json_falls_back_to_raw() {
        let body = "this is not json";
        assert_eq!(parse_ipc_body(body), ParsedIpc::Raw { body: body.into() });
    }

    #[test]
    fn parse_ipc_focus_with_missing_v_uses_question_mark_target() {
        assert_eq!(
            parse_ipc_body(r#"{"k":"focus"}"#),
            ParsedIpc::WebviewFocus {
                state: WebviewFocusState::In,
                target: "?".into(),
            }
        );
    }

    #[test]
    fn webview_focus_state_log_str_is_in_and_out() {
        // Lock the log-line format the README documents — the dispatch
        // path interpolates these literals directly into the
        // `webview_focus state=…` line.
        assert_eq!(WebviewFocusState::In.as_log_str(), "in");
        assert_eq!(WebviewFocusState::Out.as_log_str(), "out");
    }

    /// Verify that the autoresize-mask constants used by `fix_autoresize_mask`
    /// have the correct bit values.
    ///
    /// The live wire-up (calling `setAutoresizingMask` on a real `WKWebView`)
    /// requires an actual AppKit NSView and cannot run in the GPUI test
    /// platform.  This test asserts on the bitmask constants themselves,
    /// locking the values that `fix_autoresize_mask` passes to AppKit so a
    /// future objc2-app-kit version bump can't silently break the fix.
    ///
    /// Reference: `NSViewWidthSizable = 2`, `NSViewHeightSizable = 16`
    /// (AppKit NSView.h).  The combined mask is `0b10010` = 18.
    #[cfg(target_os = "macos")]
    #[test]
    fn autoresize_mask_constants_have_expected_bit_values() {
        use objc2_app_kit::NSAutoresizingMaskOptions;

        let mask = NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewHeightSizable;
        // NSViewWidthSizable = 2, NSViewHeightSizable = 16 → combined = 18.
        assert_eq!(
            mask.bits(),
            18,
            "ViewWidthSizable | ViewHeightSizable must be 0x12 (18); \
             if this fails a dependency version changed the bit layout"
        );
    }
}
