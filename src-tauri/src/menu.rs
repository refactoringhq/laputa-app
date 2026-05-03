use serde::{Deserialize, Deserializer};
use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    sync::OnceLock,
};
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, MenuItemKind, Submenu, SubmenuBuilder},
    App, AppHandle, Emitter,
};

const APP_COMMAND_MANIFEST_JSON: &str = include_str!("../../src/shared/appCommandManifest.json");
const NOTE_DEPENDENT_GROUP: &str = "noteDependent";
const EDITOR_FIND_DEPENDENT_GROUP: &str = "editorFindDependent";
const NOTE_LIST_SEARCH_DEPENDENT_GROUP: &str = "noteListSearchDependent";
const RESTORE_DELETED_DEPENDENT_GROUP: &str = "restoreDeletedDependent";
const GIT_COMMIT_DEPENDENT_GROUP: &str = "gitCommitDependent";
const GIT_CONFLICT_DEPENDENT_GROUP: &str = "gitConflictDependent";
const GIT_NO_REMOTE_DEPENDENT_GROUP: &str = "gitNoRemoteDependent";

type MenuResult = Result<Submenu<tauri::Wry>, Box<dyn Error>>;
type AppSubmenuBuilder<'a> = SubmenuBuilder<'a, tauri::Wry, App>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppCommandManifest {
    commands: BTreeMap<String, ManifestCommand>,
    menus: Vec<ManifestMenuSection>,
    app_menu: Vec<ManifestMenuItem>,
    menu_state_groups: BTreeMap<String, Vec<MenuStateGroupReference>>,
}

#[derive(Debug, Deserialize)]
struct ManifestCommand {
    id: String,
    shortcut: Option<ManifestShortcut>,
}

#[derive(Debug, Deserialize)]
struct ManifestShortcut {
    accelerator: String,
}

#[derive(Debug, Deserialize)]
struct ManifestMenuSection {
    label: String,
    items: Vec<ManifestMenuItem>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
enum ManifestMenuItem {
    #[serde(rename = "separator")]
    Separator,
    #[serde(rename = "command")]
    Command {
        command: String,
        id: Option<String>,
        label: PlatformLabel,
        #[serde(default, deserialize_with = "deserialize_accelerator")]
        accelerator: ManifestAccelerator,
        enabled: Option<bool>,
    },
    #[serde(rename = "menu-event")]
    MenuEvent {
        id: String,
        label: PlatformLabel,
        #[serde(default, deserialize_with = "deserialize_accelerator")]
        accelerator: ManifestAccelerator,
        enabled: Option<bool>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PlatformLabel {
    Plain(String),
    Platform {
        macos: Option<String>,
        windows: Option<String>,
        linux: Option<String>,
        default: String,
    },
}

#[derive(Debug, Default)]
enum ManifestAccelerator {
    #[default]
    Inherit,
    Suppressed,
    Explicit(String),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum MenuStateGroupReference {
    Command { command: String },
    Id { id: String },
}

fn deserialize_accelerator<'de, D>(deserializer: D) -> Result<ManifestAccelerator, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(|accelerator| match accelerator {
        Some(accelerator) => ManifestAccelerator::Explicit(accelerator),
        None => ManifestAccelerator::Suppressed,
    })
}

impl PlatformLabel {
    fn resolve(&self, target_os: &str) -> &str {
        match self {
            Self::Plain(label) => label.as_str(),
            Self::Platform {
                macos,
                windows,
                linux,
                default,
            } => match target_os {
                "macos" => macos.as_deref().unwrap_or(default.as_str()),
                "windows" => windows.as_deref().unwrap_or(default.as_str()),
                "linux" => linux.as_deref().unwrap_or(default.as_str()),
                _ => default.as_str(),
            },
        }
    }
}

impl ManifestMenuItem {
    fn command_id<'a>(&'a self, manifest: &'a AppCommandManifest) -> Option<&'a str> {
        match self {
            Self::Command { command, .. } => manifest
                .commands
                .get(command)
                .map(|command| command.id.as_str()),
            Self::MenuEvent { id, .. } => Some(id.as_str()),
            Self::Separator => None,
        }
    }

