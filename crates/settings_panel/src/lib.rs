#![forbid(unsafe_code)]
//! Settings panel modal for Tolaria (ADR-0115 Phase 2d → Phase 8.14).
//!
//! Implements `workspace::ModalView` so it can be mounted into `TolariaWorkspace`
//! via `ModalLayer::toggle_modal`.
//!
//! Layout:
//! ```text
//! ┌──────────────────────────────────────────────────┐
//! │ General  │  Theme               Light             │
//! │ Editor   │  Version             1                 │
//! │ Git      │                                        │
//! │ AI       │                                        │
//! │ Vault    │                                        │
//! └──────────────────────────────────────────────────┘
//! ```
//!
//! The active tab is highlighted with the theme's `tab_active` background.
//! Each right-pane content area renders one row per known field, with
//! `field_name` on the left and the current read-only value on the right.
//! Fields that the schema does not yet expose are surfaced as a single
//! "Phase 9 wires editing" placeholder row so the panel is a faithful
//! scaffold rather than a live editor.
//!
//! # Usage
//!
//! ```rust,ignore
//! // Toggle from workspace (mock globals must be installed first):
//! cx.set_global(MockSettings::seeded());
//! workspace.toggle_modal::<SettingsPanel>(window, cx, |_w, cx| SettingsPanel::new(cx));
//! ```

use gpui::prelude::FluentBuilder;
use gpui::{
    div, px, App, Context, Div, IntoElement, ParentElement, Render, SharedString, Styled, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants},
    ActiveTheme,
};
use mock_fixtures::MockSettings;

// ---------------------------------------------------------------------------
// SettingsTab
// ---------------------------------------------------------------------------

/// A tab page shown in the [`SettingsPanel`] sidebar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsTab {
    General,
    Editor,
    Git,
    Ai,
    Vault,
}

impl SettingsTab {
    /// All tabs in display order.
    pub const ALL: &'static [Self] = &[
        Self::General,
        Self::Editor,
        Self::Git,
        Self::Ai,
        Self::Vault,
    ];

    /// Human-readable label for this tab.
    pub const fn label(self) -> &'static str {
        match self {
            Self::General => "General",
            Self::Editor => "Editor",
            Self::Git => "Git",
            Self::Ai => "AI",
            Self::Vault => "Vault",
        }
    }

    /// Stable GPUI element ID for this tab's sidebar button.
    ///
    /// Kept on the enum so that adding a new variant forces an update here,
    /// preventing the render function from drifting out of sync.
    pub const fn element_id(self) -> &'static str {
        match self {
            Self::General => "settings-tab-general",
            Self::Editor => "settings-tab-editor",
            Self::Git => "settings-tab-git",
            Self::Ai => "settings-tab-ai",
            Self::Vault => "settings-tab-vault",
        }
    }
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

/// Multi-tab settings dialog mounted into `TolariaWorkspace` via `ModalLayer`.
pub struct SettingsPanel {
    active: SettingsTab,
    settings: MockSettings,
}

impl SettingsPanel {
    /// Construct a new panel.  Reads [`MockSettings`] from the GPUI globals if
    /// installed (e.g. under `TOLARIA_MOCK=1`); otherwise falls back to
    /// [`MockSettings::default`].
    pub fn new(cx: &mut App) -> Self {
        let settings = cx.try_global::<MockSettings>().cloned().unwrap_or_default();
        Self {
            active: SettingsTab::General,
            settings,
        }
    }

    /// The currently selected tab.
    pub fn active_tab(&self) -> SettingsTab {
        self.active
    }

    /// Switch to `tab` and notify any observers.
    pub fn set_active(&mut self, tab: SettingsTab, cx: &mut Context<Self>) {
        self.active = tab;
        cx.notify();
    }

    /// The settings snapshot held by this panel.
    pub fn settings(&self) -> &MockSettings {
        &self.settings
    }
}

impl workspace::ModalView for SettingsPanel {} // marker impl — intentionally empty

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/// One row in the settings-content pane: a left-aligned field name
/// and a right-aligned value.  Pure helper — kept as a free function
/// so each tab's renderer reads as a flat list of rows.
fn settings_row(
    name: &'static str,
    value: SharedString,
    fg: gpui::Hsla,
    muted: gpui::Hsla,
) -> gpui::AnyElement {
    div()
        .flex()
        .flex_row()
        .items_center()
        .justify_between()
        .py(px(6.0))
        .text_sm()
        .child(
            div()
                .text_color(muted)
                .child(SharedString::new_static(name)),
        )
        .child(div().text_color(fg).child(value))
        .into_any_element()
}

