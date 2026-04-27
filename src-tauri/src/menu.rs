use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, MenuItemKind, Submenu, SubmenuBuilder},
    App, AppHandle, Emitter,
};

// Custom menu item IDs that emit events to the frontend.
const APP_SETTINGS: &str = "app-settings";
const APP_CHECK_FOR_UPDATES: &str = "app-check-for-updates";

const FILE_NEW_NOTE: &str = "file-new-note";
const FILE_NEW_TYPE: &str = "file-new-type";
const FILE_QUICK_OPEN: &str = "file-quick-open";
const FILE_QUICK_OPEN_ALIAS: &str = "file-quick-open-alias";
const FILE_SAVE: &str = "file-save";

const EDIT_FIND_IN_NOTE: &str = "edit-find-in-note";
const EDIT_REPLACE_IN_NOTE: &str = "edit-replace-in-note";
const EDIT_FIND_IN_VAULT: &str = "edit-find-in-vault";
const EDIT_TOGGLE_NOTE_LIST_SEARCH: &str = "edit-toggle-note-list-search";
const EDIT_TOGGLE_RAW_EDITOR: &str = "edit-toggle-raw-editor";
const EDIT_TOGGLE_DIFF: &str = "edit-toggle-diff";

const VIEW_EDITOR_ONLY: &str = "view-editor-only";
const VIEW_EDITOR_LIST: &str = "view-editor-list";
const VIEW_ALL: &str = "view-all";
const VIEW_TOGGLE_PROPERTIES: &str = "view-toggle-properties";
const VIEW_TOGGLE_AI_CHAT: &str = "view-toggle-ai-chat";
const VIEW_TOGGLE_BACKLINKS: &str = "view-toggle-backlinks";
const VIEW_COMMAND_PALETTE: &str = "view-command-palette";
const VIEW_ZOOM_IN: &str = "view-zoom-in";
const VIEW_ZOOM_OUT: &str = "view-zoom-out";
const VIEW_ZOOM_RESET: &str = "view-zoom-reset";
const VIEW_GO_BACK: &str = "view-go-back";
const VIEW_GO_FORWARD: &str = "view-go-forward";

const GO_ALL_NOTES: &str = "go-all-notes";
const GO_ARCHIVED: &str = "go-archived";
const GO_CHANGES: &str = "go-changes";
const GO_INBOX: &str = "go-inbox";

const NOTE_TOGGLE_ORGANIZED: &str = "note-toggle-organized";
const NOTE_ARCHIVE: &str = "note-archive";
const NOTE_DELETE: &str = "note-delete";
const NOTE_OPEN_IN_NEW_WINDOW: &str = "note-open-in-new-window";
const NOTE_RESTORE_DELETED: &str = "note-restore-deleted";

const VAULT_OPEN: &str = "vault-open";
const VAULT_REMOVE: &str = "vault-remove";
const VAULT_RESTORE_GETTING_STARTED: &str = "vault-restore-getting-started";
const VAULT_ADD_REMOTE: &str = "vault-add-remote";
const VAULT_COMMIT_PUSH: &str = "vault-commit-push";
const VAULT_PULL: &str = "vault-pull";
const VAULT_RESOLVE_CONFLICTS: &str = "vault-resolve-conflicts";
const VAULT_VIEW_CHANGES: &str = "vault-view-changes";
const VAULT_INSTALL_MCP: &str = "vault-install-mcp";
const VAULT_RELOAD: &str = "vault-reload";
const VAULT_REPAIR: &str = "vault-repair";

