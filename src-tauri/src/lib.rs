pub mod ai_agents;
pub mod app_updater;
pub mod claude_cli;
mod cli_agent_runtime;
pub mod codex_cli;
mod commands;
pub mod frontmatter;
pub mod gemini_cli;
mod gemini_config;
mod gemini_discovery;
pub mod git;
pub mod mcp;
#[cfg(desktop)]
pub mod menu;
pub mod opencode_cli;
mod opencode_config;
mod opencode_discovery;
mod opencode_events;
pub mod pi_cli;
mod pi_config;
mod pi_discovery;
mod pi_events;
pub mod search;
pub mod settings;
pub mod telemetry;
pub mod vault;
pub mod vault_list;
pub mod vault_watcher;
#[cfg(desktop)]
mod window_state;

use std::ffi::OsStr;
use std::process::Command;

#[cfg(all(desktop, target_os = "linux"))]
use std::os::unix::process::CommandExt;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::Child;
#[cfg(desktop)]
use std::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    suppress_windows_console(&mut command);
    command
}

#[cfg(windows)]
fn suppress_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_windows_console(_command: &mut Command) {}

#[cfg(desktop)]
struct WsBridgeChild(Mutex<Option<Child>>);

#[cfg(desktop)]
struct AllowedAssetScopeRoots(Mutex<Vec<PathBuf>>);

#[cfg(any(test, all(desktop, target_os = "linux")))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StartupEnvOverride {
    key: &'static str,
    value: &'static str,
}

#[cfg(any(test, all(desktop, target_os = "linux")))]
const LINUX_APPIMAGE_WEBKIT_OVERRIDES: [StartupEnvOverride; 2] = [
    StartupEnvOverride {
        key: "WEBKIT_DISABLE_DMABUF_RENDERER",
        value: "1",
    },
    StartupEnvOverride {
        key: "WEBKIT_DISABLE_COMPOSITING_MODE",
        value: "1",
    },
];

#[cfg(any(test, all(desktop, target_os = "linux")))]
const WAYLAND_CLIENT_PRELOAD_CANDIDATES: [&str; 7] = [
    "/usr/lib/libwayland-client.so",
    "/usr/lib/libwayland-client.so.0",
    "/usr/lib64/libwayland-client.so",
    "/usr/lib64/libwayland-client.so.0",
    "/lib64/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
];

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn is_linux_appimage_launch<F>(mut get_var: F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    ["APPIMAGE", "APPDIR"]
        .into_iter()
        .any(|key| get_var(key).is_some_and(|value| !value.trim().is_empty()))
}

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn is_wayland_session<F>(mut get_var: F) -> bool
where
    F: FnMut(&str) -> Option<String>,
{
    get_var("WAYLAND_DISPLAY").is_some_and(|value| !value.trim().is_empty())
        || get_var("XDG_SESSION_TYPE")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("wayland"))
}

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn linux_appimage_wayland_client_preload_path_with<F, E>(
    mut get_var: F,
    mut file_exists: E,
) -> Option<&'static str>
where
    F: FnMut(&str) -> Option<String>,
    E: FnMut(&str) -> bool,
{
    if !is_linux_appimage_launch(&mut get_var) || !is_wayland_session(&mut get_var) {
        return None;
    }

    if get_var("LD_PRELOAD").is_some_and(|value| !value.trim().is_empty())
        || get_var("TOLARIA_APPIMAGE_WAYLAND_PRELOAD_ATTEMPTED").is_some_and(|value| value == "1")
    {
        return None;
    }

    WAYLAND_CLIENT_PRELOAD_CANDIDATES
        .into_iter()
        .find(|path| file_exists(path))
}

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn linux_appimage_startup_env_overrides_with<F>(mut get_var: F) -> Vec<StartupEnvOverride>
where
    F: FnMut(&str) -> Option<String>,
{
    if !is_linux_appimage_launch(&mut get_var) {
        return Vec::new();
    }

    LINUX_APPIMAGE_WEBKIT_OVERRIDES
        .into_iter()
        .filter(|env_override| {
            !get_var(env_override.key).is_some_and(|value| !value.trim().is_empty())
        })
        .collect()
}

