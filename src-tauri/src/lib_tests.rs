#[cfg(desktop)]
use super::optional_mcp_runtime_resource_dir;
use super::should_use_native_desktop_menu;
use super::MACOS_WEBVIEW_RESERVED_COMMAND_KEYS;
use super::MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS;

#[cfg(desktop)]
use crate::asset_scope::{missing_asset_scope_roots, vault_asset_scope_roots};
#[cfg(desktop)]
use crate::desktop_runtime::{
    selected_mcp_bridge_vault_paths, spawn_startup_tasks_for_vault_with,
    validate_mcp_bridge_vault_path,
};
#[cfg(desktop)]
use crate::vault_list::{VaultEntry, VaultList};
#[cfg(desktop)]
use std::path::PathBuf;

#[test]
fn macos_webview_shortcut_prevention_includes_ai_panel_shortcut() {
    assert_eq!(MACOS_WEBVIEW_RESERVED_COMMAND_KEYS, ["O", "F"]);
    assert_eq!(MACOS_WEBVIEW_RESERVED_COMMAND_SHIFT_KEYS, ["L"]);
}

#[cfg(desktop)]
#[test]
fn mcp_runtime_resource_dir_is_optional_in_dev() {
    let unavailable: Result<PathBuf, &str> = Err("unknown path");

    assert_eq!(optional_mcp_runtime_resource_dir(unavailable), None);
}

#[cfg(desktop)]
#[test]
fn mcp_runtime_resource_dir_keeps_available_path() {
    let resource_dir = PathBuf::from("/Applications/Tolaria.app/Contents/Resources");

    assert_eq!(
        optional_mcp_runtime_resource_dir(Ok::<PathBuf, &str>(resource_dir.clone())),
        Some(resource_dir)
    );
}

#[cfg(desktop)]
#[test]
fn selected_mcp_bridge_vault_paths_puts_persisted_active_vault_first() {
    let list = VaultList {
        vaults: vec![
            VaultEntry {
                label: "Secondary".to_string(),
                path: "/tmp/Secondary Vault".to_string(),
                mounted: Some(true),
                ..VaultEntry::default()
            },
            VaultEntry {
                label: "Hidden".to_string(),
                path: "/tmp/Hidden Vault".to_string(),
                mounted: Some(false),
                ..VaultEntry::default()
            },
            VaultEntry {
                label: "Selected".to_string(),
                path: "/tmp/Selected Vault".to_string(),
                mounted: Some(true),
                ..VaultEntry::default()
            },
        ],
        active_vault: Some("/tmp/Selected Vault".to_string()),
        default_workspace_path: None,
        hidden_defaults: Vec::new(),
    };

    assert_eq!(
        selected_mcp_bridge_vault_paths(&list),
        vec![
            PathBuf::from("/tmp/Selected Vault"),
            PathBuf::from("/tmp/Secondary Vault"),
        ]
    );
}

#[cfg(desktop)]
#[test]
fn selected_mcp_bridge_vault_paths_ignores_blank_active_vault() {
    let list = VaultList {
        vaults: Vec::new(),
        active_vault: Some("  ".to_string()),
        default_workspace_path: None,
        hidden_defaults: Vec::new(),
    };

    assert!(selected_mcp_bridge_vault_paths(&list).is_empty());
}

#[cfg(desktop)]
#[test]
fn startup_tasks_skip_missing_legacy_vault() {
    let missing_vault = tempfile::tempdir().unwrap().path().join("missing");
    let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let called_from_task = called.clone();

    let spawned = spawn_startup_tasks_for_vault_with(missing_vault, move |_| {
        called_from_task.store(true, std::sync::atomic::Ordering::SeqCst);
    });

    assert!(!spawned);
    assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
}

#[cfg(desktop)]
#[test]
fn startup_tasks_run_in_background() {
    let directory = tempfile::tempdir().unwrap();
    let (entered_sender, entered_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();

    let spawned = spawn_startup_tasks_for_vault_with(directory.path().to_path_buf(), move |_| {
        entered_sender.send(()).unwrap();
        release_receiver
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
    });

    assert!(spawned);
    entered_receiver
        .recv_timeout(std::time::Duration::from_secs(1))
        .unwrap();
    release_sender.send(()).unwrap();
}

#[cfg(desktop)]
#[test]
fn validate_mcp_bridge_vault_path_requires_existing_directory() {
    let directory = tempfile::tempdir().unwrap();
    let vault = directory.path().join("Vault With Spaces");
    std::fs::create_dir(&vault).unwrap();

    let resolved = validate_mcp_bridge_vault_path(&vault).unwrap();
    assert_eq!(resolved, vault.canonicalize().unwrap());

    let missing = directory.path().join("Missing Vault");
    let error = validate_mcp_bridge_vault_path(&missing).unwrap_err();
    assert!(error.contains("MCP bridge vault is not available"));
}

#[cfg(all(desktop, unix))]
#[test]
fn vault_asset_scope_roots_include_requested_symlink_path() {
    let directory = tempfile::tempdir().unwrap();
    let canonical_vault = directory.path().join("Getting Started");
    let symlinked_vault = directory.path().join("Symlinked Getting Started");
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
        missing_asset_scope_roots(&allowed_roots, std::slice::from_ref(&vault_b)),
        vec![vault_b]
    );
    assert!(missing_asset_scope_roots(&allowed_roots, std::slice::from_ref(&vault_a)).is_empty());
}

#[test]
fn native_desktop_menu_is_macos_only() {
    assert!(should_use_native_desktop_menu("macos"));
    assert!(!should_use_native_desktop_menu("windows"));
    assert!(!should_use_native_desktop_menu("linux"));
}
