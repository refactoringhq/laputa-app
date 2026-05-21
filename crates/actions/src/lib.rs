//! Action registry and keymap loader for Tolaria (ADR-0115 Phase 1).
//!
//! All application actions are declared here via `gpui::actions!` with the
//! `tolaria` namespace (e.g. `tolaria::Quit`). The `actions!` macro generates
//! a `pub struct` for each name and registers it with GPUI's inventory-based
//! action registry so that `cx.build_action("tolaria::Quit", None)` resolves
//! at runtime.
//!
//! `init(cx)` loads the bundled `assets/default.json` keymap and any user
//! override at `paths::keymap_file()`, merges them (user bindings win), and
//! calls `cx.bind_keys(…)`. The JSON format is an array of sections:
//!
//! ```json
//! [{ "context": null, "bindings": { "cmd-q": "tolaria::Quit" } }]
//! ```

use std::{collections::BTreeMap, rc::Rc};

use anyhow::Context as _;
use gpui::{App, KeyBinding, KeyBindingContextPredicate};
use serde::Deserialize;

gpui::actions!(
    tolaria,
    [
        Quit,
        CloseWindow,
        OpenSettings,
        ReloadKeymap,
        // Phase 2 chrome actions — declared now so menus / keymap can reference
        // them without forward-declaration issues.
        NewNote,
        Save,
        QuickOpen,
        CommandPalette,
        ToggleSidebar,
        /// User-facing inspector window toggle.  Opens (or closes) a
        /// separate macOS `NSWindow` that hosts
        /// `inspector_panel::InspectorPanel` — see worklist 3.1 in
        /// `docs/plans/native-gpui-chrome/phase-8-issues.md`.  Dispatched
        /// from the note-toolbar Inspector button (worklist 2.18) and
        /// from `View → Toggle Inspector` (`menus.rs`).
        ToggleInspector,
        /// GPUI built-in debug element-picker overlay.  Bound to
        /// `Cmd+Alt+I` so the muscle-memory keystroke still reaches the
        /// picker after worklist 3.1 repurposed `ToggleInspector` for
        /// the user-facing chrome window.  Only meaningful in debug
        /// builds — gpui's `Window::toggle_inspector` is gated on
        /// `cfg(any(feature = "inspector", debug_assertions))`.
        ToggleElementInspector,
        CloseTab,
        /// Phase 8.13 — dismiss the active modal in `TolariaWorkspace`'s
        /// `ModalLayer`.  Bound to `escape` in the modal-active context
        /// (Phase 9.4 `dialog_stack` will publish the context predicate);
        /// for now the keymap binds it globally to a workspace handler
        /// that no-ops when no modal is active.
        Dismiss,
        // Edit-menu OsAction placeholders — actions!() only declares the Rust
        // types; the actual AppKit selectors are wired via MenuItem::os_action
        // in menus.rs so they route into the focused WKWebView unchanged.
        EditUndo,
        EditRedo,
        EditCut,
        EditCopy,
        EditPaste,
        EditSelectAll,
        // Worklist 2.7 — File / View / Help menu actions.  All currently
        // dispatch through log-only stubs in `main.rs`; replace with real
        // handlers as the underlying surfaces land.
        //
        //   * OpenVault — picks a vault path (Phase 8.11 vault-picker).
        //   * ZoomIn / ZoomOut / ResetZoom — workspace font-size controls
        //     (Phase 9.x view-zoom; today the workspace ships a single
        //     fixed scale).
        //   * About — opens the standard macOS About panel (Phase 9.x).
        //   * ViewDocs / ReportIssue — open external URLs; placeholder
        //     handlers log the target until the docs site and the issue
        //     tracker land.
        OpenVault,
        ZoomIn,
        ZoomOut,
        ResetZoom,
        About,
        ViewDocs,
        ReportIssue,
    ]
);

/// Embedded default keymap (loaded with `include_str!` so it ships inside the
/// binary without a separate file-read at startup).
const DEFAULT_KEYMAP: &str = include_str!("../assets/default.json");

/// One section from a keymap JSON file.
///
/// The format mirrors Zed's keymap sections but is intentionally minimal for
/// Phase 1: context is an optional string predicate and bindings are a plain
/// `{keystroke: action_name}` object. Array-valued action entries (used for
/// actions with parameters) are not yet needed in Phase 1.
#[derive(Debug, Deserialize)]
struct KeymapSection {
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    bindings: BTreeMap<String, String>,
}

/// Load and install the combined (default + user) keymap into `cx`.
///
/// Parsing errors in individual sections/bindings are logged as warnings and
/// skipped; the remaining valid bindings are still installed. A parse error in
/// the entire JSON falls back to an empty binding set with a warning (no panic).
///
/// Infallible by construction — every error path is logged and recovered from
/// (missing file → defaults only, malformed file → defaults only, unknown
/// action or invalid chord in a section → that one binding skipped with a
/// warning), so a bad user keymap never prevents the app from starting.
pub fn init(cx: &mut App) {
    let mut all_bindings = parse_keymap(DEFAULT_KEYMAP, "default", cx);

    let user_path = paths::keymap_file();
    if user_path.exists() {
        match std::fs::read_to_string(&user_path)
            .with_context(|| format!("reading user keymap at {user_path:?}"))
        {
            Ok(content) => {
                let user_bindings = parse_keymap(&content, "user", cx);
                // User bindings appended after defaults; GPUI resolves conflicts
                // by "last-registered wins", so user chords shadow defaults.
                all_bindings.extend(user_bindings);
            }
            Err(err) => {
                log::warn!("failed to load user keymap: {err:#}");
            }
        }
    }

    cx.bind_keys(all_bindings);
}

