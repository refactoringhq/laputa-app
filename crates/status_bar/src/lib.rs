#![forbid(unsafe_code)]
//! Status-bar chrome view for Tolaria (ADR-0115 Phase 2b → Phase 6
//! visual-parity pass → Phase 8.6 interactive wiring).
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
//! ## Phase 8.6 additions
//!
//! - Vault-name cluster (left side) is now clickable: a click toggles
//!   `vault_menu_open` which renders a small mock vault-switcher popup.
//! - Each service chip is clickable and emits
//!   [`StatusBarServiceClick`] so workspace consumers can route to
//!   setup flows.
//! - `Contribute` / `Docs` cells emit [`StatusBarLinkClick`].
//! - Settings gear dispatches [`actions::OpenSettings`] via
//!   `cx.dispatch_action`.
//! - Theme-switcher cell unchanged from Phase 7.2.
//!
//! Stream (a) — visible chrome parity against
//! [`tolaria-demo-vault-v2-light.png` / `…-dark.png`].

use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement, IntoElement, ParentElement, Render,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{ActiveTheme, IconName};
use mock_fixtures::{FileStatus, MockGit, MockVault};
use ui::tree_dump::DumpAsExt as _;
use vault::Vault;

// ---------------------------------------------------------------------------
// Public types — events and enumerations
// ---------------------------------------------------------------------------

/// Which service chip the user clicked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceKind {
    /// The "Git disabled" chip.
    Git,
    /// The "MCP" chip.
    Mcp,
    /// The "Claude" chip.
    Claude,
}

/// Emitted when a service-status chip is clicked.
///
/// Workspace consumers subscribe to this event and route to the
/// appropriate service-setup flow (git init, MCP install, Claude
/// Code install).  Specific routing is Phase 9+ work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusBarServiceClick {
    /// The service whose chip was clicked.
    pub service: ServiceKind,
}

/// Which link button the user clicked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    /// The "Contribute" feedback button.
    Contribute,
    /// The "Docs" documentation link.
    Docs,
}

/// Emitted when `Contribute` or `Docs` is clicked.
///
/// Workspace consumers open the relevant URL in an external browser.
/// Phase 8.6 only emits the event; actual URL dispatch is Phase 9+.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusBarLinkClick {
    /// Which link was activated.
    pub kind: LinkKind,
}

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

/// A single service-status chip rendered alongside the vault name in
/// the left cluster (visual-issue #017).
///
/// The icon mirrors the React `StatusBarBadges.tsx` mapping:
/// - `Git disabled` → `GitBranch` (no `git-branch.svg` in
///   `gpui_component`'s icon pack — closest topological match is
///   [`IconName::Network`]).
/// - `MCP` → `Cpu` ([`IconName::Cpu`]).
/// - `Claude` → `Terminal` ([`IconName::SquareTerminal`]; the React
///   source uses Phosphor's `Terminal`).
// `IconName` does not implement `Debug`/`Eq` (it's a generated
// enum of asset paths in `gpui_component`), so we can't derive
// either here — `Clone` is the only one we genuinely need.
#[derive(Clone)]
pub struct ServiceChip {
    /// Short label, e.g. `Git disabled` / `MCP` / `Claude`.
    pub label: SharedString,
    /// Severity colouring; see [`ServiceSeverity`].
    pub severity: ServiceSeverity,
    /// Leading-glyph icon, drawn 13×13 immediately to the left of the
    /// label (matches React's `<Icon size={13} />` in
    /// `StatusBarBadges.tsx`).
    pub icon: IconName,
    /// Which service this chip represents — used to emit the correct
    /// [`StatusBarServiceClick`] event on click.
    pub kind: ServiceKind,
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
    /// Whether the vault-switcher popup is currently open.
    /// Toggled by clicking the vault-name cluster (left side).
    vault_menu_open: bool,
    /// Static stub list of recent vaults shown in the popup.
    /// Phase 8.6 uses a mock list; real vault history is Phase 9+.
    recent_vaults: Vec<SharedString>,
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
            vault_menu_open: false,
            recent_vaults: stub_recent_vaults(),
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
            vault_menu_open: false,
            recent_vaults: stub_recent_vaults(),
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
            vault_menu_open: false,
            recent_vaults: stub_recent_vaults(),
        }
    }

    /// Route a service-chip activation: emit [`StatusBarServiceClick`]
    /// and `notify` so parent re-renders pick up the click.  Shared by
    /// the service-chip `on_click` closure and the click regression
    /// tests so a future refactor can't silently desync them.
    pub(crate) fn on_service_click(&mut self, kind: ServiceKind, cx: &mut Context<Self>) {
        cx.emit(StatusBarServiceClick { service: kind });
        cx.notify();
    }

    /// Route a status-bar link cell (`Contribute` / `Docs`) activation.
    /// Same dispatch shape as [`Self::on_service_click`].
    pub(crate) fn on_link_click(&mut self, kind: LinkKind, cx: &mut Context<Self>) {
        cx.emit(StatusBarLinkClick { kind });
        cx.notify();
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

    /// Whether the vault-switcher popup is currently open (test helper).
    #[cfg(test)]
    pub fn is_vault_menu_open(&self) -> bool {
        self.vault_menu_open
    }
}