#[cfg(all(desktop, target_os = "linux"))]
fn apply_linux_appimage_startup_env_overrides() {
    apply_linux_appimage_wayland_client_preload();

    for env_override in linux_appimage_startup_env_overrides_with(|key| std::env::var(key).ok()) {
        std::env::set_var(env_override.key, env_override.value);
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn apply_linux_appimage_wayland_client_preload() {
    let Some(preload_path) = linux_appimage_wayland_client_preload_path_with(
        |key| std::env::var(key).ok(),
        |path| std::path::Path::new(path).is_file(),
    ) else {
        return;
    };

    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            eprintln!(
                "Tolaria AppImage Wayland preload skipped: failed to resolve executable ({e})"
            );
            return;
        }
    };

    let error = Command::new(exe)
        .args(std::env::args_os().skip(1))
        .env("LD_PRELOAD", preload_path)
        .env("TOLARIA_APPIMAGE_WAYLAND_PRELOAD_ATTEMPTED", "1")
        .exec();
    eprintln!("Tolaria AppImage Wayland preload skipped: failed to re-exec ({error})");
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn apply_linux_appimage_startup_env_overrides() {}

#[cfg(desktop)]
fn log_startup_result(label: &str, result: Result<usize, String>) {
    match result {
        Ok(n) if n > 0 => log::info!("{}: {} files", label, n),
        Err(e) => log::warn!("{}: {}", label, e),
        _ => {}
    }
}

#[cfg(desktop)]
fn selected_mcp_bridge_vault_path(vault_list: &vault_list::VaultList) -> Option<PathBuf> {
    vault_list
        .active_vault
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

#[cfg(desktop)]
fn validate_mcp_bridge_vault_path(vault_path: &Path) -> Result<PathBuf, String> {
    let resolved = std::fs::canonicalize(vault_path).map_err(|e| {
        format!(
            "MCP bridge vault is not available: {} ({e})",
            vault_path.display()
        )
    })?;

    if !resolved.is_dir() {
        return Err(format!(
            "MCP bridge vault is not available: {} is not a directory",
            vault_path.display()
        ));
    }

    Ok(resolved)
}

#[cfg(desktop)]
fn stop_ws_bridge_child(active_child: &mut Option<Child>) {
    if let Some(mut child) = active_child.take() {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("ws-bridge child process stopped");
    }
}

#[cfg(desktop)]
pub(crate) fn sync_ws_bridge_for_vault(
    app_handle: &tauri::AppHandle,
    vault_path: Option<&Path>,
) -> Result<&'static str, String> {
    use tauri::Manager;

    let state: tauri::State<'_, WsBridgeChild> = app_handle.state();
    let mut active_child = state
        .0
        .lock()
        .map_err(|_| "Failed to lock ws-bridge state".to_string())?;

    let Some(vault_path) = vault_path else {
        stop_ws_bridge_child(&mut active_child);
        return Ok("stopped");
    };

    let resolved_vault_path = match validate_mcp_bridge_vault_path(vault_path) {
        Ok(path) => path,
        Err(e) => {
            stop_ws_bridge_child(&mut active_child);
            return Err(e);
        }
    };

    stop_ws_bridge_child(&mut active_child);

    let child = mcp::spawn_ws_bridge(&resolved_vault_path)?;

    *active_child = Some(child);
    Ok("started")
}

/// Run startup housekeeping on the default vault (migrate legacy frontmatter, seed configs).
#[cfg(desktop)]
fn run_startup_tasks() {
    let vault_path = dirs::home_dir()
        .map(|h| h.join("Laputa"))
        .unwrap_or_default();
    if !vault_path.is_dir() {
        return;
    }
    let vp_str = vault_path.to_str().unwrap_or_default();
    log_startup_result(
        "Migrated is_a to type on startup",
        vault::migrate_is_a_to_type(vp_str),
    );
    // Migrate legacy config/agents.md → root AGENTS.md (one-time, idempotent)
    vault::migrate_agents_md(vp_str);
    // Seed AGENTS.md and starter type definitions at vault root if missing
    vault::seed_config_files(vp_str);
}

#[cfg(desktop)]
fn spawn_ws_bridge(app: &mut tauri::App) {
    let vault_path = match vault_list::load_vault_list() {
        Ok(vault_list) => selected_mcp_bridge_vault_path(&vault_list),
        Err(e) => {
            log::warn!("Failed to load active vault for ws-bridge startup: {}", e);
            None
        }
    };

    let Some(vault_path) = vault_path else {
        log::info!("ws-bridge not started: no active vault selected");
        return;
    };

    if let Err(e) = sync_ws_bridge_for_vault(app.handle(), Some(&vault_path)) {
        log::warn!("Failed to start ws-bridge: {}", e);
    }
}

fn setup_common_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    app.handle().plugin(tauri_plugin_dialog::init())?;
    Ok(())
}

