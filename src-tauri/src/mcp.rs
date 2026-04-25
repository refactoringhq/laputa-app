use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

const MCP_SERVER_NAME: &str = "tolaria";
const LEGACY_MCP_SERVER_NAME: &str = "laputa";

/// Format of the MCP config file being written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigFormat {
    /// Standard format used by Claude Code and Cursor: `mcpServers` key with
    /// `command` (string) + `args` (array) + `env` (map).
    Standard,
    /// OpenCode format: `mcp` key with `type` ("local"), `command` (array),
    /// and `environment` (map).
    Opencode,
}

/// Status of the MCP server installation.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpStatus {
    /// MCP is registered in Claude config and server files exist.
    Installed,
    /// MCP server files or config are missing for the active vault.
    NotInstalled,
}

/// Find the `node` binary path at runtime.
pub(crate) fn find_node() -> Result<PathBuf, String> {
    let output = node_lookup_command()
        .output()
        .map_err(|e| format!("Failed to locate node on PATH: {e}"))?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    if let Some(path) = fallback_node_path() {
        return Ok(path);
    }

    Err("node not found in PATH or common install locations".into())
}

fn node_lookup_command() -> Command {
    #[cfg(windows)]
    let mut command = crate::hidden_command("where.exe");
    #[cfg(not(windows))]
    let mut command = crate::hidden_command("which");

    command.arg("node");
    command
}

fn fallback_node_path() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".volta").join("bin").join("node"));

        let nvm_dir = home.join(".nvm").join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(nvm_dir) {
            let mut versions = entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .collect::<Vec<_>>();
            versions.sort();
            versions.reverse();
            candidates.extend(
                versions
                    .into_iter()
                    .map(|version| version.join("bin").join("node")),
            );
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

/// Resolve the path to `mcp-server/`.
///
/// In dev mode, uses `CARGO_MANIFEST_DIR` (set at compile time).
/// In release mode, navigates from the current executable.
pub(crate) fn mcp_server_dir() -> Result<PathBuf, String> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mcp-server");
    if dev_path.join("ws-bridge.js").exists() {
        return Ok(std::fs::canonicalize(&dev_path).unwrap_or(dev_path));
    }

    let exe = std::env::current_exe().map_err(|e| format!("Cannot find executable: {e}"))?;
    // On macOS the exe lives at Contents/MacOS/<binary>.
    // Resources are placed at Contents/Resources/ by Tauri.
    let release_path = exe
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("Resources").join("mcp-server"))
        .ok_or_else(|| "Cannot resolve mcp-server directory".to_string())?;
    if release_path.join("ws-bridge.js").exists() {
        return Ok(release_path);
    }

    Err(format!(
        "mcp-server not found at {} or {}",
        dev_path.display(),
        release_path.display()
    ))
}

/// Spawn the WebSocket bridge as a child process.
pub fn spawn_ws_bridge(vault_path: &str) -> Result<Child, String> {
    let node = find_node()?;
    let server_dir = mcp_server_dir()?;
    let script = server_dir.join("ws-bridge.js");

    let child = crate::hidden_command(node)
        .arg(&script)
        .env("VAULT_PATH", vault_path)
        .env("WS_PORT", "9710")
        .env("WS_UI_PORT", "9711")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ws-bridge: {e}"))?;

    log::info!("ws-bridge spawned (pid: {})", child.id());
    Ok(child)
}

fn mcp_config_paths() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| mcp_config_paths_for_home(&home))
        .unwrap_or_default()
}

fn mcp_config_paths_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".claude.json"),
        home.join(".claude").join("mcp.json"),
        home.join(".cursor").join("mcp.json"),
        home.join(".config").join("mcp").join("mcp.json"),
        home.join(".config").join("opencode").join("opencode.json"),
    ]
}

fn detect_config_format(config_path: &Path) -> ConfigFormat {
    let raw = config_path.to_string_lossy();
    if raw.contains(".config/opencode/") {
        ConfigFormat::Opencode
    } else {
        ConfigFormat::Standard
    }
}

fn read_registered_mcp_entry(config_path: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let format = detect_config_format(config_path);

    let key = match format {
        ConfigFormat::Standard => "mcpServers",
        ConfigFormat::Opencode => "mcp",
    };

    config
        .get(key)
        .and_then(|value| value.as_object())
        .and_then(|servers| {
            servers
                .get(MCP_SERVER_NAME)
                .or_else(|| servers.get(LEGACY_MCP_SERVER_NAME))
        })
        .cloned()
}

