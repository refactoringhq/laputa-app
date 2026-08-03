mod ai_agent_processes;
pub mod ai_agents;
mod ai_model_tools;
pub mod ai_models;
pub mod antigravity_cli;
mod antigravity_config;
mod antigravity_discovery;
mod app_config;
mod app_icon;
pub mod app_updater;
mod asset_scope;
pub mod claude_cli;
mod claude_invocation;
mod cli_agent_runtime;
pub mod codex_cli;
mod commands;
pub mod copilot_cli;
mod copilot_discovery;
#[cfg(desktop)]
mod desktop_runtime;
pub mod frontmatter;
pub mod git;
pub mod hermes_cli;
mod hermes_discovery;
pub mod kiro_cli;
mod kiro_discovery;
#[cfg(any(test, all(desktop, target_os = "linux")))]
mod linux_appimage;
mod macos_fullscreen_escape;
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
mod vault_instance;
pub mod vault_list;
pub mod vault_watcher;
#[cfg(desktop)]
mod window_state;
mod workspace_colors;

#[cfg(desktop)]
pub(crate) use asset_scope::sync_vault_asset_scope;
#[cfg(desktop)]
pub(crate) use desktop_runtime::sync_ws_bridge_for_vault;

use std::ffi::OsStr;
use std::process::Command;

#[cfg(desktop)]
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
fn focus_main_window(app_handle: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn with_desktop_entry_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let builder = if vault_instance::is_separate_vault_instance() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
    };
    builder.plugin(tauri_plugin_deep_link::init())
}

#[cfg(desktop)]
fn setup_deep_link_runtime_registration(
    _app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;

        _app.deep_link().register_all()?;
    }

    Ok(())
}

#[cfg(desktop)]
fn setup_desktop_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    setup_macos_webview_shortcut_prevention(app)?;
    macos_fullscreen_escape::setup(app)?;
    setup_deep_link_runtime_registration(app)?;
    install_desktop_runtime_plugins(app)?;
    setup_native_desktop_menu(app)?;
    setup_custom_window_chrome(app)?;
    window_state::restore_main_window_state(app);
    show_debug_main_window(app);
    Ok(())
}

#[cfg(desktop)]
fn install_desktop_runtime_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    app.handle().plugin(tauri_plugin_process::init())?;
    app.handle().plugin(tauri_plugin_opener::init())?;
    Ok(())
}

#[cfg(desktop)]
fn setup_native_desktop_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if should_use_native_desktop_menu(std::env::consts::OS) {
        menu::setup_menu(app)?;
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn show_debug_main_window(app: &mut tauri::App) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.center();
        let _ = window.set_focus();
    }
}

#[cfg(not(debug_assertions))]
fn show_debug_main_window(_app: &mut tauri::App) {}

fn should_use_native_desktop_menu(target_os: &str) -> bool {
    target_os == "macos"
}

#[cfg(all(desktop, any(target_os = "linux", target_os = "windows")))]
fn setup_custom_window_chrome(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(false);
    }
    Ok(())
}

