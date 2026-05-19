#![forbid(unsafe_code)]
//! Status-bar chrome view for Tolaria (ADR-0115 Phase 2b → Phase 6
//! visual-parity pass).
//!
//! Mirrors the Tauri-era `src/components/StatusBar.tsx` layout: a
//! thin 30-pt strip pinned to the bottom of the workspace, with two
//! clusters separated by a flexible spacer.
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │ demo-vault-v2 ▾  2026.5.18                                       │
//! │                              ⚠ Git disabled  ⚠ MCP  ⚠ Claude     │
//! │                                      📣 Contribute  📖 Docs  🌙 ⚙ │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! Stream (a) — visible chrome parity against
//! [`tolaria-demo-vault-v2-light.png` / `…-dark.png`].  The right
//! cluster's `Contribute / Docs / Theme / Settings` cells are
//! interactive in the React source; Phase 6 ships them as visual
//! placeholders, wired in a later iteration alongside their actions.

use gpui::{
    div, px, AnyElement, App, Context, InteractiveElement, IntoElement, ParentElement, Render,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{ActiveTheme, IconName};
use mock_fixtures::{FileStatus, MockGit, MockVault};
use ui::tree_dump::DumpAsExt as _;
use vault::Vault;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Severity of a service-status chip in the middle cluster.
///
/// Maps to a colour swatch in [`Render`].  `Ok` paints the chip in
/// `theme.foreground` (default text colour); `Warning` paints it in
/// `theme.warning`; `Error` paints it in `theme.danger`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceSeverity {
    /// Healthy / live (e.g. git connected, MCP running).
    Ok,
    /// Disabled or degraded — amber tone in the reference screenshots.
    Warning,
    /// Hard failure — red tone.
    Error,
}

/// A single service-status chip rendered in the middle cluster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceChip {
    /// Short label, e.g. `Git disabled` / `MCP` / `Claude`.
    pub label: SharedString,
    /// Severity colouring; see [`ServiceSeverity`].
    pub severity: ServiceSeverity,
}

// ---------------------------------------------------------------------------
// StatusBar view
// ---------------------------------------------------------------------------

/// Horizontal status strip rendered at the bottom of `TolariaWorkspace`.
pub struct StatusBar {
    /// Workspace name shown in the left cluster (last segment of the
    /// vault root path, or `""` when no vault is open).
    vault_name: SharedString,
    /// Build / version label shown next to the vault name.
    version: SharedString,
    /// Service-status chips in the middle cluster.
    services: Vec<ServiceChip>,
}

impl StatusBar {
    /// An empty status bar (no vault, no chips).  Still paints the
    /// background + border so the bottom of the window has a status
    /// strip instead of a bare void.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            vault_name: SharedString::default(),
            version: SharedString::new_static(env!("CARGO_PKG_VERSION")),
            services: Vec::new(),
        }
    }

    /// Build from globals if any are installed.  Phase 5-MVP precedence:
    /// `vault::Vault` > `mock_fixtures::MockVault` > empty.  Service
    /// chips are always populated with the legacy "Git disabled / MCP
    /// / Claude" placeholder set — wiring them to real services is
    /// Phase 7+ work but the visual is in place today.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self {
                services: placeholder_services(),
                ..Self::empty()
            }
        }
    }

    /// Build from the real `vault::Vault` global.
    ///
    /// # Panics
    ///
    /// Panics if the [`Vault`] global is not installed on `cx`.
    pub fn from_vault(cx: &mut App) -> Self {
        let vault = cx.global::<Vault>();
        let vault_name = vault
            .root()
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .map(SharedString::from)
            .unwrap_or_default();
        Self {
            vault_name,
            version: SharedString::new_static(env!("CARGO_PKG_VERSION")),
            services: placeholder_services(),
        }
    }

    /// Build a status bar populated from the [`MockVault`] and [`MockGit`]
    /// globals installed on `cx`.
    ///
    /// # Panics
    ///
    /// Panics if the [`MockVault`] or [`MockGit`] globals are not installed.
    pub fn from_mock(cx: &mut App) -> Self {
        // MockVault has no name field — synthesise the demo vault id.
        let vault_name: SharedString = "demo-vault-v2".into();
        // Eagerly resolve dirty count from MockGit so the placeholder
        // "Git disabled" chip can surface a real count later.  Today
        // the value is dropped because Phase 6 doesn't show counts on
        // service chips, but keeping the read here documents the
        // shape for the Phase 7 service-wired version.
        let status_task = cx.global::<MockGit>().status();
        let git_status = cx.foreground_executor().block_on(status_task);
        let _dirty_count =
            git_status.count(FileStatus::Modified) + git_status.count(FileStatus::Untracked);

        Self {
            vault_name,
            version: SharedString::new_static(env!("CARGO_PKG_VERSION")),
            services: placeholder_services(),
        }
    }

    /// Service chips currently shown in the middle cluster (test
    /// helper — production renders these via [`Render`]).
    #[cfg(test)]
    pub fn services(&self) -> &[ServiceChip] {
        &self.services
    }

    /// Workspace name shown in the left cluster (test helper).
    #[cfg(test)]
    pub fn vault_name(&self) -> &SharedString {
        &self.vault_name
    }
}

/// Status-bar link cell — a 14-pt icon + label combo (Contribute,
/// Docs).  Tagged via `dump_as` so periscope can target the
/// labelled cells alongside the icon-only ones.
fn status_link(label: &'static str, icon: IconName, muted: gpui::Hsla) -> gpui::AnyElement {
    use gpui::IntoElement as _;
    div()
        .id(label)
        .flex()
        .items_center()
        .gap(px(4.0))
        .text_color(muted)
        .cursor_pointer()
        .child(
            div()
                .w(px(14.0))
                .h(px(14.0))
                .flex()
                .items_center()
                .justify_center()
                .child(icon),
        )
        .child(SharedString::new_static(label))
        .dump_as(label)
        .into_any_element()
}

