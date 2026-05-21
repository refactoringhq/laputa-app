//! Native macOS menu bar for Tolaria (ADR-0115 Phase 1).
//!
//! Mirrors `crates/embed_poc/src/menus.rs` but imports actions from the
//! `actions` crate instead of re-declaring them. The Edit menu uses
//! `MenuItem::os_action` so AppKit's standard `cut:` / `copy:` / `paste:` /
//! `undo:` / `redo:` / `selectAll:` selectors keep routing into the focused
//! WKWebView unchanged (ADR-0115 §6).
//!
//! Worklist 2.7 expanded the menu bar to a six-submenu layout —
//! Tolaria / File / Edit / View / Window / Help — that matches the
//! standard macOS app convention so muscle-memory for File→Save,
//! View→Toggle Sidebar, and Help→About lands without surprises.
//! Stub-but-wired items (Open Vault…, Zoom In/Out, View Docs, Report
//! Issue) dispatch through log-only handlers in `main.rs` and carry a
//! `TODO(worklist-2.7)` comment beside their action declaration in
//! `crates/actions/src/lib.rs`.

use actions::{
    About, CloseTab, CloseWindow, EditCopy, EditCut, EditPaste, EditRedo, EditSelectAll, EditUndo,
    NewNote, OpenSettings, OpenVault, Quit, ReportIssue, ResetZoom, Save, ToggleInspector,
    ToggleSidebar, ViewDocs, ZoomIn, ZoomOut,
};
use gpui::{Menu, MenuItem, OsAction};

/// Snapshot of the workspace state the menu labels depend on.
///
/// Worklist 3.2 — the View menu's two toggle entries pick their label
/// from the current sidebar / inspector state (`"Show Sidebar"` vs
/// `"Hide Sidebar"`, `"Show Inspector"` vs `"Hide Inspector"`) instead
/// of the static `"Toggle …"` verbs.  Passed by value because both
/// fields are `bool` and the struct lives only for the duration of one
/// `cx.set_menus(...)` call — `MenuState` is intentionally not a
/// `gpui::Global` (the workspace already owns sidebar state and the
/// inspector slot already owns inspector state; this is derived).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MenuState {
    /// Whether the workspace's left dock (sidebar) is currently open.
    pub sidebar_open: bool,
    /// Whether the inspector window is currently tracked as open.
    pub inspector_open: bool,
}

/// Build the application menu bar.
///
/// Call via `cx.set_menus(app_menus(MenuState::default()))` before the
/// first window opens so AppKit picks up the accelerators immediately;
/// then re-call with a fresh [`MenuState`] from the action handlers
/// whenever sidebar / inspector state changes (worklist 3.2).
pub fn app_menus(state: MenuState) -> Vec<Menu> {
    vec![
        app_menu(),
        file_menu(),
        edit_menu(),
        view_menu(state),
        window_menu(),
        help_menu(),
    ]
}

/// Standard macOS App menu — "Tolaria" — that owns About and Quit.
///
/// About sits at the top per AppKit convention; Quit lives at the
/// bottom with the standard `Cmd+Q` accelerator (bound globally in
/// `assets/default.json`).
fn app_menu() -> Menu {
    Menu {
        name: "Tolaria".into(),
        disabled: false,
        items: vec![
            MenuItem::action("About Tolaria", About),
            MenuItem::separator(),
            MenuItem::action("Settings…", OpenSettings),
            MenuItem::separator(),
            MenuItem::action("Quit Tolaria", Quit),
        ],
    }
}

/// File menu.  Houses note / vault lifecycle plus the standard "Close
/// Window" exit affordance.  `Close Tab` keeps `Cmd+W` (mirroring the
/// browser-tab convention used inside the workspace); `Close Window`
/// gets `Cmd+Shift+W` so both verbs are reachable without ambiguity.
fn file_menu() -> Menu {
    Menu {
        name: "File".into(),
        disabled: false,
        items: vec![
            MenuItem::action("New Note", NewNote),
            MenuItem::separator(),
            MenuItem::action("Open Vault…", OpenVault),
            MenuItem::separator(),
            MenuItem::action("Save", Save),
            MenuItem::separator(),
            MenuItem::action("Close Tab", CloseTab),
            MenuItem::action("Close Window", CloseWindow),
        ],
    }
}

