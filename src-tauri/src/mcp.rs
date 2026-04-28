use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

const MCP_SERVER_NAME: &str = "tolaria";
const LEGACY_MCP_SERVER_NAME: &str = "laputa";

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
        if let Some(path) = first_node_lookup_path(&output.stdout) {
            verify_node_version(&path)?;
            return Ok(path);
        }
    }

    if let Some(path) = fallback_node_path() {
        verify_node_version(&path)?;
        return Ok(path);
    }

    Err("node not found in PATH or common install locations".into())
}

fn first_node_lookup_path(stdout: &[u8]) -> Option<PathBuf> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn verify_node_version(node: &Path) -> Result<(), String> {
    let output = crate::hidden_command(node)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run {} --version: {e}", node.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{} --version failed; install Node.js 18+ and make it available on PATH",
            node.display()
        ));
    }

    let raw_version = String::from_utf8_lossy(&output.stdout);
    let Some(major) = node_major_version(&raw_version) else {
        return Err(format!(
            "Cannot parse Node.js version from '{}'",
            raw_version.trim()
        ));
    };
    if major < 18 {
        return Err(format!(
            "Node.js 18+ is required for Tolaria MCP tools; found {}",
            raw_version.trim()
        ));
    }

    Ok(())
}

fn node_major_version(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse().ok())
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

    #[cfg(windows)]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe"));
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local_app_data)
                    .join("Programs")
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".volta").join("bin").join(node_binary_name()));

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

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Resolve the path to `mcp-server/`.
///
/// In dev mode, uses `CARGO_MANIFEST_DIR` (set at compile time).
/// In release mode, navigates from the current executable.
pub(crate) fn mcp_server_dir() -> Result<PathBuf, String> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mcp-server");
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find executable: {e}"))?;
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    let candidates = mcp_server_dir_candidates(&dev_path, &exe, appdir.as_deref());
    if let Some(path) = candidates
        .iter()
        .find(|path| mcp_server_dir_has_files(path))
    {
        return Ok(std::fs::canonicalize(path).unwrap_or_else(|_| path.clone()));
    }

    let searched = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "mcp-server not found. Searched these paths: {searched}"
    ))
}

fn mcp_server_dir_candidates(
    dev_path: &Path,
    exe_path: &Path,
    appdir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = vec![dev_path.to_path_buf()];

    if let Some(exe_dir) = exe_path.parent() {
        candidates.push(exe_dir.join("mcp-server"));
        if let Some(bundle_root) = exe_dir.parent() {
            candidates.push(bundle_root.join("Resources").join("mcp-server"));
            candidates.push(bundle_root.join("lib").join("tolaria").join("mcp-server"));
        }
    }

    if let Some(appdir) = appdir {
        candidates.push(
            appdir
                .join("usr")
                .join("lib")
                .join("tolaria")
                .join("mcp-server"),
        );
    }

    candidates.push(
        PathBuf::from("/usr")
            .join("lib")
            .join("tolaria")
            .join("mcp-server"),
    );
    candidates
}

fn mcp_server_dir_has_files(path: &Path) -> bool {
    path.join("index.js").is_file() && path.join("ws-bridge.js").is_file()
}

/// Spawn the WebSocket bridge as a child process.
pub fn spawn_ws_bridge(vault_path: impl AsRef<Path>) -> Result<Child, String> {
    let node = find_node()?;
    let server_dir = mcp_server_dir()?;
    let script = server_dir.join("ws-bridge.js");
    let vault_path = vault_path.as_ref();

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

    log::info!(
        "ws-bridge spawned (pid: {}, vault: {})",
        child.id(),
        vault_path.display()
    );
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
        home.join(".gemini").join("settings.json"),
        home.join(".cursor").join("mcp.json"),
        home.join(".config").join("mcp").join("mcp.json"),
    ]
}

fn read_registered_mcp_entry(config_path: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    config
        .get("mcpServers")
        .and_then(|value| value.as_object())
        .and_then(|servers| {
            servers
                .get(MCP_SERVER_NAME)
                .or_else(|| servers.get(LEGACY_MCP_SERVER_NAME))
        })
        .cloned()
}

fn entry_index_js_exists(entry: &serde_json::Value) -> bool {
    entry["args"]
        .as_array()
        .and_then(|args| args.first())
        .and_then(|value| value.as_str())
        .is_some_and(|index_js| Path::new(index_js).exists())
}

fn entry_uses_stdio(entry: &serde_json::Value) -> bool {
    entry["type"].as_str() == Some("stdio")
}

