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
//! # Lifecycle
//!
//! Hover-enter opens a fresh popup window; hover-exit closes it.
//! Only one tooltip is open at a time — a global slot
//! ([`OverlayTooltipState`]) holds the current `AnyWindowHandle` and
//! any new show closes the previous one first.  There is intentionally
//! **no** hover-delay timer in the MVP; macOS' ~500 ms feel can be
//! added once we have a stable surface to tune.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{
    div, point, px, AnyWindowHandle, App, AppContext, Bounds, Context, IntoElement, ParentElement,
    Pixels, Point, Render, SharedString, Size, StatefulInteractiveElement, Styled, Window,
    WindowBackgroundAppearance, WindowBounds, WindowKind, WindowOptions,
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
    /// `gpui_component::Tooltip` visual.  The window opens on hover-enter
    /// and closes on hover-exit; only one overlay tooltip is open at a
    /// time.
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
// Lifecycle
// ---------------------------------------------------------------------------

/// Global slot holding the currently visible overlay window, if any.
///
/// Stored as a `gpui::Global` so `show_overlay` / `hide_overlay` can
/// reach the previous handle from any callback without threading
/// state through the call sites.
#[derive(Default)]
struct OverlayTooltipState {
    current: Option<AnyWindowHandle>,
}

impl gpui::Global for OverlayTooltipState {}

fn show_overlay(text: SharedString, origin: Point<Pixels>, cx: &mut App) {
    // Close any previously-open tooltip before opening a new one — we
    // only want a single overlay floating at once.
    hide_overlay(cx);

    let bounds = Bounds {
        origin,
        size: Size {
            width: px(TOOLTIP_WIDTH_PT),
            height: px(TOOLTIP_HEIGHT_PT),
        },
    };

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
                current: Some(handle.into()),
            });
        }
        Err(err) => {
            log::warn!("overlay_tooltip: failed to open popup window: {err:#}");
        }
    }
}

fn hide_overlay(cx: &mut App) {
    let Some(handle) = cx
        .try_global::<OverlayTooltipState>()
        .and_then(|state| state.current)
    else {
        return;
    };

    let _ = handle.update(cx, |_, window, _| window.remove_window());
    cx.set_global(OverlayTooltipState { current: None });
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
/// anchored just below `trigger` (which is in *window-local* logical
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
/// The popup is horizontally centred on the trigger and offset `gap`
/// points below it.
fn position_overlay(
    parent_bounds: Bounds<Pixels>,
    trigger: Bounds<Pixels>,
    tooltip_size: Size<Pixels>,
    gap: Pixels,
) -> Point<Pixels> {
    let x =
        parent_bounds.origin.x + trigger.origin.x + (trigger.size.width - tooltip_size.width) / 2.0;
    let y = parent_bounds.origin.y + trigger.origin.y + trigger.size.height + gap;
    point(x, y)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Trigger centred horizontally inside the parent window — popup
    /// origin should land at `parent_x + (trigger_x + (trigger_w -
    /// tooltip_w) / 2)` and just below the trigger's bottom edge.
    #[test]
    fn position_overlay_centres_and_drops_below_trigger() {
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

        // x = 100 + 40 + (24 - 200) / 2 = 100 + 40 + (-88) = 52
        assert_eq!(origin.x, px(52.0));
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
        assert_eq!(
            origin.y,
            parent.origin.y + trigger.origin.y + trigger.size.height + px(4.0),
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
}