const CUSTOM_IDS: &[&str] = &[
    APP_SETTINGS,
    APP_CHECK_FOR_UPDATES,
    FILE_NEW_NOTE,
    FILE_NEW_TYPE,
    FILE_QUICK_OPEN,
    FILE_QUICK_OPEN_ALIAS,
    FILE_SAVE,
    EDIT_FIND_IN_NOTE,
    EDIT_REPLACE_IN_NOTE,
    EDIT_FIND_IN_VAULT,
    EDIT_TOGGLE_NOTE_LIST_SEARCH,
    EDIT_TOGGLE_RAW_EDITOR,
    EDIT_TOGGLE_DIFF,
    VIEW_EDITOR_ONLY,
    VIEW_EDITOR_LIST,
    VIEW_ALL,
    VIEW_TOGGLE_PROPERTIES,
    VIEW_TOGGLE_AI_CHAT,
    VIEW_TOGGLE_BACKLINKS,
    VIEW_COMMAND_PALETTE,
    VIEW_ZOOM_IN,
    VIEW_ZOOM_OUT,
    VIEW_ZOOM_RESET,
    VIEW_GO_BACK,
    VIEW_GO_FORWARD,
    GO_ALL_NOTES,
    GO_ARCHIVED,
    GO_CHANGES,
    GO_INBOX,
    NOTE_TOGGLE_ORGANIZED,
    NOTE_ARCHIVE,
    NOTE_DELETE,
    NOTE_OPEN_IN_NEW_WINDOW,
    NOTE_RESTORE_DELETED,
    VAULT_OPEN,
    VAULT_REMOVE,
    VAULT_RESTORE_GETTING_STARTED,
    VAULT_ADD_REMOTE,
    VAULT_COMMIT_PUSH,
    VAULT_PULL,
    VAULT_RESOLVE_CONFLICTS,
    VAULT_VIEW_CHANGES,
    VAULT_INSTALL_MCP,
    VAULT_RELOAD,
    VAULT_REPAIR,
];

/// IDs of menu items that should be disabled when no note tab is active.
const NOTE_DEPENDENT_IDS: &[&str] = &[
    FILE_SAVE,
    NOTE_TOGGLE_ORGANIZED,
    NOTE_ARCHIVE,
    NOTE_DELETE,
    EDIT_TOGGLE_RAW_EDITOR,
    EDIT_TOGGLE_DIFF,
    VIEW_TOGGLE_BACKLINKS,
    NOTE_OPEN_IN_NEW_WINDOW,
];

/// IDs of menu items that depend on the editor being the active surface.
const EDITOR_FIND_DEPENDENT_IDS: &[&str] = &[EDIT_FIND_IN_NOTE, EDIT_REPLACE_IN_NOTE];

/// IDs of menu items that depend on the note list being the active surface.
const NOTE_LIST_SEARCH_DEPENDENT_IDS: &[&str] = &[EDIT_TOGGLE_NOTE_LIST_SEARCH];

/// IDs of menu items that depend on a deleted-note preview being active.
const RESTORE_DELETED_DEPENDENT_IDS: &[&str] = &[NOTE_RESTORE_DELETED];

/// IDs of menu items that depend on having uncommitted changes.
const GIT_COMMIT_DEPENDENT_IDS: &[&str] = &[VAULT_COMMIT_PUSH];

/// IDs of menu items that depend on having merge conflicts.
const GIT_CONFLICT_DEPENDENT_IDS: &[&str] = &[VAULT_RESOLVE_CONFLICTS];

/// IDs of menu items that depend on the active vault having no remote configured.
const GIT_NO_REMOTE_DEPENDENT_IDS: &[&str] = &[VAULT_ADD_REMOTE];

type MenuResult = Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>>;

fn build_app_menu(app: &App) -> MenuResult {
    let settings_item = MenuItemBuilder::new("Settings...")
        .id(APP_SETTINGS)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_updates_item = MenuItemBuilder::new("Check for Updates...")
        .id(APP_CHECK_FOR_UPDATES)
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "Tolaria")
        .about(None)
        .separator()
        .item(&check_updates_item)
        .separator()
        .item(&settings_item)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?)
}

fn build_file_menu(app: &App) -> MenuResult {
    let quick_open_alias_label = if cfg!(target_os = "macos") {
        "Quick Open (Cmd+O)"
    } else {
        "Quick Open (Ctrl+O)"
    };
    let new_note = MenuItemBuilder::new("New Note")
        .id(FILE_NEW_NOTE)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_type = MenuItemBuilder::new("New Type")
        .id(FILE_NEW_TYPE)
        .build(app)?;
    let quick_open = MenuItemBuilder::new("Quick Open")
        .id(FILE_QUICK_OPEN)
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let quick_open_alias = MenuItemBuilder::new(quick_open_alias_label)
        .id(FILE_QUICK_OPEN_ALIAS)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save = MenuItemBuilder::new("Save")
        .id(FILE_SAVE)
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    Ok(SubmenuBuilder::new(app, "File")
        .item(&new_note)
        .item(&new_type)
        .item(&quick_open)
        .item(&quick_open_alias)
        .separator()
        .item(&save)
        .build()?)
}