    fn menu_item_id<'a>(&'a self, manifest: &'a AppCommandManifest) -> Option<&'a str> {
        match self {
            Self::Command { command, id, .. } => id.as_deref().or_else(|| {
                manifest
                    .commands
                    .get(command)
                    .map(|command| command.id.as_str())
            }),
            Self::MenuEvent { id, .. } => Some(id.as_str()),
            Self::Separator => None,
        }
    }

    fn label(&self, target_os: &str) -> Option<&str> {
        match self {
            Self::Command { label, .. } | Self::MenuEvent { label, .. } => {
                Some(label.resolve(target_os))
            }
            Self::Separator => None,
        }
    }

    fn accelerator<'a>(&'a self, manifest: &'a AppCommandManifest) -> Option<&'a str> {
        match self {
            Self::Command {
                command,
                accelerator,
                ..
            } => match accelerator {
                ManifestAccelerator::Explicit(accelerator) => Some(accelerator.as_str()),
                ManifestAccelerator::Suppressed => None,
                ManifestAccelerator::Inherit => manifest
                    .commands
                    .get(command)
                    .and_then(|command| command.shortcut.as_ref())
                    .map(|shortcut| shortcut.accelerator.as_str()),
            },
            Self::MenuEvent { accelerator, .. } => match accelerator {
                ManifestAccelerator::Explicit(accelerator) => Some(accelerator.as_str()),
                ManifestAccelerator::Suppressed | ManifestAccelerator::Inherit => None,
            },
            Self::Separator => None,
        }
    }

    fn enabled(&self) -> bool {
        match self {
            Self::Command { enabled, .. } | Self::MenuEvent { enabled, .. } => {
                enabled.unwrap_or(true)
            }
            Self::Separator => true,
        }
    }
}

static APP_COMMAND_MANIFEST: OnceLock<AppCommandManifest> = OnceLock::new();
static CUSTOM_MENU_IDS: OnceLock<HashSet<String>> = OnceLock::new();

fn manifest() -> &'static AppCommandManifest {
    APP_COMMAND_MANIFEST.get_or_init(|| {
        serde_json::from_str(APP_COMMAND_MANIFEST_JSON)
            .expect("shared app command manifest must be valid JSON")
    })
}

fn manifest_menu_items() -> impl Iterator<Item = &'static ManifestMenuItem> {
    let manifest = manifest();
    manifest
        .menus
        .iter()
        .flat_map(|section| section.items.iter())
        .chain(manifest.app_menu.iter())
}

fn custom_menu_ids() -> &'static HashSet<String> {
    CUSTOM_MENU_IDS.get_or_init(|| {
        manifest_menu_items()
            .filter_map(|item| item.menu_item_id(manifest()))
            .map(str::to_owned)
            .collect()
    })
}

fn manifest_section(label: &str) -> Result<&'static ManifestMenuSection, Box<dyn Error>> {
    manifest()
        .menus
        .iter()
        .find(|section| section.label == label)
        .ok_or_else(|| format!("Missing menu section in command manifest: {label}").into())
}

fn app_menu_includes_services(target_os: &str) -> bool {
    target_os == "macos"
}

fn build_manifest_menu_item(
    app: &App,
    item: &ManifestMenuItem,
) -> Result<Option<MenuItem<tauri::Wry>>, Box<dyn Error>> {
    let Some(id) = item.menu_item_id(manifest()) else {
        return Ok(None);
    };
    let Some(label) = item.label(std::env::consts::OS) else {
        return Ok(None);
    };

    let mut builder = MenuItemBuilder::new(label).id(id).enabled(item.enabled());
    if let Some(accelerator) = item.accelerator(manifest()) {
        builder = builder.accelerator(accelerator);
    }
    Ok(Some(builder.build(app)?))
}

