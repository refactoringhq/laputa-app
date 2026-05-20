//! Tolaria application entry point (ADR-0115 Phase 1).
//!
//! Registration sequence (order matters — Globals must exist before any
//! observer or view reads them):
//!
//! 1. `env_logger` init.
//! 2. `gpui_platform::application().run(…)`.
//! 3. `theme::init(cx)` — installs `gpui_component` Theme global.
//! 4. `settings_store::SettingsStore::load_and_install(cx)`.
//! 5. `actions::init(cx)` — declares actions, loads bundled + user keymap.
//! 6. Global action handlers (`Quit`, `CloseWindow`, `OpenSettings`,
//!    `ReloadKeymap`).
//! 7. `cx.set_menus(menus::app_menus())`.
//! 8. `cx.observe_global::<SettingsStore>(…)` → `theme::reload_from_settings`.
//! 9. Open root window with `workspace::TolariaWorkspace`.
//! 10. `cx.activate(true)`.

/// Exit code returned by the non-macOS stub to signal "unsupported platform".
/// Distinct from 1 (generic failure) so CI can special-case platform checks.
#[cfg(not(target_os = "macos"))]
const UNSUPPORTED_PLATFORM_EXIT_CODE: i32 = 2;

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("tolaria is macOS-only (ADR-0115 Phase 1); skipping on this platform.");
    std::process::exit(UNSUPPORTED_PLATFORM_EXIT_CODE);
}

#[cfg(target_os = "macos")]
mod menus;

#[cfg(target_os = "macos")]
mod open_note;

