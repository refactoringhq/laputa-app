use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

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
    let mut last_error = None;
    for path in node_binary_candidates() {
        match verify_node_version(&path) {
            Ok(()) => return Ok(path),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| "node not found in PATH or common install locations".into()))
}

fn node_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = find_node_on_path();
    candidates.extend(find_node_in_user_shell());
    candidates.extend(fallback_node_paths());
    candidates
}

fn find_node_on_path() -> Vec<PathBuf> {
    node_lookup_command()
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| node_lookup_paths(&output.stdout))
        .unwrap_or_default()
}

fn find_node_in_user_shell() -> Vec<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .filter_map(|shell| command_path_from_shell(&shell, "node"))
        .collect()
}

fn node_lookup_paths(stdout: &[u8]) -> Vec<PathBuf> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn user_shell_candidates() -> Vec<PathBuf> {
    let mut shells = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        if !shell.is_empty() {
            shells.push(PathBuf::from(shell));
        }
    }
    shells.push(PathBuf::from("/bin/zsh"));
    shells.push(PathBuf::from("/bin/bash"));
    shells
}

fn command_path_from_shell(shell: &Path, command: &str) -> Option<PathBuf> {
    crate::hidden_command(shell)
        .arg("-lc")
        .arg(format!("command -v {command}"))
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn path_from_successful_output(output: &std::process::Output) -> Option<PathBuf> {
    if output.status.success() {
        first_existing_path(&String::from_utf8_lossy(&output.stdout))
    } else {
        None
    }
}

fn first_existing_path(stdout: &str) -> Option<PathBuf> {
    stdout.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }
        let candidate = PathBuf::from(trimmed);
        candidate.exists().then_some(candidate)
    })
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

fn fallback_node_paths() -> Vec<PathBuf> {
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
        candidates.extend(node_binary_candidates_for_home(&home));
    }

    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .collect()
}

fn node_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join(".local/share/mise/shims")
            .join(node_binary_name()),
        home.join(".mise").join("shims").join(node_binary_name()),
        home.join(".asdf").join("shims").join(node_binary_name()),
        home.join(".volta").join("bin").join(node_binary_name()),
    ];

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

    candidates
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
/// In release mode, uses platform resource roots exposed by the launcher.
pub(crate) fn mcp_server_dir() -> Result<PathBuf, String> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("mcp-server");
    let resource_roots = runtime_resource_roots();
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

fn stable_mcp_server_dir() -> Result<PathBuf, String> {
    let Some(data_dir) = dirs::data_dir() else {
        return Err("Unable to resolve data directory for stable MCP server path".into());
    };
    Ok(data_dir.join("tolaria").join("mcp-server"))
}

const EXTRACTION_LOCK_STALE_SECS: u64 = 120;

struct ExtractionLock {
    path: PathBuf,
}

impl Drop for ExtractionLock {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != ErrorKind::NotFound {
                log::warn!(
                    "Failed to remove extraction lock file {}: {}",
                    self.path.display(),
                    error
                );
            }
        }
    }
}

fn extraction_lock_path() -> Result<PathBuf, String> {
    let stable_dir = stable_mcp_server_dir()?;
    let Some(parent) = stable_dir.parent() else {
        return Err(format!(
            "Stable MCP server directory has no parent: {}",
            stable_dir.display()
        ));
    };
    Ok(parent.join("mcp-server.lock"))
}