fn build_edit_menu(app: &App) -> MenuResult {
    let find_in_note = MenuItemBuilder::new("Find in Note")
        .id(EDIT_FIND_IN_NOTE)
        .accelerator("CmdOrCtrl+F")
        .enabled(false)
        .build(app)?;
    let replace_in_note = MenuItemBuilder::new("Replace in Note")
        .id(EDIT_REPLACE_IN_NOTE)
        .enabled(false)
        .build(app)?;
    let find_in_vault = MenuItemBuilder::new("Find in Vault")
        .id(EDIT_FIND_IN_VAULT)
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let toggle_note_list_search = MenuItemBuilder::new("Toggle Note List Search")
        .id(EDIT_TOGGLE_NOTE_LIST_SEARCH)
        .accelerator("CmdOrCtrl+F")
        .enabled(false)
        .build(app)?;
    let toggle_diff = MenuItemBuilder::new("Toggle Diff Mode")
        .id(EDIT_TOGGLE_DIFF)
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .separator()
        .item(&find_in_note)
        .item(&replace_in_note)
        .item(&find_in_vault)
        .item(&toggle_note_list_search)
        .item(&toggle_diff)
        .build()?)
}

fn build_view_menu(app: &App) -> MenuResult {
    let editor_only = MenuItemBuilder::new("Editor Only")
        .id(VIEW_EDITOR_ONLY)
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let editor_list = MenuItemBuilder::new("Editor + Notes")
        .id(VIEW_EDITOR_LIST)
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let all_panels = MenuItemBuilder::new("All Panels")
        .id(VIEW_ALL)
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    // Keep Cmd+Shift+I on the renderer path. The menu item stays available,
    // but the native accelerator has proven unreliable for this command.
    let toggle_properties = MenuItemBuilder::new("Toggle Properties Panel")
        .id(VIEW_TOGGLE_PROPERTIES)
        .build(app)?;
    let command_palette = MenuItemBuilder::new("Command Palette")
        .id(VIEW_COMMAND_PALETTE)
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let zoom_in = MenuItemBuilder::new("Zoom In")
        .id(VIEW_ZOOM_IN)
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::new("Zoom Out")
        .id(VIEW_ZOOM_OUT)
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::new("Actual Size")
        .id(VIEW_ZOOM_RESET)
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "View")
        .item(&editor_only)
        .item(&editor_list)
        .item(&all_panels)
        .separator()
        .item(&toggle_properties)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&command_palette)
        .build()?)
}

fn build_go_menu(app: &App) -> MenuResult {
    let all_notes = MenuItemBuilder::new("All Notes")
        .id(GO_ALL_NOTES)
        .build(app)?;
    let archived = MenuItemBuilder::new("Archived")
        .id(GO_ARCHIVED)
        .build(app)?;
    let changes = MenuItemBuilder::new("Changes").id(GO_CHANGES).build(app)?;
    let inbox = MenuItemBuilder::new("Inbox").id(GO_INBOX).build(app)?;
    let go_back = MenuItemBuilder::new("Go Back")
        .id(VIEW_GO_BACK)
        .accelerator("CmdOrCtrl+Left")
        .build(app)?;
    let go_forward = MenuItemBuilder::new("Go Forward")
        .id(VIEW_GO_FORWARD)
        .accelerator("CmdOrCtrl+Right")
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "Go")
        .item(&all_notes)
        .item(&archived)
        .item(&changes)
        .item(&inbox)
        .separator()
        .item(&go_back)
        .item(&go_forward)
        .build()?)
}

fn build_note_menu(app: &App) -> MenuResult {
    let toggle_organized = MenuItemBuilder::new("Toggle Organized")
        .id(NOTE_TOGGLE_ORGANIZED)
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let archive_note = MenuItemBuilder::new("Archive Note")
        .id(NOTE_ARCHIVE)
        .build(app)?;
    let delete_note = MenuItemBuilder::new("Delete Note")
        .id(NOTE_DELETE)
        .accelerator("CmdOrCtrl+Backspace")
        .build(app)?;
    let restore_deleted_note = MenuItemBuilder::new("Restore Deleted Note")
        .id(NOTE_RESTORE_DELETED)
        .enabled(false)
        .build(app)?;
    let open_new_window = MenuItemBuilder::new("Open in New Window")
        .id(NOTE_OPEN_IN_NEW_WINDOW)
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let toggle_raw_editor = MenuItemBuilder::new("Toggle Raw Editor")
        .id(EDIT_TOGGLE_RAW_EDITOR)
        .accelerator("CmdOrCtrl+\\")
        .build(app)?;
    let toggle_ai_chat = MenuItemBuilder::new("Toggle AI Panel")
        .id(VIEW_TOGGLE_AI_CHAT)
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let toggle_backlinks = MenuItemBuilder::new("Toggle Backlinks")
        .id(VIEW_TOGGLE_BACKLINKS)
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "Note")
        .item(&toggle_organized)
        .item(&archive_note)
        .item(&delete_note)
        .item(&restore_deleted_note)
        .separator()
        .item(&open_new_window)
        .separator()
        .item(&toggle_raw_editor)
        .item(&toggle_ai_chat)
        .item(&toggle_backlinks)
        .build()?)
}