/// Edit menu — wires AppKit's standard selectors so the focused
/// WKWebView keeps receiving cut/copy/paste/undo/redo/selectAll
/// directly (ADR-0115 §6).  Untouched by worklist 2.7.
fn edit_menu() -> Menu {
    Menu {
        name: "Edit".into(),
        disabled: false,
        items: vec![
            MenuItem::os_action("Undo", EditUndo, OsAction::Undo),
            MenuItem::os_action("Redo", EditRedo, OsAction::Redo),
            MenuItem::separator(),
            MenuItem::os_action("Cut", EditCut, OsAction::Cut),
            MenuItem::os_action("Copy", EditCopy, OsAction::Copy),
            MenuItem::os_action("Paste", EditPaste, OsAction::Paste),
            MenuItem::separator(),
            MenuItem::os_action("Select All", EditSelectAll, OsAction::SelectAll),
        ],
    }
}

/// View menu — sidebar / inspector toggles plus the standard
/// zoom-in / zoom-out / reset-zoom triplet.  Zoom commands are
/// stub-but-wired (Phase 9.x will implement workspace font-size
/// scaling); the menu entries are in place so the muscle-memory
/// accelerators behave the same as any other macOS editor.
///
/// Worklist 3.2 — the sidebar / inspector entries flip between
/// `"Show …"` and `"Hide …"` based on [`MenuState`] so the menu
/// reflects the current visibility instead of the static
/// `"Toggle …"` verb.  Three trigger points (initial set, sidebar
/// action handler, inspector action handler in `main.rs`) rebuild the
/// whole menu via `cx.set_menus(app_menus(...))` so the label tracks
/// state across every dispatch vector (menu click, Cmd accelerator,
/// title-bar / note-toolbar buttons).
fn view_menu(state: MenuState) -> Menu {
    let sidebar_label = if state.sidebar_open {
        "Hide Sidebar"
    } else {
        "Show Sidebar"
    };
    let inspector_label = if state.inspector_open {
        "Hide Inspector"
    } else {
        "Show Inspector"
    };
    Menu {
        name: "View".into(),
        disabled: false,
        items: vec![
            MenuItem::action(sidebar_label, ToggleSidebar),
            MenuItem::action(inspector_label, ToggleInspector),
            MenuItem::separator(),
            MenuItem::action("Zoom In", ZoomIn),
            MenuItem::action("Zoom Out", ZoomOut),
            MenuItem::action("Actual Size", ResetZoom),
        ],
    }
}

/// Window menu — kept narrow (just `Close Window`) now that the tab
/// / sidebar / inspector verbs have moved to File and View.  Leaving
/// the menu in place preserves the macOS "Window" slot AppKit
/// expects between View and Help.
fn window_menu() -> Menu {
    Menu {
        name: "Window".into(),
        disabled: false,
        items: vec![MenuItem::action("Close Window", CloseWindow)],
    }
}

