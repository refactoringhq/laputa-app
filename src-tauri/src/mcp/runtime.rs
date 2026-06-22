use std::path::{Path, PathBuf};
use std::process::Command;

use super::subprocess;

/// A resolved runtime that can execute the MCP server scripts.
#[derive(Debug, Clone)]
pub(crate) struct McpRuntime {
    pub(crate) kind: McpRuntimeKind,
    pub(crate) binary: PathBuf,
}

/// Which JS runtime was selected for the MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum McpRuntimeKind {
    Node,
    Bun,
}

impl McpRuntimeKind {
    fn binary_name(self) -> &'static str {
        match self {
            McpRuntimeKind::Node => node_binary_name(),
            McpRuntimeKind::Bun => bun_binary_name(),
        }
    }
}

/// Find any supported MCP runtime, preferring Node over Bun.
pub(crate) fn find_mcp_runtime() -> Result<McpRuntime, String> {
    let mut last_error = None;
    for kind in [McpRuntimeKind::Node, McpRuntimeKind::Bun] {
        if let Some(binary) = try_runtime(kind, &mut last_error) {
            return Ok(McpRuntime { kind, binary });
        }
    }
    Err(last_error.unwrap_or_else(|| {
        "No supported MCP runtime found. Install Node.js 18+ or Bun 1+ and ensure it's on PATH."
            .into()
    }))
}

/// Find the `node` binary specifically. Used by Codex/CLI agent shims that
/// require Node and cannot fall back to Bun.
pub(crate) fn find_node() -> Result<PathBuf, String> {
    let mut last_error = None;
    if let Some(binary) = try_runtime(McpRuntimeKind::Node, &mut last_error) {
        return Ok(binary);
    }
    Err(last_error.unwrap_or_else(|| {
        format!(
            "{} not found in PATH or common install locations",
            McpRuntimeKind::Node.binary_name()
        )
    }))
}

fn try_runtime(kind: McpRuntimeKind, last_error: &mut Option<String>) -> Option<PathBuf> {
    for path in runtime_binary_candidates(kind) {
        match verify_runtime_version(kind, &path) {
            Ok(()) => return Some(path),
            Err(error) => *last_error = Some(error),
        }
    }
    None
}

fn runtime_binary_candidates(kind: McpRuntimeKind) -> Vec<PathBuf> {
    let command = kind.binary_name();
    let mut candidates = find_on_path(command);
    candidates.extend(find_in_user_shell(command));
    candidates.extend(fallback_paths_for(kind));
    candidates
}

fn fallback_paths_for(kind: McpRuntimeKind) -> Vec<PathBuf> {
    match kind {
        McpRuntimeKind::Node => fallback_node_paths(),
        McpRuntimeKind::Bun => fallback_bun_paths(),
    }
}

fn verify_runtime_version(kind: McpRuntimeKind, path: &Path) -> Result<(), String> {
    match kind {
        McpRuntimeKind::Node => verify_node_version(path),
        McpRuntimeKind::Bun => verify_bun_version(path),
    }
}

fn find_on_path(command: &str) -> Vec<PathBuf> {
    lookup_command(command)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| lookup_paths(&output.stdout))
        .unwrap_or_default()
}

fn find_in_user_shell(command: &str) -> Vec<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .filter_map(|shell| command_path_from_shell(&shell, command))
        .collect()
}

fn lookup_paths(stdout: &[u8]) -> Vec<PathBuf> {
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
    subprocess::command(shell)
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
    let output = subprocess::command(node)
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

fn lookup_command(command: &str) -> Command {
    #[cfg(windows)]
    let mut cmd = subprocess::command("where.exe");
    #[cfg(not(windows))]
    let mut cmd = subprocess::command("which");

    cmd.arg(command);
    cmd
}

fn fallback_node_paths() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];

    #[cfg(not(windows))]
    candidates.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin/node"));

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
        home.join(".linuxbrew").join("bin").join(node_binary_name()),
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

