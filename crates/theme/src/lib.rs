//! Theme global for Tolaria (ADR-0115 Phase 1 + Phase 8.12).
//!
//! Thin wrapper around `gpui_component`'s `Theme` global. `init` is
//! idempotent: calling it multiple times is safe because
//! `gpui_component::init` is itself idempotent.
//!
//! Phase 8.12 lit up `reload_from_settings` and added
//! [`observe_settings_store`] so the live theme tracks every
//! `SettingsStore::update` — flipping `settings.theme` in any consumer
//! (settings panel, future settings actions, direct mutation in tests)
//! propagates to the chrome on the next event-loop tick.

use std::fmt;
use std::str::FromStr;

mod palette;

/// Install the `gpui_component::Theme` global into `cx`.
///
/// Must be called before any `gpui_component` primitive is rendered.
/// Mirrors the `gpui_component::init` call in `embed_poc::main`.
pub fn init(cx: &mut gpui::App) {
    gpui_component::init(cx);
}

/// User-facing theme choice surfaced via the `--theme` CLI flag (and,
/// later, the settings store).
///
/// - [`ThemeChoice::System`] tracks the macOS Light/Dark appearance —
///   useful for users who already have a global preference.
/// - [`ThemeChoice::Light`] / [`ThemeChoice::Dark`] pin the app to a
///   single mode regardless of OS preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThemeChoice {
    /// Follow the OS appearance.  Default — matches what users
    /// expect from a well-behaved native macOS app.
    #[default]
    System,
    /// Force the light theme.
    Light,
    /// Force the dark theme.
    Dark,
}

impl ThemeChoice {
    /// Stable serialization for log output and settings persistence.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

impl fmt::Display for ThemeChoice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<settings_store::ThemeChoice> for ThemeChoice {
    fn from(value: settings_store::ThemeChoice) -> Self {
        match value {
            settings_store::ThemeChoice::System => Self::System,
            settings_store::ThemeChoice::Light => Self::Light,
            settings_store::ThemeChoice::Dark => Self::Dark,
        }
    }
}

impl FromStr for ThemeChoice {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "system" | "auto" => Ok(Self::System),
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            other => {
                anyhow::bail!("unknown theme {other:?}; expected one of: system, light, dark")
            }
        }
    }
}

/// Apply `choice` to the active `gpui_component::Theme` global.
///
/// `theme::init` must have run first so the global exists.  For
/// [`ThemeChoice::System`] the function reads `cx.window_appearance()`
/// and forwards through gpui-component's
/// `Theme::sync_system_appearance`.  For the explicit modes it calls
/// `Theme::change` directly — same code path as the user toggling the
/// theme at runtime.
///
/// # Panics
///
/// Panics if `gpui_component::Theme` is not yet registered as a
/// `gpui::Global`.  Always call after [`init`].
pub fn apply_choice(cx: &mut gpui::App, choice: ThemeChoice) {
    use gpui_component::theme::{Theme, ThemeMode};
    use gpui_component::ActiveTheme as _;

    match choice {
        ThemeChoice::System => Theme::sync_system_appearance(None, cx),
        ThemeChoice::Light => Theme::change(ThemeMode::Light, None, cx),
        ThemeChoice::Dark => Theme::change(ThemeMode::Dark, None, cx),
    }
    // Overwrite the just-installed `ThemeColor` with our CSS-derived
    // palette so the native chrome matches `src/index.css` and the
    // Tauri-era reference screenshots exactly.
    let theme = cx.global_mut::<Theme>();
    if theme.is_dark() {
        palette::apply_dark(theme);
    } else {
        palette::apply_light(theme);
    }
    log::info!(
        "theme: applied {choice} (resolved is_dark={})",
        cx.theme().is_dark()
    );
}

/// Toggle the active theme between [`ThemeChoice::Light`] and
/// [`ThemeChoice::Dark`].  Reads the live state via
/// `gpui_component::ActiveTheme::is_dark`, then calls
/// [`apply_choice`] with the inverse.  Used by the status-bar
/// theme-switcher button so users can flip the chrome without going
/// through the menu / settings.
///
/// `System` is intentionally not part of the cycle — the user opts
/// into "follow system" via the `--theme` CLI flag or future
/// settings UI, not the status-bar toggle.
pub fn cycle(cx: &mut gpui::App) {
    use gpui_component::ActiveTheme as _;
    let next = if cx.theme().is_dark() {
        ThemeChoice::Light
    } else {
        ThemeChoice::Dark
    };
    apply_choice(cx, next);
}