#[cfg(desktop)]
fn setup_desktop_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    setup_macos_webview_shortcut_prevention(app)?;
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    app.handle().plugin(tauri_plugin_process::init())?;
    app.handle().plugin(tauri_plugin_opener::init())?;
    #[cfg(not(target_os = "linux"))]
    menu::setup_menu(app)?;
    setup_linux_window_chrome(app)?;
    window_state::restore_main_window_state(app);
    Ok(())
}

#[cfg(all(desktop, target_os = "linux"))]
fn setup_linux_window_chrome(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(false);
    }
    Ok(())
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn setup_linux_window_chrome(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg(any(test, all(desktop, target_os = "macos")))]
const MACOS_WEBVIEW_RESERVED_COMMAND_KEYS: &[&str] = &["O", "F"];
#[cfg(any(test, all(desktop, target_os = "macos")))]
const MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS: &[&str] = &["L"];

#[cfg(all(desktop, target_os = "macos"))]
fn setup_macos_webview_shortcut_prevention(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_prevent_default::ModifierKey::{MetaKey, ShiftKey};
    use tauri_plugin_prevent_default::{Flags, KeyboardShortcut};

    let mut builder = tauri_plugin_prevent_default::Builder::new().with_flags(Flags::empty());

    // WKWebView can swallow some browser-reserved chords before our shared
    // renderer shortcut handler sees them. Keep this list narrow and verify
    // every addition with native QA.
    for key in MACOS_WEBVIEW_RESERVED_COMMAND_KEYS {
        builder = builder.shortcut(KeyboardShortcut::with_modifiers(key, &[MetaKey]));
    }
    for key in MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS {
        builder = builder.shortcut(KeyboardShortcut::with_modifiers(key, &[MetaKey, ShiftKey]));
    }

    app.handle().plugin(builder.build())?;
    Ok(())
}

#[cfg(not(all(desktop, target_os = "macos")))]
fn setup_macos_webview_shortcut_prevention(
    _app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    setup_common_plugins(app)?;

    #[cfg(desktop)]
    setup_desktop_plugins(app)?;

    if telemetry::init_sentry_from_settings() {
        log::info!("Sentry initialized (crash reporting enabled)");
    }

    #[cfg(desktop)]
    {
        run_startup_tasks();
        spawn_ws_bridge(app);
    }

    Ok(())
}

#[cfg(desktop)]
fn vault_asset_scope_roots(vault_path: &Path) -> Result<Vec<PathBuf>, String> {
    let canonical_vault_path = std::fs::canonicalize(vault_path).map_err(|e| {
        format!(
            "Failed to resolve asset scope for {}: {e}",
            vault_path.display()
        )
    })?;
    let mut roots = vec![canonical_vault_path.clone()];
    let requested_vault_path = vault_path.to_path_buf();
    if requested_vault_path != canonical_vault_path {
        roots.push(requested_vault_path);
    }
    Ok(roots)
}

