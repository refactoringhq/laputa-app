use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Child;

#[cfg(any(test, all(desktop, target_os = "linux")))]
mod extraction;
mod opencode;
mod paths;
mod runtime;
mod subprocess;

#[cfg(all(desktop, target_os = "linux"))]
pub(crate) use extraction::extract_mcp_server_to_stable_dir;
pub(crate) use runtime::{find_mcp_runtime, find_node};

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

/// Resolve the path to `mcp-server/`.
///
/// In dev mode, prefers `CARGO_MANIFEST_DIR` and falls back to runtime checkout ancestors.
/// In release mode, uses launcher roots plus bundle paths derived from the executable.
pub(crate) fn mcp_server_dir() -> Result<PathBuf, String> {
    let dev_path = build_time_dev_mcp_server_dir();
    let resource_roots = paths::runtime_resource_roots();
    let candidates = mcp_server_dir_candidates(&dev_path, &resource_roots);
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

fn mcp_server_dir_for_registration() -> Result<PathBuf, String> {
    #[cfg(all(desktop, target_os = "linux"))]
    if let Some(stable_dir) = extraction::ready_stable_mcp_server_dir() {
        return Ok(stable_dir);
    }

    mcp_server_dir()
}

pub(crate) fn mcp_server_index_js_path_string() -> Result<String, String> {
    Ok(index_js_client_path(&mcp_server_dir()?))
}

fn index_js_client_path(server_dir: &Path) -> String {
    paths::client_script_path(&server_dir.join("index.js"))
}

fn build_time_dev_mcp_server_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mcp-server")
}

fn mcp_server_dir_candidates(dev_path: &Path, resource_roots: &[PathBuf]) -> Vec<PathBuf> {
    let current_dir = std::env::current_dir().ok();

    mcp_server_dir_candidates_for(dev_path, resource_roots, current_dir.as_deref())
}

fn mcp_server_dir_candidates_for(
    dev_path: &Path,
    resource_roots: &[PathBuf],
    current_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    push_unique_path(&mut candidates, dev_path.to_path_buf());

    for root in resource_roots {
        push_resource_root_candidates(&mut candidates, root);
    }

    for root in runtime_development_roots(current_dir) {
        push_development_root_candidates(&mut candidates, &root);
    }

    push_linux_package_candidates(&mut candidates, Path::new("/usr/local"));
    push_linux_package_candidates(&mut candidates, Path::new("/usr"));
    candidates
}

fn push_resource_root_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    push_unique_path(candidates, root.join("mcp-server"));
    push_unique_path(candidates, root.join("resources").join("mcp-server"));
    push_linux_package_candidates(candidates, root);
}

fn push_development_root_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    push_unique_path(candidates, root.join("mcp-server"));
    push_unique_path(candidates, root.join("resources").join("mcp-server"));
    push_unique_path(
        candidates,
        root.join("src-tauri").join("resources").join("mcp-server"),
    );
}

fn runtime_development_roots(current_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(current_dir) = current_dir {
        push_ancestor_paths(&mut roots, current_dir);
    }

    roots
}

fn push_ancestor_paths(paths: &mut Vec<PathBuf>, start: &Path) {
    for ancestor in start.ancestors().filter(|path| path.parent().is_some()) {
        push_unique_path(paths, ancestor.to_path_buf());
    }
}