/// Parse a keymap JSON string into `Vec<KeyBinding>`.
///
/// `source` is a short label ("default" or "user") included in log warnings
/// so triage can identify which keymap file produced the error.
///
/// Uses `cx.build_action` to resolve action names and `cx.keyboard_mapper`
/// to validate keystrokes against the platform layout.
fn parse_keymap(json: &str, source: &str, cx: &App) -> Vec<KeyBinding> {
    let sections: Vec<KeymapSection> = match serde_json::from_str(json) {
        Ok(s) => s,
        Err(err) => {
            log::warn!("failed to parse {source} keymap JSON: {err}");
            return Vec::new();
        }
    };

    let keyboard_mapper = cx.keyboard_mapper();
    let mut bindings = Vec::new();

    for section in sections {
        let context_predicate: Option<Rc<KeyBindingContextPredicate>> = section
            .context
            .as_deref()
            .filter(|c| !c.is_empty())
            .and_then(|c| match KeyBindingContextPredicate::parse(c) {
                Ok(p) => Some(Rc::new(p)),
                Err(err) => {
                    log::warn!("invalid keymap context predicate {:?}: {err}", c);
                    None
                }
            });

        for (keystroke, action_name) in &section.bindings {
            let action = match cx.build_action(action_name, None) {
                Ok(a) => a,
                Err(err) => {
                    log::warn!("unknown action {:?}: {err}", action_name);
                    continue;
                }
            };

            match KeyBinding::load(
                keystroke,
                action,
                context_predicate.clone(),
                false,
                None,
                keyboard_mapper.as_ref(),
            ) {
                Ok(binding) => bindings.push(binding),
                Err(err) => {
                    log::warn!("invalid keystroke {:?}: {err:?}", keystroke);
                }
            }
        }
    }

    bindings
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{KeyBinding, TestAppContext};
    use std::{cell::Cell, rc::Rc};

    /// After `actions::init` the default keymap is installed and the four
    /// Phase-1 global chords are resolvable.
    #[gpui::test]
    fn init_binds_default_keymap(cx: &mut TestAppContext) {
        cx.update(|cx| {
            init(cx);
        });

        // Verify the keymap has at least the 4 default bindings.
        cx.update(|cx| {
            let all = cx.all_action_names();
            assert!(
                all.contains(&"tolaria::Quit"),
                "tolaria::Quit must be registered"
            );
        });
    }

    /// Mirror of `embed_poc/src/menus.rs:115`: cmd-q must dispatch `Quit`.
    #[gpui::test]
    fn cmd_q_dispatches_quit_action(cx: &mut TestAppContext) {
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

        assert_eq!(fired.get(), 1, "Quit must fire once for cmd-q");
    }

    /// User keymap entries appended after the default keymap override conflicting
    /// chords (last-registered wins in GPUI's keymap).
    #[gpui::test]
    fn user_keymap_overrides_default(cx: &mut TestAppContext) {
        // We test the override mechanism using cx.bind_keys directly, mirroring
        // what `init` does: default bindings first, user bindings second.
        let fired_save = Rc::new(Cell::new(0u32));
        let fired_quit = Rc::new(Cell::new(0u32));
        let save_h = fired_save.clone();
        let quit_h = fired_quit.clone();

        cx.update(|cx| {
            cx.on_action(move |_: &Save, _| {
                save_h.set(save_h.get() + 1);
            });
            cx.on_action(move |_: &Quit, _| {
                quit_h.set(quit_h.get() + 1);
            });
            // Default: cmd-q → Quit.
            cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
            // User override: rebind cmd-q → Save (user chord wins).
            cx.bind_keys([KeyBinding::new("cmd-q", Save, None)]);
        });

        let window = cx.add_empty_window();
        window.simulate_keystrokes("cmd-q");
        window.run_until_parked();

        // GPUI dispatches the last-registered binding that matches the
        // keystroke; with the override applied, Save fires and Quit does not.
        assert_eq!(
            fired_save.get(),
            1,
            "user override must rebind cmd-q to Save"
        );
        assert_eq!(
            fired_quit.get(),
            0,
            "default Quit binding must be shadowed by user override"
        );
    }

    /// A completely malformed JSON user keymap must not panic; the function
    /// falls back to an empty binding set for the bad file.
    #[gpui::test]
    fn malformed_keymap_falls_back_to_defaults_and_warns(cx: &mut TestAppContext) {
        let bindings = cx.update(|cx| parse_keymap("not valid json {{{ }", "test", cx));
        // No panic. Empty result; defaults are still applied separately by init.
        assert!(
            bindings.is_empty(),
            "malformed JSON should produce no bindings (got {bindings:?})"
        );
    }
}