/// Three legacy placeholder service chips that mirror the
/// `Git disabled / MCP / Claude` warnings in the reference
/// screenshots.  When the real services land they replace this
/// helper at call sites.
fn placeholder_services() -> Vec<ServiceChip> {
    vec![
        ServiceChip {
            label: "Git disabled".into(),
            severity: ServiceSeverity::Warning,
        },
        ServiceChip {
            label: "MCP".into(),
            severity: ServiceSeverity::Warning,
        },
        ServiceChip {
            label: "Claude".into(),
            severity: ServiceSeverity::Warning,
        },
    ]
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for StatusBar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        // The reference's status strip sits on the sidebar palette so
        // it visually anchors with the left dock; mirror that here.
        let bg = theme.sidebar;
        let border = theme.border;
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let warning = theme.warning;
        let danger = theme.danger;
        // Theme-switcher icon — sun in dark mode (clicking flips to
        // light), moon in light mode (clicking flips to dark).
        // Matches the React `<Sun />` / `<Moon />` lucide swap.
        let theme_toggle_icon: IconName = if theme.is_dark() {
            IconName::Sun
        } else {
            IconName::Moon
        };

        let left = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_color(fg)
                    .child(self.vault_name.clone())
                    .child(
                        div()
                            .w(px(12.0))
                            .h(px(12.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(muted)
                            .child(IconName::ChevronDown),
                    )
                    .into_any_element(),
            )
            .child(
                div()
                    .text_color(muted)
                    .child(self.version.clone())
                    .into_any_element(),
            );

        let service_chips: Vec<AnyElement> = self
            .services
            .iter()
            .map(|chip| {
                let color = match chip.severity {
                    ServiceSeverity::Ok => fg,
                    ServiceSeverity::Warning => warning,
                    ServiceSeverity::Error => danger,
                };
                div()
                    .text_color(color)
                    .child(chip.label.clone())
                    .into_any_element()
            })
            .collect();

        let right = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(12.0))
            .text_color(muted)
            .children(service_chips)
            .child(status_link("Contribute", IconName::Bell, muted))
            .child(status_link("Docs", IconName::BookOpen, muted))
            // Theme switcher — clickable.  Calls `theme::cycle` which
            // flips between [`ThemeChoice::Light`] and `Dark`.  The
            // icon shows the *target* mode so the click affordance is
            // obvious (sun=switch-to-light, moon=switch-to-dark) —
            // matches the lucide `<Sun />` / `<Moon />` swap in the
            // React status bar.  `.dump_as` registers the laid-out
            // bounds under `"status-bar-theme-toggle"` so periscope can
            // target it by name.
            .child(
                div()
                    .id("status-bar-theme-toggle")
                    .cursor_pointer()
                    .w(px(20.0))
                    .h(px(20.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .on_click(|_, _window, cx| theme::cycle(cx))
                    .child(theme_toggle_icon)
                    .dump_as("status-bar-theme-toggle"),
            )
            .child(
                div()
                    .id("status-bar-settings")
                    .w(px(20.0))
                    .h(px(20.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .child(IconName::Settings)
                    .dump_as("status-bar-settings"),
            );

        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .flex_shrink_0()
            .h(px(30.0))
            .px(px(8.0))
            .bg(bg)
            .border_t_1()
            .border_color(border)
            .text_xs()
            .child(left)
            .child(right)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use mock_fixtures::{MockGit, MockVault};

    /// Install the `gpui_component::Theme` global required by any view that
    /// reads it during render.
    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// An empty status bar must render without panicking.
    #[gpui::test]
    fn empty_status_bar_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| StatusBar::empty());
        cx.run_until_parked();
    }

    /// `from_mock` must seed the legacy three placeholder service chips.
    #[gpui::test]
    fn from_mock_populates_placeholder_services(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
            let bar = StatusBar::from_mock(cx);
            let labels: Vec<&str> = bar.services().iter().map(|c| c.label.as_ref()).collect();
            assert_eq!(labels, vec!["Git disabled", "MCP", "Claude"]);
            assert!(
                bar.services()
                    .iter()
                    .all(|c| c.severity == ServiceSeverity::Warning),
                "all placeholder chips must use ServiceSeverity::Warning until services land",
            );
        });
    }

    /// `from_vault` must derive `vault_name` from the vault root path.
    #[gpui::test]
    fn from_vault_uses_last_path_segment(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("vault-name");
        fs::create_dir(&nested).unwrap();
        let vault = vault::Vault::open_at(&nested).expect("open vault");
        cx.update(|cx| {
            cx.set_global(vault);
            let bar = StatusBar::from_vault(cx);
            assert_eq!(bar.vault_name().as_ref(), "vault-name");
        });
    }

    /// `from_or_empty` must prefer the real `Vault` over `MockVault`.
    #[gpui::test]
    fn from_or_empty_prefers_real_vault(cx: &mut TestAppContext) {
        use std::fs;
        install_theme(cx);
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("real-vault");
        fs::create_dir(&nested).unwrap();
        let vault = vault::Vault::open_at(&nested).expect("open vault");
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
            cx.set_global(vault);
            let bar = StatusBar::from_or_empty(cx);
            assert_eq!(
                bar.vault_name().as_ref(),
                "real-vault",
                "real Vault must win over MockVault when both globals present"
            );
        });
    }
}
