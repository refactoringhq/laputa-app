//! Custom title-bar strip view for `TolariaWorkspace` (ADR-0115 Phase 7.8).
//!
//! Renders a 34-pt horizontal strip pinned above the workspace main row.
//! The strip grows with the user's UI font scale via
//! `(rem_size * TITLE_BAR_REM_SCALE).max(px(NATIVE_TITLE_BAR_HEIGHT_PT))`.
//! Native macOS traffic lights are pinned to `(9, 9)` via
//! `TitlebarOptions::traffic_light_position`; the strip reserves
//! `TRAFFIC_LIGHTS_PADDING_PT` (71 pt) so the action cluster never
//! overlaps them.  See `zed-title-bar-analysis.md` section 5 for the
//! full Zed-matching spec.  The strip draws:
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
use gpui_component::{tooltip::Tooltip, ActiveTheme, IconName};
use ui::tree_dump::DumpAsExt as _;

use crate::workspace::NATIVE_TITLE_BAR_HEIGHT_PT;

/// Horizontal padding (in pts) reserved on the left of the title-bar
/// strip so the macOS traffic-light buttons (close / minimise /
/// maximise) sit cleanly without overlapping our own controls.
///
/// Mirrors Zed's `TRAFFIC_LIGHT_PADDING` constant
/// (`crates/ui/src/utils/constants.rs:8-12`):
/// - 71 pt on pre-Tahoe macOS SDKs.
/// - 78 pt on macOS SDK 26 (Tahoe) — the extra 7 pt comes from the
///   1-px border around the window frame on that SDK.
///
/// TODO: bump to 78 on Tahoe behind `#[cfg(macos_sdk_26)]` once we
/// target that SDK.
pub const TRAFFIC_LIGHTS_PADDING_PT: f32 = 71.0;

/// Multiplier on `Window::rem_size()` for the dynamic strip height.
///
/// Mirrors Zed's `platform_title_bar_height` formula
/// (`crates/ui/src/utils/constants.rs:19-21`): at the default 16-pt rem
/// this yields `1.75 * 16 = 28`, then `max`-clamped up to
/// `NATIVE_TITLE_BAR_HEIGHT_PT` (34 pt).  The clamp only kicks in
/// below ~19.43 rem-pt; at larger font scales the strip grows
/// linearly.
const TITLE_BAR_REM_SCALE: f32 = 1.75;

/// Custom title-bar strip view for `TolariaWorkspace`.
///
/// Mostly a visual surface — most cells are still log-only stubs.
/// The sidebar toggle (visual-issue #020) is the first wired action:
/// clicking it dispatches [`actions::ToggleSidebar`] so the menu, the
/// keymap accelerator, and this button all funnel through one
/// handler (worklist 3.2).  Wire-up for the remaining cells lands
/// alongside the Phase 8 modal-chrome work (command palette, quick
/// open, …).
#[derive(Default)]
pub struct TitleBar;

impl TitleBar {
    /// Build a fresh title bar.
    ///
    /// Worklist 3.2 — the sidebar toggle button dispatches
    /// [`actions::ToggleSidebar`] via `cx.dispatch_action`, so the
    /// title bar no longer needs to cache a dock handle.  The
    /// constructor is kept as a thin alias for `Default::default` so
    /// `cx.new(|_| TitleBar::new())` reads idiomatically alongside
    /// the other entity constructors in this crate.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Render for TitleBar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        // Anchor on the sidebar palette so the strip blends with the
        // dock chrome immediately below it in both modes.
        let bg = theme.sidebar;
        let fg = theme.muted_foreground;
        let border = theme.border;

        // Dynamic height: mirrors Zed's `platform_title_bar_height`
        // (`crates/ui/src/utils/constants.rs:19-21`).  At the default
        // 16-pt rem this is `max(28, 34) = 34`; the strip grows with
        // the user's UI font scale.  The static fallback constant
        // `NATIVE_TITLE_BAR_HEIGHT_PT` (34.0) is used by
        // `ui::tree_dump` so periscope coordinates stay in sync.
        let height = (window.rem_size() * TITLE_BAR_REM_SCALE).max(px(NATIVE_TITLE_BAR_HEIGHT_PT));

        // TODO: wire WindowControlArea::Drag on the outer div once
        // gpui exposes `window_control_area` / `titlebar_double_click`
        // in our pinned revision.  Grep: `WindowControlArea`,
        // `titlebar_double_click` — neither present in the workspace
        // today.

        // The title bar is workspace-wide chrome only.  Per-note
        // commands (favourite, organised, raw, AI, …) live on the
        // per-note toolbar in `note_item::note_toolbar` (visual-issue
        // #019); new-note creation lives on the `note_list_pane`
        // header alongside its sort + search controls.  Anything that
        // depends on the *currently open note* must not appear here.
        //
        // Sidebar toggle (visual-issue #020) lands between the macOS
        // traffic lights and the back / forward navigation cluster —
        // matching the reference's `[●●●] [▢] [←] [→]` ordering.
        //
        // Worklist 3.2 — the click dispatches `actions::ToggleSidebar`
        // (instead of calling `Dock::toggle` directly) so the menu,
        // keymap accelerator, and title-bar button all funnel through
        // the same action handler.  That handler lives in
        // `crates/tolaria/src/main.rs`; it flips the dock *and*
        // rebuilds the menu so the View entry's
        // `"Show Sidebar"` / `"Hide Sidebar"` label stays in sync.
        let toggle_sidebar = div()
            .id("title-bar-toggle-sidebar")
            .flex()
            .items_center()
            .justify_center()
            .h(px(20.0))
            .w(px(28.0))
            .rounded_sm()
            .cursor_pointer()
            .hover(|this| this.bg(gpui::hsla(0.0, 0.0, 0.5, 0.12)))
            .on_click(|_, _window, cx| {
                cx.dispatch_action(&actions::ToggleSidebar);
            })
            .tooltip(|window, cx| Tooltip::new("Toggle sidebar").build(window, cx))
            .child(IconName::PanelLeft)
            .dump_as("title-bar-toggle-sidebar")
            .into_any_element();

