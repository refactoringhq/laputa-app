//! Chrome-safe tooltip primitive that renders in a dedicated
//! [`WindowKind::PopUp`] window so it composites *above* sibling
//! `NSView`s of the parent window's content view — including the
//! embedded WKWebView that hosts the editor.
//!
//! # Why a separate window?
//!
//! Tolaria's editor surface is a `WKWebView` mounted as a sibling
//! `NSView` of GPUI's content view (ADR-0115 §6).  GPUI draws into a
//! `CAMetalLayer` on *its* sibling view, so any GPUI overlay — including
//! `gpui_component`'s in-window tooltip — paints into that Metal layer.
//! When the tooltip's bounding rectangle overlaps the WKWebView's frame,
//! the WebView's pixels win the z-order fight and the tooltip is hidden.
//!
//! `WindowKind::PopUp` opens a new `NSPanel` at `NSPopUpWindowLevel`
//! (`gpui_macos/src/window.rs:719,908`) — a *different* window entirely,
//! whose level sits above all `NSNormalWindowLevel` content including
//! our parent window's NSView hierarchy.  Compositing happens at the
//! WindowServer level rather than within a single window's view tree,
//! so the WKWebView z-order ceases to matter.
//!
//! # MVP scope
//!
//! Worklist 2.4 (phase-8-issues.md).  This commit migrates the three
//! tooltip sites in `note_item::note_toolbar` only — the toolbar
//! borders the WebView, so its tooltips are the ones currently being
//! occluded.  Status-bar / sidebar / note-list / title-bar tooltips
//! keep `gpui_component`'s inline `.tooltip(…)` for now; they don't
//! border the WebView and we'll fan out once the user validates the
//! new primitive.
//!
//! # Lifecycle (worklist 2.28 — cached panel)
//!
//! A single process-global `NSPanel` is allocated on the first hover
//! and **reused** for every subsequent hover.  Hover-enter on a warm
//! cache updates the cached entity's text, repositions the panel via
//! `NSWindow::setFrameTopLeftPoint:`, and re-orders it onto screen with
//! `NSWindow::orderFront:`.  Hover-exit hides via `NSWindow::orderOut:`
//! without destroying the panel.  Allocating the panel + Metal renderer
//! is the slow path (~50–200 ms on first hover); the cache reduces every
//! subsequent hover-to-paint to the cost of a redraw (~5–20 ms).
//!
//! If the cached handle is stale (window destroyed externally) the warm
//! path's `update` returns `Err`, we clear the slot, and fall through to
//! a cold reopen.  There is intentionally **no** hover-delay timer in
//! the MVP; macOS' ~500 ms feel can be added once we have a stable
//! surface to tune.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{
    div, point, px, App, AppContext, Bounds, Context, IntoElement, ParentElement, Pixels, Point,
    Render, SharedString, Size, StatefulInteractiveElement, Styled, Window,
    WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowKind, WindowOptions,
};
use gpui_component::{ActiveTheme, ElementExt};

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

/// Default popup width in logical points.  Picked to match the typical
/// gpui_component tooltip width and wide enough for "Show in Organized
/// view" without wrapping.
///
/// TODO(overlay-tooltip-autosize): measure the rendered body and shrink
/// the window to fit instead of pinning a width.
const TOOLTIP_WIDTH_PT: f32 = 200.0;

/// Default popup height in logical points.  Accommodates a single line
/// of `text_sm` with `py_0p5`.
///
/// TODO(overlay-tooltip-autosize): see [`TOOLTIP_WIDTH_PT`].
const TOOLTIP_HEIGHT_PT: f32 = 28.0;

/// Vertical gap between the trigger's bottom edge and the popup's top
/// edge, in logical points.
const TOOLTIP_GAP_PT: f32 = 4.0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Attach a chrome-safe tooltip to any
/// [`StatefulInteractiveElement`] that can host children.
///
/// The tooltip body renders in a separate [`WindowKind::PopUp`] window
/// so it composites above any sibling `NSView` of the parent window —
/// including the embedded `WKWebView`.  See the module docs for the
/// z-order rationale.
pub trait OverlayTooltipExt: Sized {
    /// Attach a chrome-safe tooltip to `self`.
    ///
    /// `text` is rendered as a single-line `text_sm` body matching the
    /// `gpui_component::Tooltip` visual.  The first hover allocates the
    /// process-global popup window; every subsequent hover reuses it
    /// (worklist 2.28).
    fn overlay_tooltip(self, text: impl Into<SharedString>) -> Self;
}