#[cfg(target_os = "macos")]
fn main() {
    macos::run();
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;

    use gpui::{
        point, px, size, App, AppContext, Bounds, QuitMode, TitlebarOptions, WindowBounds,
        WindowOptions,
    };
    use gpui_platform::application;
    use mock_fixtures::{MockAi, MockGit, MockSearch, MockVault};
    use settings_store::SettingsStore;
    use vault::Vault;

    use crate::menus;

    /// Environment variable that toggles mock-fixture install at startup.
    /// When set to a non-empty value (canonically `1`), the seeded
    /// `MockVault` / `MockGit` / `MockAi` / `MockSearch` globals are
    /// installed before any view is constructed. `TolariaWorkspace`'s
    /// children then auto-populate against them via their `from_or_empty`
    /// helpers (see `status_bar::StatusBar::from_or_empty`).
    const MOCK_ENV_VAR: &str = "TOLARIA_MOCK";

    /// Parsed command-line arguments.  Phase 5-MVP carries `--vault
    /// <path>` and `--theme <system|light|dark>`; Phase 6 adds
    /// `--width`/`--height` so periscope and other harnesses can
    /// open the window at the exact logical-point size of the
    /// reference screenshots (1516×1052) without relying on the
    /// persisted `settings.json`.  Everything else is forwarded by
    /// GPUI / AppKit (e.g. `--bundle` arguments from `open`).
    struct CliArgs {
        vault_path: Option<PathBuf>,
        theme: theme::ThemeChoice,
        /// Override initial window width (logical points).  `None`
        /// falls back to `SettingsStore::get(cx).window.width`.
        width: Option<f32>,
        /// Override initial window height (logical points).  `None`
        /// falls back to `SettingsStore::get(cx).window.height`.
        height: Option<f32>,
    }

    fn parse_args() -> CliArgs {
        let mut iter = std::env::args().skip(1);
        let mut vault_path = None;
        let mut theme = theme::ThemeChoice::default();
        let mut width: Option<f32> = None;
        let mut height: Option<f32> = None;
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--vault" => {
                    vault_path = iter.next().map(PathBuf::from);
                }
                "--theme" => {
                    let Some(value) = iter.next() else {
                        eprintln!("--theme requires an argument: system | light | dark");
                        std::process::exit(2);
                    };
                    match value.parse::<theme::ThemeChoice>() {
                        Ok(choice) => theme = choice,
                        Err(err) => {
                            eprintln!("invalid --theme value: {err}");
                            std::process::exit(2);
                        }
                    }
                }
                "--width" => {
                    width = Some(parse_window_dim(iter.next().as_deref(), "--width"));
                }
                "--height" => {
                    height = Some(parse_window_dim(iter.next().as_deref(), "--height"));
                }
                "--help" | "-h" => {
                    eprintln!(
                        "Usage: tolaria [--vault <path>] [--theme <system|light|dark>] \
                         [--width <pts>] [--height <pts>]"
                    );
                    std::process::exit(0);
                }
                _ => {
                    // Ignore unrecognised flags so future GPUI / AppKit
                    // additions don't break startup.
                }
            }
        }
        CliArgs {
            vault_path,
            theme,
            width,
            height,
        }
    }

    /// Parse a `--width` / `--height` value: a strictly-positive,
    /// finite f32 in logical points.  Negative, zero, NaN, or
    /// missing values exit with a usage error rather than silently
    /// degrading the window geometry.
    fn parse_window_dim(value: Option<&str>, flag: &str) -> f32 {
        let Some(raw) = value else {
            eprintln!("{flag} requires a positive number of logical points");
            std::process::exit(2);
        };
        match raw.parse::<f32>() {
            Ok(v) if v.is_finite() && v > 0.0 => v,
            Ok(v) => {
                eprintln!("{flag}: {v} is not a positive finite number");
                std::process::exit(2);
            }
            Err(err) => {
                eprintln!("{flag}: {raw:?} is not a number ({err})");
                std::process::exit(2);
            }
        }
    }

    /// Whether the mock-fixture launch path is requested.
    ///
    /// Truthy values: `"1"`, `"true"`, `"yes"`, `"on"` (case-insensitive).
    /// Anything else — including unset, empty, `"0"`, `"false"` — is falsy.
    fn mock_mode_requested() -> bool {
        let Ok(v) = std::env::var(MOCK_ENV_VAR) else {
            return false;
        };
        matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
    }

    /// Install the four `mock_fixtures` Globals on `cx`. Must run before
    /// `TolariaWorkspace::empty` so child views (status_bar, future Phase 2c
    /// panels) see the globals during their own construction.
    fn install_mock_globals(cx: &mut App) {
        cx.set_global(MockVault::seeded());
        cx.set_global(MockGit::seeded());
        cx.set_global(MockAi::seeded());
        cx.set_global(MockSearch);
        log::info!("installed mock_fixtures globals ({MOCK_ENV_VAR} set)");
    }

    /// Register a Phase-1 placeholder handler that logs the action name and a
    /// note describing what the real implementation will do in Phase 2.
    ///
    /// Reduces boilerplate for the three log-only stubs; search "Phase 2 will"
    /// to locate all of them at once.
    fn log_stub<A: gpui::Action>(cx: &mut App, label: &'static str, note: &'static str) {
        cx.on_action(move |_: &A, _| log::info!("{label}: {note}"));
    }

    /// Resolve the active window's root view (a `gpui_component::Root`
    /// wrapper around `TolariaWorkspace`), unwrap the inner workspace
    /// entity, and run `f` against it.  No-op (with a debug log) when
    /// no active window resolves or the root view is not the expected
    /// `Root → TolariaWorkspace` pair.
    ///
    /// Centralises the active-window → workspace-entity hop so each
    /// new workspace-level action handler stays a single-line
    /// dispatch.
    fn dispatch_to_workspace<F>(label: &'static str, cx: &mut App, f: F)
    where
        F: FnOnce(
                &mut workspace::TolariaWorkspace,
                &mut gpui::Context<workspace::TolariaWorkspace>,
            ) + 'static,
    {
        // Defer for the same re-entrancy reason as `dispatch_to_any_window`:
        // when an action is dispatched from inside the window's own
        // dispatch tree (menu click, keybinding routed through the
        // element tree), the window slot in `App::windows` is already
        // taken by the current update.  `cx.defer` queues the inner
        // `handle.update` for after the current update unwinds.
        cx.defer(move |cx| {
            let Some(handle) = cx.active_window() else {
                log::debug!("{label}: no active window");
                return;
            };
            if let Err(err) = handle.update(cx, |root, _window, app_cx| {
                let Ok(root_entity) = root.downcast::<gpui_component::Root>() else {
                    log::debug!("{label}: window root is not gpui_component::Root");
                    return;
                };
                let inner = root_entity.read(app_cx).view().clone();
                let Ok(workspace) = inner.downcast::<workspace::TolariaWorkspace>() else {
                    log::debug!("{label}: Root inner view is not TolariaWorkspace");
                    return;
                };
                workspace.update(app_cx, f);
            }) {
                log::error!("{label} dispatch failed: {err:#}");
            }
        });
    }

    /// Run `f` against any live Tolaria window — deferred to the
    /// next event-loop tick so the current update has fully unwound
    /// before the window-update borrow is acquired.
    ///
    /// Root cause of the "ToggleInspector dispatch failed: window not
    /// found" reports: when an action fires from inside a window's
    /// dispatch tree (menu click, keybinding routed through the
    /// element tree), the action handler runs while the window's
    /// `Option<Box<Window>>` slot in `App::windows` is already taken
    /// by the current update.  `gpui::AnyWindowHandle::update` then
    /// hits the `cx.windows.get_mut(id)?.take()?` branch with `None`
    /// on the `.take()`, surfacing as `anyhow!("window not found")`.
    ///
    /// `cx.defer` queues the closure to run after the current update
    /// completes — by that point the window slot is restored, so the
    /// follow-up `handle.update` succeeds.  Picks the window handle
    /// at dispatch time (deferred), not at registration time, so the
    /// path is also safe to call from cold start-up contexts where
    /// no window exists yet.
    ///
    /// Gated by `cfg(debug_assertions)` because the only current
    /// caller (`ToggleInspector`) is itself debug-only — gpui's
    /// `Window::toggle_inspector` is gated by
    /// `cfg(any(feature = "inspector", debug_assertions))`.  Un-gate
    /// the helper if a release-path action handler needs it later.
    #[cfg(debug_assertions)]
    fn dispatch_to_any_window<F>(label: &'static str, cx: &mut App, f: F)
    where
        F: FnOnce(gpui::AnyView, &mut gpui::Window, &mut App) + 'static,
    {
        cx.defer(move |cx| {
            // Prefer the live-window registry over `active_window()` —
            // both are checked at deferred-dispatch time so a stale
            // focus handle can't slip through.
            let handle = cx
                .windows()
                .into_iter()
                .next()
                .or_else(|| cx.active_window());
            let Some(handle) = handle else {
                log::debug!("{label}: no live window available");
                return;
            };
            if let Err(err) = handle.update(cx, f) {
                log::error!("{label} dispatch failed: {err:#}");
            }
        });
    }

    pub fn run() {
        env_logger::Builder::new()
            .filter_module("tolaria", log::LevelFilter::Info)
            .parse_default_env()
            .init();
        log::info!("tolaria starting (ADR-0115 Phase 5-MVP)");

        let args = parse_args();

        // Exit the process when the last window closes — Tolaria is
        // a single-window editor without a menu-bar persistent mode,
        // so the macOS default (`QuitMode::Explicit`, where the app
        // lingers after the close button) feels broken from a user's
        // perspective.  `LastWindowClosed` makes red-button-close
        // and `Cmd+W` behave the same as `Cmd+Q`.
        application()
            .with_quit_mode(QuitMode::LastWindowClosed)
            // Bundle gpui-component's icon SVGs so the sidebar / note
            // list / status bar / title bar can render `IconName::*`
            // elements.  Without an `AssetSource`, `svg()` falls back to
            // a blank rect and every chrome glyph disappears.
            .with_assets(gpui_component_assets::Assets)
            .run(move |cx: &mut App| {
                // 3. Theme / gpui-component global (must precede any primitive render).
                //    `theme::init` always lands the theme on Light; `apply_choice`
                //    immediately follows so we open in the user-requested mode
                //    instead of flashing Light on launch.
                theme::init(cx);
                theme::apply_choice(cx, args.theme);

                // 4. Settings global (reads or creates
                //    ~/Library/Application Support/Tolaria/settings.json).
                //    Log the full error chain and exit cleanly rather than panicking
                //    inside the GPUI event-loop closure (avoids an opaque crash dialog).
                if let Err(err) = settings_store::SettingsStore::load_and_install(cx) {
                    log::error!("failed to initialise settings store: {err:#}");
                    std::process::exit(1);
                }

                // 5. Action registry + keymap (bundled default.json + user override).
                //    Infallible by construction; bad user keymaps log a warning and
                //    fall back to defaults rather than blocking startup.
                actions::init(cx);

                // 6. Global action handlers.
                cx.on_action(|_: &actions::Quit, cx| cx.quit());

                // CloseWindow — close the active window via its handle.
                // No-op when there is no active window (e.g. between
                // close and reopen).
                cx.on_action(|_: &actions::CloseWindow, cx| {
                    let Some(handle) = cx.active_window() else {
                        log::debug!("CloseWindow: no active window");
                        return;
                    };
                    if let Err(err) = handle.update(cx, |_, window, _| window.remove_window()) {
                        log::error!("CloseWindow update failed: {err:#}");
                    }
                });

                // ReloadKeymap — re-run `actions::init` so user-keymap
                // edits land without restarting the app.  Logs a
                // diagnostic so triage can see the reload happened.
                cx.on_action(|_: &actions::ReloadKeymap, cx| {
                    actions::init(cx);
                    log::info!("ReloadKeymap: keymap reloaded");
                });

                // OpenSettings stays as a log stub until Phase 8.14
                // lands the settings panel as a real workspace surface
                // (today's `settings_panel` crate is shape-only).
                log_stub::<actions::OpenSettings>(
                    cx,
                    "OpenSettings",
                    "Phase 8.14 will push settings_panel onto TolariaWorkspace via toggle_modal",
                );

                // ToggleSidebar — flip the workspace's left dock open
                // / closed.  Mirrors the title-bar sidebar-toggle
                // button so the keymap shortcut and the visual
                // affordance share one code path.
                cx.on_action(|_: &actions::ToggleSidebar, cx| {
                    dispatch_to_workspace("ToggleSidebar", cx, |ws, cx| ws.toggle_left_dock(cx));
                });

                // CloseTab — close the active item in the center
                // pane group's active pane.  No-op when nothing is
                // open.
                cx.on_action(|_: &actions::CloseTab, cx| {
                    dispatch_to_workspace("CloseTab", cx, |ws, cx| ws.close_active_tab(cx));
                });

                // Dismiss — close the active modal (Phase 8.13).
                // No-op when no modal is shown, so binding `escape` to
                // this action globally doesn't interfere with input
                // fields that have their own Escape semantics — the
                // workspace's `dismiss_active_modal` gates on
                // `has_active_modal` before touching the modal layer.
                cx.on_action(|_: &actions::Dismiss, cx| {
                    dispatch_to_workspace("Dismiss", cx, |ws, cx| ws.dismiss_active_modal(cx));
                });

                // Save / NewNote / QuickOpen / CommandPalette stay as
                // log stubs.  `Save` needs the active `NoteItem` entity
                // (Phase 8.3 wired the editor-host SaveRequest path but
                // the workspace doesn't yet thread the active item to
                // a global Save handler — that's Phase 9.1
                // `command_registry` work).  `NewNote` needs a vault
                // write path (Phase 8.11).  `QuickOpen` /
                // `CommandPalette` need the modal surfaces (Phase 11.1
                // / 11.2).
                log_stub::<actions::Save>(
                    cx,
                    "Save",
                    "Phase 9.1 (command_registry) will route Save to the active NoteItem",
                );
                log_stub::<actions::NewNote>(
                    cx,
                    "NewNote",
                    "Phase 8.11 (vault background executor) will create a fresh note via Vault",
                );
                log_stub::<actions::QuickOpen>(
                    cx,
                    "QuickOpen",
                    "Phase 11.2 (quick_open) will push the quick-open palette as a modal",
                );
                log_stub::<actions::CommandPalette>(
                    cx,
                    "CommandPalette",
                    "Phase 11.1 (command_palette) will push the command palette as a modal",
                );
                // `Cmd+Alt+I` toggles GPUI's built-in element-picker
                // inspector (always available in debug builds; in release
                // builds gpui must be compiled with its `inspector` feature
                // — see `~/.cargo/git/checkouts/zed-…/crates/gpui/Cargo.toml`).
                //
                // Robust dispatch: try `cx.active_window()` first, but
                // fall back to iterating `cx.windows()` when the active
                // handle no longer resolves.  Closing-and-reopening a
                // window leaves `active_window()` briefly pointing at a
                // stale handle that returns `Err("window not found")` on
                // `handle.update`, which is what produced the spurious
                // error reports.  Iterating the live window list bypasses
                // the staleness window without depending on AppKit's
                // focus tracking.
                cx.on_action(|_: &actions::ToggleInspector, cx| {
                    // `Window::toggle_inspector` is only compiled when
                    // gpui's `inspector` feature is on, which our
                    // workspace gets implicitly from `debug_assertions`
                    // — present in debug builds, absent in release.
                    // Gate the call with the same predicate so the
                    // action handler still compiles in release; in
                    // release it logs and no-ops rather than failing
                    // the build.
                    #[cfg(debug_assertions)]
                    dispatch_to_any_window("ToggleInspector", cx, |_, window, app_cx| {
                        window.toggle_inspector(app_cx);
                    });
                    #[cfg(not(debug_assertions))]
                    {
                        let _ = cx;
                        log::debug!(
                            "ToggleInspector: gpui inspector is not available in release \
                             builds (debug_assertions disabled)"
                        );
                    }
                });

                // 7. Native menu bar (installed before window open so AppKit picks
                //    up accelerators immediately — ADR-0115 §6).
                cx.set_menus(menus::app_menus());

                // 8. Mock fixtures (TOLARIA_MOCK=1) — installs MockVault /
                //    MockGit / MockAi / MockSearch as Globals so chrome views
                //    populate against them. Phase 3 swaps in real services.
                //    Installed before any `observe_global` so future observers
                //    see the global state from registration onward.
                if mock_mode_requested() {
                    install_mock_globals(cx);
                }

                // 8b. Real vault (Phase 5-MVP).  `--vault <path>` opens the
                //     on-disk vault and installs `vault::Vault` as a Global.
                //     Chrome panels prefer it over `MockVault` via their
                //     `from_or_empty` helpers (Phase 5c).  Failure to open
                //     is logged but non-fatal — the app launches into an
                //     empty workspace so the user can pick a vault later.
                if let Some(path) = args.vault_path.as_ref() {
                    match Vault::open_at(path) {
                        Ok(mut vault) => {
                            // Phase 8.11: wire the background executor so
                            // subsequent reads / saves don't block the
                            // foreground thread on disk IO.  The initial
                            // scan above is intentionally sync — the app
                            // can't render before the index exists, and
                            // the scan cost is bounded by the demo vault
                            // size (~30 notes).
                            vault.set_executor(cx.background_executor().clone());
                            log::info!("--vault {path:?}: installed vault::Vault global");
                            cx.set_global(vault);
                        }
                        Err(err) => {
                            log::error!("--vault {path:?}: failed to open: {err:#}");
                        }
                    }
                }

                // 8c. Debug-only: arm the SIGUSR1 tree-dump handler so
                //     external tools (periscope, lldb, the user from a
                //     shell) can poke the process and grab a JSON dump of
                //     every `.dump_as("name")`-tagged element's current
                //     window-local bounds.  Release builds skip this —
                //     the IPC surface is strictly a developer affordance.
                //
                //     The y-offset matches the workspace's native title
                //     bar spacer (`workspace::NATIVE_TITLE_BAR_HEIGHT_PT`,
                //     applied as `.child(div().h(px(...)))`).  GPUI's
                //     `paint` hands us content-area-relative bounds;
                //     `periscope click` and `xcap::Window::y()` use
                //     frame-relative coordinates that *include* the title
                //     bar.  Adding the offset at register time keeps the
                //     JSON dump and periscope's click coordinate system
                //     in lockstep.
                #[cfg(debug_assertions)]
                {
                    ui::tree_dump::set_window_y_offset(workspace::NATIVE_TITLE_BAR_HEIGHT_PT);
                    let pid = std::process::id();
                    let path = ui::tree_dump::default_dump_path_for_pid(pid);
                    if let Err(err) = ui::tree_dump::install_signal_handler(path.clone()) {
                        log::error!("tree_dump SIGUSR1 handler install failed: {err:#}");
                    } else {
                        log::info!("tree_dump SIGUSR1 handler armed (pid={pid}, dump={path:?})");
                    }
                }

                // 9. Re-apply theme whenever settings change.  The
                //    crate-level helper hides the
                //    `cx.observe_global::<SettingsStore>(...).detach()`
                //    boilerplate so future settings-aware observers
                //    follow the same pattern.
                theme::observe_settings_store(cx);

                // 9b. Phase 7.9 — broadcast every theme change to the
                //     embedded WKWebView so the editor body's `<html>`
                //     `data-theme` attribute tracks the native chrome.
                //     The slot is constructed below so chrome views can
                //     share the same active-`NoteItem` handle; we create
                //     it here, register the observer that captures a
                //     clone, then thread the original into the
                //     window-open closure.
                let active_note_item: crate::open_note::ActiveNoteItemSlot =
                    std::rc::Rc::new(std::cell::RefCell::new(None));
                let theme_slot = active_note_item.clone();
                cx.observe_global::<gpui_component::theme::Theme>(move |cx| {
                    use gpui_component::ActiveTheme as _;
                    let mode = if cx.theme().is_dark() {
                        note_item::ThemeMode::Dark
                    } else {
                        note_item::ThemeMode::Light
                    };
                    let Some(item) = theme_slot.borrow().as_ref().cloned() else {
                        return;
                    };
                    if let Err(e) = item.update(cx, |item, cx| item.set_theme(mode, cx)) {
                        log::warn!("note_item::set_theme on theme change failed: {e:#}");
                    }
                })
                .detach();

                // 10. Open root window.  Copy f32 size values out before passing cx
                //    to Bounds::centered so the borrow of SettingsStore is released.
                //    CLI `--width` / `--height` override the persisted settings —
                //    periscope and other harnesses use this to pin the window to
                //    the 1516×1052 logical-point size of the Tauri-era reference
                //    screenshots without writing through `settings.json`.
                let (width, height) = {
                    let w = &SettingsStore::get(cx).window;
                    (
                        args.width.unwrap_or(w.width),
                        args.height.unwrap_or(w.height),
                    )
                };
                let bounds = Bounds::centered(None, size(px(width), px(height)), cx);
                let opts = WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        // `title: None` lets the workspace draw its own
                        // strip without a system title string — mirrors
                        // Zed's `zed.rs:350` (`title: None`).
                        title: None,
                        // Hide the system titlebar so our custom strip
                        // paints flush with the top of the window.
                        appears_transparent: true,
                        // Pin traffic lights to (9, 9) — mirrors Zed's
                        // `zed.rs:352` (`traffic_light_position: Some(point(px(9.0), px(9.0)))`).
                        // The y value is the *top inset* of the close button;
                        // GPUI/AppKit flips it internally
                        // (`gpui_macos/src/window.rs:538-544`).
                        // The strip reserves `TRAFFIC_LIGHTS_PADDING_PT`
                        // (71 pt) on the left so the action cluster never
                        // overlaps the lights.
                        traffic_light_position: Some(point(px(9.0), px(9.0))),
                    }),
                    ..Default::default()
                };

                if let Err(err) = cx.open_window(opts, |window, cx| {
                    use note_list_pane::{NoteListPane, NoteListScope, OpenNoteEvent};
                    use sidebar_panel::{
                        SidebarPanel, SidebarSelection, SidebarSelectionChangedEvent,
                    };
                    use workspace::TolariaWorkspace;

                    let sidebar = cx.new(|cx| SidebarPanel::from_or_empty(cx));
                    let note_list = cx.new(|cx| NoteListPane::from_or_empty(cx));
                    // Slot holding the currently mounted `NoteItem` so
                    // successive `OpenNoteEvent`s reuse the same entity
                    // (and underlying WKWebView) instead of constructing a
                    // new one — the latter is what produced the flicker.
                    // Constructed before `cx.open_window` so the
                    // observe-global theme broadcaster (Phase 7.9) and
                    // the open-note subscription can share the same handle.
                    let active_note_item = active_note_item.clone();
                    let workspace = cx.new(|model_cx| {
                        let mut workspace = TolariaWorkspace::empty(window, model_cx);
                        // Sidebar (vault tree) on the left, note list in
                        // its own column between sidebar and editor —
                        // matches `tolaria-demo-vault-v2.png`.
                        workspace.attach_left_dock(sidebar.clone(), model_cx);
                        workspace.attach_note_list_column(note_list.clone());
                        // Eagerly mount a blank WKWebView so the editor
                        // NSView is constructed (and painted) before the
                        // user clicks anything — avoids the black NSView
                        // flash on first open.  The editor shows its
                        // "Select a note…" placeholder until a click
                        // swaps real content in.
                        if let Err(e) = crate::open_note::preload_blank_webview(
                            &workspace,
                            &active_note_item,
                            window,
                            model_cx,
                        ) {
                            log::error!("preload_blank_webview failed: {e:#}");
                        }
                        // Subscribe inside the workspace's Context so the
                        // subscription lifetime tracks the workspace entity.
                        let slot = active_note_item.clone();
                        let active_handle = note_list.clone();
                        // Phase 8.1 — route every sidebar selection
                        // change to the note-list pane's scope filter.
                        // `Inbox` / `AllNotes` / `Archive` / `View(...)`
                        // map to the same-named scopes; `Type(label)`
                        // and `Folder(path)` narrow the list to
                        // matching entries.  Re-selecting the same row
                        // is a no-op in the sidebar (`select` only
                        // emits on change), so this subscription
                        // doesn't churn on idempotent clicks.
                        let scoped_list = note_list.clone();
                        model_cx
                            .subscribe_in(
                                &sidebar,
                                window,
                                move |_ws,
                                      _side,
                                      event: &SidebarSelectionChangedEvent,
                                      _window,
                                      cx| {
                                    let scope = match event.selection.clone() {
                                        SidebarSelection::Inbox => NoteListScope::Inbox,
                                        SidebarSelection::AllNotes => NoteListScope::AllNotes,
                                        SidebarSelection::Archive => NoteListScope::Archive,
                                        SidebarSelection::Type(label) => NoteListScope::Type(label),
                                        SidebarSelection::Folder(path) => {
                                            NoteListScope::Folder(path)
                                        }
                                        SidebarSelection::View(name) => NoteListScope::View(name),
                                    };
                                    // Worklist 2.1 — keep the note-list-pane header in
                                    // sync with the row label so users see which slice
                                    // of the vault they're looking at.
                                    let header = event.display_label.clone();
                                    scoped_list.update(cx, |list, cx| {
                                        list.set_scope(scope, cx);
                                        list.set_header_title(header, cx);
                                    });
                                },
                            )
                            .detach();

                        model_cx
                            .subscribe_in(
                                &note_list,
                                window,
                                move |ws_view, _list, event: &OpenNoteEvent, window, cx| {
                                    // Pass `&TolariaWorkspace` straight through —
                                    // `open_note` calls `add_item_to_active_pane`
                                    // (which takes `&self`) directly on it instead
                                    // of re-entering via `entity.update(...)`.  See
                                    // `open_note.rs` for the re-entrancy story.
                                    if let Err(e) = crate::open_note::open_note(
                                        ws_view, event.id, &slot, window, cx,
                                    ) {
                                        log::error!("open_note failed: {e:#}");
                                    }
                                    // Keep the note-list's pale-accent highlight
                                    // in sync with the editor's mounted note —
                                    // Phase 7.7 visual parity.  This is a no-op
                                    // when the click originated in the list
                                    // (`NoteListPane::open` already set
                                    // `selected_id`), but lets future open paths
                                    // (keymap, palette) drive the highlight too.
                                    active_handle.update(cx, |list, cx| {
                                        list.set_active(Some(event.id), cx);
                                    });
                                },
                            )
                            .detach();
                        workspace
                    });
                    // Wrap the workspace entity in `gpui_component::Root` —
                    // gpui-component's Dialog / Sheet / Notification / Tooltip
                    // overlays *and* `Window::toggle_inspector` all assume the
                    // window's first view is `Root`.  Skipping the wrapper
                    // panics inside `gpui_component::Root::read` at the first
                    // overlay call (root.rs:118, `Option::unwrap()` on `None`)
                    // — observed via `ToggleInspector` triggering the
                    // inspector overlay.
                    cx.new(|cx| gpui_component::Root::new(workspace, window, cx))
                }) {
                    log::error!("failed to open Tolaria window: {err:#}");
                }

                // 10. Bring application to foreground.
                cx.activate(true);
            });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use actions::{Quit, ReloadKeymap};
    use gpui::{KeyBinding, TestAppContext};
    use std::{cell::Cell, rc::Rc};

    /// Cmd+Q must dispatch the `Quit` action.
    ///
    /// Mirrors `embed_poc/src/menus.rs:115`: binds `cmd-q → Quit`, drives the
    /// keystroke through the test platform's dispatch chain, and asserts the
    /// global handler fires exactly once.
    #[gpui::test]
    fn cmd_q_dispatches_quit(cx: &mut TestAppContext) {
        let fired = Rc::new(Cell::new(0u32));
        let fired_handler = fired.clone();

        cx.update(|cx| {
            cx.on_action(move |_: &Quit, _| {
                fired_handler.set(fired_handler.get() + 1);
            });
            cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        });

        let window = cx.add_empty_window();
        window.simulate_keystrokes("cmd-q");
        window.run_until_parked();

        assert_eq!(fired.get(), 1, "Quit must fire exactly once for cmd-q");
    }

    /// Firing `ReloadKeymap` twice must fire the handler exactly twice.
    ///
    /// The Phase 1 handler is a log-only stub; this test documents the
    /// idempotency contract that Phase 2's real implementation must uphold.
    #[gpui::test]
    fn reload_keymap_action_is_idempotent(cx: &mut TestAppContext) {
        let fired = Rc::new(Cell::new(0u32));
        let fired_handler = fired.clone();

        cx.update(|cx| {
            cx.on_action(move |_: &ReloadKeymap, _cx| {
                fired_handler.set(fired_handler.get() + 1);
            });
            cx.bind_keys([KeyBinding::new("cmd-shift-p", ReloadKeymap, None)]);
        });

        let window = cx.add_empty_window();
        window.simulate_keystrokes("cmd-shift-p");
        window.simulate_keystrokes("cmd-shift-p");
        window.run_until_parked();

        assert_eq!(
            fired.get(),
            2,
            "ReloadKeymap must fire exactly twice without panicking"
        );
    }

    /// The real-platform `PlatformTextSystem` MUST be able to enumerate
    /// system fonts.  When `gpui_platform` is built without the
    /// `font-kit` feature, `gpui_macos::MacPlatform::new` swaps
    /// `MacTextSystem` for `gpui::NoopTextSystem`, whose
    /// `all_font_names()` returns an empty `Vec` — every label in the
    /// app then renders as invisible whitespace.  Window chrome geometry
    /// still paints, so the regression is silent at the GPUI layer; only
    /// observing the live text system catches it.
    ///
    /// We construct the real headless macOS platform via
    /// `gpui_platform::current_platform(true)` and ask its
    /// `PlatformTextSystem` for the font catalog.  A healthy
    /// `MacTextSystem` (CoreText-backed) returns hundreds of system
    /// fonts; `NoopTextSystem` returns zero.  Picking a generous floor
    /// of 50 leaves room for trimmed macOS installs while still firing
    /// hard the moment the platform falls back to `NoopTextSystem`.
    ///
    /// Discovered in Phase 6-MVP verification — see
    /// `docs/plans/native-gpui-chrome/progress.md`.  This test is a
    /// plain `#[test]` (not `#[gpui::test]`) because `TestPlatform::new`
    /// hard-codes `NoopTextSystem` regardless of feature flags, so
    /// `TestAppContext` cannot distinguish the two configurations.
    #[test]
    fn platform_text_system_enumerates_system_fonts() {
        let platform = gpui_platform::current_platform(true);
        let text_system = platform.text_system();
        let names = text_system.all_font_names();
        assert!(
            names.len() > 50,
            "PlatformTextSystem::all_font_names() returned {} font(s): \
             {names:?}.\n\nThis is the symptom of `gpui_platform` being \
             built without the `font-kit` feature — `gpui_macos::\
             MacPlatform::new` then falls back to `gpui::NoopTextSystem`, \
             whose font list is empty, and the whole UI ships with \
             invisible glyphs.  Re-add `\"font-kit\"` to the workspace \
             `gpui_platform` feature list in `Cargo.toml`.",
            names.len(),
        );
    }

    /// Worklist 2.1 — end-to-end check that a sidebar selection event
    /// drives the note-list-pane header through the workspace event
    /// subscription, exactly as the live app wires them in
    /// `cx.open_window`.  We rebuild the subscription here in isolation
    /// (the live `cx.open_window` path requires a real window) so the
    /// contract — `SidebarPanel::select` → `SidebarSelectionChangedEvent`
    /// → `NoteListPane::set_header_title` — stays guarded even if the
    /// scope-routing block in `main` is refactored.
    #[gpui::test]
    fn sidebar_selection_updates_note_list_header(cx: &mut TestAppContext) {
        use gpui::AppContext as _;
        use note_list_pane::NoteListPane;
        use sidebar_panel::{SidebarPanel, SidebarSelection, SidebarSelectionChangedEvent};

        cx.update(gpui_component::init);

        let sidebar = cx.update(|cx| cx.new(|_| SidebarPanel::new()));
        let note_list = cx.update(|cx| cx.new(|_| NoteListPane::new()));

        cx.update(|cx| {
            let list = note_list.clone();
            cx.subscribe(
                &sidebar,
                move |_panel, event: &SidebarSelectionChangedEvent, cx| {
                    let label = event.display_label.clone();
                    list.update(cx, |pane: &mut NoteListPane, cx| {
                        pane.set_header_title(label, cx);
                    });
                },
            )
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            sidebar.update(cx, |panel: &mut SidebarPanel, cx| {
                panel.select(SidebarSelection::Archive, cx);
            });
        });
        cx.run_until_parked();

        let header = cx.update(|cx| note_list.read(cx).header_title().clone());
        assert_eq!(
            header.as_ref(),
            "Archive",
            "sidebar Archive selection must propagate to the note-list header",
        );

        cx.update(|cx| {
            sidebar.update(cx, |panel: &mut SidebarPanel, cx| {
                panel.select(SidebarSelection::Type("Events".into()), cx);
            });
        });
        cx.run_until_parked();
        let header = cx.update(|cx| note_list.read(cx).header_title().clone());
        assert_eq!(header.as_ref(), "Events");
    }
}