fn append_manifest_item<'a>(
    app: &'a App,
    builder: AppSubmenuBuilder<'a>,
    item: &ManifestMenuItem,
) -> Result<AppSubmenuBuilder<'a>, Box<dyn Error>> {
    if matches!(item, ManifestMenuItem::Separator) {
        return Ok(builder.separator());
    }

    let Some(item) = build_manifest_menu_item(app, item)? else {
        return Ok(builder);
    };
    Ok(builder.item(&item))
}

fn build_manifest_menu(app: &App, label: &str) -> MenuResult {
    let section = manifest_section(label)?;
    let mut builder = SubmenuBuilder::new(app, section.label.as_str());
    for item in &section.items {
        builder = append_manifest_item(app, builder, item)?;
    }
    Ok(builder.build()?)
}

fn build_app_menu(app: &App) -> MenuResult {
    let mut builder = SubmenuBuilder::new(app, "Tolaria").about(None).separator();

    for item in &manifest().app_menu {
        builder = append_manifest_item(app, builder, item)?;
    }

    builder = builder.separator();

    if app_menu_includes_services(std::env::consts::OS) {
        builder = builder
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator();
    }

    Ok(builder.quit().build()?)
}

fn build_file_menu(app: &App) -> MenuResult {
    build_manifest_menu(app, "File")
}

fn build_edit_menu(app: &App) -> MenuResult {
    let section = manifest_section("Edit")?;
    let mut items = section.items.iter();
    let mut builder = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste();

    if let Some(paste_plain_text) = items.next() {
        builder = append_manifest_item(app, builder, paste_plain_text)?;
    }

    builder = builder.separator().select_all().separator();

    if matches!(items.clone().next(), Some(ManifestMenuItem::Separator)) {
        items.next();
    }

    for item in items {
        builder = append_manifest_item(app, builder, item)?;
    }

    Ok(builder.build()?)
}

fn build_view_menu(app: &App) -> MenuResult {
    build_manifest_menu(app, "View")
}

fn build_go_menu(app: &App) -> MenuResult {
    build_manifest_menu(app, "Go")
}

fn build_note_menu(app: &App) -> MenuResult {
    build_manifest_menu(app, "Note")
}

fn build_vault_menu(app: &App) -> MenuResult {
    build_manifest_menu(app, "Vault")
}

fn build_window_menu(app: &App) -> MenuResult {
    Ok(SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?)
}

pub fn setup_menu(app: &App) -> Result<(), Box<dyn Error>> {
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

fn emitted_menu_event_id(id: &str) -> Option<&'static str> {
    manifest_menu_items().find_map(|item| {
        if item.menu_item_id(manifest()) == Some(id) {
            item.command_id(manifest())
        } else {
            None
        }
    })
}

pub fn emit_custom_menu_event(app_handle: &AppHandle, id: &str) -> Result<(), String> {
    if !custom_menu_ids().contains(id) {
        return Err(format!("Unknown custom menu event: {id}"));
    }
    let emitted_id = emitted_menu_event_id(id)
        .ok_or_else(|| format!("Missing emitted command for custom menu event: {id}"))?;
    app_handle
        .emit("menu-event", emitted_id)
        .map_err(|err| format!("Failed to emit menu-event {emitted_id}: {err}"))
}

fn menu_state_group_ids(group_name: &str) -> Vec<&'static str> {
    manifest()
        .menu_state_groups
        .get(group_name)
        .into_iter()
        .flatten()
        .filter_map(|reference| match reference {
            MenuStateGroupReference::Command { command } => manifest()
                .commands
                .get(command)
                .map(|command| command.id.as_str()),
            MenuStateGroupReference::Id { id } => Some(id.as_str()),
        })
        .collect()
}

fn set_items_enabled<'a>(
    app_handle: &AppHandle,
    ids: impl IntoIterator<Item = &'a str>,
    enabled: bool,
) {
    let Some(menu) = app_handle.menu() else {
        return;
    };
    for id in ids {
        if let Some(MenuItemKind::MenuItem(mi)) = menu.get(id) {
            let _ = mi.set_enabled(enabled);
        }
    }
}