fn extraction_lock_is_stale(lock_path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(lock_path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    let Ok(elapsed) = modified.elapsed() else {
        return false;
    };
    elapsed > Duration::from_secs(EXTRACTION_LOCK_STALE_SECS)
}

fn try_create_extraction_lock(lock_path: &Path) -> Result<Option<ExtractionLock>, String> {
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create extraction lock parent directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(mut file) => {
            writeln!(file, "{}", std::process::id()).map_err(|error| {
                format!(
                    "Failed to write extraction lock {}: {}",
                    lock_path.display(),
                    error
                )
            })?;
            file.sync_all().map_err(|error| {
                format!(
                    "Failed to sync extraction lock {}: {}",
                    lock_path.display(),
                    error
                )
            })?;
            Ok(Some(ExtractionLock {
                path: lock_path.to_path_buf(),
            }))
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(None),
        Err(error) => Err(format!(
            "Failed to create extraction lock {}: {}",
            lock_path.display(),
            error
        )),
    }
}

fn acquire_extraction_lock(lock_path: &Path) -> Result<Option<ExtractionLock>, String> {
    if let Some(lock) = try_create_extraction_lock(lock_path)? {
        return Ok(Some(lock));
    }

    if extraction_lock_is_stale(lock_path) {
        match std::fs::remove_file(lock_path) {
            Ok(()) => return try_create_extraction_lock(lock_path),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return try_create_extraction_lock(lock_path);
            }
            Err(error) => {
                return Err(format!(
                    "Failed to remove stale extraction lock {}: {}",
                    lock_path.display(),
                    error
                ));
            }
        }
    }

    Ok(None)
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| {
        format!(
            "Failed to create destination directory {}: {e}",
            dst.display()
        )
    })?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read source directory {}: {e}", src.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {e}", src.display()))?;
        let source_path = entry.path();
        let target_path = dst.join(entry.file_name());
        let metadata = std::fs::symlink_metadata(&source_path)
            .map_err(|e| format!("Failed to read metadata for {}: {e}", source_path.display()))?;

        if metadata.is_symlink() {
            let link_target = std::fs::read_link(&source_path)
                .map_err(|e| format!("Failed to read symlink {}: {e}", source_path.display()))?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(&link_target, &target_path).map_err(|e| {
                format!(
                    "Failed to create symlink {} -> {}: {e}",
                    target_path.display(),
                    link_target.display()
                )
            })?;
            #[cfg(not(unix))]
            return Err(format!(
                "Symlink copy is not supported on this platform for {} -> {}",
                target_path.display(),
                link_target.display()
            ));
        } else if metadata.is_dir() {
            copy_dir_all(&source_path, &target_path)?;
        } else {
            std::fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "Failed to copy file {} to {}: {e}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }

    Ok(())
}

const VERSION_MARKER_FILE: &str = ".tolaria-version";

fn read_version_marker(dir: &Path) -> Option<String> {
    let marker = dir.join(VERSION_MARKER_FILE);
    std::fs::read_to_string(marker)
        .ok()
        .map(|s| s.trim().to_string())
}

fn write_version_marker(dir: &Path, version: &str) -> Result<(), String> {
    let marker = dir.join(VERSION_MARKER_FILE);
    std::fs::write(&marker, version)
        .map_err(|e| format!("Failed to write version marker {}: {e}", marker.display()))
}

fn needs_extraction(app_version: &str, target: &Path) -> bool {
    if !mcp_server_dir_has_files(target) {
        return true;
    }
    read_version_marker(target).as_deref() != Some(app_version)
}

pub fn extract_mcp_server_to_stable_dir(app_version: &str) -> Result<PathBuf, String> {
    let source_dir = mcp_server_dir()?;
    let target_dir = stable_mcp_server_dir()?;

    if !needs_extraction(app_version, &target_dir) {
        return Ok(target_dir);
    }

    let lock_path = extraction_lock_path()?;
    let Some(_lock) = acquire_extraction_lock(&lock_path)? else {
        log::info!("MCP extraction skipped: another instance is extracting");
        return Ok(target_dir);
    };

    // Re-check after acquiring lock — another process may have finished extraction
    if !needs_extraction(app_version, &target_dir) {
        return Ok(target_dir);
    }

    let parent = target_dir
        .parent()
        .ok_or("stable MCP server dir has no parent")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;

    let staging_dir = parent.join("mcp-server.staging");
    let old_dir = parent.join("mcp-server.old");

    // Clean up any leftover staging/old dirs from prior crashed runs
    let _ = std::fs::remove_dir_all(&staging_dir);
    let _ = std::fs::remove_dir_all(&old_dir);

    // Stage: copy into staging dir + write version marker
    copy_dir_all(&source_dir, &staging_dir)?;
    write_version_marker(&staging_dir, app_version)?;

    // Swap: move current → old, staging → current
    if target_dir.exists() {
        std::fs::rename(&target_dir, &old_dir).map_err(|e| {
            // Clean up staging on failure
            let _ = std::fs::remove_dir_all(&staging_dir);
            format!("Failed to move old MCP dir aside: {e}")
        })?;
    }

    std::fs::rename(&staging_dir, &target_dir).map_err(|e| {
        // Attempt rollback: restore old dir
        let _ = std::fs::rename(&old_dir, &target_dir);
        format!("Failed to move staging MCP dir into place: {e}")
    })?;

    // Cleanup old dir (best effort)
    let _ = std::fs::remove_dir_all(&old_dir);

    log::info!(
        "Extracted MCP server to stable path: {}",
        target_dir.display()
    );

    Ok(target_dir)
}

