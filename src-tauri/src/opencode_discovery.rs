use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    match find_binary() {
        Ok(binary) => AiAgentAvailability {
            installed: true,
            version: version_for_binary(&binary),
        },
        Err(_) => AiAgentAvailability {
            installed: false,
            version: None,
        },
    }
}

pub(crate) fn find_binary() -> Result<PathBuf, String> {
    if let Some(binary) = find_binary_on_path() {
        return Ok(binary);
    }

    if let Some(binary) = find_binary_in_user_shell() {
        return Ok(binary);
    }

    if let Some(binary) = find_existing_binary(opencode_binary_candidates()) {
        return Ok(binary);
    }

    Err("OpenCode CLI not found. Install it: https://opencode.ai/docs/".into())
}

fn version_for_binary(binary: &PathBuf) -> Option<String> {
    crate::hidden_command(binary)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn find_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(path_lookup_command())
        .arg("opencode")
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn path_lookup_command() -> &'static str {
    if cfg!(windows) {
        "where"
    } else {
        "which"
    }
}

fn find_binary_in_user_shell() -> Option<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| command_path_from_shell(&shell, "opencode"))
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

fn find_existing_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn opencode_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| opencode_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn opencode_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/opencode"),
        home.join(".local/bin/opencode.exe"),
        home.join(".opencode/bin/opencode"),
        home.join(".opencode/bin/opencode.exe"),
        home.join(".local/share/mise/shims/opencode"),
        home.join(".local/share/mise/shims/opencode.exe"),
        home.join(".asdf/shims/opencode"),
        home.join(".asdf/shims/opencode.exe"),
        home.join(".npm-global/bin/opencode"),
        home.join(".npm-global/bin/opencode.cmd"),
        home.join(".npm-global/bin/opencode.exe"),
        home.join(".npm/bin/opencode"),
        home.join(".npm/bin/opencode.cmd"),
        home.join(".npm/bin/opencode.exe"),
        home.join(".bun/bin/opencode"),
        home.join(".bun/bin/opencode.exe"),
        home.join("AppData/Roaming/npm/opencode.cmd"),
        home.join("AppData/Roaming/npm/opencode.exe"),
        home.join("AppData/Local/pnpm/opencode.cmd"),
        home.join("AppData/Local/pnpm/opencode.exe"),
        home.join("scoop/shims/opencode.exe"),
        PathBuf::from("/usr/local/bin/opencode"),
        PathBuf::from("/opt/homebrew/bin/opencode"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_local_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = opencode_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/opencode"),
            home.join(".opencode/bin/opencode"),
            home.join(".local/share/mise/shims/opencode"),
            home.join(".asdf/shims/opencode"),
            home.join(".npm-global/bin/opencode"),
            home.join(".bun/bin/opencode"),
            PathBuf::from("/opt/homebrew/bin/opencode"),
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
    fn binary_candidates_include_windows_npm_and_toolchain_shims() {
        let home = PathBuf::from(r"C:\Users\alex");
        let candidates = opencode_binary_candidates_for_home(&home);
        let expected = [
            home.join(".npm-global/bin/opencode.cmd"),
            home.join(".npm-global/bin/opencode.exe"),
            home.join(".npm/bin/opencode.cmd"),
            home.join(".npm/bin/opencode.exe"),
            home.join("AppData/Roaming/npm/opencode.cmd"),
            home.join("AppData/Roaming/npm/opencode.exe"),
            home.join("AppData/Local/pnpm/opencode.cmd"),
            home.join("AppData/Local/pnpm/opencode.exe"),
            home.join("scoop/shims/opencode.exe"),
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
    fn path_lookup_command_matches_current_platform() {
        let expected = if cfg!(windows) { "where" } else { "which" };

        assert_eq!(path_lookup_command(), expected);
    }

    #[test]
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-opencode");
        let opencode = dir.path().join("opencode");
        std::fs::write(&opencode, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), opencode.display());

        assert_eq!(first_existing_path(&stdout), Some(opencode));
    }
}