fn set_menu_state_group_enabled(app_handle: &AppHandle, group_name: &str, enabled: bool) {
    set_items_enabled(app_handle, menu_state_group_ids(group_name), enabled);
}

/// Enable or disable menu items that depend on having an active note tab.
pub fn set_note_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, NOTE_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on the editor being the active surface.
pub fn set_editor_find_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, EDITOR_FIND_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on the note list being the active surface.
pub fn set_note_list_search_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, NOTE_LIST_SEARCH_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on having uncommitted changes.
pub fn set_git_commit_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, GIT_COMMIT_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on having merge conflicts.
pub fn set_git_conflict_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, GIT_CONFLICT_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on the active vault having no remote.
pub fn set_git_no_remote_items_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, GIT_NO_REMOTE_DEPENDENT_GROUP, enabled);
}

/// Enable or disable menu items that depend on a deleted note preview being active.
pub fn set_restore_deleted_item_enabled(app_handle: &AppHandle, enabled: bool) {
    set_menu_state_group_enabled(app_handle, RESTORE_DELETED_DEPENDENT_GROUP, enabled);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn menu_item_by_id(id: &str) -> &'static ManifestMenuItem {
        manifest_menu_items()
            .find(|item| item.menu_item_id(manifest()) == Some(id))
            .unwrap_or_else(|| panic!("missing menu item {id}"))
    }

    #[test]
    fn custom_ids_are_manifest_menu_item_ids() {
        let expected: HashSet<_> = manifest_menu_items()
            .filter_map(|item| item.menu_item_id(manifest()))
            .map(str::to_owned)
            .collect();

        assert_eq!(custom_menu_ids(), &expected);
        assert!(custom_menu_ids().contains("file-quick-open-alias"));
    }

    #[test]
    fn manifest_command_items_reference_known_commands() {
        for item in manifest_menu_items() {
            if let ManifestMenuItem::Command { command, .. } = item {
                assert!(
                    manifest().commands.contains_key(command),
                    "menu item references missing command key {command}"
                );
            }
        }
    }

    #[test]
    fn overridden_menu_item_ids_emit_their_primary_command() {
        assert_eq!(
            emitted_menu_event_id("file-quick-open-alias"),
            Some("file-quick-open")
        );
        assert_eq!(
            emitted_menu_event_id("edit-toggle-note-list-search"),
            Some("edit-toggle-note-list-search")
        );
        assert_eq!(emitted_menu_event_id("file-save"), Some("file-save"));
    }

    #[test]
    fn state_group_ids_are_manifest_menu_items() {
        for (group, references) in &manifest().menu_state_groups {
            for reference in references {
                let id = match reference {
                    MenuStateGroupReference::Command { command } => manifest()
                        .commands
                        .get(command)
                        .map(|command| command.id.as_str())
                        .unwrap_or_else(|| panic!("state group {group} references {command}")),
                    MenuStateGroupReference::Id { id } => id.as_str(),
                };
                assert!(
                    custom_menu_ids().contains(id),
                    "state group {group} references non-menu item {id}"
                );
            }
        }
    }

    #[test]
    fn view_toggle_properties_keeps_renderer_owned_accelerator() {
        let item = menu_item_by_id("view-toggle-properties");

        assert_eq!(item.accelerator(manifest()), None);
    }

    #[test]
    fn no_duplicate_custom_ids() {
        let mut seen = HashSet::new();
        for id in manifest_menu_items().filter_map(|item| item.menu_item_id(manifest())) {
            assert!(seen.insert(id), "duplicate custom ID: {id}");
        }
    }

    #[test]
    fn app_services_menu_is_macos_only() {
        assert!(app_menu_includes_services("macos"));
        assert!(!app_menu_includes_services("windows"));
        assert!(!app_menu_includes_services("linux"));
    }
}