fn entry_has_ui_port(entry: &serde_json::Value) -> bool {
    entry["env"]["WS_UI_PORT"].as_str() == Some("9711")
}

fn entry_targets_vault(entry: &serde_json::Value, vault_path: &Path) -> bool {
    let Some(entry_vault_path) = entry["env"]["VAULT_PATH"].as_str() else {
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
fn build_mcp_entry(node_command: &str, index_js: &str, vault_path: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "stdio",
        "command": node_command,
        "args": [index_js],
        "env": {
            "VAULT_PATH": vault_path,
            "WS_UI_PORT": "9711"
        }
    })
}

fn build_mcp_config_snippet(entry: &serde_json::Value) -> Result<String, String> {
    let mut servers = serde_json::Map::new();
    servers.insert(MCP_SERVER_NAME.to_string(), entry.clone());
    let config = serde_json::json!({ "mcpServers": servers });

    serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize MCP config snippet: {e}"))
}

/// Build the exact MCP config JSON users can copy into compatible tools.
pub fn mcp_config_snippet(vault_path: &str) -> Result<String, String> {
    let node = find_node().map_err(|e| {
        format!("Node.js 18+ is required on PATH before Tolaria can build MCP config: {e}")
    })?;
    let server_dir = mcp_server_dir()?;
    let index_js = server_dir.join("index.js").to_string_lossy().into_owned();
    let node_command = node.to_string_lossy().into_owned();
    let entry = build_mcp_entry(&node_command, &index_js, vault_path);

    build_mcp_config_snippet(&entry)
}

/// Write MCP registration to a list of config file paths.
/// Returns "registered" on first registration, "updated" if already present.
fn register_mcp_to_configs(entry: &serde_json::Value, config_paths: &[PathBuf]) -> String {
    let mut status = "registered";
    for config_path in config_paths {
        match upsert_mcp_config(config_path, entry) {
            Ok(true) => status = "updated",
            Ok(false) => {}
            Err(e) => log::warn!("Failed to update {}: {}", config_path.display(), e),
        }
    }
    status.to_string()
}

/// Register Tolaria as an MCP server in external AI tool config files.
pub fn register_mcp(vault_path: &str) -> Result<String, String> {
    let node = find_node().map_err(|e| {
        format!("Node.js 18+ is required on PATH before Tolaria can register MCP tools: {e}")
    })?;
    let server_dir = mcp_server_dir()?;
    let index_js = server_dir.join("index.js").to_string_lossy().into_owned();
    let node_command = node.to_string_lossy().into_owned();

    let entry = build_mcp_entry(&node_command, &index_js, vault_path);

    Ok(register_mcp_to_configs(&entry, &mcp_config_paths()))
}