/// Single-row note shown for a tab that hasn't been wired to an
/// editable backing store yet.  Lands as a Phase 9 follow-up; the
/// row keeps the layout consistent so the empty tabs aren't blank.
fn pending_row(muted: gpui::Hsla) -> gpui::AnyElement {
    div()
        .py(px(6.0))
        .text_sm()
        .text_color(muted)
        .child(SharedString::new_static(
            "Phase 9 wires editing for this tab.",
        ))
        .into_any_element()
}

impl Render for SettingsPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.active;
        let theme = cx.theme();
        let tab_active_bg = theme.tab_active;
        let tab_active_fg = theme.tab_active_foreground;
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let settings = &self.settings;

        // Right-pane content is a flat list of `settings_row` entries
        // per tab.  Tabs with no live-readable fields fall through to
        // a single "Phase 9 wires editing" placeholder.
        let content: gpui::AnyElement = match active {
            SettingsTab::General => div()
                .flex()
                .flex_col()
                .child(settings_row(
                    "Theme",
                    SharedString::from(format!("{:?}", settings.theme)),
                    fg,
                    muted,
                ))
                .child(settings_row(
                    "Schema version",
                    SharedString::from(settings.version.to_string()),
                    fg,
                    muted,
                ))
                .into_any_element(),
            SettingsTab::Editor | SettingsTab::Git | SettingsTab::Ai => pending_row(muted),
            SettingsTab::Vault => div()
                .flex()
                .flex_col()
                .child(settings_row(
                    "Window width (pt)",
                    SharedString::from(format!("{}", settings.window.width)),
                    fg,
                    muted,
                ))
                .child(settings_row(
                    "Window height (pt)",
                    SharedString::from(format!("{}", settings.window.height)),
                    fg,
                    muted,
                ))
                .child(settings_row(
                    "Restore window position",
                    SharedString::from(if settings.window.restore_position {
                        "Yes"
                    } else {
                        "No"
                    }),
                    fg,
                    muted,
                ))
                .into_any_element(),
        };

        div()
            .flex()
            .flex_row()
            .size_full()
            .child(div().flex().flex_col().w(px(160.0)).p(px(8.0)).children(
                SettingsTab::ALL.iter().map(|&tab| {
                    let is_active = tab == active;
                    let btn = Button::new(tab.element_id())
                        .label(SharedString::from(tab.label()))
                        .ghost();
                    div()
                        .w_full()
                        .px(px(4.0))
                        .py(px(2.0))
                        .when(is_active, |d: Div| {
                            d.bg(tab_active_bg).text_color(tab_active_fg)
                        })
                        .child(btn)
                        .into_any_element()
                }),
            ))
            .child(div().flex_1().p(px(16.0)).child(content))
    }
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

    /// When no [`MockSettings`] global is installed, the panel falls back to
    /// [`MockSettings::default`].
    #[gpui::test]
    fn defaults_when_no_mock_settings(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = SettingsPanel::new(cx);
            assert_eq!(
                *panel.settings(),
                MockSettings::default(),
                "settings must default when no global is installed"
            );
        });
    }

    /// The active tab must be [`SettingsTab::General`] right after construction.
    #[gpui::test]
    fn active_tab_starts_general(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = SettingsPanel::new(cx);
            assert_eq!(
                panel.active_tab(),
                SettingsTab::General,
                "initial active tab must be General"
            );
        });
    }

    /// `set_active` must round-trip through every tab variant.
    #[gpui::test]
    fn set_active_round_trips(cx: &mut TestAppContext) {
        install_theme(cx);
        let panel_view = cx.add_window(|_window, cx| SettingsPanel::new(cx));
        for &tab in SettingsTab::ALL {
            panel_view
                .update(cx, |panel, _window, cx| {
                    panel.set_active(tab, cx);
                    assert_eq!(
                        panel.active_tab(),
                        tab,
                        "active_tab must reflect the tab passed to set_active"
                    );
                })
                .expect("window must be alive");
        }
    }

    /// `SettingsTab::ALL` must contain exactly five tabs.
    #[test]
    fn all_returns_5_tabs() {
        assert_eq!(
            SettingsTab::ALL.len(),
            5,
            "SettingsTab::ALL must contain exactly 5 tabs"
        );
    }

    /// Phase 8.14 — every tab must render without panicking under a
    /// seeded `MockSettings` global, including the "Phase 9 wires
    /// editing" placeholder tabs (Editor / Git / AI).
    #[gpui::test]
    fn every_tab_renders_under_seeded_settings(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| cx.set_global(MockSettings::seeded()));
        let window = cx.add_window(|_window, cx| SettingsPanel::new(cx));
        for &tab in SettingsTab::ALL {
            window
                .update(cx, |panel, _window, cx| panel.set_active(tab, cx))
                .expect("window must be alive");
            cx.run_until_parked();
        }
    }
}
