//! Native macOS menu bar for Tolaria (ADR-0115 Phase 1).
//!
//! Mirrors `crates/embed_poc/src/menus.rs` but imports actions from the
//! `actions` crate instead of re-declaring them. The Edit menu uses
//! `MenuItem::os_action` so AppKit's standard `cut:` / `copy:` / `paste:` /
//! `undo:` / `redo:` / `selectAll:` selectors keep routing into the focused
//! WKWebView unchanged (ADR-0115 §6).

use actions::{
    CloseTab, CloseWindow, EditCopy, EditCut, EditPaste, EditRedo, EditSelectAll, EditUndo,
    NewNote, OpenSettings, Quit, Save, ToggleInspector, ToggleSidebar,
};
use gpui::{Menu, MenuItem, OsAction};

/// Build the application menu bar.
///
/// Call via `cx.set_menus(app_menus())` before the first window opens so
/// AppKit picks up the accelerators immediately.
pub fn app_menus() -> Vec<Menu> {
    vec![
        Menu {
            name: "Tolaria".into(),
            disabled: false,
            items: vec![MenuItem::action("Quit Tolaria", Quit)],
        },
        Menu {
            name: "File".into(),
            disabled: false,
            items: vec![
                MenuItem::action("New Note", NewNote),
                MenuItem::action("Save", Save),
                MenuItem::separator(),
                MenuItem::action("Open Settings…", OpenSettings),
            ],
        },
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
        },
        // Standard macOS Window menu.  Routes window-affecting actions
        // through AppKit's menu system so the dispatch reaches the
        // focused window's first responder directly — avoids the
        // `cx.active_window() → handle.update` lookup that occasionally
        // races with a stale handle when the keymap fires before the
        // window claims focus.  The same actions are also bound in the
        // keymap (assets/default.json); both code paths share the
        // global `cx.on_action` handlers installed in `main.rs`.
        Menu {
            name: "Window".into(),
            disabled: false,
            items: vec![
                MenuItem::action("Close Window", CloseWindow),
                MenuItem::action("Close Tab", CloseTab),
                MenuItem::separator(),
                MenuItem::action("Toggle Sidebar", ToggleSidebar),
                MenuItem::separator(),
                MenuItem::action("Toggle Inspector", ToggleInspector),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity-check the menu skeleton: four top-level menus with the expected
    /// item counts.  Tolaria / File / Edit / Window — matches the standard
    /// macOS menu-bar layout for a single-window editor.
    #[test]
    fn app_menus_lists_app_file_edit_and_window_with_save_and_quit() {
        let menus = app_menus();
        let names: Vec<_> = menus.iter().map(|m| m.name.to_string()).collect();
        assert_eq!(names, vec!["Tolaria", "File", "Edit", "Window"]);

        // App menu: just Quit.
        let app_menu = menus
            .iter()
            .find(|m| m.name == "Tolaria")
            .expect("app_menus() must include the Tolaria menu");
        assert_eq!(app_menu.items.len(), 1, "App menu should hold just Quit");

        // File menu: New Note / Save / separator / Open Settings… = 4 entries.
        let file = menus
            .iter()
            .find(|m| m.name == "File")
            .expect("app_menus() must include the File menu");
        assert_eq!(
            file.items.len(),
            4,
            "File menu should hold New Note/Save/sep/Open Settings (4 entries)"
        );

        // Edit menu: Undo/Redo/sep/Cut/Copy/Paste/sep/SelectAll = 8 entries.
        let edit = menus
            .iter()
            .find(|m| m.name == "Edit")
            .expect("app_menus() must include the Edit menu");
        assert_eq!(
            edit.items.len(),
            8,
            "Edit menu should hold Undo/Redo/sep/Cut/Copy/Paste/sep/SelectAll (8 entries)"
        );

        // Window menu: Close Window / Close Tab / sep / Toggle Sidebar /
        // sep / Toggle Inspector = 6 entries.
        let window = menus
            .iter()
            .find(|m| m.name == "Window")
            .expect("app_menus() must include the Window menu");
        assert_eq!(
            window.items.len(),
            6,
            "Window menu should hold CloseWindow / CloseTab / sep / \
             ToggleSidebar / sep / ToggleInspector (6 entries)"
        );
    }
}