fn entry_index_js_exists(entry: &serde_json::Value) -> bool {
    if let Some(js) = entry["args"]
        .as_array()
        .and_then(|args| args.first())
        .and_then(|value| value.as_str())
    {
        if Path::new(js).exists() {
            return true;
        }
    }

    if let Some(js) = entry["command"]
        .as_array()
        .and_then(|cmd| cmd.get(1))
        .and_then(|value| value.as_str())
    {
        if Path::new(js).exists() {
            return true;
        }
    }

    false
}

fn entry_targets_vault(entry: &serde_json::Value, vault_path: &Path) -> bool {
    let Some(entry_vault_path) = entry["env"]["VAULT_PATH"]
        .as_str()
        .or_else(|| entry["environment"]["VAULT_PATH"].as_str())
    else {
        return false;
    };

    let Ok(expected) = std::fs::canonicalize(vault_path) else {
        return false;
    };
    let Ok(actual) = std::fs::canonicalize(entry_vault_path) else {
        return false;
    };

    actual == expected
}

/// Build the MCP server entry JSON for a given vault path and index.js path.
fn build_mcp_entry(index_js: &str, vault_path: &str) -> serde_json::Value {
    serde_json::json!({
        "command": "node",
        "args": [index_js],
        "env": { "VAULT_PATH": vault_path }
    })
}

/// Build an OpenCode-format MCP server entry.
fn build_opencode_mcp_entry(index_js: &str, vault_path: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "local",
        "command": ["node", index_js],
        "environment": { "VAULT_PATH": vault_path }
    })
}

/// Build the appropriate MCP entry based on config format.
fn build_entry(index_js: &str, vault_path: &str, format: ConfigFormat) -> serde_json::Value {
    match format {
        ConfigFormat::Standard => build_mcp_entry(index_js, vault_path),
        ConfigFormat::Opencode => build_opencode_mcp_entry(index_js, vault_path),
    }
}

/// Write MCP registration to a list of config file paths.
/// Returns "registered" on first registration, "updated" if already present.
fn register_mcp_to_configs(index_js: &str, vault_path: &str, config_paths: &[PathBuf]) -> String {
    let mut status = "registered";
    for config_path in config_paths {
        let format = detect_config_format(config_path);
        let entry = build_entry(index_js, vault_path, format);
        match upsert_mcp_config(config_path, &entry, format) {
            Ok(true) => status = "updated",
            Ok(false) => {}
            Err(e) => log::warn!("Failed to update {}: {}", config_path.display(), e),
        }
    }
    status.to_string()
}

/// Register Tolaria as an MCP server in Claude Code, Cursor, OpenCode, and generic MCP config files.
pub fn register_mcp(vault_path: &str) -> Result<String, String> {
    let server_dir = mcp_server_dir()?;
    let index_js = server_dir.join("index.js").to_string_lossy().into_owned();

    Ok(register_mcp_to_configs(
        &index_js,
        vault_path,
        &mcp_config_paths(),
    ))
}

/// Insert or update the Tolaria entry in an MCP config file.
fn upsert_mcp_config(
    config_path: &Path,
    entry: &serde_json::Value,
    format: ConfigFormat,
) -> Result<bool, String> {
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dir {}: {e}", parent.display()))?;
    }

    let mut config: serde_json::Value = if config_path.exists() {
        let raw = std::fs::read_to_string(config_path)
            .map_err(|e| format!("Cannot read {}: {e}", config_path.display()))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Invalid JSON in {}: {e}", config_path.display()))?
    } else {
        serde_json::json!({})
    };

    let key = match format {
        ConfigFormat::Standard => "mcpServers",
        ConfigFormat::Opencode => "mcp",
    };

    let servers = config
        .as_object_mut()
        .ok_or("Config is not a JSON object")?
        .entry(key)
        .or_insert_with(|| serde_json::json!({}));

    let servers = servers
        .as_object_mut()
        .ok_or(format!("{} is not a JSON object", key))?;

    let was_update =
        servers.get(MCP_SERVER_NAME).is_some() || servers.get(LEGACY_MCP_SERVER_NAME).is_some();
    servers.remove(LEGACY_MCP_SERVER_NAME);
    servers.insert(MCP_SERVER_NAME.to_string(), entry.clone());

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(config_path, json)
        .map_err(|e| format!("Cannot write {}: {e}", config_path.display()))?;

    Ok(was_update)
}