/// Help menu — About reuses the standard AppKit panel via the same
/// `About` action surfaced under the Tolaria menu; the documentation
/// and issue-tracker links land as stub-but-wired log handlers
/// (Phase 9.x replaces them with `open::that(...)` once the docs
/// site and issue tracker have stable URLs).
fn help_menu() -> Menu {
    Menu {
        name: "Help".into(),
        disabled: false,
        items: vec![
            MenuItem::action("Tolaria Documentation", ViewDocs),
            MenuItem::action("Report Issue…", ReportIssue),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity-check the menu skeleton: six top-level menus matching the
    /// macOS convention App / File / Edit / View / Window / Help.  Each
    /// helper owns its own item-count assertion below so regressions
    /// pinpoint the affected submenu.
    #[test]
    fn app_menus_lists_app_file_edit_view_window_help() {
        let menus = app_menus(MenuState::default());
        let names: Vec<_> = menus.iter().map(|m| m.name.to_string()).collect();
        assert_eq!(
            names,
            vec!["Tolaria", "File", "Edit", "View", "Window", "Help"]
        );
    }

    use ItemKind::{Action, Separator};

    /// Expected shape of a menu item — single source of truth for
    /// per-test schema assertions.  See [`assert_menu_schema`].
    #[derive(Debug)]
    enum ItemKind {
        Separator,
        Action(&'static str),
    }

    /// Assert the menu's name and item layout match `expected` exactly.
    /// Length and per-position kind/name are checked together so a
    /// reorder failure points at the divergent slot, not at a stale
    /// count assertion further up.
    #[track_caller]
    fn assert_menu_schema(menu: &Menu, expected_name: &str, expected: &[ItemKind]) {
        assert_eq!(menu.name.as_ref(), expected_name);
        assert_eq!(
            menu.items.len(),
            expected.len(),
            "{expected_name} item count"
        );
        for (i, (actual, want)) in menu.items.iter().zip(expected).enumerate() {
            match (actual, want) {
                (MenuItem::Separator, ItemKind::Separator) => {}
                (MenuItem::Action { name, .. }, ItemKind::Action(label)) => {
                    assert_eq!(name.as_ref(), *label, "{expected_name}[{i}]");
                }
                _ => {
                    let actual_kind = match actual {
                        MenuItem::Separator => "separator",
                        MenuItem::Action { .. } => "action",
                        MenuItem::Submenu(_) => "submenu",
                        _ => "other",
                    };
                    panic!("{expected_name}[{i}]: mismatch (want {want:?}, got {actual_kind})");
                }
            }
        }
    }

    /// App menu: About / sep / Settings / sep / Quit.
    #[test]
    fn app_menu_holds_about_settings_quit() {
        assert_menu_schema(
            &app_menu(),
            "Tolaria",
            &[
                Action("About Tolaria"),
                Separator,
                Action("Settings…"),
                Separator,
                Action("Quit Tolaria"),
            ],
        );
    }

    /// File menu: New / sep / Open / sep / Save / sep / Close Tab / Close Window.
    #[test]
    fn file_menu_holds_new_open_save_close() {
        assert_menu_schema(
            &file_menu(),
            "File",
            &[
                Action("New Note"),
                Separator,
                Action("Open Vault…"),
                Separator,
                Action("Save"),
                Separator,
                Action("Close Tab"),
                Action("Close Window"),
            ],
        );
    }

    /// Edit menu unchanged from Phase 1: 8 entries.  Names are
    /// AppKit-provided so we only pin the count here.
    #[test]
    fn edit_menu_holds_standard_os_actions() {
        let menu = edit_menu();
        assert_eq!(menu.name.as_ref(), "Edit");
        assert_eq!(menu.items.len(), 8);
    }

    /// View menu (default state — both closed): "Show Sidebar" /
    /// "Show Inspector" / sep / ZoomIn / ZoomOut / Actual Size.
    /// Worklist 3.2 makes the first two labels state-driven.
    #[test]
    fn view_menu_shows_show_labels_when_state_closed() {
        assert_menu_schema(
            &view_menu(MenuState::default()),
            "View",
            &[
                Action("Show Sidebar"),
                Action("Show Inspector"),
                Separator,
                Action("Zoom In"),
                Action("Zoom Out"),
                Action("Actual Size"),
            ],
        );
    }

    /// View menu (both open): labels flip to "Hide Sidebar" / "Hide
    /// Inspector".  Worklist 3.2 — the menu rebuild driven from the
    /// action handlers in `main.rs` is what keeps these in sync with
    /// the workspace + inspector slot state.
    #[test]
    fn view_menu_shows_hide_labels_when_state_open() {
        assert_menu_schema(
            &view_menu(MenuState {
                sidebar_open: true,
                inspector_open: true,
            }),
            "View",
            &[
                Action("Hide Sidebar"),
                Action("Hide Inspector"),
                Separator,
                Action("Zoom In"),
                Action("Zoom Out"),
                Action("Actual Size"),
            ],
        );
    }

    /// Mixed state: sidebar open, inspector closed.  Guards the
    /// independence of the two labels — flipping one must not bleed
    /// into the other.
    #[test]
    fn view_menu_labels_track_each_axis_independently() {
        let menu = view_menu(MenuState {
            sidebar_open: true,
            inspector_open: false,
        });
        assert_menu_schema(
            &menu,
            "View",
            &[
                Action("Hide Sidebar"),
                Action("Show Inspector"),
                Separator,
                Action("Zoom In"),
                Action("Zoom Out"),
                Action("Actual Size"),
            ],
        );
    }

    /// Window menu trimmed to just Close Window now that the tab /
    /// sidebar / inspector verbs live under File and View.
    #[test]
    fn window_menu_holds_close_window() {
        assert_menu_schema(&window_menu(), "Window", &[Action("Close Window")]);
    }

    /// Help menu: View Docs / Report Issue.  About intentionally
    /// lives only under the Tolaria menu per AppKit convention.
    #[test]
    fn help_menu_holds_docs_and_report_issue() {
        assert_menu_schema(
            &help_menu(),
            "Help",
            &[Action("Tolaria Documentation"), Action("Report Issue…")],
        );
    }

    /// Tiny assertion helper — panics with a clear message when the
    /// matched item is a separator/submenu instead of the expected
    /// labelled action.  Kept for any future call site that wants to
    /// assert a single item in isolation.
    #[allow(dead_code)]
    #[track_caller]
    fn assert_action_named(item: &MenuItem, expected: &str) {
        match item {
            MenuItem::Action { name, .. } => assert_eq!(name.as_ref(), expected),
            MenuItem::Separator => panic!("expected action {expected:?}, got separator"),
            MenuItem::Submenu(_) => panic!("expected action {expected:?}, got submenu"),
            MenuItem::SystemMenu(_) => panic!("expected action {expected:?}, got system menu"),
        }
    }
}