fn mcp_server_dir_for_registration() -> Result<PathBuf, String> {
    let stable_dir = stable_mcp_server_dir()?;
    if mcp_server_dir_has_files(&stable_dir) && read_version_marker(&stable_dir).is_some() {
        return Ok(stable_dir);
    }
    mcp_server_dir()
}

fn mcp_server_dir_candidates(dev_path: &Path, resource_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = vec![dev_path.to_path_buf()];

    for root in resource_roots {
        candidates.push(root.join("mcp-server"));
        candidates.push(root.join("resources").join("mcp-server"));
        candidates.extend(linux_package_mcp_server_dirs(root));
    }

    candidates.extend(linux_package_mcp_server_dirs(Path::new("/usr/local")));
    candidates.extend(linux_package_mcp_server_dirs(Path::new("/usr")));
    candidates
}

fn runtime_resource_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(resource_path) = non_empty_env_path("RESOURCEPATH") {
        roots.push(resource_path);
    }

    if let Some(appdir) = non_empty_env_path("APPDIR") {
        roots.push(appdir.join("usr"));
        roots.push(appdir.join("usr").join("lib").join("tolaria"));
        roots.push(appdir.join("usr").join("lib").join("Tolaria"));
    }

    roots
}

fn non_empty_env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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

/// Returns the OpenCode config file path.
///
/// Uses `dirs::config_dir()` which resolves to `$XDG_CONFIG_HOME` (or `~/.config`)
/// on Linux. Note this differs from `stable_mcp_server_dir()` which uses
/// `dirs::data_dir()` (`$XDG_DATA_HOME` / `~/.local/share`). The divergence is
/// intentional: OpenCode stores its own config under `config_dir`, while extracted
/// MCP server binaries belong under `data_dir` per the XDG Base Directory spec.
fn opencode_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|config_dir| config_dir.join("opencode").join("opencode.json"))
}

fn read_registered_mcp_entry(config_path: &Path) -> Option<serde_json::Value> {
    read_registered_mcp_entry_with_key(config_path, "mcpServers")
}

fn read_registered_mcp_entry_with_key(
    config_path: &Path,
    config_key: &str,
) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    config
        .get(config_key)
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