/// Insert or update the Tolaria entry in an MCP config file.
fn upsert_mcp_config(config_path: &Path, entry: &serde_json::Value) -> Result<bool, String> {
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

    let servers = config
        .as_object_mut()
        .ok_or("Config is not a JSON object")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    let servers = servers
        .as_object_mut()
        .ok_or("mcpServers is not a JSON object")?;

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
        match remove_mcp_from_config(config_path) {
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

fn remove_mcp_from_config(config_path: &Path) -> Result<bool, String> {
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

    let Some(servers_value) = config_object.get_mut("mcpServers") else {
        return Ok(false);
    };

    let Some(servers) = servers_value.as_object_mut() else {
        return Err("mcpServers is not a JSON object".into());
    };

    let removed_primary = servers.remove(MCP_SERVER_NAME).is_some();
    let removed_legacy = servers.remove(LEGACY_MCP_SERVER_NAME).is_some();
    if !removed_primary && !removed_legacy {
        return Ok(false);
    }

    if servers.is_empty() {
        config_object.remove("mcpServers");
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
            entry_uses_stdio(&entry)
                && entry_index_js_exists(&entry)
                && entry_has_ui_port(&entry)
                && entry_targets_vault(&entry, active_vault_path)
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
            "type": "stdio",
            "command": "node",
            "args": [index_js],
            "env": { "VAULT_PATH": vault_path, "WS_UI_PORT": "9711" }
        })
    }

    fn test_mcp_entry(index_js: &str, vault_path: &str) -> serde_json::Value {
        build_mcp_entry("node", index_js, vault_path)
    }

    fn write_mcp_servers_config(config_path: &Path, servers: Vec<(&str, serde_json::Value)>) {
        let servers = servers
            .into_iter()
            .map(|(name, server)| (name.to_string(), server))
            .collect::<serde_json::Map<_, _>>();
        write_config_json(config_path, serde_json::json!({ "mcpServers": servers }));
    }

    struct ExpectedMcpServer<'a> {
        index_js: &'a str,
        vault_path: &'a str,
    }

    fn assert_registered_tolaria_server(
        config: &serde_json::Value,
        expected: ExpectedMcpServer<'_>,
    ) {
        let server = &config["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["args"][0], expected.index_js);
        assert_eq!(server["env"]["VAULT_PATH"], expected.vault_path);
    }

    fn write_index_js(dir: &Path) -> PathBuf {
        let index_js = dir.join("index.js");
        std::fs::write(&index_js, "console.log('ok');").unwrap();
        index_js
    }

    #[test]
    fn build_mcp_entry_produces_correct_json() {
        let entry = build_mcp_entry("/usr/local/bin/node", "/path/to/index.js", "/my/vault");
        assert_eq!(entry["type"], "stdio");
        assert_eq!(entry["command"], "/usr/local/bin/node");
        assert_eq!(entry["args"][0], "/path/to/index.js");
        assert_eq!(entry["env"]["VAULT_PATH"], "/my/vault");
        assert_eq!(entry["env"]["WS_UI_PORT"], "9711");
    }

    #[test]
    fn build_mcp_config_snippet_wraps_tolaria_server_entry() {
        let entry = test_mcp_entry("/path/to/index.js", "/my/vault");
        let snippet = build_mcp_config_snippet(&entry).unwrap();
        let config: serde_json::Value = serde_json::from_str(&snippet).unwrap();

        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["args"][0],
            "/path/to/index.js"
        );
        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["env"]["VAULT_PATH"],
            "/my/vault"
        );
    }

    #[test]
    fn first_node_lookup_path_uses_first_non_empty_line() {
        let stdout = b"\nC:\\Program Files\\nodejs\\node.exe\r\nC:\\Other\\node.exe\r\n";
        assert_eq!(
            first_node_lookup_path(stdout).unwrap(),
            PathBuf::from("C:\\Program Files\\nodejs\\node.exe")
        );
    }

    #[test]
    fn node_major_version_accepts_current_node_output() {
        assert_eq!(node_major_version("v24.13.1\n"), Some(24));
        assert_eq!(node_major_version("18.19.0"), Some(18));
        assert_eq!(node_major_version("not-node"), None);
    }

    #[test]
    fn mcp_server_dir_candidates_prefer_exe_dir_before_macos_resources() {
        let dev_path = Path::new("/repo/mcp-server");
        let exe_path = Path::new("/Users/tester/AppData/Local/Tolaria/tolaria.exe");
        let candidates = mcp_server_dir_candidates(dev_path, exe_path, None);

        let windows_dir = PathBuf::from("/Users/tester/AppData/Local/Tolaria/mcp-server");
        let macos_dir = PathBuf::from("/Users/tester/AppData/Local/Resources/mcp-server");
        let windows_pos = candidates
            .iter()
            .position(|path| path == &windows_dir)
            .unwrap();
        let macos_pos = candidates
            .iter()
            .position(|path| path == &macos_dir)
            .unwrap();

        assert_eq!(candidates[0], dev_path);
        assert!(windows_pos < macos_pos);
    }

    #[test]
    fn upsert_creates_new_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let entry = test_mcp_entry("/test/index.js", "/test/vault");

        let was_update = upsert_mcp_config(&config_path, &entry).unwrap();
        assert!(!was_update);

        let config = read_config(&config_path);
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/test/index.js",
                vault_path: "/test/vault",
            },
        );
    }

    #[test]
    fn upsert_updates_existing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");

        let entry1 = test_mcp_entry("/test/index.js", "/vault/v1");
        upsert_mcp_config(&config_path, &entry1).unwrap();

        let entry2 = test_mcp_entry("/test/index.js", "/vault/v2");
        let was_update = upsert_mcp_config(&config_path, &entry2).unwrap();
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

        let entry = test_mcp_entry("/test/index.js", "/vault");
        let was_update = upsert_mcp_config(&config_path, &entry).unwrap();
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

        let entry = test_mcp_entry("/test/index.js", "/vault");
        upsert_mcp_config(&config_path, &entry).unwrap();

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

        let entry = test_mcp_entry("/test/index.js", "/vault");
        upsert_mcp_config(&config_path, &entry).unwrap();

        let config = read_config(&config_path);
        assert_eq!(config["model"], "sonnet");
        assert_eq!(config["theme"], "dark");
        assert!(config["mcpServers"]["other-server"].is_object());
        assert!(config["mcpServers"][MCP_SERVER_NAME].is_object());
    }

    #[test]
    fn upsert_preserves_gemini_settings_json_fields() {
        let (_tmp, config_path) = temp_config_path("settings.json");
        write_config_json(
            &config_path,
            serde_json::json!({
                "theme": "GitHub",
                "mcpServers": {
                    "other": { "command": "example" }
                }
            }),
        );
        let entry = test_mcp_entry("/gemini/index.js", "/gemini-vault");

        let was_update = upsert_mcp_config(&config_path, &entry).unwrap();
        let config = read_config(&config_path);

        assert!(!was_update);
        assert_eq!(config["theme"], "GitHub");
        assert_eq!(config["mcpServers"]["other"]["command"], "example");
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/gemini/index.js",
                vault_path: "/gemini-vault",
            },
        );
    }

    #[test]
    fn upsert_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("nested").join("dir").join("mcp.json");
        let entry = test_mcp_entry("/test/index.js", "/vault");

        upsert_mcp_config(&config_path, &entry).unwrap();
        assert!(config_path.exists());
    }

    #[test]
    fn register_mcp_to_configs_returns_registered_for_new() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("claude").join("mcp.json");
        let entry = test_mcp_entry("/test/index.js", "/vault");

        let status = register_mcp_to_configs(&entry, &[config]);
        assert_eq!(status, "registered");
    }

    #[test]
    fn register_mcp_to_configs_returns_updated_for_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("mcp.json");
        let entry = test_mcp_entry("/test/index.js", "/vault");

        // First call
        register_mcp_to_configs(&entry, std::slice::from_ref(&config));
        // Second call
        let status = register_mcp_to_configs(&entry, &[config]);
        assert_eq!(status, "updated");
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

        // Clean up: kill the spawned process
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn register_mcp_to_configs_writes_multiple_configs() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_user_cfg = tmp.path().join(".claude.json");
        let claude_cfg = tmp.path().join("claude").join("mcp.json");
        let gemini_cfg = tmp.path().join(".gemini").join("settings.json");
        let cursor_cfg = tmp.path().join("cursor").join("mcp.json");
        let generic_cfg = tmp.path().join(".config").join("mcp").join("mcp.json");
        let entry = test_mcp_entry("/test/index.js", "/vault");

        register_mcp_to_configs(
            &entry,
            &[
                claude_user_cfg.clone(),
                claude_cfg.clone(),
                gemini_cfg.clone(),
                cursor_cfg.clone(),
                generic_cfg.clone(),
            ],
        );

        assert!(claude_user_cfg.exists());
        assert!(claude_cfg.exists());
        assert!(gemini_cfg.exists());
        assert!(cursor_cfg.exists());
        assert!(generic_cfg.exists());

        let raw = std::fs::read_to_string(&claude_user_cfg).unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/test/index.js",
                vault_path: "/vault",
            },
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
                home.join(".gemini").join("settings.json"),
                home.join(".cursor").join("mcp.json"),
                home.join(".config").join("mcp").join("mcp.json"),
            ]
        );
    }
    #[test]
    fn upsert_returns_error_for_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        std::fs::write(&config_path, "not valid json{{{{").unwrap();
        let entry = test_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry);
        assert!(result.is_err());
    }

    #[test]
    fn register_mcp_to_configs_handles_empty_list() {
        let entry = test_mcp_entry("/test/index.js", "/vault");
        // Empty config list — function should return "registered" (no existing)
        let status = register_mcp_to_configs(&entry, &[]);
        // With empty config list, there were no updates, so status should be "registered"
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
    fn upsert_returns_error_for_non_object_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        std::fs::write(&config_path, "[]").unwrap();

        let entry = test_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry);
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

        let entry = test_mcp_entry("/test/index.js", "/vault");
        let result = upsert_mcp_config(&config_path, &entry);
        assert!(
            matches!(result, Err(ref error) if error.contains("mcpServers is not a JSON object"))
        );
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

        let removed = remove_mcp_from_config(&config_path).unwrap();
        assert!(removed);

        let updated = read_config(&config_path);
        assert!(updated["mcpServers"][MCP_SERVER_NAME].is_null());
        assert!(updated["mcpServers"][LEGACY_MCP_SERVER_NAME].is_null());
        assert!(updated["mcpServers"]["other-server"].is_object());
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

        let removed = remove_mcp_from_config(&config_path).unwrap();
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
    fn mcp_status_serializes_to_snake_case() {
        let json = serde_json::to_string(&McpStatus::Installed).unwrap();
        assert_eq!(json, r#""installed""#);
        let json = serde_json::to_string(&McpStatus::NotInstalled).unwrap();
        assert_eq!(json, r#""not_installed""#);
    }
}