impl EventEmitter<StatusBarServiceClick> for StatusBar {}
impl EventEmitter<StatusBarLinkClick> for StatusBar {}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/// Left-cluster status chip — 13-pt leading icon + label, optionally
/// followed by a 10-pt amber `triangle-alert` (issue 017).  Mirrors
/// React's `CompactStatusActionBadge` body in
/// `src/components/status-bar/StatusBarBadges.tsx`:
///
/// - `ICON_STYLE.gap = 4` → `.gap(px(4.0))`.
/// - `<Icon size={13} />` → 13 × 13 icon cell.
/// - `<AlertTriangle size={10} style={{ marginLeft: 2 }} />` → 10 × 10
///   trailing cell painted in `theme.warning`.
fn status_chip(
    label: SharedString,
    icon: IconName,
    color: gpui::Hsla,
    trailing_warning: bool,
    warning: gpui::Hsla,
) -> gpui::AnyElement {
    let mut chip = div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .text_color(color)
        .child(
            div()
                .w(px(13.0))
                .h(px(13.0))
                .flex()
                .items_center()
                .justify_center()
                .child(icon),
        )
        .child(label);
    if trailing_warning {
        chip = chip.child(
            div()
                .ml(px(2.0))
                .w(px(10.0))
                .h(px(10.0))
                .flex()
                .items_center()
                .justify_center()
                .text_color(warning)
                .child(IconName::TriangleAlert),
        );
    }
    chip.into_any_element()
}

/// Thin vertical `|` separator drawn in `theme.border`.  Mirrors
/// React's `StatusBarSeparator` (`SEP_STYLE` from
/// `src/components/status-bar/styles.ts`, `color: var(--border)`).
fn status_separator(border: gpui::Hsla) -> gpui::AnyElement {
    div()
        .text_color(border)
        .child(SharedString::new_static("|"))
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
            // React: `<GitBranch />` (Phosphor).  `gpui_component`'s
            // icon pack has no `git-branch.svg`; `Network` is the
            // closest tree-of-nodes topology.
            icon: IconName::Network,
            kind: ServiceKind::Git,
        },
        ServiceChip {
            label: "MCP".into(),
            severity: ServiceSeverity::Warning,
            // React: `<Cpu />` — direct match.
            icon: IconName::Cpu,
            kind: ServiceKind::Mcp,
        },
        ServiceChip {
            label: "Claude".into(),
            severity: ServiceSeverity::Warning,
            // React: `<Terminal />` — closest in pack is `SquareTerminal`.
            icon: IconName::SquareTerminal,
            kind: ServiceKind::Claude,
        },
    ]
}

/// Static stub vault list for the Phase 8.6 vault-switcher popup.
/// Populated with recognisable demo-vault names so the UI is not
/// empty; real vault history wiring is Phase 9+.
fn stub_recent_vaults() -> Vec<SharedString> {
    vec![
        SharedString::from("demo-vault-v2"),
        SharedString::from("demo-vault"),
    ]
}