#[cfg(not(all(desktop, any(target_os = "linux", target_os = "windows"))))]
fn setup_custom_window_chrome(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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

#[cfg(desktop)]
fn optional_mcp_runtime_resource_dir<E: std::fmt::Display>(
    resource_dir: Result<std::path::PathBuf, E>,
) -> Option<std::path::PathBuf> {
    match resource_dir {
        Ok(path) => Some(path),
        Err(error) => {
            log::warn!(
                "Tauri resource directory unavailable; continuing with MCP fallback paths: {error}"
            );
            None
        }
    }
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    setup_common_plugins(app)?;

    #[cfg(desktop)]
    {
        use tauri::Manager;

        if let Some(resource_dir) = optional_mcp_runtime_resource_dir(app.path().resource_dir()) {
            mcp::set_runtime_resource_dir(resource_dir);
        }
        setup_desktop_plugins(app)?;
        app_icon::update_app_icon_for_theme(app.handle(), "light")?;
    }

    if telemetry::init_sentry_from_settings() {
        log::info!("Sentry initialized (crash reporting enabled)");
    }

    #[cfg(desktop)]
    {
        desktop_runtime::spawn_startup_tasks();
        desktop_runtime::spawn_initial_ws_bridge_sync(app);
    }

    Ok(())
}

macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            commands::list_vault,
            commands::read_vault_snapshot,
            commands::get_startup_elapsed_ms,
            commands::record_startup_milestone,
            commands::get_startup_trace,
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
            commands::move_note_to_workspace,
            commands::auto_rename_untitled,
            commands::detect_renames,
            commands::update_wikilinks_for_renames,
            commands::get_file_history,
            commands::get_modified_files,
            commands::get_file_diff,
            commands::get_file_diff_at_commit,
            commands::get_vault_pulse,
            commands::git_commit,
            commands::git_author_identity,
            commands::get_build_number,
            commands::get_last_commit_info,
            commands::git_pull,
            commands::git_push,
            commands::git_remote_status,
            commands::git_file_url,
            commands::git_provider_status,
            commands::test_git_provider,
            commands::git_add_remote,
            commands::get_conflict_files,
            commands::get_conflict_mode,
            commands::git_resolve_conflict,
            commands::git_commit_conflict_resolution,
            commands::git_discard_file,
            commands::is_git_repo,
            commands::git_workspace_info,
            commands::init_git_repo,
            commands::check_claude_cli,
            commands::get_ai_agents_status,
            commands::get_ai_agent_model_catalog,
            commands::get_agent_docs_path,
            commands::get_vault_ai_guidance_status,
            commands::restore_vault_ai_guidance,
            commands::stream_claude_chat,
            commands::stream_ai_agent,
            commands::abort_ai_agent_stream,
            commands::stream_ai_model,
            commands::save_ai_model_provider_api_key,
            commands::delete_ai_model_provider_api_key,
            commands::test_ai_model_provider,
            commands::reload_vault,
            commands::reload_vault_entry,
            commands::sync_vault_asset_scope_for_window,
            commands::open_vault_file_external,
            commands::reveal_path_in_file_manager,
            commands::sync_note_title,
            commands::save_image,
            commands::copy_image_to_vault,
            commands::download_remote_image_to_vault,
            commands::delete_note,
            commands::batch_delete_notes,
            commands::batch_delete_notes_async,
            commands::migrate_is_a_to_type,
            commands::create_vault_folder,
            commands::rename_vault_folder,
            commands::delete_vault_folder,
            commands::batch_archive_notes,
            commands::get_settings,
            macos_fullscreen_escape::set_macos_dismissable_escape_surface_open,
            commands::get_ai_workspace_sessions,
            commands::check_for_app_update,
            commands::update_menu_state,
            commands::update_app_icon,
            commands::open_vault_in_new_window,
            commands::trigger_menu_command,
            commands::update_current_window_min_size,
            commands::perform_current_window_titlebar_double_click,
            commands::save_settings,
            commands::save_ai_workspace_sessions,
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
            commands::get_opencode_mcp_config_snippet,
            commands::copy_text_to_clipboard,
            commands::read_text_from_clipboard,
            commands::sync_mcp_bridge_vault,
            commands::get_process_memory_snapshot,
            commands::repair_vault,
            commands::reinit_telemetry,
            commands::should_use_external_media_preview,
            commands::print_current_webview,
            commands::can_export_current_webview_pdf,
            commands::export_current_webview_pdf,
            commands::resolve_sheet_external_formula_inputs,
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
        let state: tauri::State<'_, desktop_runtime::WsBridgeChild> = app_handle.state();
        let mut guard = state.0.lock().unwrap();
        desktop_runtime::stop_ws_bridge_child(&mut guard);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(desktop, target_os = "linux"))]
    linux_appimage::apply_startup_env_overrides();

    let builder = tauri::Builder::default().manage(commands::StartupTimingState::default());

    #[cfg(desktop)]
    let builder = with_desktop_entry_plugins(builder);

    #[cfg(desktop)]
    let builder = builder
        .manage(desktop_runtime::WsBridgeChild(std::sync::Mutex::new(None)))
        .manage(asset_scope::AllowedAssetScopeRoots(std::sync::Mutex::new(
            Vec::new(),
        )))
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
mod lib_tests;