/// Reload the active theme from the current `SettingsStore` global
/// (Phase 8.12).
///
/// Reads `SettingsStore::get(cx).theme` and forwards through
/// [`apply_choice`], which calls `gpui_component`'s theme-switch API
/// and re-applies the CSS-derived palette so the native chrome
/// tracks the new mode.
///
/// No-op (with a warning) when no `SettingsStore` global is
/// installed — letting callers register the observer before
/// `SettingsStore::load_and_install` runs without an order-of-init
/// panic.
pub fn reload_from_settings(cx: &mut gpui::App) {
    if cx.try_global::<settings_store::SettingsStore>().is_none() {
        log::warn!(
            "theme::reload_from_settings: no SettingsStore global; \
             skipping reload"
        );
        return;
    }
    let choice: ThemeChoice = settings_store::SettingsStore::get(cx).theme.into();
    apply_choice(cx, choice);
}

/// Register a `cx.observe_global::<SettingsStore>` callback that
/// re-applies the persisted theme choice whenever the settings
/// store fires `NotifyGlobalObservers` — typically the moment
/// `SettingsStore::update` writes a new value to disk.
///
/// Returned subscription is detached internally so callers don't
/// have to thread it through the workspace lifetime.  The observer
/// stays alive for the lifetime of the `App`.
pub fn observe_settings_store(cx: &mut gpui::App) {
    cx.observe_global::<settings_store::SettingsStore>(reload_from_settings)
        .detach();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[gpui::test]
    fn init_installs_theme_global(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            assert!(
                cx.try_global::<gpui_component::theme::Theme>().is_some(),
                "gpui_component::Theme global must be present after theme::init"
            );
        });
    }

    #[test]
    fn theme_choice_round_trip_via_from_str() {
        for choice in [ThemeChoice::System, ThemeChoice::Light, ThemeChoice::Dark] {
            let s = choice.as_str();
            let parsed: ThemeChoice = s.parse().expect("round-trip");
            assert_eq!(parsed, choice, "round-trip failed for {s}");
        }
    }

    #[test]
    fn theme_choice_from_str_is_case_insensitive_and_accepts_auto_alias() {
        assert_eq!(
            "System".parse::<ThemeChoice>().unwrap(),
            ThemeChoice::System
        );
        assert_eq!("LIGHT".parse::<ThemeChoice>().unwrap(), ThemeChoice::Light);
        assert_eq!("dArK".parse::<ThemeChoice>().unwrap(), ThemeChoice::Dark);
        assert_eq!("auto".parse::<ThemeChoice>().unwrap(), ThemeChoice::System);
    }

    #[test]
    fn theme_choice_from_str_rejects_garbage() {
        let err = "puce".parse::<ThemeChoice>().unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("system") && msg.contains("light") && msg.contains("dark"),
            "error must enumerate the valid choices: got {msg:?}"
        );
    }

    #[gpui::test]
    fn apply_choice_dark_flips_theme_mode_to_dark(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            apply_choice(cx, ThemeChoice::Dark);
            let theme = cx
                .try_global::<gpui_component::theme::Theme>()
                .expect("Theme global");
            assert!(theme.is_dark(), "Theme::is_dark() must be true after Dark");
        });
    }

    #[gpui::test]
    fn apply_choice_light_flips_theme_mode_to_light(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            apply_choice(cx, ThemeChoice::Dark); // start dark to prove we move it
            apply_choice(cx, ThemeChoice::Light);
            let theme = cx
                .try_global::<gpui_component::theme::Theme>()
                .expect("Theme global");
            assert!(
                !theme.is_dark(),
                "Theme::is_dark() must be false after Light"
            );
        });
    }

    /// Phase 8.12 — `reload_from_settings` must read the current
    /// `SettingsStore::theme` and apply it to the live theme global.
    #[gpui::test]
    fn reload_from_settings_applies_persisted_theme(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            settings_store::SettingsStore::load_and_install(cx).expect("install settings store");
            // Start by forcing Light so we can prove `reload_from_settings`
            // actually moves the theme to whatever the store holds.
            apply_choice(cx, ThemeChoice::Light);
            settings_store::SettingsStore::update(cx, |s| {
                s.theme = settings_store::ThemeChoice::Dark;
            });

            reload_from_settings(cx);

            let theme = cx
                .try_global::<gpui_component::theme::Theme>()
                .expect("Theme global");
            assert!(
                theme.is_dark(),
                "reload_from_settings must flip the live theme to match settings.theme"
            );
        });
    }

    /// Phase 8.12 — installing the observer must re-apply the theme
    /// every time `SettingsStore::update` fires its global notification.
    #[gpui::test]
    fn observe_settings_store_reacts_to_runtime_change(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            settings_store::SettingsStore::load_and_install(cx).expect("install settings store");
            apply_choice(cx, ThemeChoice::Light);
            observe_settings_store(cx);
        });

        // Drive a settings change and wait for observers to fire.
        cx.update(|cx| {
            settings_store::SettingsStore::update(cx, |s| {
                s.theme = settings_store::ThemeChoice::Dark;
            });
        });
        cx.run_until_parked();

        cx.update(|cx| {
            let theme = cx
                .try_global::<gpui_component::theme::Theme>()
                .expect("Theme global");
            assert!(
                theme.is_dark(),
                "observer must re-apply Dark after SettingsStore::update writes it"
            );
        });
    }
}