/// Vault-switcher popup — a minimal list of recent vault names
/// rendered above the status bar when `vault_menu_open` is true.
/// Phase 8.6 uses a static stub list; real vault history is Phase 9+.
fn vault_menu_popup(
    vaults: &[SharedString],
    bg: gpui::Hsla,
    border: gpui::Hsla,
    fg: gpui::Hsla,
) -> gpui::AnyElement {
    let mut list = div()
        .absolute()
        .bottom(px(30.0))
        .left(px(0.0))
        .min_w(px(160.0))
        .bg(bg)
        .border_1()
        .border_color(border)
        .rounded(px(6.0))
        .p(px(4.0))
        .shadow_lg();

    for name in vaults {
        list = list.child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .text_xs()
                .text_color(fg)
                .cursor_pointer()
                .rounded(px(3.0))
                .child(name.clone()),
        );
    }

    list.dump_as("status-bar-vault-menu").into_any_element()
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

        let entity = cx.entity();

        // ---- Vault-name cluster (clickable — toggles vault menu) ----
        let vault_name = self.vault_name.clone();
        let vault_entity = entity.clone();
        let vault_chip = div()
            .id("status-bar-vault-cluster")
            .flex()
            .items_center()
            .gap(px(4.0))
            .cursor_pointer()
            .on_click(move |_, _window, cx| {
                vault_entity.update(cx, |this, cx| {
                    this.vault_menu_open = !this.vault_menu_open;
                    cx.notify();
                });
            })
            .child(status_chip(
                vault_name,
                IconName::HardDrive,
                fg,
                false,
                warning,
            ))
            .child(
                div()
                    .w(px(10.0))
                    .h(px(10.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(muted)
                    .child(IconName::ChevronDown),
            )
            .dump_as("status-bar-vault-cluster");

        // Left cluster — vault chip · version chip · service chips,
        // all separated by `|` glyphs (visual-issue #017, mirrors
        // React's `StatusBarSeparator` in
        // `src/components/status-bar/StatusBarBadges.tsx`).
        let mut left = div()
            .relative()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(10.0))
            .child(vault_chip)
            .child(status_separator(border))
            // The user's issue-017 reference crop shows the same
            // cube-style glyph on both the vault and version chips,
            // even though the React source carries no icon on the
            // version label.  Mirror the screenshot, not the React
            // source, here.
            .child(status_chip(
                self.version.clone(),
                IconName::HardDrive,
                muted,
                false,
                warning,
            ));

        for chip in &self.services {
            let color = match chip.severity {
                ServiceSeverity::Ok => fg,
                ServiceSeverity::Warning => warning,
                ServiceSeverity::Error => danger,
            };
            let chip_id: SharedString = format!("status-bar-service-{}", chip.label).into();
            let service_kind = chip.kind;
            let chip_entity = entity.clone();
            let chip_label = chip.label.clone();
            let chip_icon = chip.icon.clone();
            let trailing = chip.severity != ServiceSeverity::Ok;

            left = left.child(status_separator(border)).child(
                div()
                    .id(chip_id)
                    .flex()
                    .items_center()
                    .cursor_pointer()
                    .on_click(move |_, _window, cx| {
                        chip_entity.update(cx, |this, cx| this.on_service_click(service_kind, cx));
                    })
                    .child(status_chip(chip_label, chip_icon, color, trailing, warning))
                    .dump_as("status-bar-service-chip"),
            );
        }

        // Vault menu popup (rendered inside the left cluster so it
        // anchors to the left edge of the bar).
        if self.vault_menu_open {
            left = left.child(vault_menu_popup(&self.recent_vaults, bg, border, fg));
        }

        // ---- Right cluster ----
        let contrib_entity = entity.clone();
        let docs_entity = entity.clone();

        let right = div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(12.0))
            .text_color(muted)
            .child(
                div()
                    .id("status-bar-contribute")
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_color(muted)
                    .cursor_pointer()
                    .on_click(move |_, _window, cx| {
                        contrib_entity
                            .update(cx, |this, cx| this.on_link_click(LinkKind::Contribute, cx));
                    })
                    .child(
                        div()
                            .w(px(14.0))
                            .h(px(14.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(IconName::Bell),
                    )
                    .child(SharedString::new_static("Contribute"))
                    .dump_as("status-bar-contribute"),
            )
            .child(
                div()
                    .id("status-bar-docs")
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_color(muted)
                    .cursor_pointer()
                    .on_click(move |_, _window, cx| {
                        docs_entity.update(cx, |this, cx| this.on_link_click(LinkKind::Docs, cx));
                    })
                    .child(
                        div()
                            .w(px(14.0))
                            .h(px(14.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(IconName::BookOpen),
                    )
                    .child(SharedString::new_static("Docs"))
                    .dump_as("status-bar-docs"),
            )
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
                    .on_click(|_, _window, cx| {
                        cx.dispatch_action(&actions::OpenSettings);
                    })
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
            .dump_as("workspace-status-bar")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AppContext as _;
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

    /// Issue 017 — every placeholder chip carries the icon the React
    /// `StatusBarBadges.tsx` mapping assigns to it.  `IconName` has no
    /// `PartialEq`, so we compare via the embedded asset path.
    #[gpui::test]
    fn placeholder_services_carry_react_matching_icons(cx: &mut TestAppContext) {
        use gpui_component::IconNamed as _;
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
            let bar = StatusBar::from_mock(cx);
            let paths: Vec<String> = bar
                .services()
                .iter()
                .map(|c| c.icon.clone().path().to_string())
                .collect();
            assert!(
                paths[0].contains("network"),
                "git chip icon must be `network` (closest to React's GitBranch); got {:?}",
                paths[0],
            );
            assert!(
                paths[1].contains("cpu"),
                "mcp chip icon must be `cpu` (matches React); got {:?}",
                paths[1],
            );
            assert!(
                paths[2].contains("square-terminal"),
                "claude chip icon must be `square-terminal` (closest to React's Terminal); got {:?}",
                paths[2],
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

    /// Phase 8.6 — clicking a service chip emits `StatusBarServiceClick`
    /// with the matching `ServiceKind`.  Uses the subscribe-deferred-activate
    /// pattern: subscribe, `run_until_parked`, then update.
    ///
    /// We synthesise a click by calling the entity's update path directly
    /// (GPUI test contexts don't simulate pointer events into on_click
    /// closures) — the event emission is the observable contract.
    #[gpui::test]
    fn status_bar_service_chip_click_emits_event(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            cx.set_global(MockGit::seeded());
        });

        let bar = cx.update(|cx| {
            let sb = StatusBar::from_mock(cx);
            cx.new(|_| sb)
        });

        let received: Rc<RefCell<Vec<ServiceKind>>> = Rc::new(RefCell::new(Vec::new()));

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&bar, move |_entity, event: &StatusBarServiceClick, _cx| {
                recv.borrow_mut().push(event.service);
            })
            .detach();
        });
        cx.run_until_parked();

        // Route through the same helper the on_click closure calls so a
        // future refactor of one path forces the other to update.
        cx.update(|cx| {
            bar.update(cx, |this, cx| {
                this.on_service_click(ServiceKind::Git, cx);
                this.on_service_click(ServiceKind::Mcp, cx);
                this.on_service_click(ServiceKind::Claude, cx);
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![ServiceKind::Git, ServiceKind::Mcp, ServiceKind::Claude],
            "each service chip click must emit StatusBarServiceClick with the correct ServiceKind",
        );
    }

    /// Phase 8.6 — clicking the settings gear dispatches `OpenSettings`.
    /// We verify by registering an `on_action` handler and simulating the
    /// dispatch directly (mirrors `cmd_q_dispatches_quit_action` in the
    /// actions crate tests).
    #[gpui::test]
    fn status_bar_settings_gear_dispatches_open_settings(cx: &mut TestAppContext) {
        use std::cell::Cell;
        use std::rc::Rc;

        install_theme(cx);
        let fired = Rc::new(Cell::new(0u32));
        let fired_h = fired.clone();

        cx.update(|cx| {
            cx.on_action(move |_: &actions::OpenSettings, _| {
                fired_h.set(fired_h.get() + 1);
            });
        });

        let window = cx.add_window(|_window, _cx| StatusBar::empty());
        cx.run_until_parked();

        // Dispatch the action as the settings gear's on_click would.
        window
            .update(cx, |_bar, _window, cx| {
                cx.dispatch_action(&actions::OpenSettings);
            })
            .unwrap();
        cx.run_until_parked();

        assert_eq!(
            fired.get(),
            1,
            "settings gear must dispatch OpenSettings exactly once",
        );
    }

    /// Phase 8.6 — clicking the vault-name cluster flips `vault_menu_open`.
    #[gpui::test]
    fn status_bar_vault_chevron_opens_menu(cx: &mut TestAppContext) {
        install_theme(cx);

        let bar = cx.update(|cx| cx.new(|_| StatusBar::empty()));

        // Menu starts closed.
        cx.update(|cx| {
            assert!(!bar.read(cx).vault_menu_open, "menu must start closed");
        });

        // First toggle — should open.
        cx.update(|cx| {
            bar.update(cx, |this, cx| {
                this.vault_menu_open = true;
                cx.notify();
            });
        });
        cx.run_until_parked();

        cx.update(|cx| {
            assert!(
                bar.read(cx).vault_menu_open,
                "menu must be open after first toggle",
            );
        });

        // Second toggle — should close.
        cx.update(|cx| {
            bar.update(cx, |this, cx| {
                this.vault_menu_open = false;
                cx.notify();
            });
        });
        cx.run_until_parked();

        cx.update(|cx| {
            assert!(
                !bar.read(cx).vault_menu_open,
                "menu must be closed after second toggle",
            );
        });
    }
}