fn build_vault_menu(app: &App) -> MenuResult {
    let open_vault = MenuItemBuilder::new("Open Vault…")
        .id(VAULT_OPEN)
        .build(app)?;
    let remove_vault = MenuItemBuilder::new("Remove Vault from List")
        .id(VAULT_REMOVE)
        .build(app)?;
    let restore_getting_started = MenuItemBuilder::new("Restore Getting Started")
        .id(VAULT_RESTORE_GETTING_STARTED)
        .build(app)?;
    let add_remote = MenuItemBuilder::new("Add Remote…")
        .id(VAULT_ADD_REMOTE)
        .enabled(false)
        .build(app)?;
    let commit_push = MenuItemBuilder::new("Commit & Push")
        .id(VAULT_COMMIT_PUSH)
        .build(app)?;
    let pull = MenuItemBuilder::new("Pull from Remote")
        .id(VAULT_PULL)
        .build(app)?;
    let resolve_conflicts = MenuItemBuilder::new("Resolve Conflicts")
        .id(VAULT_RESOLVE_CONFLICTS)
        .enabled(false)
        .build(app)?;
    let view_changes = MenuItemBuilder::new("View Pending Changes")
        .id(VAULT_VIEW_CHANGES)
        .build(app)?;
    let install_mcp = MenuItemBuilder::new("Set Up External AI Tools…")
        .id(VAULT_INSTALL_MCP)
        .build(app)?;
    let reload = MenuItemBuilder::new("Reload Vault")
        .id(VAULT_RELOAD)
        .build(app)?;
    let repair = MenuItemBuilder::new("Repair Vault")
        .id(VAULT_REPAIR)
        .build(app)?;

    Ok(SubmenuBuilder::new(app, "Vault")
        .item(&open_vault)
        .item(&remove_vault)
        .item(&restore_getting_started)
        .separator()
        .item(&add_remote)
        .item(&commit_push)
        .item(&pull)
        .item(&resolve_conflicts)
        .item(&view_changes)
        .separator()
        .item(&reload)
        .item(&repair)
        .item(&install_mcp)
        .build()?)
}

fn build_window_menu(app: &App) -> MenuResult {
    Ok(SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?)
}

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_menu = build_app_menu(app)?;
    let file_menu = build_file_menu(app)?;
    let edit_menu = build_edit_menu(app)?;
    let view_menu = build_view_menu(app)?;
    let go_menu = build_go_menu(app)?;
    let note_menu = build_note_menu(app)?;
    let vault_menu = build_vault_menu(app)?;
    let window_menu = build_window_menu(app)?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&go_menu)
        .item(&note_menu)
        .item(&vault_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(|app_handle, event| {
        let id = event.id().0.as_str();
        let _ = emit_custom_menu_event(app_handle, id);
    });

    Ok(())
}

pub fn emit_custom_menu_event(app_handle: &AppHandle, id: &str) -> Result<(), String> {
    if !CUSTOM_IDS.contains(&id) {
        return Err(format!("Unknown custom menu event: {id}"));
    }
    let emitted_id = match id {
        FILE_QUICK_OPEN_ALIAS => FILE_QUICK_OPEN,
        _ => id,
    };
    app_handle
        .emit("menu-event", emitted_id)
        .map_err(|err| format!("Failed to emit menu-event {emitted_id}: {err}"))
}

fn set_items_enabled(app_handle: &AppHandle, ids: &[&str], enabled: bool) {
    let Some(menu) = app_handle.menu() else {
        return;
    };
    for id in ids {
        if let Some(MenuItemKind::MenuItem(mi)) = menu.get(*id) {
            let _ = mi.set_enabled(enabled);
        }
    }
}

