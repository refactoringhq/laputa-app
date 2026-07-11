use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    match find_binary() {
        Ok(binary) => AiAgentAvailability {
            installed: true,
            version: crate::cli_agent_runtime::version_for_binary(&binary),
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
    if let Some(binary) = crate::cli_agent_runtime::find_executable_binary_candidate(
        antigravity_binary_candidates(),
        "Antigravity CLI",
    )? {
        return Ok(binary);
    }

    Err("Antigravity CLI not found. Install it: https://antigravity.google/docs/cli/install".into())
}

fn find_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(path_lookup_command())
        .arg("agy")
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
        .find_map(|shell| command_path_from_shell(&shell, "agy"))
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
    first_existing_path_for_platform(stdout, cfg!(windows))
}

fn first_existing_path_for_platform(stdout: &str, windows: bool) -> Option<PathBuf> {
    let mut paths = stdout.lines().filter_map(existing_path);
    if windows {
        return paths.find(|path| crate::cli_agent_runtime::has_windows_cli_extension(path));
    }

    paths.next()
}

fn existing_path(line: &str) -> Option<PathBuf> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    candidate.exists().then_some(candidate)
}

fn antigravity_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| antigravity_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn antigravity_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/agy"),
        home.join(".local/bin/agy.cmd"),
        home.join(".local/bin/agy.exe"),
        home.join("AppData/Local/agy/bin/agy.exe"),
        home.join("AppData/Roaming/npm/agy.cmd"),
        home.join("AppData/Roaming/npm/agy.exe"),
        home.join("AppData/Local/pnpm/agy.cmd"),
        home.join("AppData/Local/pnpm/agy.exe"),
        home.join("scoop/shims/agy.cmd"),
        home.join("scoop/shims/agy.exe"),
        PathBuf::from("/usr/local/bin/agy"),
        PathBuf::from("/opt/homebrew/bin/agy"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/agy"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = antigravity_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/agy"),
            home.join("AppData/Local/agy/bin/agy.exe"),
            PathBuf::from("/opt/homebrew/bin/agy"),
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
        let candidates = antigravity_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/agy.cmd"),
            home.join("AppData/Roaming/npm/agy.cmd"),
            home.join("AppData/Roaming/npm/agy.exe"),
            home.join("AppData/Local/pnpm/agy.cmd"),
            home.join("AppData/Local/pnpm/agy.exe"),
            home.join("scoop/shims/agy.cmd"),
            home.join("scoop/shims/agy.exe"),
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
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-agy");
        let agy = dir.path().join("agy");
        std::fs::write(&agy, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), agy.display());

        assert_eq!(first_existing_path(&stdout), Some(agy));
    }

    #[test]
    fn windows_path_lookup_prefers_cmd_shim_over_extensionless_script() {
        let dir = tempfile::tempdir().unwrap();
        let shell_script = dir.path().join("agy");
        let cmd_shim = dir.path().join("agy.cmd");
        std::fs::write(&shell_script, "#!/bin/sh\n").unwrap();
        std::fs::write(&cmd_shim, "@ECHO off\n").unwrap();

        let stdout = format!("{}\n{}\n", shell_script.display(), cmd_shim.display());

        assert_eq!(
            first_existing_path_for_platform(&stdout, true),
            Some(cmd_shim)
        );
    }
}
