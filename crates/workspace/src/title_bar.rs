//! Custom title-bar strip view for `TolariaWorkspace` (ADR-0115 Phase 7.8).
//!
//! Renders a 28-pt horizontal strip pinned above the workspace main
//! row.  Native macOS traffic lights remain in their default position
//! (top-left); the strip reserves space for them, then draws:
//!
//! - **Left cluster** — back / forward / new-note triplet, mirroring
//!   the Tauri-era `SidebarTopNav` action group.
//! - **Right cluster** — search, star, lock, language, more, profile,
//!   mirroring the React title-bar action cluster.
//!
//! The strip itself is the macOS draggable region (window movement
//! via click-and-drag works anywhere the strip is exposed); each
//! action cell is an `id()`-tagged element so periscope can target it
//! by name.  Wiring the buttons to real actions is deferred to the
//! Phase 8 modal-chrome work — every action currently logs and
//! returns, so clicking is harmless.

use gpui::{
    div, px, AnyElement, Context, InteractiveElement, IntoElement, ParentElement, Render,
    StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{ActiveTheme, IconName};
use ui::tree_dump::DumpAsExt as _;

use crate::workspace::NATIVE_TITLE_BAR_HEIGHT_PT;

/// Horizontal padding (in pts) reserved on the left of the title-bar
/// strip so the macOS traffic-light buttons (close / minimise /
/// maximise) sit cleanly without overlapping our own controls.  The
/// default `traffic_light_position` places the leftmost button at
/// `(7, 6)` with each button ~12pt wide and 6pt apart, so the third
/// light's right edge sits near 60pt — round up to 72pt for breathing
/// room.
pub const TRAFFIC_LIGHTS_PADDING_PT: f32 = 72.0;

/// Custom title-bar strip view for `TolariaWorkspace`.
///
/// Pure visual surface: every cell is currently a log-only stub.
/// Wire-up to real actions lands alongside the Phase 8 modal-chrome
/// work (command palette, quick open, …) so the title bar can finally
/// dispatch them.
pub struct TitleBar;

impl TitleBar {
    /// Build a fresh title bar instance.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Default for TitleBar {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for TitleBar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        // Anchor on the sidebar palette so the strip blends with the
        // dock chrome immediately below it in both modes.
        let bg = theme.sidebar;
        let fg = theme.muted_foreground;
        let border = theme.border;

        let left = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(2.0))
            .child(title_bar_cell("title-bar-back", IconName::ArrowLeft))
            .child(title_bar_cell("title-bar-forward", IconName::ArrowRight))
            .child(title_bar_cell("title-bar-new-note", IconName::Plus));

        let right = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(2.0))
            .child(title_bar_cell("title-bar-search", IconName::Search))
            .child(title_bar_cell("title-bar-star", IconName::Star))
            .child(title_bar_cell("title-bar-language", IconName::Globe))
            .child(title_bar_cell("title-bar-more", IconName::Ellipsis))
            .child(title_bar_cell("title-bar-profile", IconName::CircleUser));

        // Vertically centre the action clusters within the strip
        // proper (issue 009).  The macOS traffic lights are pinned
        // to the system titlebar region near the top of the window;
        // matching their position would force the action cluster up
        // and leave a tall empty band below.  Following the user's
        // direction we keep the lights where the OS draws them and
        // centre our own clusters in the strip.
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .flex_shrink_0()
            .h(px(NATIVE_TITLE_BAR_HEIGHT_PT))
            .pl(px(TRAFFIC_LIGHTS_PADDING_PT))
            .pr(px(8.0))
            .bg(bg)
            .text_color(fg)
            .text_xs()
            .border_b_1()
            .border_color(border)
            .child(left)
            .child(right)
    }
}

/// One title-bar action cell: a square click target with a single
/// [`IconName`] glyph centred inside.  Logs the action id on click —
/// Phase 8 modal-chrome work replaces the stub with the real action
/// dispatch.
fn title_bar_cell(id: &'static str, icon: IconName) -> AnyElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .h(px(20.0))
        .w(px(28.0))
        .rounded_sm()
        .cursor_pointer()
        .hover(|this| this.bg(gpui::hsla(0.0, 0.0, 0.5, 0.12)))
        .on_click(move |_, _window, _cx| {
            log::info!("title bar action stub: {id}");
        })
        .child(icon)
        .dump_as(id)
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// The title bar must render without panicking with the theme
    /// global installed.
    #[gpui::test]
    fn title_bar_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| TitleBar::new());
        cx.run_until_parked();
    }
}