impl<E> OverlayTooltipExt for E
where
    E: StatefulInteractiveElement + ParentElement + 'static,
{
    fn overlay_tooltip(self, text: impl Into<SharedString>) -> Self {
        let text: SharedString = text.into();
        let trigger_bounds: Rc<Cell<Bounds<Pixels>>> = Rc::new(Cell::new(Bounds::default()));
        let bounds_writer = trigger_bounds.clone();

        self.on_prepaint(move |bounds, _, _| {
            bounds_writer.set(bounds);
        })
        .on_hover(move |hovered, window, cx| {
            if *hovered {
                let parent_bounds = window.bounds();
                let trigger = trigger_bounds.get();
                let origin = position_overlay(
                    parent_bounds,
                    trigger,
                    Size {
                        width: px(TOOLTIP_WIDTH_PT),
                        height: px(TOOLTIP_HEIGHT_PT),
                    },
                    px(TOOLTIP_GAP_PT),
                );
                show_overlay(text.clone(), origin, cx);
            } else {
                hide_overlay(cx);
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Lifecycle — cached NSPanel (worklist 2.28)
// ---------------------------------------------------------------------------

/// Process-global slot holding the cached overlay window and its
/// visibility state.
///
/// `window` is `Some` once the first hover has paid the cold-open cost;
/// thereafter it survives until the App exits.  `visible` mirrors our
/// own `orderFront:` / `orderOut:` calls so we can short-circuit the
/// duplicate hover-enter events that some platforms deliver.
#[derive(Default)]
struct OverlayTooltipState {
    window: Option<WindowHandle<OverlayTooltipView>>,
    visible: bool,
}

impl gpui::Global for OverlayTooltipState {}

fn show_overlay(text: SharedString, origin: Point<Pixels>, cx: &mut App) {
    let bounds = Bounds {
        origin,
        size: Size {
            width: px(TOOLTIP_WIDTH_PT),
            height: px(TOOLTIP_HEIGHT_PT),
        },
    };

    let cached = cx
        .try_global::<OverlayTooltipState>()
        .and_then(|state| state.window);

    if let Some(handle) = cached {
        let update_result = handle.update(cx, |view, window, cx| {
            view.text = text.clone();
            cx.notify();
            reposition_overlay_window(window, bounds);
            set_overlay_window_visible(window, true);
        });
        match update_result {
            Ok(()) => {
                cx.set_global(OverlayTooltipState {
                    window: Some(handle),
                    visible: true,
                });
            }
            Err(err) => {
                // Cached handle is stale — the window was destroyed
                // externally (e.g. App shutdown teardown re-entered our
                // global).  Clear and fall through to the cold path.
                log::debug!("overlay_tooltip: cached window stale ({err:#}); reopening");
                cx.set_global(OverlayTooltipState::default());
                open_cold(text, bounds, cx);
            }
        }
        return;
    }

    open_cold(text, bounds, cx);
}

fn open_cold(text: SharedString, bounds: Bounds<Pixels>, cx: &mut App) {
    let options = WindowOptions {
        kind: WindowKind::PopUp,
        titlebar: None,
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        focus: false,
        show: true,
        is_movable: false,
        is_resizable: false,
        is_minimizable: false,
        window_background: WindowBackgroundAppearance::Transparent,
        ..Default::default()
    };

    match cx.open_window(options, move |_window, cx| {
        cx.new(|_| OverlayTooltipView { text })
    }) {
        Ok(handle) => {
            cx.set_global(OverlayTooltipState {
                window: Some(handle),
                visible: true,
            });
        }
        Err(err) => {
            log::warn!("overlay_tooltip: failed to open popup window: {err:#}");
        }
    }
}

fn hide_overlay(cx: &mut App) {
    let Some(state) = cx.try_global::<OverlayTooltipState>() else {
        return;
    };
    let Some(handle) = state.window else {
        return;
    };
    if !state.visible {
        return;
    }

    let update_result = handle.update(cx, |_, window, _| {
        set_overlay_window_visible(window, false);
    });

    match update_result {
        Ok(()) => {
            cx.set_global(OverlayTooltipState {
                window: Some(handle),
                visible: false,
            });
        }
        Err(err) => {
            // Cached handle dead — drop it so the next show does a cold
            // open instead of trying to update a phantom.
            log::debug!("overlay_tooltip: cached window stale on hide ({err:#}); clearing");
            cx.set_global(OverlayTooltipState::default());
        }
    }
}

// ---------------------------------------------------------------------------
// Platform glue — repositioning and visibility
// ---------------------------------------------------------------------------
//
// GPUI's `Window` exposes a getter for the window's screen bounds
// (`window.bounds()`) but no public setter, and no `set_visible` / `hide` /
// `show`.  For the cache we need both: move the panel to the new
// trigger location, and hide / show without destroying the NSPanel.  We
// reach into the underlying `NSWindow` via `raw_window_handle::HasWindowHandle`
// (already implemented by `gpui::Window` on macOS) and call
// `setFrameTopLeftPoint:` + `orderFront:` / `orderOut:` directly.
//
// The y-axis math mirrors `gpui_macos/src/window.rs:753-758` where the
// initial `NSRect` is constructed: AppKit screen coordinates have y
// growing UP from the screen's bottom edge, so we flip our top-down
// logical `bounds.origin.y` against the current screen's height.

#[cfg(target_os = "macos")]
fn reposition_overlay_window(window: &Window, bounds: Bounds<Pixels>) {
    macos::reposition(window, bounds);
}

#[cfg(target_os = "macos")]
fn set_overlay_window_visible(window: &Window, visible: bool) {
    macos::set_visible(window, visible);
}

// Non-macOS stubs — the overlay primitive is macOS-only (it exists to
// route around the WKWebView NSView z-order which is intrinsically an
// AppKit concept).  Other platforms fall back to GPUI's open-and-close
// flow without the cache benefit; not relevant for Phase 8.
#[cfg(not(target_os = "macos"))]
fn reposition_overlay_window(_window: &Window, _bounds: Bounds<Pixels>) {}

#[cfg(not(target_os = "macos"))]
fn set_overlay_window_visible(_window: &Window, _visible: bool) {}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos {
    use super::*;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow};
    use objc2_foundation::{NSPoint, NSSize};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    /// Resolve the underlying `NSWindow` from the GPUI `Window`.
    ///
    /// Returns `None` if the handle is not AppKit-typed (defensive — on
    /// macOS it always is) or if the `NSView` retain failed (only
    /// possible if the view was just torn down, in which case the
    /// caller's `WindowHandle::update` would already have errored).
    ///
    /// # Safety
    ///
    /// The returned `Retained<NSWindow>` is valid for the duration of
    /// the caller's stack frame: GPUI guarantees the `Window` reference
    /// is live for the closure body, which transitively keeps the
    /// `NSView` (and therefore its `window`) alive.
    unsafe fn ns_window(window: &Window) -> Option<Retained<NSWindow>> {
        // `gpui::Window` exposes two `window_handle` methods with
        // identical names: an inherent `fn window_handle(&self) ->
        // AnyWindowHandle` and the trait impl `HasWindowHandle::window_handle(&self)
        // -> Result<raw_window_handle::WindowHandle, HandleError>`.
        // Disambiguate via UFCS so we get the raw-handle variant.
        let raw = <Window as HasWindowHandle>::window_handle(window).ok()?;
        let RawWindowHandle::AppKit(appkit) = raw.as_raw() else {
            return None;
        };
        let ns_view_ptr: *mut NSView = appkit.ns_view.as_ptr().cast();
        let ns_view = unsafe { Retained::retain(ns_view_ptr) }?;
        ns_view.window()
    }

    /// Reposition the panel so its top-left corner lands at
    /// `bounds.origin` in screen coordinates (top-down logical points,
    /// matching `Window::bounds()`).
    ///
    /// Mirrors the y-flip in `gpui_macos/src/window.rs:753-758`: AppKit
    /// reports `NSScreen::frame()` with y growing UP from the primary
    /// screen's bottom edge, so we subtract our top-down y from the
    /// current screen's height.
    pub(super) fn reposition(window: &Window, bounds: Bounds<Pixels>) {
        // SAFETY: ns_window only walks AppKit pointers that GPUI keeps
        // alive for the duration of this call; all selectors below are
        // main-thread-safe NSWindow methods with no aliasing concerns.
        unsafe {
            let Some(ns_window) = ns_window(window) else {
                return;
            };
            let Some(screen) = ns_window.screen() else {
                // Window is off all screens (rare — usually means it's
                // hidden).  Skip; the next show on a live screen will
                // re-set the frame.
                return;
            };
            let screen_frame = screen.frame();
            let top_left = NSPoint {
                x: screen_frame.origin.x + bounds.origin.x.as_f32() as f64,
                y: screen_frame.origin.y + screen_frame.size.height
                    - bounds.origin.y.as_f32() as f64,
            };
            ns_window.setFrameTopLeftPoint(top_left);
            // Resize the content rect so the popup matches the cached
            // dimensions even if `TOOLTIP_*` constants change between
            // hovers (they don't today, but the call is idempotent and
            // cheap).
            ns_window.setContentSize(NSSize {
                width: bounds.size.width.as_f32() as f64,
                height: bounds.size.height.as_f32() as f64,
            });
        }
    }

    /// Show or hide the panel without destroying it.
    ///
    /// `orderFront:` re-attaches it at its existing window level
    /// (`NSPopUpWindowLevel`, set on construction by GPUI); `orderOut:`
    /// detaches without releasing the NSPanel or its CAMetalLayer.
    pub(super) fn set_visible(window: &Window, visible: bool) {
        // SAFETY: see `reposition`.
        unsafe {
            let Some(ns_window) = ns_window(window) else {
                return;
            };
            if visible {
                ns_window.orderFront(None);
            } else {
                ns_window.orderOut(None);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Popup view
// ---------------------------------------------------------------------------

/// The single-text-line entity rendered as the popup window's root.
///
/// Visual is intentionally aligned with `gpui_component::Tooltip`'s
/// `Render` impl (popover bg, border, shadow_md, rounded 6 pt,
/// `py_0p5` / `px_2`, `text_sm`) so the new overlay surface feels
/// continuous with the in-window tooltips that other chrome crates
/// still use.
struct OverlayTooltipView {
    text: SharedString,
}

impl Render for OverlayTooltipView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        div()
            .font_family(theme.font_family.clone())
            .bg(theme.popover)
            .text_color(theme.popover_foreground)
            .border_1()
            .border_color(theme.border)
            .shadow_md()
            .rounded(px(6.0))
            .py_0p5()
            .px_2()
            .text_sm()
            .child(self.text.clone())
    }
}

// ---------------------------------------------------------------------------
// Position math (unit-testable)
// ---------------------------------------------------------------------------

/// Compute the screen-coordinate origin for a popup of `tooltip_size`
/// anchored against `trigger` (which is in *window-local* logical
/// points) inside a window whose `parent_bounds` is in screen
/// coordinates.
///
/// GPUI's macOS backend stores window bounds in logical points already
/// (see `gpui_macos/src/window.rs:753-763` — the constructor converts
/// physical→logical when wiring `NSWindow`'s screen rect), so no
/// DPI conversion happens here.  Platforms that report physical pixels
/// would need a `scale_factor` argument re-added at this seam — leave
/// the comment as a breadcrumb.
///
/// Placement (worklist 2.30): prefer **above** the trigger so chrome
/// header buttons (note-list Sort, the Add `+` glyph, search) don't
/// drop their tooltip into the content rows below.  This mirrors
/// macOS-native tooltips and `gpui_component::Tooltip`'s auto-pick
/// algorithm.  Falls back to below when there isn't enough room
/// above (e.g. a trigger in the very top of the title bar).
///
/// The popup is horizontally centred on the trigger and offset `gap`
/// points away on whichever axis is chosen.
fn position_overlay(
    parent_bounds: Bounds<Pixels>,
    trigger: Bounds<Pixels>,
    tooltip_size: Size<Pixels>,
    gap: Pixels,
) -> Point<Pixels> {
    let x =
        parent_bounds.origin.x + trigger.origin.x + (trigger.size.width - tooltip_size.width) / 2.0;

    // Above placement: tooltip's bottom sits `gap` above the trigger
    // top.  Local-y origin = trigger.top - gap - tooltip.height.
    let above_local_y = trigger.origin.y - tooltip_size.height - gap;
    // Below placement: tooltip's top sits `gap` below the trigger
    // bottom.  Local-y origin = trigger.bottom + gap.
    let below_local_y = trigger.origin.y + trigger.size.height + gap;

    // Pick above when the tooltip's full height fits within the
    // window's content area.  Use trigger-local y because that's the
    // coordinate space `position_overlay` reasons in — the +
    // `parent_bounds.origin.y` final shift maps back to screen coords.
    let local_y = if above_local_y >= Pixels::ZERO {
        above_local_y
    } else {
        below_local_y
    };

    let y = parent_bounds.origin.y + local_y;
    point(x, y)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Trigger with enough room above (40 pt > 28 + 4) — popup origin
    /// should land centred horizontally and rise *above* the trigger's
    /// top edge (worklist 2.30 placement change).
    #[test]
    fn position_overlay_centres_and_drops_above_trigger() {
        let parent = Bounds {
            origin: point(px(100.0), px(50.0)),
            size: Size {
                width: px(800.0),
                height: px(600.0),
            },
        };
        let trigger = Bounds {
            origin: point(px(40.0), px(40.0)),
            size: Size {
                width: px(24.0),
                height: px(24.0),
            },
        };
        let tooltip = Size {
            width: px(200.0),
            height: px(28.0),
        };
        let gap = px(4.0);

        let origin = position_overlay(parent, trigger, tooltip, gap);

        // x = 100 + 40 + (24 - 200) / 2 = 100 + 40 + (-88) = 52
        assert_eq!(origin.x, px(52.0));
        // y = 50 + (40 - 28 - 4) = 50 + 8 = 58 — Above placement.
        assert_eq!(origin.y, px(58.0));
    }

    /// Trigger at the very top of the window (no room above) — fall
    /// back to Below placement so the tooltip stays on-screen.
    #[test]
    fn position_overlay_falls_back_to_below_when_no_room_above() {
        let parent = Bounds {
            origin: point(px(100.0), px(50.0)),
            size: Size {
                width: px(800.0),
                height: px(600.0),
            },
        };
        let trigger = Bounds {
            origin: point(px(40.0), px(8.0)),
            size: Size {
                width: px(24.0),
                height: px(24.0),
            },
        };
        let tooltip = Size {
            width: px(200.0),
            height: px(28.0),
        };
        let gap = px(4.0);

        let origin = position_overlay(parent, trigger, tooltip, gap);

        // above_local_y = 8 - 28 - 4 = -24 (< 0 → fall back to Below)
        // y = 50 + 8 + 24 + 4 = 86
        assert_eq!(origin.y, px(86.0));
    }

    /// Toolbar-cell case from `note_toolbar.rs`: 24×24 cell near the
    /// right edge of a 1516×1052 window positioned at (200, 120).
    /// Spot-check that the result is plausible — popup origin lies
    /// within the parent window's horizontal span.
    #[test]
    fn position_overlay_stays_within_parent_horizontal_span() {
        let parent = Bounds {
            origin: point(px(200.0), px(120.0)),
            size: Size {
                width: px(1516.0),
                height: px(1052.0),
            },
        };
        let trigger = Bounds {
            origin: point(px(1400.0), px(40.0)),
            size: Size {
                width: px(24.0),
                height: px(24.0),
            },
        };
        let tooltip = Size {
            width: px(200.0),
            height: px(28.0),
        };

        let origin = position_overlay(parent, trigger, tooltip, px(4.0));

        // The popup may overhang the parent on the right edge; we just
        // assert it isn't placed completely off-screen left.
        assert!(origin.x >= parent.origin.x, "popup x={:?}", origin.x);
        // Trigger top is at 40 pt with 28 pt + 4 pt of room above
        // available (above_local_y = 40 - 28 - 4 = 8 ≥ 0), so the
        // popup picks Above placement.  Worklist 2.30 placement change.
        assert_eq!(
            origin.y,
            parent.origin.y + trigger.origin.y - tooltip.height - px(4.0),
        );
    }

    /// Tooltip wider than the trigger — the centring math produces a
    /// negative half-width, so the popup origin lands *left* of the
    /// trigger's left edge.
    #[test]
    fn position_overlay_centres_when_tooltip_wider_than_trigger() {
        let parent = Bounds {
            origin: point(px(0.0), px(0.0)),
            size: Size {
                width: px(400.0),
                height: px(300.0),
            },
        };
        let trigger = Bounds {
            origin: point(px(150.0), px(20.0)),
            size: Size {
                width: px(50.0),
                height: px(20.0),
            },
        };
        let tooltip = Size {
            width: px(200.0),
            height: px(28.0),
        };

        let origin = position_overlay(parent, trigger, tooltip, px(4.0));

        // x = 0 + 150 + (50 - 200) / 2 = 150 - 75 = 75
        assert_eq!(origin.x, px(75.0));
        // y = 0 + 20 + 20 + 4 = 44
        assert_eq!(origin.y, px(44.0));
    }

    /// Cache invariant: after a `Default` `OverlayTooltipState`, the
    /// window slot is empty and `visible` is `false`.  Trivially
    /// asserted but worth pinning so a future struct refactor doesn't
    /// silently change the empty-state semantics that `hide_overlay`
    /// short-circuits on.
    #[test]
    fn overlay_tooltip_state_default_is_empty_and_hidden() {
        let state = OverlayTooltipState::default();
        assert!(state.window.is_none());
        assert!(!state.visible);
    }
}