fn remove_mcp_from_configs(config_paths: &[PathBuf]) -> String {
    let mut removed_any = false;
    for config_path in config_paths {
        let format = detect_config_format(config_path);
        match remove_mcp_from_config(config_path, format) {
            Ok(true) => removed_any = true,
            Ok(false) => {}
            Err(e) => log::warn!("Failed to update {}: {}", config_path.display(), e),
        }
    }

    if removed_any {
        "removed".to_string()
    } else {
        "already_absent".to_string()
    }
}

fn remove_mcp_from_config(config_path: &Path, format: ConfigFormat) -> Result<bool, String> {
    if !config_path.exists() {
        return Ok(false);
    }

    let raw = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Cannot read {}: {e}", config_path.display()))?;
    let mut config: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid JSON in {}: {e}", config_path.display()))?;

    let Some(config_object) = config.as_object_mut() else {
        return Err("Config is not a JSON object".into());
    };

    let key = match format {
        ConfigFormat::Standard => "mcpServers",
        ConfigFormat::Opencode => "mcp",
    };

    let Some(servers_value) = config_object.get_mut(key) else {
        return Ok(false);
    };

    let Some(servers) = servers_value.as_object_mut() else {
        return Err(format!("{} is not a JSON object", key));
    };

    let removed_primary = servers.remove(MCP_SERVER_NAME).is_some();
    let removed_legacy = servers.remove(LEGACY_MCP_SERVER_NAME).is_some();
    if !removed_primary && !removed_legacy {
        return Ok(false);
    }

    if servers.is_empty() {
        config_object.remove(key);
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(config_path, json)
        .map_err(|e| format!("Cannot write {}: {e}", config_path.display()))?;

    Ok(true)
}

pub fn remove_mcp() -> String {
    remove_mcp_from_configs(&mcp_config_paths())
}

/// Check whether the MCP server is properly installed and registered.
///
/// Returns `Installed` when the Tolaria entry exists for the active vault in
/// an external AI tool config and the referenced index.js file is present.
/// Otherwise returns `NotInstalled`.
pub fn check_mcp_status(vault_path: &str) -> McpStatus {
    let active_vault_path = Path::new(vault_path);
    if mcp_config_paths().into_iter().any(|config_path| {
        read_registered_mcp_entry(&config_path).is_some_and(|entry| {
            entry_index_js_exists(&entry) && entry_targets_vault(&entry, active_vault_path)
        })
    }) {
        McpStatus::Installed
    } else {
        McpStatus::NotInstalled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_config(config_path: &Path) -> serde_json::Value {
        let raw = std::fs::read_to_string(config_path).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn temp_config_path(file_name: &str) -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join(file_name);
        (tmp, config_path)
    }

    fn write_config_json(config_path: &Path, config: serde_json::Value) {
        std::fs::write(config_path, serde_json::to_string(&config).unwrap()).unwrap();
    }

    fn managed_server(index_js: &str, vault_path: &str) -> serde_json::Value {
        serde_json::json!({
            "command": "node",
            "args": [index_js],
            "env": { "VAULT_PATH": vault_path }
        })
    }

    fn write_mcp_servers_config(config_path: &Path, servers: Vec<(&str, serde_json::Value)>) {
        let servers = servers
            .into_iter()
            .map(|(name, server)| (name.to_string(), server))
            .collect::<serde_json::Map<_, _>>();
        write_config_json(config_path, serde_json::json!({ "mcpServers": servers }));
    }

    fn write_index_js(dir: &Path) -> PathBuf {
        let index_js = dir.join("index.js");
        std::fs::write(&index_js, "console.log('ok');").unwrap();
        index_js
    }

    #[test]
    fn build_mcp_entry_produces_correct_json() {
        let entry = build_mcp_entry("/path/to/index.js", "/my/vault");
        assert_eq!(entry["command"], "node");
        assert_eq!(entry["args"][0], "/path/to/index.js");
        assert_eq!(entry["env"]["VAULT_PATH"], "/my/vault");
    }

    #[test]
    fn build_opencode_mcp_entry_produces_correct_json() {
        let entry = build_opencode_mcp_entry("/path/to/index.js", "/my/vault");
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["command"][0], "node");
        assert_eq!(entry["command"][1], "/path/to/index.js");
        assert_eq!(entry["environment"]["VAULT_PATH"], "/my/vault");
    }

    #[test]
    fn build_entry_selects_standard_format() {
        let entry = build_entry("/idx.js", "/vault", ConfigFormat::Standard);
        assert_eq!(entry["command"], "node");
        assert_eq!(entry["args"][0], "/idx.js");
        assert!(!entry["type"].is_string());
    }

    #[test]
    fn build_entry_selects_opencode_format() {
        let entry = build_entry("/idx.js", "/vault", ConfigFormat::Opencode);
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["command"][0], "node");
        assert_eq!(entry["command"][1], "/idx.js");
    }

    #[test]
    fn upsert_creates_new_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let entry = build_mcp_entry("/test/index.js", "/test/vault");

        let was_update = upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard).unwrap();
        assert!(!was_update);

        let config = read_config(&config_path);
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["args"][0],
            "/test/index.js"
        );
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["env"]["VAULT_PATH"],
            "/test/vault"
        );
    }

    #[test]
    fn upsert_updates_existing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");

        let entry1 = build_mcp_entry("/test/index.js", "/vault/v1");
        upsert_mcp_config(&config_path, &entry1, ConfigFormat::Standard).unwrap();

        let entry2 = build_mcp_entry("/test/index.js", "/vault/v2");
        let was_update = upsert_mcp_config(&config_path, &entry2, ConfigFormat::Standard).unwrap();
        assert!(was_update);

        let config = read_config(&config_path);
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["env"]["VAULT_PATH"],
            "/vault/v2"
        );
    }

    #[test]
    fn upsert_migrates_legacy_server_name() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");

        let existing = serde_json::json!({
            "mcpServers": {
                "laputa": {
                    "command": "node",
                    "args": ["/old/index.js"],
                    "env": { "VAULT_PATH": "/old" }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&existing).unwrap()).unwrap();

        let entry = build_mcp_entry("/test/index.js", "/vault");
        let was_update = upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard).unwrap();
        assert!(was_update);

        let config = read_config(&config_path);
        assert!(config["mcpServers"][LEGACY_MCP_SERVER_NAME].is_null());
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["args"][0],
            "/test/index.js"
        );
    }

    #[test]
    fn upsert_preserves_other_servers() {
        let (_tmp, config_path) = temp_config_path("mcp.json");
        write_mcp_servers_config(
            &config_path,
            vec![(
                "other-server",
                serde_json::json!({ "command": "other", "args": [] }),
            )],
        );

        let entry = build_mcp_entry("/test/index.js", "/vault");
        upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard).unwrap();

        let raw = std::fs::read_to_string(&config_path).unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(config["mcpServers"]["other-server"].is_object());
        assert!(config["mcpServers"][MCP_SERVER_NAME].is_object());
    }

    #[test]
    fn upsert_preserves_other_top_level_settings() {
        let (_tmp, config_path) = temp_config_path(".claude.json");
        write_config_json(
            &config_path,
            serde_json::json!({
                "model": "sonnet",
                "theme": "dark",
                "mcpServers": {
                    "other-server": { "command": "other", "args": [] }
                }
            }),
        );

        let entry = build_mcp_entry("/test/index.js", "/vault");
        upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard).unwrap();

        let config = read_config(&config_path);
        assert_eq!(config["model"], "sonnet");
        assert_eq!(config["theme"], "dark");
        assert!(config["mcpServers"]["other-server"].is_object());
        assert!(config["mcpServers"][MCP_SERVER_NAME].is_object());
    }

    #[test]
    fn upsert_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("nested").join("dir").join("mcp.json");
        let entry = build_mcp_entry("/test/index.js", "/vault");

        upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard).unwrap();
        assert!(config_path.exists());
    }

    #[test]
    fn upsert_opencode_creates_new_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp
            .path()
            .join(".config")
            .join("opencode")
            .join("opencode.json");
        let entry = build_opencode_mcp_entry("/test/index.js", "/test/vault");

        let was_update = upsert_mcp_config(&config_path, &entry, ConfigFormat::Opencode).unwrap();
        assert!(!was_update);

        let config = read_config(&config_path);
        assert_eq!(config["mcp"][MCP_SERVER_NAME]["type"], "local");
        assert_eq!(config["mcp"][MCP_SERVER_NAME]["command"][0], "node");
        assert_eq!(
            config["mcp"][MCP_SERVER_NAME]["command"][1],
            "/test/index.js"
        );
        assert_eq!(
            config["mcp"][MCP_SERVER_NAME]["environment"]["VAULT_PATH"],
            "/test/vault"
        );
    }

    #[test]
    fn upsert_opencode_updates_existing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");
        let existing = build_opencode_mcp_entry("/old/index.js", "/old/vault");

        let was_update =
            upsert_mcp_config(&config_path, &existing, ConfigFormat::Opencode).unwrap();
        assert!(!was_update);

        let updated = build_opencode_mcp_entry("/new/index.js", "/new/vault");
        let was_update = upsert_mcp_config(&config_path, &updated, ConfigFormat::Opencode).unwrap();
        assert!(was_update);

        let config = read_config(&config_path);
        assert_eq!(
            config["mcp"][MCP_SERVER_NAME]["command"][1],
            "/new/index.js"
        );
        assert_eq!(
            config["mcp"][MCP_SERVER_NAME]["environment"]["VAULT_PATH"],
            "/new/vault"
        );
    }

    #[test]
    fn upsert_opencode_migrates_legacy_server_name() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");

        let existing = serde_json::json!({
            "mcp": {
                "laputa": {
                    "type": "local",
                    "command": ["node", "/old/index.js"],
                    "environment": { "VAULT_PATH": "/old" }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&existing).unwrap()).unwrap();

        let entry = build_opencode_mcp_entry("/test/index.js", "/vault");
        let was_update = upsert_mcp_config(&config_path, &entry, ConfigFormat::Opencode).unwrap();
        assert!(was_update);

        let config = read_config(&config_path);
        assert!(config["mcp"][LEGACY_MCP_SERVER_NAME].is_null());
        assert_eq!(
            config["mcp"][MCP_SERVER_NAME]["command"][1],
            "/test/index.js"
        );
    }

    #[test]
    fn upsert_opencode_preserves_other_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");

        let existing = serde_json::json!({
            "provider": { "openai": { "npm": "@ai-sdk/openai" } },
            "mcp": {
                "tavily": {
                    "type": "remote",
                    "url": "https://mcp.tavily.com/mcp"
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&existing).unwrap()).unwrap();

        let entry = build_opencode_mcp_entry("/test/index.js", "/vault");
        upsert_mcp_config(&config_path, &entry, ConfigFormat::Opencode).unwrap();

        let config = read_config(&config_path);
        assert_eq!(config["provider"]["openai"]["npm"], "@ai-sdk/openai");
        assert_eq!(config["mcp"]["tavily"]["type"], "remote");
        assert!(config["mcp"][MCP_SERVER_NAME].is_object());
    }

    #[test]
    fn register_mcp_to_configs_returns_registered_for_new() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("claude").join("mcp.json");

        let status = register_mcp_to_configs("/test/index.js", "/vault", &[config]);
        assert_eq!(status, "registered");
    }

    #[test]
    fn register_mcp_to_configs_returns_updated_for_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("mcp.json");

        register_mcp_to_configs("/test/index.js", "/vault", &[config.clone()]);
        let status = register_mcp_to_configs("/test/index.js", "/vault", &[config]);
        assert_eq!(status, "updated");
    }

    #[test]
    fn register_mcp_to_configs_routes_formats_correctly() {
        let tmp = tempfile::tempdir().unwrap();
        let standard_cfg = tmp.path().join(".claude.json");
        let opencode_cfg = tmp
            .path()
            .join(".config")
            .join("opencode")
            .join("opencode.json");

        register_mcp_to_configs(
            "/test/index.js",
            "/vault",
            &[standard_cfg.clone(), opencode_cfg.clone()],
        );

        let std_config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&standard_cfg).unwrap()).unwrap();
        assert_eq!(std_config["mcpServers"][MCP_SERVER_NAME]["command"], "node");
        assert!(!std_config["mcpServers"][MCP_SERVER_NAME]["args"].is_null());

        let oc_config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&opencode_cfg).unwrap()).unwrap();
        assert_eq!(oc_config["mcp"][MCP_SERVER_NAME]["type"], "local");
        assert!(!oc_config["mcp"][MCP_SERVER_NAME]["command"].is_null());
    }

    #[test]
    fn find_node_returns_valid_path() {
        let node = find_node().unwrap();
        assert!(node.exists(), "node binary should exist at {:?}", node);
        assert!(
            node.to_string_lossy().contains("node"),
            "path should contain 'node': {:?}",
            node
        );
    }

    #[test]
    fn mcp_server_dir_resolves_in_dev() {
        let dir = mcp_server_dir().unwrap();
        assert!(dir.join("ws-bridge.js").exists());
        assert!(dir.join("index.js").exists());
        assert!(dir.join("vault.js").exists());
    }

    #[test]
    fn spawn_ws_bridge_starts_and_can_be_killed() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().to_str().unwrap();

        let mut child = spawn_ws_bridge(vault_path).unwrap();
        assert!(child.id() > 0, "child process should have a valid PID");

        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn register_mcp_to_configs_writes_multiple_configs() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_user_cfg = tmp.path().join(".claude.json");
        let claude_cfg = tmp.path().join("claude").join("mcp.json");
        let cursor_cfg = tmp.path().join("cursor").join("mcp.json");
        let generic_cfg = tmp.path().join(".config").join("mcp").join("mcp.json");
        let opencode_cfg = tmp.path().join(".config").join("opencode").join("opencode.json");
        let entry = build_mcp_entry("/test/index.js", "/vault");

        register_mcp_to_configs(
            "/test/index.js",
            "/vault",
            &[
                claude_user_cfg.clone(),
                claude_cfg.clone(),
                cursor_cfg.clone(),
                generic_cfg.clone(),
                opencode_cfg.clone(),
            ],
        );

        assert!(claude_user_cfg.exists());
        assert!(claude_cfg.exists());
        assert!(cursor_cfg.exists());
        assert!(generic_cfg.exists());
        assert!(opencode_cfg.exists());

        let raw = std::fs::read_to_string(&claude_user_cfg).unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["args"][0],
            "/test/index.js"
        );
    }

    #[test]
    fn mcp_config_paths_for_home_includes_all_supported_config_paths() {
        let home = Path::new("/Users/tester");
        let paths = mcp_config_paths_for_home(home);

        assert_eq!(
            paths,
            vec![
                home.join(".claude.json"),
                home.join(".claude").join("mcp.json"),
                home.join(".cursor").join("mcp.json"),
                home.join(".config").join("mcp").join("mcp.json"),
                home.join(".config").join("opencode").join("opencode.json"),
            ]
        );
    }

    #[test]
    fn detect_config_format_identifies_opencode_path() {
        assert_eq!(
            detect_config_format(Path::new("/Users/test/.config/opencode/opencode.json")),
            ConfigFormat::Opencode
        );
    }

    #[test]
    fn detect_config_format_identifies_standard_paths() {
        assert_eq!(
            detect_config_format(Path::new("/Users/test/.claude.json")),
            ConfigFormat::Standard
        );
        assert_eq!(
            detect_config_format(Path::new("/Users/test/.claude/mcp.json")),
            ConfigFormat::Standard
        );
        assert_eq!(
            detect_config_format(Path::new("/Users/test/.cursor/mcp.json")),
            ConfigFormat::Standard
        );
    }

    #[test]
    fn upsert_returns_error_for_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        std::fs::write(&config_path, "not valid json{{{{").unwrap();
        let entry = build_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard);
        assert!(result.is_err());
    }

    #[test]
    fn register_mcp_to_configs_handles_empty_list() {
        let status = register_mcp_to_configs("/test/index.js", "/vault", &[]);
        assert_eq!(status, "registered");
    }

    #[test]
    fn read_registered_mcp_entry_prefers_primary_server_name() {
        let (_tmp, config_path) = temp_config_path("mcp.json");
        write_mcp_servers_config(
            &config_path,
            vec![
                (
                    MCP_SERVER_NAME,
                    managed_server("/primary/index.js", "/primary"),
                ),
                (
                    LEGACY_MCP_SERVER_NAME,
                    managed_server("/legacy/index.js", "/legacy"),
                ),
            ],
        );

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert_eq!(entry["env"]["VAULT_PATH"], "/primary");
    }

    #[test]
    fn read_registered_mcp_entry_uses_legacy_server_name() {
        let (_tmp, config_path) = temp_config_path("mcp.json");
        write_mcp_servers_config(
            &config_path,
            vec![(
                LEGACY_MCP_SERVER_NAME,
                managed_server("/legacy/index.js", "/legacy"),
            )],
        );

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert_eq!(entry["env"]["VAULT_PATH"], "/legacy");
    }

    #[test]
    fn read_registered_mcp_entry_reads_opencode_format() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp
            .path()
            .join(".config")
            .join("opencode")
            .join("opencode.json");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();

        let config = serde_json::json!({
            "mcp": {
                "tolaria": {
                    "type": "local",
                    "command": ["node", "/test/index.js"],
                    "environment": { "VAULT_PATH": "/opencode/vault" }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["environment"]["VAULT_PATH"], "/opencode/vault");
    }

    #[test]
    fn read_registered_mcp_entry_returns_none_for_invalid_or_missing_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let invalid_path = tmp.path().join("invalid.json");
        std::fs::write(&invalid_path, "{not json").unwrap();
        assert!(read_registered_mcp_entry(&invalid_path).is_none());

        let empty_path = tmp.path().join("empty.json");
        let empty_config = serde_json::json!({ "other": {} });
        std::fs::write(&empty_path, serde_json::to_string(&empty_config).unwrap()).unwrap();
        assert!(read_registered_mcp_entry(&empty_path).is_none());

        let missing_path = tmp.path().join("missing.json");
        assert!(read_registered_mcp_entry(&missing_path).is_none());
    }

    #[test]
    fn entry_index_js_exists_requires_existing_first_arg() {
        let tmp = tempfile::tempdir().unwrap();
        let index_js = tmp.path().join("index.js");
        std::fs::write(&index_js, "console.log('ok');").unwrap();

        let existing = serde_json::json!({
            "args": [index_js.to_string_lossy()]
        });
        assert!(entry_index_js_exists(&existing));

        let missing = serde_json::json!({
            "args": [tmp.path().join("missing.js").to_string_lossy()]
        });
        assert!(!entry_index_js_exists(&missing));

        let no_args = serde_json::json!({});
        assert!(!entry_index_js_exists(&no_args));
    }

    #[test]
    fn entry_index_js_exists_works_with_opencode_command_array() {
        let tmp = tempfile::tempdir().unwrap();
        let index_js = tmp.path().join("index.js");
        std::fs::write(&index_js, "console.log('ok');").unwrap();

        let existing = serde_json::json!({
            "type": "local",
            "command": ["node", index_js.to_string_lossy()],
            "environment": { "VAULT_PATH": "/vault" }
        });
        assert!(entry_index_js_exists(&existing));

        let missing = serde_json::json!({
            "type": "local",
            "command": ["node", tmp.path().join("missing.js").to_string_lossy()],
            "environment": { "VAULT_PATH": "/vault" }
        });
        assert!(!entry_index_js_exists(&missing));
    }

    #[test]
    fn entry_index_js_exists_prefers_standard_args() {
        let tmp = tempfile::tempdir().unwrap();
        let good_js = tmp.path().join("good.js");
        std::fs::write(&good_js, "// ok").unwrap();

        let entry = serde_json::json!({
            "args": [good_js.to_string_lossy()],
            "command": ["node", tmp.path().join("missing.js").to_string_lossy()]
        });
        assert!(entry_index_js_exists(&entry));
    }

    #[test]
    fn upsert_returns_error_for_non_object_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        std::fs::write(&config_path, "[]").unwrap();

        let entry = build_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard);
        assert!(matches!(result, Err(ref error) if error.contains("Config is not a JSON object")));
    }

    #[test]
    fn upsert_returns_error_for_non_object_mcp_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let config = serde_json::json!({
            "mcpServers": []
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = build_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry, ConfigFormat::Standard);
        assert!(
            matches!(result, Err(ref error) if error.contains("mcpServers is not a JSON object"))
        );
    }

    #[test]
    fn upsert_opencode_returns_error_for_non_object_mcp_key() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");
        let config = serde_json::json!({
            "mcp": []
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = build_opencode_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry, ConfigFormat::Opencode);
        assert!(matches!(result, Err(ref error) if error.contains("mcp is not a JSON object")));
    }

    #[test]
    fn remove_mcp_from_config_removes_primary_and_legacy_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let config = serde_json::json!({
            "mcpServers": {
                "tolaria": { "command": "node", "args": ["/index.js"] },
                "laputa": { "command": "node", "args": ["/legacy.js"] },
                "other-server": { "command": "other", "args": [] }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let removed = remove_mcp_from_config(&config_path, ConfigFormat::Standard).unwrap();
        assert!(removed);

        let updated = read_config(&config_path);
        assert!(updated["mcpServers"][MCP_SERVER_NAME].is_null());
        assert!(updated["mcpServers"][LEGACY_MCP_SERVER_NAME].is_null());
        assert!(updated["mcpServers"]["other-server"].is_object());
    }

    #[test]
    fn remove_mcp_from_config_removes_opencode_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");
        let config = serde_json::json!({
            "mcp": {
                "tolaria": { "type": "local", "command": ["node", "/index.js"] },
                "laputa": { "type": "local", "command": ["node", "/legacy.js"] },
                "tavily": { "type": "remote", "url": "https://mcp.tavily.com/mcp" }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let removed = remove_mcp_from_config(&config_path, ConfigFormat::Opencode).unwrap();
        assert!(removed);

        let updated = read_config(&config_path);
        assert!(updated["mcp"][MCP_SERVER_NAME].is_null());
        assert!(updated["mcp"][LEGACY_MCP_SERVER_NAME].is_null());
        assert_eq!(updated["mcp"]["tavily"]["type"], "remote");
    }

    #[test]
    fn remove_mcp_from_config_removes_key_when_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("opencode.json");
        let config = serde_json::json!({
            "mcp": {
                "tolaria": { "type": "local", "command": ["node", "/index.js"] }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let removed = remove_mcp_from_config(&config_path, ConfigFormat::Opencode).unwrap();
        assert!(removed);

        let updated = read_config(&config_path);
        assert!(updated["mcp"].is_null());
    }

    #[test]
    fn remove_mcp_from_config_returns_false_when_entry_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let config = serde_json::json!({
            "mcpServers": {
                "other-server": { "command": "other", "args": [] }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let removed = remove_mcp_from_config(&config_path, ConfigFormat::Standard).unwrap();
        assert!(!removed);
    }

    #[test]
    fn check_mcp_status_returns_installed_for_matching_vault() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().join("vault");
        std::fs::create_dir_all(&vault_path).unwrap();
        let index_js = write_index_js(tmp.path());
        let config_path = tmp.path().join("mcp.json");
        let config = serde_json::json!({
            "mcpServers": {
                "tolaria": {
                    "command": "node",
                    "args": [index_js.to_string_lossy()],
                    "env": { "VAULT_PATH": vault_path.to_string_lossy() }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert!(entry_targets_vault(&entry, &vault_path));
        assert!(entry_index_js_exists(&entry));
    }

    #[test]
    fn check_mcp_status_returns_installed_for_opencode_format() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().join("vault");
        std::fs::create_dir_all(&vault_path).unwrap();
        let index_js = write_index_js(tmp.path());

        let config_dir = tmp.path().join(".config").join("opencode");
        std::fs::create_dir_all(&config_dir).unwrap();
        let config_path = config_dir.join("opencode.json");
        let config = serde_json::json!({
            "mcp": {
                "tolaria": {
                    "type": "local",
                    "command": ["node", index_js.to_string_lossy()],
                    "environment": { "VAULT_PATH": vault_path.to_string_lossy() }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert!(entry_targets_vault(&entry, &vault_path));
        assert!(entry_index_js_exists(&entry));
    }

    #[test]
    fn entry_targets_vault_requires_matching_existing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let first_vault = tmp.path().join("vault-a");
        let second_vault = tmp.path().join("vault-b");
        std::fs::create_dir_all(&first_vault).unwrap();
        std::fs::create_dir_all(&second_vault).unwrap();

        let entry = serde_json::json!({
            "env": { "VAULT_PATH": first_vault.to_string_lossy() }
        });

        assert!(entry_targets_vault(&entry, &first_vault));
        assert!(!entry_targets_vault(&entry, &second_vault));
    }

    #[test]
    fn entry_targets_vault_works_with_opencode_environment_key() {
        let tmp = tempfile::tempdir().unwrap();
        let first_vault = tmp.path().join("vault-a");
        let second_vault = tmp.path().join("vault-b");
        std::fs::create_dir_all(&first_vault).unwrap();
        std::fs::create_dir_all(&second_vault).unwrap();

        let entry = serde_json::json!({
            "type": "local",
            "environment": { "VAULT_PATH": first_vault.to_string_lossy() }
        });

        assert!(entry_targets_vault(&entry, &first_vault));
        assert!(!entry_targets_vault(&entry, &second_vault));
    }

    #[test]
    fn mcp_status_serializes_to_snake_case() {
        let json = serde_json::to_string(&McpStatus::Installed).unwrap();
        assert_eq!(json, r#""installed""#);
        let json = serde_json::to_string(&McpStatus::NotInstalled).unwrap();
        assert_eq!(json, r#""not_installed""#);
    }
}
