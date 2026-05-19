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
    div, px, AnyElement, Context, Entity, InteractiveElement, IntoElement, ParentElement, Render,
    StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{ActiveTheme, IconName};
use ui::tree_dump::DumpAsExt as _;

use crate::dock::Dock;
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
/// clicking it flips the left dock between open and closed via
/// [`Dock::toggle`].  Wire-up for the remaining cells lands alongside
/// the Phase 8 modal-chrome work (command palette, quick open, …).
pub struct TitleBar {
    /// Dock entity the sidebar toggle button flips via [`Dock::toggle`].
    ///
    /// Held by *role* rather than *position* — today the sidebar lives
    /// in the workspace's left dock, but if a future setting parks the
    /// sidebar in the right dock instead, this field still points at
    /// "the thing the sidebar button toggles" without any rename.
    /// Holding the entity directly keeps the click-to-action path
    /// inside the workspace crate — no extra `Action` trip and no
    /// `Global` lookup.
    sidebar_toggle_target: Entity<Dock>,
}

impl TitleBar {
    /// Build a fresh title bar bound to the dock the sidebar button
    /// should toggle.
    ///
    /// The dock entity is cached so the sidebar toggle (visual-issue
    /// #020) can dispatch the toggle in one `update` call without a
    /// workspace round-trip.
    #[must_use]
    pub fn new(sidebar_toggle_target: Entity<Dock>) -> Self {
        Self {
            sidebar_toggle_target,
        }
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
        // `Entity<Dock>` is a cheap refcounted handle; cloning into
        // the `on_click` closure is the idiomatic GPUI pattern for
        // entity wiring.
        let sidebar_toggle_target = self.sidebar_toggle_target.clone();
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
            .on_click(move |_, _window, cx| {
                sidebar_toggle_target.update(cx, |dock, cx| dock.toggle(cx));
            })
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
            .child(title_bar_cell("title-bar-back", IconName::ArrowLeft))
            .child(title_bar_cell("title-bar-forward", IconName::ArrowRight));

        let right = div()
            .flex()
            .flex_row()
            .items_center()
            // gap_1 = 4 px, matching Zed's right-cluster gap
            // (`crates/title_bar/src/title_bar.rs:316`).
            .gap(px(4.0))
            .child(title_bar_cell("title-bar-search", IconName::Search))
            .child(title_bar_cell("title-bar-language", IconName::Globe))
            .child(title_bar_cell("title-bar-profile", IconName::CircleUser));

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
    use crate::panel::{DockPosition, Panel};
    use gpui::{px, App, AppContext as _, Entity, IntoElement, Pixels, Render, TestAppContext};

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// Build a fresh empty `Dock` entity for tests that need to
    /// construct a `TitleBar`.  Dock starts in `DockState::Empty` —
    /// `Dock::toggle` is a no-op on Empty, so tests that want
    /// round-trip semantics attach the local `ToggleFixturePanel` via
    /// [`attach_fixture`] first.
    fn fresh_left_dock(cx: &mut TestAppContext) -> Entity<Dock> {
        cx.update(|cx| cx.new(|_| Dock::new(DockPosition::Left)))
    }

    /// Minimal `Panel` impl used by `title_bar_left_dock_toggle_round_trip`
    /// to give `Dock::toggle` a non-Empty state to flip.  Local to this
    /// module so the title-bar tests don't depend on the `MockPanel`
    /// defined inside `lib.rs::tests`.
    struct ToggleFixturePanel;

    impl Render for ToggleFixturePanel {
        fn render(
            &mut self,
            _window: &mut gpui::Window,
            _cx: &mut Context<Self>,
        ) -> impl IntoElement {
            gpui::div()
        }
    }

    impl Panel for ToggleFixturePanel {
        fn persistent_name(&self) -> &str {
            "ToggleFixturePanel"
        }

        fn panel_key(&self) -> &str {
            "toggle-fixture"
        }

        fn position(&self, _cx: &App) -> DockPosition {
            DockPosition::Left
        }

        fn set_position(&mut self, _position: DockPosition, _cx: &mut Context<Self>) {}

        fn default_size(&self, _cx: &App) -> Pixels {
            px(200.0)
        }

        fn toggle_action(&self) -> Box<dyn gpui::Action> {
            Box::new(actions::ToggleSidebar)
        }

        fn starts_open(&self, _cx: &App) -> bool {
            false
        }
    }

    /// Attach a `ToggleFixturePanel` to `dock` so the next `toggle`
    /// call has a non-Empty state to flip between Open and Closed.
    fn attach_fixture(cx: &mut TestAppContext, dock: &Entity<Dock>) {
        cx.update(|cx| {
            let panel = cx.new(|_| ToggleFixturePanel);
            dock.update(cx, |d, cx| d.set_panel(panel, cx));
        });
    }

    /// The title bar must render without panicking with the theme
    /// global installed.
    #[gpui::test]
    fn title_bar_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let dock = fresh_left_dock(cx);
        let _window = cx.add_window(|_window, _cx| TitleBar::new(dock));
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
        let dock = fresh_left_dock(cx);
        let _window = cx.add_window(|_window, _cx| TitleBar::new(dock));
        cx.run_until_parked();
    }

    /// Issue 020 — the sidebar toggle button must flip the left dock's
    /// open/closed state on each click.  The button's `on_click` calls
    /// `Dock::toggle` directly via the cached entity; this test
    /// exercises the same call path to document the round-trip
    /// contract (Empty → Open → Closed → Open …).  A real click
    /// would need an `id`-resolved hit-test through the GPUI test
    /// harness, but the round-trip via `Dock::toggle` is the
    /// load-bearing behaviour: the toggle cell carries no extra
    /// logic of its own.
    #[gpui::test]
    fn title_bar_left_dock_toggle_round_trip(cx: &mut TestAppContext) {
        install_theme(cx);
        let dock = fresh_left_dock(cx);
        // Empty dock is closed by construction.
        assert!(
            !cx.update(|cx| dock.read(cx).is_open()),
            "empty dock starts closed"
        );

        // Attaching `ToggleFixturePanel` (`starts_open == false`) must
        // honour the panel's preference — i.e. the dock stays closed.
        attach_fixture(cx, &dock);
        assert!(
            !cx.update(|cx| dock.read(cx).is_open()),
            "fixture with starts_open=false leaves the dock closed"
        );

        // Two toggles must flip the dock open then closed again.
        cx.update(|cx| dock.update(cx, |d, cx| d.toggle(cx)));
        assert!(
            cx.update(|cx| dock.read(cx).is_open()),
            "first toggle opens the dock"
        );
        cx.update(|cx| dock.update(cx, |d, cx| d.toggle(cx)));
        assert!(
            !cx.update(|cx| dock.read(cx).is_open()),
            "second toggle closes the dock again"
        );

        // Render still succeeds after the dock has toggled state.
        let _window = cx.add_window(|_window, _cx| TitleBar::new(dock));
        cx.run_until_parked();
    }
}