#[cfg(desktop)]
fn missing_asset_scope_roots(
    allowed_roots: &[PathBuf],
    requested_roots: &[PathBuf],
) -> Vec<PathBuf> {
    requested_roots
        .iter()
        .filter(|root| !allowed_roots.contains(root))
        .cloned()
        .collect()
}

#[cfg(desktop)]
pub(crate) fn sync_vault_asset_scope(
    app_handle: &tauri::AppHandle,
    vault_path: &Path,
) -> Result<(), String> {
    use tauri::Manager;

    let requested_roots = vault_asset_scope_roots(vault_path)?;
    let scope = app_handle.asset_protocol_scope();
    let state: tauri::State<'_, AllowedAssetScopeRoots> = app_handle.state();
    let mut allowed_roots = state
        .0
        .lock()
        .map_err(|_| "Failed to lock asset scope state".to_string())?;
    let roots_to_allow = missing_asset_scope_roots(&allowed_roots, &requested_roots);

    for root in &roots_to_allow {
        scope
            .allow_directory(root, true)
            .map_err(|e| format!("Failed to allow asset access for {}: {e}", root.display()))?;
    }

    allowed_roots.extend(roots_to_allow);
    Ok(())
}

macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            commands::list_vault,
            commands::list_vault_folders,
            commands::get_note_content,
            commands::validate_note_content,
            commands::create_note_content,
            commands::save_note_content,
            commands::update_frontmatter,
            commands::delete_frontmatter_property,
            commands::rename_note,
            commands::rename_note_filename,
            commands::move_note_to_folder,
            commands::auto_rename_untitled,
            commands::detect_renames,
            commands::update_wikilinks_for_renames,
            commands::get_file_history,
            commands::get_modified_files,
            commands::get_file_diff,
            commands::get_file_diff_at_commit,
            commands::get_vault_pulse,
            commands::git_commit,
            commands::get_build_number,
            commands::get_last_commit_info,
            commands::git_pull,
            commands::git_push,
            commands::git_remote_status,
            commands::git_add_remote,
            commands::get_conflict_files,
            commands::get_conflict_mode,
            commands::git_resolve_conflict,
            commands::git_commit_conflict_resolution,
            commands::git_discard_file,
            commands::is_git_repo,
            commands::init_git_repo,
            commands::check_claude_cli,
            commands::get_ai_agents_status,
            commands::get_vault_ai_guidance_status,
            commands::restore_vault_ai_guidance,
            commands::stream_claude_chat,
            commands::stream_ai_agent,
            commands::reload_vault,
            commands::reload_vault_entry,
            commands::sync_vault_asset_scope_for_window,
            commands::open_vault_file_external,
            commands::sync_note_title,
            commands::save_image,
            commands::copy_image_to_vault,
            commands::delete_note,
            commands::batch_delete_notes,
            commands::batch_delete_notes_async,
            commands::migrate_is_a_to_type,
            commands::create_vault_folder,
            commands::rename_vault_folder,
            commands::delete_vault_folder,
            commands::batch_archive_notes,
            commands::get_settings,
            commands::check_for_app_update,
            commands::update_menu_state,
            commands::trigger_menu_command,
            commands::update_current_window_min_size,
            commands::perform_current_window_titlebar_double_click,
            commands::save_settings,
            commands::download_and_install_app_update,
            commands::load_vault_list,
            commands::save_vault_list,
            commands::git_clone::clone_git_repo,
            commands::search_vault,
            commands::create_empty_vault,
            commands::create_getting_started_vault,
            commands::check_vault_exists,
            commands::get_default_vault_path,
            commands::register_mcp_tools,
            commands::remove_mcp_tools,
            commands::check_mcp_status,
            commands::get_mcp_config_snippet,
            commands::copy_text_to_clipboard,
            commands::sync_mcp_bridge_vault,
            commands::repair_vault,
            commands::reinit_telemetry,
            commands::list_views,
            commands::save_view_cmd,
            commands::delete_view_cmd,
            vault_watcher::start_vault_watcher,
            vault_watcher::stop_vault_watcher
        ]
    };
}