fn push_linux_package_candidates(candidates: &mut Vec<PathBuf>, root: &Path) {
    for path in linux_package_mcp_server_dirs(root) {
        push_unique_path(candidates, path);
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.as_os_str().is_empty() && !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn linux_package_mcp_server_dirs(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join("Tolaria").join("mcp-server"),
        root.join("Tolaria").join("resources").join("mcp-server"),
        root.join("lib").join("Tolaria").join("mcp-server"),
        root.join("lib")
            .join("Tolaria")
            .join("resources")
            .join("mcp-server"),
        root.join("lib").join("tolaria").join("mcp-server"),
        root.join("lib")
            .join("tolaria")
            .join("resources")
            .join("mcp-server"),
    ]
}

fn mcp_server_dir_has_files(path: &Path) -> bool {
    path.join("index.js").is_file() && path.join("ws-bridge.js").is_file()
}

/// Spawn the WebSocket bridge as a child process.
pub fn spawn_ws_bridge(vault_path: impl AsRef<Path>) -> Result<Child, String> {
    spawn_ws_bridge_with_paths(vault_path, &[])
}

/// Spawn the WebSocket bridge with every active vault exposed to MCP tools.
pub fn spawn_ws_bridge_with_paths(
    vault_path: impl AsRef<Path>,
    vault_paths: &[PathBuf],
) -> Result<Child, String> {
    let runtime = find_mcp_runtime()?;
    let server_dir = mcp_server_dir()?;
    let script = server_dir.join("ws-bridge.js");
    let vault_path = vault_path.as_ref();
    let active_vault_paths = active_vault_paths_json(vault_path, vault_paths);

    let mut command = subprocess::command(&runtime.binary);
    let child = command
        .arg(&script)
        .env("VAULT_PATH", vault_path)
        .env("VAULT_PATHS", active_vault_paths)
        .env("WS_PORT", "9710")
        .env("WS_UI_PORT", "9711")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ws-bridge: {e}"))?;

    log::info!(
        "ws-bridge spawned (pid: {}, runtime: {:?}, vault: {})",
        child.id(),
        runtime.kind,
        vault_path.display()
    );
    Ok(child)
}

fn active_vault_paths_json(vault_path: &Path, vault_paths: &[PathBuf]) -> String {
    let mut paths = Vec::new();
    push_unique_bridge_vault_path(&mut paths, vault_path);
    for path in vault_paths {
        push_unique_bridge_vault_path(&mut paths, path);
    }
    serde_json::to_string(&paths).unwrap_or_else(|_| "[]".to_string())
}

fn push_unique_bridge_vault_path(paths: &mut Vec<String>, path: &Path) {
    let value = path.to_string_lossy().trim().to_string();
    if value.is_empty() || paths.iter().any(|existing| existing == &value) {
        return;
    }
    paths.push(value);
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

/// Build the durable external MCP server entry JSON for an index.js path.
fn build_mcp_entry(runtime_command: &str, index_js: &str) -> serde_json::Value {
    let index_js = paths::client_script_path(Path::new(index_js));
    serde_json::json!({
        "type": "stdio",
        "command": runtime_command,
        "args": [index_js],
        "env": {
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
    let _ = vault_path;
    let runtime = find_mcp_runtime().map_err(|e| {
        format!(
            "Node.js 18+ or Bun 1+ is required on PATH before Tolaria can build MCP config: {e}"
        )
    })?;
    let server_dir = mcp_server_dir_for_registration()?;
    let index_js = index_js_client_path(&server_dir);
    let runtime_command = runtime.binary.to_string_lossy().into_owned();
    let entry = build_mcp_entry(&runtime_command, &index_js);

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
    let _ = vault_path;
    let runtime = find_mcp_runtime().map_err(|e| {
        format!(
            "Node.js 18+ or Bun 1+ is required on PATH before Tolaria can register MCP tools: {e}"
        )
    })?;
    let server_dir = mcp_server_dir_for_registration()?;
    let index_js = index_js_client_path(&server_dir);
    let runtime_command = runtime.binary.to_string_lossy().into_owned();

    let entry = build_mcp_entry(&runtime_command, &index_js);
    let opencode_entry = opencode::build_entry(&runtime_command, &index_js);
    if let Some(config_path) = opencode::config_path() {
        if let Err(e) = opencode::upsert_config(&config_path, &opencode_entry) {
            log::warn!("Failed to update {}: {}", config_path.display(), e);
        }
    }

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
    let removed_standard = remove_mcp_from_configs(&mcp_config_paths()) == "removed";
    let removed_opencode = opencode::config_path().is_some_and(|config_path| {
        opencode::remove_config(&config_path).unwrap_or_else(|e| {
            log::warn!("Failed to update {}: {}", config_path.display(), e);
            false
        })
    });

    if removed_standard || removed_opencode {
        "removed".to_string()
    } else {
        "already_absent".to_string()
    }
}

/// Check whether the MCP server is properly installed and registered.
///
/// Returns `Installed` when the Tolaria entry exists for the active vault in
/// an external AI tool config and the referenced index.js file is present.
/// Otherwise returns `NotInstalled`.
pub fn check_mcp_status(vault_path: &str) -> McpStatus {
    let _ = vault_path;
    let installed_standard = mcp_config_paths().into_iter().any(|config_path| {
        read_registered_mcp_entry(&config_path).is_some_and(|entry| {
            entry_uses_stdio(&entry) && entry_index_js_exists(&entry) && entry_has_ui_port(&entry)
        })
    });
    let installed_opencode = opencode::config_path().is_some_and(|config_path| {
        opencode::read_registered_entry(&config_path)
            .is_some_and(|entry| opencode::entry_is_installed(&entry))
    });

    if installed_standard || installed_opencode {
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

    fn managed_server(index_js: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [index_js],
            "env": { "WS_UI_PORT": "9711" }
        })
    }

    fn test_mcp_entry(index_js: &str) -> serde_json::Value {
        build_mcp_entry("node", index_js)
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
    }

    fn assert_registered_tolaria_server(
        config: &serde_json::Value,
        expected: ExpectedMcpServer<'_>,
    ) {
        let server = &config["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["args"][0], expected.index_js);
        assert!(server["env"]["VAULT_PATH"].is_null());
        assert_eq!(server["env"]["WS_UI_PORT"], "9711");
    }

    fn write_index_js(dir: &Path) -> PathBuf {
        let index_js = dir.join("index.js");
        std::fs::write(&index_js, "console.log('ok');").unwrap();
        index_js
    }

    fn assert_candidates_include(candidates: &[PathBuf], expected: &[PathBuf]) {
        for candidate in expected {
            assert!(
                candidates.contains(candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn build_mcp_entry_produces_correct_json() {
        let entry = build_mcp_entry("/usr/local/bin/node", "/path/to/index.js");
        assert_eq!(
            entry,
            serde_json::json!({
                "type": "stdio",
                "command": "/usr/local/bin/node",
                "args": ["/path/to/index.js"],
                "env": {
                    "WS_UI_PORT": "9711"
                }
            })
        );
    }

    #[test]
    fn build_mcp_entry_strips_windows_extended_length_script_prefix() {
        let entry = build_mcp_entry("node", r"\\?\D:\Tolaria\mcp-server\index.js");

        assert_eq!(entry["args"][0], r"D:\Tolaria\mcp-server\index.js",);
    }

    #[test]
    fn build_mcp_config_snippet_wraps_tolaria_server_entry() {
        let entry = test_mcp_entry("/path/to/index.js");
        let snippet = build_mcp_config_snippet(&entry).unwrap();
        let config: serde_json::Value = serde_json::from_str(&snippet).unwrap();

        assert_eq!(
            config["mcpServers"][MCP_SERVER_NAME]["args"][0],
            "/path/to/index.js"
        );
        assert!(config["mcpServers"][MCP_SERVER_NAME]["env"]["VAULT_PATH"].is_null());
    }

    #[test]
    fn mcp_server_dir_candidates_prefer_resource_root_before_linux_packages() {
        let dev_path = Path::new("/repo/mcp-server");
        let resource_roots = vec![PathBuf::from(
            "/Applications/Tolaria.app/Contents/Resources",
        )];
        let candidates = mcp_server_dir_candidates(dev_path, &resource_roots);

        let resource_dir = PathBuf::from("/Applications/Tolaria.app/Contents/Resources/mcp-server");
        let linux_pos = candidates
            .iter()
            .position(|path| path == &PathBuf::from("/usr/local/Tolaria/mcp-server"))
            .unwrap();

        assert_eq!(candidates[0], dev_path);
        assert_eq!(candidates[1], resource_dir);
        assert!(1 < linux_pos);
    }

    #[test]
    fn mcp_server_dir_candidates_include_linux_package_resource_roots() {
        let dev_path = Path::new("/repo/mcp-server");
        let resource_roots = vec![PathBuf::from("/opt/tolaria")];
        let candidates = mcp_server_dir_candidates(dev_path, &resource_roots);
        let expected = vec![
            PathBuf::from("/opt/tolaria/Tolaria/mcp-server"),
            PathBuf::from("/opt/tolaria/Tolaria/resources/mcp-server"),
            PathBuf::from("/opt/tolaria/lib/Tolaria/mcp-server"),
            PathBuf::from("/opt/tolaria/lib/Tolaria/resources/mcp-server"),
            PathBuf::from("/opt/tolaria/lib/tolaria/mcp-server"),
            PathBuf::from("/opt/tolaria/lib/tolaria/resources/mcp-server"),
            PathBuf::from("/usr/local/Tolaria/mcp-server"),
            PathBuf::from("/usr/local/Tolaria/resources/mcp-server"),
            PathBuf::from("/usr/local/lib/Tolaria/mcp-server"),
            PathBuf::from("/usr/local/lib/Tolaria/resources/mcp-server"),
            PathBuf::from("/usr/local/lib/tolaria/mcp-server"),
            PathBuf::from("/usr/local/lib/tolaria/resources/mcp-server"),
            PathBuf::from("/usr/lib/Tolaria/mcp-server"),
            PathBuf::from("/usr/lib/Tolaria/resources/mcp-server"),
            PathBuf::from("/usr/lib/tolaria/mcp-server"),
            PathBuf::from("/usr/lib/tolaria/resources/mcp-server"),
        ];

        assert_candidates_include(&candidates, &expected);
    }

    #[test]
    fn mcp_server_dir_candidates_include_deb_capitalized_lib_root() {
        let dev_path = Path::new("/repo/mcp-server");
        let candidates = mcp_server_dir_candidates(dev_path, &[]);

        assert!(candidates.contains(&PathBuf::from("/usr/lib/Tolaria/mcp-server")));
    }

    #[test]
    fn mcp_server_dir_candidates_include_linux_appimage_resource_root() {
        let dev_path = Path::new("/repo/mcp-server");
        let resource_roots = vec![PathBuf::from("/tmp/.mount_tolaria/usr")];
        let candidates = mcp_server_dir_candidates(dev_path, &resource_roots);

        assert_candidates_include(
            &candidates,
            &[PathBuf::from(
                "/tmp/.mount_tolaria/usr/lib/tolaria/resources/mcp-server",
            )],
        );
    }

    #[test]
    fn mcp_server_dir_candidates_include_runtime_dev_roots_when_build_path_is_stale() {
        let stale_dev_path = Path::new("/Users/runner/work/tolaria/tolaria/mcp-server");
        let current_dir = Path::new("/Users/luca/Workspace/tolaria");
        let candidates = mcp_server_dir_candidates_for(stale_dev_path, &[], Some(current_dir));

        assert!(candidates.contains(&PathBuf::from("/Users/luca/Workspace/tolaria/mcp-server")));
        assert!(candidates.contains(&PathBuf::from(
            "/Users/luca/Workspace/tolaria/src-tauri/resources/mcp-server"
        )));
    }

    #[test]
    fn mcp_server_dir_candidates_include_macos_bundle_resources() {
        let dev_path = Path::new("/repo/mcp-server");
        let resource_roots = vec![PathBuf::from(
            "/Applications/Tolaria.app/Contents/Resources",
        )];
        let candidates = mcp_server_dir_candidates_for(dev_path, &resource_roots, None);

        assert_candidates_include(
            &candidates,
            &[PathBuf::from(
                "/Applications/Tolaria.app/Contents/Resources/mcp-server",
            )],
        );
    }

    #[test]
    fn upsert_creates_new_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");
        let entry = test_mcp_entry("/test/index.js");

        let was_update = upsert_mcp_config(&config_path, &entry).unwrap();
        assert!(!was_update);

        let config = read_config(&config_path);
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/test/index.js",
            },
        );
    }

    #[test]
    fn upsert_updates_existing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mcp.json");

        let entry1 = test_mcp_entry("/test/index.js");
        upsert_mcp_config(&config_path, &entry1).unwrap();

        let entry2 = test_mcp_entry("/test/index.js");
        let was_update = upsert_mcp_config(&config_path, &entry2).unwrap();
        assert!(was_update);

        let config = read_config(&config_path);
        assert!(config["mcpServers"][MCP_SERVER_NAME]["env"]["VAULT_PATH"].is_null());
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

        let entry = test_mcp_entry("/test/index.js");
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

        let entry = test_mcp_entry("/test/index.js");
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

        let entry = test_mcp_entry("/test/index.js");
        upsert_mcp_config(&config_path, &entry).unwrap();

        let config = read_config(&config_path);
        assert_eq!(
            (
                config["model"].as_str(),
                config["theme"].as_str(),
                config["mcpServers"]["other-server"].is_object(),
                config["mcpServers"][MCP_SERVER_NAME].is_object(),
            ),
            (Some("sonnet"), Some("dark"), true, true)
        );
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
        let entry = test_mcp_entry("/gemini/index.js");

        let was_update = upsert_mcp_config(&config_path, &entry).unwrap();
        let config = read_config(&config_path);

        assert!(!was_update);
        assert_eq!(config["theme"], "GitHub");
        assert_eq!(config["mcpServers"]["other"]["command"], "example");
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/gemini/index.js",
            },
        );
    }

    #[test]
    fn upsert_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("nested").join("dir").join("mcp.json");
        let entry = test_mcp_entry("/test/index.js");

        upsert_mcp_config(&config_path, &entry).unwrap();
        assert!(config_path.exists());
    }

    #[test]
    fn register_mcp_to_configs_returns_registered_for_new() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("claude").join("mcp.json");
        let entry = test_mcp_entry("/test/index.js");

        let status = register_mcp_to_configs(&entry, &[config]);
        assert_eq!(status, "registered");
    }

    #[test]
    fn register_mcp_to_configs_returns_updated_for_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("mcp.json");
        let entry = test_mcp_entry("/test/index.js");

        // First call
        register_mcp_to_configs(&entry, std::slice::from_ref(&config));
        // Second call
        let status = register_mcp_to_configs(&entry, &[config]);
        assert_eq!(status, "updated");
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
        let entry = test_mcp_entry("/test/index.js");

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
        let config_paths = [
            &claude_user_cfg,
            &claude_cfg,
            &gemini_cfg,
            &cursor_cfg,
            &generic_cfg,
        ];

        assert!(config_paths.iter().all(|config_path| config_path.exists()));

        let raw = std::fs::read_to_string(&claude_user_cfg).unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_registered_tolaria_server(
            &config,
            ExpectedMcpServer {
                index_js: "/test/index.js",
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
        let entry = test_mcp_entry("/test/index.js");
        let result = upsert_mcp_config(&config_path, &entry);
        assert!(result.is_err());
    }

    #[test]
    fn register_mcp_to_configs_handles_empty_list() {
        let entry = test_mcp_entry("/test/index.js");
        // Empty config list — function should return "registered" (no existing)
        let status = register_mcp_to_configs(&entry, &[]);
        // With empty config list, there were no updates, so status should be "registered"
        assert_eq!(status, "registered");
    }

    #[test]
    fn read_registered_mcp_entry_prefers_primary_then_uses_legacy_server_name() {
        let (_tmp, config_path) = temp_config_path("mcp.json");
        write_mcp_servers_config(
            &config_path,
            vec![
                (MCP_SERVER_NAME, managed_server("/primary/index.js")),
                (LEGACY_MCP_SERVER_NAME, managed_server("/legacy/index.js")),
            ],
        );

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert_eq!(entry["args"][0], "/primary/index.js");

        write_mcp_servers_config(
            &config_path,
            vec![(LEGACY_MCP_SERVER_NAME, managed_server("/legacy/index.js"))],
        );
        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert_eq!(entry["args"][0], "/legacy/index.js");
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

        let entry = test_mcp_entry("/test/index.js");
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

        let entry = test_mcp_entry("/test/index.js");
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
    fn durable_entry_is_status_eligible_without_vault_env() {
        let tmp = tempfile::tempdir().unwrap();
        let index_js = write_index_js(tmp.path());
        let config_path = tmp.path().join("mcp.json");
        let config = serde_json::json!({
            "mcpServers": {
                "tolaria": {
                    "type": "stdio",
                    "command": "node",
                    "args": [index_js.to_string_lossy()],
                    "env": { "WS_UI_PORT": "9711" }
                }
            }
        });
        std::fs::write(&config_path, serde_json::to_string(&config).unwrap()).unwrap();

        let entry = read_registered_mcp_entry(&config_path).unwrap();
        assert!(entry_uses_stdio(&entry));
        assert!(entry_index_js_exists(&entry));
        assert!(entry_has_ui_port(&entry));
    }

    #[test]
    fn mcp_status_serializes_to_snake_case() {
        let json = serde_json::to_string(&McpStatus::Installed).unwrap();
        assert_eq!(json, r#""installed""#);
        let json = serde_json::to_string(&McpStatus::NotInstalled).unwrap();
        assert_eq!(json, r#""not_installed""#);
    }
}