/// Enable or disable menu items that depend on having an active note tab.
pub fn set_note_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, NOTE_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on the editor being the active surface.
pub fn set_editor_find_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, EDITOR_FIND_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on the note list being the active surface.
pub fn set_note_list_search_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, NOTE_LIST_SEARCH_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on having uncommitted changes.
pub fn set_git_commit_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, GIT_COMMIT_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on having merge conflicts.
pub fn set_git_conflict_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, GIT_CONFLICT_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on the active vault having no remote.
pub fn set_git_no_remote_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, GIT_NO_REMOTE_DEPENDENT_IDS, enabled);
}

/// Enable or disable menu items that depend on a deleted note preview being active.
pub fn set_restore_deleted_item_enabled(app_handle: &AppHandle, enabled: bool) {
    set_items_enabled(app_handle, RESTORE_DELETED_DEPENDENT_IDS, enabled);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_ids_include_all_constants() {
        let expected = [
            APP_SETTINGS,
            APP_CHECK_FOR_UPDATES,
            FILE_NEW_NOTE,
            FILE_NEW_TYPE,
            FILE_QUICK_OPEN,
            FILE_SAVE,
            EDIT_FIND_IN_NOTE,
            EDIT_REPLACE_IN_NOTE,
            EDIT_FIND_IN_VAULT,
            EDIT_TOGGLE_NOTE_LIST_SEARCH,
            EDIT_TOGGLE_RAW_EDITOR,
            EDIT_TOGGLE_DIFF,
            VIEW_EDITOR_ONLY,
            VIEW_EDITOR_LIST,
            VIEW_ALL,
            VIEW_TOGGLE_PROPERTIES,
            VIEW_TOGGLE_AI_CHAT,
            VIEW_TOGGLE_BACKLINKS,
            VIEW_COMMAND_PALETTE,
            VIEW_ZOOM_IN,
            VIEW_ZOOM_OUT,
            VIEW_ZOOM_RESET,
            VIEW_GO_BACK,
            VIEW_GO_FORWARD,
            GO_ALL_NOTES,
            GO_ARCHIVED,
            GO_CHANGES,
            NOTE_ARCHIVE,
            NOTE_DELETE,
            NOTE_OPEN_IN_NEW_WINDOW,
            VAULT_OPEN,
            VAULT_REMOVE,
            VAULT_RESTORE_GETTING_STARTED,
            VAULT_ADD_REMOTE,
            VAULT_COMMIT_PUSH,
            VAULT_PULL,
            VAULT_RESOLVE_CONFLICTS,
            VAULT_VIEW_CHANGES,
            VAULT_INSTALL_MCP,
            VAULT_RELOAD,
        ];
        for id in &expected {
            assert!(CUSTOM_IDS.contains(id), "missing custom ID: {id}");
        }
    }

    #[test]
    fn note_dependent_ids_are_subset_of_custom_ids() {
        for id in NOTE_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "note-dependent ID {id} not in CUSTOM_IDS"
            );
        }
    }

    #[test]
    fn note_list_search_dependent_ids_are_subset_of_custom_ids() {
        for id in NOTE_LIST_SEARCH_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "note-list-search-dependent ID {id} not in CUSTOM_IDS"
            );
        }
    }

    #[test]
    fn editor_find_dependent_ids_are_subset_of_custom_ids() {
        for id in EDITOR_FIND_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "editor-find-dependent ID {id} not in CUSTOM_IDS"
            );
        }
    }

    #[test]
    fn git_dependent_ids_are_subset_of_custom_ids() {
        for id in GIT_COMMIT_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "git-commit-dependent ID {id} not in CUSTOM_IDS"
            );
        }
        for id in GIT_CONFLICT_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "git-conflict-dependent ID {id} not in CUSTOM_IDS"
            );
        }
        for id in GIT_NO_REMOTE_DEPENDENT_IDS {
            assert!(
                CUSTOM_IDS.contains(id),
                "git-no-remote-dependent ID {id} not in CUSTOM_IDS"
            );
        }
    }

    #[test]
    fn no_duplicate_custom_ids() {
        let mut seen = std::collections::HashSet::new();
        for id in CUSTOM_IDS {
            assert!(seen.insert(id), "duplicate custom ID: {id}");
        }
    }
}