fn with_invoke_handler(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(app_invoke_handler!())
}

#[cfg(desktop)]
fn handle_run_event(app_handle: &tauri::AppHandle, event: &tauri::RunEvent) {
    use tauri::Manager;

    window_state::handle_run_event(app_handle, event);

    if let tauri::RunEvent::Exit = event {
        let state: tauri::State<'_, WsBridgeChild> = app_handle.state();
        let mut guard = state.0.lock().unwrap();
        stop_ws_bridge_child(&mut guard);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_linux_appimage_startup_env_overrides();
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .manage(WsBridgeChild(Mutex::new(None)))
        .manage(AllowedAssetScopeRoots(Mutex::new(Vec::new())))
        .manage(window_state::MainWindowFrameState::default())
        .manage(vault_watcher::VaultWatcherState::new());

    with_invoke_handler(builder)
        .setup(setup_app)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(desktop)]
            handle_run_event(app_handle, &event);
        });
}

#[cfg(test)]
mod tests {
    use super::linux_appimage_startup_env_overrides_with;
    use super::linux_appimage_wayland_client_preload_path_with;
    use super::StartupEnvOverride;
    use super::MACOS_WEBVIEW_RESERVED_COMMAND_KEYS;
    use super::MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS;

    #[cfg(desktop)]
    use super::{
        missing_asset_scope_roots, selected_mcp_bridge_vault_path, validate_mcp_bridge_vault_path,
    };
    #[cfg(desktop)]
    use crate::vault_list::VaultList;
    #[cfg(desktop)]
    use std::path::PathBuf;

    #[cfg(all(desktop, unix))]
    use super::vault_asset_scope_roots;

    #[test]
    fn macos_webview_shortcut_prevention_includes_ai_panel_shortcut() {
        assert_eq!(MACOS_WEBVIEW_RESERVED_COMMAND_KEYS, ["O", "F"]);
        assert_eq!(MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS, ["L"]);
    }

    #[test]
    fn linux_appimage_startup_env_overrides_are_empty_outside_appimage_launches() {
        let overrides = linux_appimage_startup_env_overrides_with(|_| None);

        assert!(overrides.is_empty());
    }

    #[test]
    fn linux_appimage_startup_env_overrides_disable_unstable_webkit_rendering_for_appimages() {
        let overrides = linux_appimage_startup_env_overrides_with(|key| match key {
            "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
            _ => None,
        });

        assert_eq!(
            overrides,
            vec![
                StartupEnvOverride {
                    key: "WEBKIT_DISABLE_DMABUF_RENDERER",
                    value: "1",
                },
                StartupEnvOverride {
                    key: "WEBKIT_DISABLE_COMPOSITING_MODE",
                    value: "1",
                }
            ]
        );
    }

    #[test]
    fn linux_appimage_startup_env_overrides_preserve_explicit_user_setting_per_variable() {
        let overrides = linux_appimage_startup_env_overrides_with(|key| match key {
            "APPDIR" => Some("/tmp/.mount_Tolaria".to_string()),
            "WEBKIT_DISABLE_DMABUF_RENDERER" => Some("0".to_string()),
            _ => None,
        });

        assert_eq!(
            overrides,
            vec![StartupEnvOverride {
                key: "WEBKIT_DISABLE_COMPOSITING_MODE",
                value: "1",
            }]
        );
    }