        let left = div()
            .flex()
            .flex_row()
            .items_center()
            // gap_0p5 = 2 px, matching Zed's left-cluster gap
            // (`crates/title_bar/src/title_bar.rs:244`).
            .gap(px(2.0))
            .child(toggle_sidebar)
            .child(title_bar_cell(
                "title-bar-back",
                IconName::ArrowLeft,
                "Go back",
            ))
            .child(title_bar_cell(
                "title-bar-forward",
                IconName::ArrowRight,
                "Go forward",
            ));

        let right = div()
            .flex()
            .flex_row()
            .items_center()
            // gap_1 = 4 px, matching Zed's right-cluster gap
            // (`crates/title_bar/src/title_bar.rs:316`).
            .gap(px(4.0))
            .child(title_bar_cell(
                "title-bar-search",
                IconName::Search,
                "Search",
            ))
            .child(title_bar_cell(
                "title-bar-language",
                IconName::Globe,
                "Language",
            ))
            .child(title_bar_cell(
                "title-bar-profile",
                IconName::CircleUser,
                "Profile",
            ));

        // Vertically centre the action clusters within the strip
        // (issue 009 / issue 016).  Traffic lights are pinned to
        // `(9, 9)` via `TitlebarOptions::traffic_light_position`;
        // `items_center` on a 34-px strip lands our 14-px icons at
        // y ≈ 10 — within ±1 px of the lights' visual centre.
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .flex_shrink_0()
            .h(height)
            .pl(px(TRAFFIC_LIGHTS_PADDING_PT))
            .pr(px(8.0))
            .bg(bg)
            .text_color(fg)
            .text_xs()
            .border_b_1()
            .border_color(border)
            .child(left)
            .child(right)
            .dump_as("workspace-title-bar")
    }
}

/// One title-bar action cell: a square click target with a single
/// [`IconName`] glyph centred inside.  Logs the action id on click —
/// Phase 8 modal-chrome work replaces the stub with the real action
/// dispatch.  `tooltip` is the hover hint shown on the cell (worklist 2.4).
fn title_bar_cell(id: &'static str, icon: IconName, tooltip: &'static str) -> AnyElement {
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
        .tooltip(move |window, cx| Tooltip::new(tooltip).build(window, cx))
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

    /// Issue 016 — Zed-matching dims.
    ///
    /// Asserts the two constants that the render tree is driven by:
    /// - Strip height floor = 34.0 pt (Zed's `platform_title_bar_height`
    ///   at default 16-pt rem; `crates/ui/src/utils/constants.rs:19-21`).
    /// - Traffic-lights leading padding = 71.0 pt (Zed's
    ///   `TRAFFIC_LIGHT_PADDING` for pre-Tahoe SDKs;
    ///   `crates/ui/src/utils/constants.rs:8-12`).
    ///
    /// These values are cross-referenced with `NATIVE_TITLE_BAR_HEIGHT_PT`
    /// in `workspace.rs` (also 34.0) so `ui::tree_dump` coordinates
    /// stay in sync.
    #[gpui::test]
    fn title_bar_zed_matching_dims(cx: &mut TestAppContext) {
        install_theme(cx);

        // Height floor must match the Zed spec and workspace constant.
        assert_eq!(
            NATIVE_TITLE_BAR_HEIGHT_PT, 34.0,
            "strip height floor must be 34 pt (Zed spec, issue 016)"
        );

        // Traffic-lights padding must match Zed's pre-Tahoe constant.
        assert_eq!(
            TRAFFIC_LIGHTS_PADDING_PT, 71.0,
            "traffic-lights padding must be 71 pt (Zed spec, issue 016)"
        );

        // The dynamic formula `(1.75 * 16).max(34) = 34` must produce
        // the same value as the static floor at default rem size.
        //
        // Exact f32 equality is intentional below: every literal here
        // (34.0, 71.0, 1.75 * 16.0 = 28.0) is exactly representable in
        // f32, so the asserts cannot suffer rounding drift.  If a
        // future change makes the multiplier non-exact (e.g. 1.7),
        // switch to `(a - b).abs() < f32::EPSILON`.
        let dynamic_at_default_rem =
            (TITLE_BAR_REM_SCALE * 16.0_f32).max(NATIVE_TITLE_BAR_HEIGHT_PT);
        assert_eq!(
            dynamic_at_default_rem, NATIVE_TITLE_BAR_HEIGHT_PT,
            "dynamic formula must equal static floor at default rem"
        );

        // Render succeeds with the new dims.
        let _window = cx.add_window(|_window, _cx| TitleBar::new());
        cx.run_until_parked();
    }
}