fn fallback_bun_paths() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/bun"),
        PathBuf::from("/usr/local/bin/bun"),
    ];

    #[cfg(windows)]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            candidates.push(
                PathBuf::from(profile)
                    .join(".bun")
                    .join("bin")
                    .join("bun.exe"),
            );
        }
    }

    if let Some(home) = dirs::home_dir() {
        candidates.extend(bun_binary_candidates_for_home(&home));
    }

    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .collect()
}

fn bun_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".bun").join("bin").join(bun_binary_name()),
        home.join(".local/share/mise/shims").join(bun_binary_name()),
        home.join(".mise").join("shims").join(bun_binary_name()),
        home.join(".asdf").join("shims").join(bun_binary_name()),
        home.join(".proto").join("bin").join(bun_binary_name()),
    ]
}

fn bun_binary_name() -> &'static str {
    if cfg!(windows) {
        "bun.exe"
    } else {
        "bun"
    }
}

fn verify_bun_version(bun: &Path) -> Result<(), String> {
    let output = subprocess::command(bun)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run {} --version: {e}", bun.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{} --version failed; install Bun 1+ and make it available on PATH",
            bun.display()
        ));
    }

    let raw_version = String::from_utf8_lossy(&output.stdout);
    let Some(major) = node_major_version(&raw_version) else {
        return Err(format!(
            "Cannot parse Bun version from '{}'",
            raw_version.trim()
        ));
    };
    if major < 1 {
        return Err(format!(
            "Bun 1+ is required for Tolaria MCP tools; found {}",
            raw_version.trim()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_candidates_include(candidates: &[PathBuf], expected: &[PathBuf]) {
        for candidate in expected {
            assert!(
                candidates.contains(candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    fn assert_home_binary_candidates_include(
        home: &Path,
        candidates: &[PathBuf],
        expected_relative_paths: &[&str],
    ) {
        let expected = expected_relative_paths
            .iter()
            .map(|relative| home.join(relative))
            .collect::<Vec<_>>();
        assert_candidates_include(candidates, &expected);
    }

    #[test]
    fn lookup_paths_keep_non_empty_lines_in_order() {
        let stdout = b"\nC:\\Program Files\\nodejs\\node.exe\r\nC:\\Other\\node.exe\r\n";
        assert_eq!(
            lookup_paths(stdout),
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
    fn home_binary_candidates_include_shell_managed_installs() {
        let home = PathBuf::from("/Users/alex");
        let cases = [
            (
                node_binary_candidates_for_home(&home),
                &[
                    ".local/share/mise/shims/node",
                    ".asdf/shims/node",
                    ".volta/bin/node",
                    ".linuxbrew/bin/node",
                ][..],
            ),
            (
                bun_binary_candidates_for_home(&home),
                &[
                    ".bun/bin/bun",
                    ".local/share/mise/shims/bun",
                    ".mise/shims/bun",
                    ".asdf/shims/bun",
                    ".proto/bin/bun",
                ][..],
            ),
        ];

        for (candidates, expected_paths) in cases {
            assert_home_binary_candidates_include(&home, &candidates, expected_paths);
        }
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
    fn find_mcp_runtime_returns_valid_runtime() {
        let runtime = find_mcp_runtime().unwrap();
        assert!(
            runtime.binary.exists(),
            "runtime binary should exist at {:?}",
            runtime.binary
        );
        let expected = match runtime.kind {
            McpRuntimeKind::Node => "node",
            McpRuntimeKind::Bun => "bun",
        };
        assert!(
            runtime.binary.to_string_lossy().contains(expected),
            "path should contain '{expected}': {:?}",
            runtime.binary
        );
    }

    #[test]
    fn verify_bun_version_accepts_real_bun_binary() {
        let Ok(bun) = find_bun_for_test() else {
            // Bun is optional on dev machines; skip when absent.
            return;
        };
        verify_bun_version(&bun).expect("installed bun should satisfy version requirement");
    }

    fn find_bun_for_test() -> Result<PathBuf, String> {
        let mut last_error = None;
        if let Some(bin) = try_runtime(McpRuntimeKind::Bun, &mut last_error) {
            return Ok(bin);
        }
        Err(last_error.unwrap_or_else(|| "bun not present in test environment".into()))
    }
}