    #[test]
    fn linux_appimage_wayland_preload_uses_first_available_system_library() {
        let preload_path = linux_appimage_wayland_client_preload_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                "XDG_SESSION_TYPE" => Some("wayland".to_string()),
                _ => None,
            },
            |path| path == "/lib/x86_64-linux-gnu/libwayland-client.so.0",
        );

        assert_eq!(
            preload_path,
            Some("/lib/x86_64-linux-gnu/libwayland-client.so.0")
        );
    }

    #[test]
    fn linux_appimage_wayland_preload_preserves_explicit_ld_preload() {
        let preload_path = linux_appimage_wayland_client_preload_path_with(
            |key| match key {
                "APPDIR" => Some("/tmp/.mount_Tolaria".to_string()),
                "WAYLAND_DISPLAY" => Some("wayland-0".to_string()),
                "LD_PRELOAD" => Some("/custom/libwayland-client.so".to_string()),
                _ => None,
            },
            |_| true,
        );

        assert_eq!(preload_path, None);
    }

    #[test]
    fn linux_appimage_wayland_preload_is_empty_for_x11_sessions() {
        let preload_path = linux_appimage_wayland_client_preload_path_with(
            |key| match key {
                "APPIMAGE" => Some("/tmp/Tolaria.AppImage".to_string()),
                "XDG_SESSION_TYPE" => Some("x11".to_string()),
                _ => None,
            },
            |_| true,
        );

        assert_eq!(preload_path, None);
    }

    #[cfg(desktop)]
    #[test]
    fn selected_mcp_bridge_vault_path_uses_persisted_active_vault() {
        let list = VaultList {
            vaults: Vec::new(),
            active_vault: Some("/tmp/Selected Vault".to_string()),
            hidden_defaults: Vec::new(),
        };

        assert_eq!(
            selected_mcp_bridge_vault_path(&list),
            Some(std::path::PathBuf::from("/tmp/Selected Vault"))
        );
    }

    #[cfg(desktop)]
    #[test]
    fn selected_mcp_bridge_vault_path_ignores_blank_active_vault() {
        let list = VaultList {
            vaults: Vec::new(),
            active_vault: Some("  ".to_string()),
            hidden_defaults: Vec::new(),
        };

        assert_eq!(selected_mcp_bridge_vault_path(&list), None);
    }

    #[cfg(desktop)]
    #[test]
    fn validate_mcp_bridge_vault_path_requires_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("Vault With Spaces");
        std::fs::create_dir(&vault).unwrap();

        let resolved = validate_mcp_bridge_vault_path(&vault).unwrap();
        assert_eq!(resolved, vault.canonicalize().unwrap());

        let missing = dir.path().join("Missing Vault");
        let err = validate_mcp_bridge_vault_path(&missing).unwrap_err();
        assert!(err.contains("MCP bridge vault is not available"));
    }

    #[cfg(all(desktop, unix))]
    #[test]
    fn vault_asset_scope_roots_include_requested_symlink_path() {
        let dir = tempfile::tempdir().unwrap();
        let canonical_vault = dir.path().join("Getting Started");
        let symlinked_vault = dir.path().join("Symlinked Getting Started");
        std::fs::create_dir(&canonical_vault).unwrap();
        std::os::unix::fs::symlink(&canonical_vault, &symlinked_vault).unwrap();

        let roots = vault_asset_scope_roots(&symlinked_vault).unwrap();

        assert_eq!(roots[0], canonical_vault.canonicalize().unwrap());
        assert!(roots.contains(&symlinked_vault));
    }

    #[cfg(desktop)]
    #[test]
    fn missing_asset_scope_roots_keeps_previously_allowed_vaults() {
        let vault_a = PathBuf::from("/vault-a");
        let vault_b = PathBuf::from("/vault-b");
        let allowed_roots = vec![vault_a.clone()];

        assert_eq!(
            missing_asset_scope_roots(&allowed_roots, &[vault_b.clone()]),
            vec![vault_b]
        );
        assert!(missing_asset_scope_roots(&allowed_roots, &[vault_a]).is_empty());
    }
}