fn entry_has_ui_port_in_key(entry: &serde_json::Value, key: &str) -> bool {
    entry[key]["WS_UI_PORT"].as_str() == Some("9711")
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

fn opencode_entry_index_js_exists(entry: &serde_json::Value) -> bool {
    entry["command"]
        .as_array()
        .and_then(|command| command.get(1))
        .and_then(|value| value.as_str())
        .is_some_and(|index_js| Path::new(index_js).exists())
}

fn opencode_entry_targets_vault(entry: &serde_json::Value, vault_path: &Path) -> bool {
    let Some(entry_vault_path) = entry["environment"]["VAULT_PATH"].as_str() else {
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

fn build_opencode_mcp_entry(
    node_command: &str,
    index_js: &str,
    vault_path: &str,
) -> serde_json::Value {
    serde_json::json!({
        "type": "local",
        "command": [node_command, index_js],
        "environment": {
            "VAULT_PATH": vault_path,
            "WS_UI_PORT": "9711"
        },
        "enabled": true
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
    let server_dir = mcp_server_dir_for_registration()?;
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
    let server_dir = mcp_server_dir_for_registration()?;
    let index_js = server_dir.join("index.js").to_string_lossy().into_owned();
    let node_command = node.to_string_lossy().into_owned();

    let entry = build_mcp_entry(&node_command, &index_js, vault_path);

    if let Some(opencode_path) = opencode_config_path() {
        let opencode_entry = build_opencode_mcp_entry(&node_command, &index_js, vault_path);
        if let Err(e) = upsert_mcp_config_with_key(&opencode_path, &opencode_entry, "mcp") {
            log::warn!("Failed to update OpenCode config: {e}");
        }
    }

    Ok(register_mcp_to_configs(&entry, &mcp_config_paths()))
}

/// Insert or update the Tolaria entry in an MCP config file.
fn upsert_mcp_config(config_path: &Path, entry: &serde_json::Value) -> Result<bool, String> {
    upsert_mcp_config_with_key(config_path, entry, "mcpServers")
}

fn atomic_write_json(path: &Path, json: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Config path has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Cannot create dir {}: {e}", parent.display()))?;

    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, json)
        .map_err(|e| format!("Cannot write temp file {}: {e}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, path).map_err(|e| {
        format!(
            "Cannot rename {} to {}: {e}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}

fn upsert_mcp_config_with_key(
    config_path: &Path,
    entry: &serde_json::Value,
    config_key: &str,
) -> Result<bool, String> {
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
        .entry(config_key)
        .or_insert_with(|| serde_json::json!({}));

    let servers = servers
        .as_object_mut()
        .ok_or_else(|| format!("{config_key} is not a JSON object"))?;

    let was_update =
        servers.get(MCP_SERVER_NAME).is_some() || servers.get(LEGACY_MCP_SERVER_NAME).is_some();
    servers.remove(LEGACY_MCP_SERVER_NAME);
    servers.insert(MCP_SERVER_NAME.to_string(), entry.clone());

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    atomic_write_json(config_path, &json)?;

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
    remove_mcp_from_config_with_key(config_path, "mcpServers")
}

fn remove_mcp_from_config_with_key(config_path: &Path, config_key: &str) -> Result<bool, String> {
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

    let Some(servers_value) = config_object.get_mut(config_key) else {
        return Ok(false);
    };

    let Some(servers) = servers_value.as_object_mut() else {
        return Err(format!("{config_key} is not a JSON object"));
    };

    let removed_primary = servers.remove(MCP_SERVER_NAME).is_some();
    let removed_legacy = servers.remove(LEGACY_MCP_SERVER_NAME).is_some();
    if !removed_primary && !removed_legacy {
        return Ok(false);
    }

    if servers.is_empty() {
        config_object.remove(config_key);
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    atomic_write_json(config_path, &json)?;

    Ok(true)
}

pub fn remove_mcp() -> String {
    let removed_from_standard_configs = remove_mcp_from_configs(&mcp_config_paths()) == "removed";
    let removed_from_opencode = if let Some(opencode_path) = opencode_config_path() {
        match remove_mcp_from_config_with_key(&opencode_path, "mcp") {
            Ok(removed) => removed,
            Err(e) => {
                log::warn!("Failed to update {}: {}", opencode_path.display(), e);
                false
            }
        }
    } else {
        false
    };

    if removed_from_standard_configs || removed_from_opencode {
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
    let active_vault_path = Path::new(vault_path);
    let standard_installed = mcp_config_paths().into_iter().any(|config_path| {
        read_registered_mcp_entry(&config_path).is_some_and(|entry| {
            entry_uses_stdio(&entry)
                && entry_index_js_exists(&entry)
                && entry_has_ui_port(&entry)
                && entry_targets_vault(&entry, active_vault_path)
        })
    });

    let opencode_installed = opencode_config_path().is_some_and(|config_path| {
        read_registered_mcp_entry_with_key(&config_path, "mcp").is_some_and(|entry| {
            entry["type"].as_str() == Some("local")
                && entry["enabled"].as_bool() == Some(true)
                && opencode_entry_index_js_exists(&entry)
                && entry_has_ui_port_in_key(&entry, "environment")
                && opencode_entry_targets_vault(&entry, active_vault_path)
        })
    });

    if standard_installed || opencode_installed {
        McpStatus::Installed
    } else {
        McpStatus::NotInstalled
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;

    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.as_ref() {
                std::env::set_var(self.key, previous);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

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

    #[test]
    fn atomic_write_json_writes_and_renames() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("config.json");

        atomic_write_json(&path, r#"{"key":"value"}"#).unwrap();

        assert!(path.exists());
        assert!(
            !path.with_extension("tmp").exists(),
            "temp file should be cleaned up"
        );
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, r#"{"key":"value"}"#);
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
        assert_eq!(
            entry,
            serde_json::json!({
                "type": "stdio",
                "command": "/usr/local/bin/node",
                "args": ["/path/to/index.js"],
                "env": {
                    "VAULT_PATH": "/my/vault",
                    "WS_UI_PORT": "9711"
                }
            })
        );
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
    fn node_lookup_paths_keep_non_empty_lines_in_order() {
        let stdout = b"\nC:\\Program Files\\nodejs\\node.exe\r\nC:\\Other\\node.exe\r\n";
        assert_eq!(
            node_lookup_paths(stdout),
            vec![
                PathBuf::from("C:\\Program Files\\nodejs\\node.exe"),
                PathBuf::from("C:\\Other\\node.exe"),
            ]
        );
    }

    #[test]
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-node");
        let node = dir.path().join("node");
        std::fs::write(&node, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), node.display());

        assert_eq!(first_existing_path(&stdout), Some(node));
    }

    #[cfg(unix)]
    #[test]
    fn command_path_from_shell_finds_node_from_login_shell() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let node = dir.path().join("node");
        std::fs::write(&node, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();

        let shell = dir.path().join("shell");
        std::fs::write(
            &shell,
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"-lc\" ]; then echo '{}'; fi\n",
                node.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(command_path_from_shell(&shell, "node"), Some(node));
    }

    #[test]
    fn node_major_version_accepts_current_node_output() {
        assert_eq!(node_major_version("v24.13.1\n"), Some(24));
        assert_eq!(node_major_version("18.19.0"), Some(18));
        assert_eq!(node_major_version("not-node"), None);
    }

    #[test]
    fn node_binary_candidates_include_shell_managed_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = node_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/share/mise/shims/node"),
            home.join(".asdf/shims/node"),
            home.join(".volta/bin/node"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
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
        let expected = [
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

        assert!(expected.iter().all(|path| candidates.contains(path)));
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

        assert!(candidates.contains(&PathBuf::from(
            "/tmp/.mount_tolaria/usr/lib/tolaria/resources/mcp-server"
        )));
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

    #[test]
    fn stable_mcp_server_dir_returns_data_dir_path() {
        let expected = dirs::data_dir()
            .expect("data dir should exist in test environment")
            .join("tolaria")
            .join("mcp-server");
        assert_eq!(
            stable_mcp_server_dir().expect("stable mcp dir should be resolved"),
            expected,
            "stable MCP path should be under data dir"
        );
    }

    #[test]
    fn extraction_lock_acquired_and_released() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let lock_path = extraction_lock_path().expect("lock path should resolve");
        assert!(
            !lock_path.exists(),
            "test precondition: lock file should not exist"
        );

        {
            let _lock = acquire_extraction_lock(&lock_path)
                .expect("acquire should succeed")
                .expect("lock should be acquired");
            assert!(lock_path.is_file(), "lock file should exist while held");
        }

        assert!(
            !lock_path.exists(),
            "lock file should be removed when lock guard drops"
        );
    }

    #[test]
    fn extraction_lock_rejects_concurrent_acquire() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let lock_path = extraction_lock_path().expect("lock path should resolve");
        let first = acquire_extraction_lock(&lock_path)
            .expect("first acquire should succeed")
            .expect("first lock should be acquired");

        let second = acquire_extraction_lock(&lock_path).expect("second acquire should not error");
        assert!(second.is_none(), "second acquire should be rejected while held");

        drop(first);

        let third = acquire_extraction_lock(&lock_path)
            .expect("third acquire should succeed")
            .expect("third acquire should lock after release");
        drop(third);
    }

    #[test]
    fn copy_dir_all_copies_files_and_subdirs() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");

        std::fs::create_dir_all(source.join("nested").join("deeper")).unwrap();
        std::fs::write(source.join("index.js"), "console.log('index');").unwrap();
        std::fs::write(source.join("nested").join("dep.txt"), "nested").unwrap();
        std::fs::write(
            source.join("nested").join("deeper").join("leaf.txt"),
            "leaf",
        )
        .unwrap();

        copy_dir_all(&source, &destination).expect("copy_dir_all should succeed");

        assert!(destination.join("index.js").is_file());
        assert!(destination.join("nested").join("dep.txt").is_file());
        assert!(destination
            .join("nested")
            .join("deeper")
            .join("leaf.txt")
            .is_file());
    }

    #[test]
    fn copy_dir_all_creates_destination() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");

        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("ws-bridge.js"), "console.log('bridge');").unwrap();

        assert!(
            !destination.exists(),
            "test precondition: destination should not exist"
        );
        copy_dir_all(&source, &destination).expect("copy_dir_all should create destination");
        assert!(destination.exists(), "destination should be created");
        assert!(
            destination.join("ws-bridge.js").is_file(),
            "copied file should exist in destination"
        );
    }

    #[cfg(unix)]
    #[test]
    fn copy_dir_all_preserves_symlinks() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let dst_path = dst.path().join("out");

        std::fs::write(src.path().join("real.txt"), "content").unwrap();
        std::os::unix::fs::symlink("real.txt", src.path().join("link.txt")).unwrap();

        copy_dir_all(src.path(), &dst_path).unwrap();

        let link_meta = std::fs::symlink_metadata(dst_path.join("link.txt")).unwrap();
        assert!(link_meta.is_symlink(), "symlink should be preserved");
        let target = std::fs::read_link(dst_path.join("link.txt")).unwrap();
        assert_eq!(target, PathBuf::from("real.txt"));
    }

    #[test]
    fn extract_mcp_server_to_stable_dir_creates_copy() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let extracted = extract_mcp_server_to_stable_dir("2025.5.1")
            .expect("extract_mcp_server_to_stable_dir should succeed in dev mode");

        assert!(extracted.join("index.js").is_file());
        assert!(extracted.join("ws-bridge.js").is_file());
        assert_eq!(
            read_version_marker(&extracted),
            Some("2025.5.1".to_string()),
            "version marker should be written after extraction"
        );
    }

    #[test]
    fn extract_mcp_server_to_stable_dir_replaces_existing() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let stable_dir = stable_mcp_server_dir().expect("stable dir should resolve");
        std::fs::create_dir_all(&stable_dir).unwrap();
        std::fs::write(stable_dir.join("stale.txt"), "old").unwrap();

        let extracted =
            extract_mcp_server_to_stable_dir("2025.5.2").expect("re-extraction should succeed");

        assert!(
            !extracted.join("stale.txt").exists(),
            "stale content should be removed before copy"
        );
        assert!(extracted.join("index.js").is_file());
    }

    #[test]
    fn mcp_server_dir_for_registration_prefers_stable() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let stable_dir = stable_mcp_server_dir().expect("stable dir should resolve");
        std::fs::create_dir_all(&stable_dir).unwrap();
        std::fs::write(stable_dir.join("index.js"), "console.log('index');").unwrap();
        std::fs::write(stable_dir.join("ws-bridge.js"), "console.log('ws bridge');").unwrap();
        write_version_marker(&stable_dir, "test").unwrap();

        let resolved = mcp_server_dir_for_registration().expect("registration dir should resolve");
        assert_eq!(resolved, stable_dir);
    }

    #[test]
    fn mcp_server_dir_for_registration_rejects_partial_extraction() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let stable_dir = stable_mcp_server_dir().expect("stable dir should resolve");
        std::fs::create_dir_all(&stable_dir).unwrap();
        // Create files but NO version marker — simulates partial extraction
        std::fs::write(stable_dir.join("index.js"), "").unwrap();
        std::fs::write(stable_dir.join("ws-bridge.js"), "").unwrap();

        let resolved = mcp_server_dir_for_registration().expect("should resolve");
        // Should fall back to runtime dir, not use the partial stable dir
        assert_ne!(
            resolved, stable_dir,
            "should not use stable dir without version marker"
        );
    }

    #[test]
    fn mcp_server_dir_for_registration_falls_back_to_runtime() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let stable_dir = stable_mcp_server_dir().expect("stable dir should resolve");
        std::fs::create_dir_all(&stable_dir).unwrap();

        let expected_runtime = mcp_server_dir().expect("runtime mcp server dir should resolve");
        let resolved = mcp_server_dir_for_registration().expect("registration dir should resolve");
        assert_eq!(resolved, expected_runtime);
    }

    #[test]
    fn build_opencode_mcp_entry_produces_correct_json() {
        let entry = build_opencode_mcp_entry("node", "/tmp/mcp/index.js", "/tmp/vault");
        assert_eq!(
            entry,
            serde_json::json!({
                "type": "local",
                "command": ["node", "/tmp/mcp/index.js"],
                "environment": {
                    "VAULT_PATH": "/tmp/vault",
                    "WS_UI_PORT": "9711"
                },
                "enabled": true
            })
        );
    }

    #[test]
    fn upsert_mcp_config_with_key_uses_custom_key() {
        let (_tmp, config_path) = temp_config_path("opencode.json");
        let entry = build_opencode_mcp_entry("node", "/opt/index.js", "/vault");

        let was_update =
            upsert_mcp_config_with_key(&config_path, &entry, "mcp").expect("upsert should succeed");

        assert!(
            !was_update,
            "new OpenCode config should report registration"
        );
        let config = read_config(&config_path);
        assert!(config["mcp"][MCP_SERVER_NAME].is_object());
        assert!(
            config.get("mcpServers").is_none(),
            "custom key upsert should not create mcpServers"
        );
    }

    #[test]
    fn upsert_opencode_preserves_other_config_fields() {
        let (_tmp, config_path) = temp_config_path("opencode.json");
        write_config_json(
            &config_path,
            serde_json::json!({
                "plugins": ["a", "b"],
                "agent": { "model": "x" },
                "mcp": {
                    "other": { "type": "local", "command": ["node", "other.js"] }
                }
            }),
        );

        let entry = build_opencode_mcp_entry("node", "/app/index.js", "/vault");
        upsert_mcp_config_with_key(&config_path, &entry, "mcp").expect("upsert should succeed");

        let config = read_config(&config_path);
        assert_eq!(config["plugins"], serde_json::json!(["a", "b"]));
        assert_eq!(config["agent"]["model"], "x");
        assert!(config["mcp"]["other"].is_object());
        assert!(config["mcp"][MCP_SERVER_NAME].is_object());
    }

    #[test]
    fn remove_mcp_from_config_with_key_removes_entry() {
        let (_tmp, config_path) = temp_config_path("opencode.json");
        write_config_json(
            &config_path,
            serde_json::json!({
                "mcp": {
                    MCP_SERVER_NAME: { "type": "local", "command": ["node", "index.js"] },
                    LEGACY_MCP_SERVER_NAME: { "type": "local", "command": ["node", "legacy.js"] },
                    "other": { "type": "local", "command": ["node", "other.js"] }
                }
            }),
        );

        let removed =
            remove_mcp_from_config_with_key(&config_path, "mcp").expect("remove should succeed");
        assert!(
            removed,
            "remove should report true when managed servers exist"
        );

        let config = read_config(&config_path);
        assert!(config["mcp"][MCP_SERVER_NAME].is_null());
        assert!(config["mcp"][LEGACY_MCP_SERVER_NAME].is_null());
        assert!(config["mcp"]["other"].is_object());
    }

    #[test]
    fn opencode_config_path_returns_config_dir_path() {
        let expected = dirs::config_dir().map(|dir| dir.join("opencode").join("opencode.json"));
        assert_eq!(opencode_config_path(), expected);
    }

    #[test]
    fn entry_has_ui_port_in_key_reads_requested_env_key() {
        let valid = serde_json::json!({
            "environment": {
                "WS_UI_PORT": "9711"
            }
        });
        assert!(entry_has_ui_port_in_key(&valid, "environment"));

        let invalid = serde_json::json!({
            "environment": {
                "WS_UI_PORT": "9000"
            }
        });
        assert!(!entry_has_ui_port_in_key(&invalid, "environment"));
    }

    #[test]
    fn opencode_entry_index_js_exists_checks_second_command_arg() {
        let tmp = tempfile::tempdir().unwrap();
        let index_js = write_index_js(tmp.path());
        let valid = serde_json::json!({
            "command": ["node", index_js.to_string_lossy()]
        });
        assert!(opencode_entry_index_js_exists(&valid));

        let missing = serde_json::json!({
            "command": ["node", tmp.path().join("missing.js").to_string_lossy()]
        });
        assert!(!opencode_entry_index_js_exists(&missing));
    }

    #[test]
    fn opencode_entry_targets_vault_uses_environment_vault_path() {
        let tmp = tempfile::tempdir().unwrap();
        let first_vault = tmp.path().join("vault-a");
        let second_vault = tmp.path().join("vault-b");
        std::fs::create_dir_all(&first_vault).unwrap();
        std::fs::create_dir_all(&second_vault).unwrap();

        let entry = serde_json::json!({
            "environment": {
                "VAULT_PATH": first_vault.to_string_lossy()
            }
        });

        assert!(opencode_entry_targets_vault(&entry, &first_vault));
        assert!(!opencode_entry_targets_vault(&entry, &second_vault));
    }

    #[test]
    fn read_version_marker_returns_stored_version() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(VERSION_MARKER_FILE), "2025.5.8").unwrap();

        assert_eq!(read_version_marker(tmp.path()), Some("2025.5.8".into()));
    }

    #[test]
    fn read_version_marker_trims_whitespace() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(VERSION_MARKER_FILE), "  2025.5.8\n").unwrap();

        assert_eq!(read_version_marker(tmp.path()), Some("2025.5.8".into()));
    }

    #[test]
    fn read_version_marker_returns_none_for_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_version_marker(tmp.path()), None);
    }

    #[test]
    fn write_version_marker_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        write_version_marker(tmp.path(), "2025.5.8").unwrap();

        assert_eq!(
            std::fs::read_to_string(tmp.path().join(VERSION_MARKER_FILE)).unwrap(),
            "2025.5.8"
        );
    }

    #[test]
    fn needs_extraction_true_when_target_has_no_files() {
        let target = tempfile::tempdir().unwrap();

        assert!(needs_extraction("2025.5.8", target.path()));
    }

    #[test]
    fn needs_extraction_true_when_versions_differ() {
        let target = tempfile::tempdir().unwrap();

        std::fs::write(target.path().join("index.js"), "").unwrap();
        std::fs::write(target.path().join("ws-bridge.js"), "").unwrap();
        write_version_marker(target.path(), "2025.4.1").unwrap();

        assert!(needs_extraction("2025.5.8", target.path()));
    }

    #[test]
    fn needs_extraction_true_when_marker_missing() {
        let target = tempfile::tempdir().unwrap();

        std::fs::write(target.path().join("index.js"), "").unwrap();
        std::fs::write(target.path().join("ws-bridge.js"), "").unwrap();

        assert!(needs_extraction("2025.5.8", target.path()));
    }

    #[test]
    fn needs_extraction_false_when_versions_match() {
        let target = tempfile::tempdir().unwrap();

        std::fs::write(target.path().join("index.js"), "").unwrap();
        std::fs::write(target.path().join("ws-bridge.js"), "").unwrap();
        write_version_marker(target.path(), "2025.5.8").unwrap();

        assert!(!needs_extraction("2025.5.8", target.path()));
    }

    #[test]
    fn extract_mcp_server_skips_when_version_matches() {
        let _env_lock = ENV_MUTEX.lock().unwrap();
        let data_home = tempfile::tempdir().unwrap();
        let _guard = EnvVarGuard::set("XDG_DATA_HOME", data_home.path());

        let extracted =
            extract_mcp_server_to_stable_dir("2025.5.8").expect("first extraction should succeed");

        let marker = extracted.join("marker.txt");
        std::fs::write(&marker, "should survive").unwrap();

        let extracted_again =
            extract_mcp_server_to_stable_dir("2025.5.8").expect("second extraction should succeed");

        assert_eq!(extracted, extracted_again);
        assert!(
            marker.is_file(),
            "marker file should survive when version unchanged"
        );
    }
}
