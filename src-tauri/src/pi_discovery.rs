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

    if let Some(binary) = find_existing_binary(pi_binary_candidates()) {
        return Ok(binary);
    }

    Err("Pi CLI not found. Install it: https://pi.dev".into())
}

fn find_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(path_lookup_command())
        .arg("pi")
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
        .find_map(|shell| command_path_from_shell(&shell, "pi"))
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

fn pi_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = pi_binary_candidates_from_env();

    if let Some(home) = dirs::home_dir() {
        candidates.extend(pi_binary_candidates_for_home(&home));
    }

    candidates.extend(pi_global_binary_candidates());
    candidates
}

fn pi_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let mut candidates = pi_nvm_binary_candidates_for_home(home);
    candidates.extend([
        home.join(".local/bin/pi"),
        home.join(".local/bin/pi.exe"),
        home.join(".pi/bin/pi"),
        home.join(".pi/bin/pi.exe"),
        home.join(".local/share/mise/shims/pi"),
        home.join(".local/share/mise/shims/pi.exe"),
        home.join(".asdf/shims/pi"),
        home.join(".asdf/shims/pi.exe"),
        home.join(".npm-global/bin/pi"),
        home.join(".npm-global/bin/pi.cmd"),
        home.join(".npm-global/bin/pi.exe"),
        home.join(".npm/bin/pi"),
        home.join(".npm/bin/pi.cmd"),
        home.join(".npm/bin/pi.exe"),
        home.join(".bun/bin/pi"),
        home.join(".bun/bin/pi.exe"),
        home.join("AppData/Roaming/npm/pi.cmd"),
        home.join("AppData/Roaming/npm/pi.exe"),
        home.join("AppData/Local/pnpm/pi.cmd"),
        home.join("AppData/Local/pnpm/pi.exe"),
        home.join("scoop/shims/pi.exe"),
    ]);
    candidates
}

fn pi_global_binary_candidates() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/usr/local/bin/pi"),
        PathBuf::from("/opt/homebrew/bin/pi"),
    ]
}

fn pi_binary_candidates_from_env() -> Vec<PathBuf> {
    let nvm_bin = std::env::var_os("NVM_BIN").map(PathBuf::from);
    let npm_config_prefix = std::env::var_os("npm_config_prefix").map(PathBuf::from);
    let npm_config_prefix_upper = std::env::var_os("NPM_CONFIG_PREFIX").map(PathBuf::from);

    pi_binary_candidates_from_prefixes(nvm_bin, npm_config_prefix, npm_config_prefix_upper)
}

fn pi_binary_candidates_from_prefixes(
    nvm_bin: Option<PathBuf>,
    npm_config_prefix: Option<PathBuf>,
    npm_config_prefix_upper: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = nvm_bin.filter(|path| !path.as_os_str().is_empty()) {
        candidates.push(path.join("pi"));
    }
    if let Some(path) = npm_config_prefix.filter(|path| !path.as_os_str().is_empty()) {
        candidates.push(path.join("bin/pi"));
    }
    if let Some(path) = npm_config_prefix_upper.filter(|path| !path.as_os_str().is_empty()) {
        candidates.push(path.join("bin/pi"));
    }

    candidates
}

fn pi_nvm_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let versions_dir = home.join(".nvm/versions/node");
    let mut version_dirs = match std::fs::read_dir(versions_dir) {
        Ok(entries) => entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>(),
        Err(_) => return Vec::new(),
    };

    version_dirs.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    version_dirs
        .into_iter()
        .map(|version_dir| version_dir.join("bin/pi"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_local_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = pi_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/pi"),
            home.join(".pi/bin/pi"),
            home.join(".local/share/mise/shims/pi"),
            home.join(".asdf/shims/pi"),
            home.join(".npm-global/bin/pi"),
            home.join(".bun/bin/pi"),
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
        let candidates = pi_binary_candidates_for_home(&home);
        let expected = [
            home.join(".npm-global/bin/pi.cmd"),
            home.join(".npm-global/bin/pi.exe"),
            home.join(".npm/bin/pi.cmd"),
            home.join(".npm/bin/pi.exe"),
            home.join("AppData/Roaming/npm/pi.cmd"),
            home.join("AppData/Roaming/npm/pi.exe"),
            home.join("AppData/Local/pnpm/pi.cmd"),
            home.join("AppData/Local/pnpm/pi.exe"),
            home.join("scoop/shims/pi.exe"),
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
    fn binary_candidates_include_nvm_node_version_installs() {
        let home = tempfile::tempdir().unwrap();
        let pi = home.path().join(".nvm/versions/node/v22.20.0/bin/pi");

        std::fs::create_dir_all(pi.parent().unwrap()).unwrap();
        std::fs::write(&pi, "#!/bin/sh\n").unwrap();

        let candidates = pi_binary_candidates_for_home(home.path());

        assert!(
            candidates.contains(&pi),
            "missing nvm candidate {}",
            pi.display()
        );
    }

    #[test]
    fn binary_candidates_include_static_global_fallbacks() {
        let candidates = pi_global_binary_candidates();

        assert!(candidates.contains(&PathBuf::from("/usr/local/bin/pi")));
        assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin/pi")));
    }

    #[test]
    fn binary_candidates_include_env_provided_npm_and_nvm_prefixes() {
        let nvm_bin = PathBuf::from("/Users/alex/.nvm/versions/node/v22.20.0/bin");
        let npm_config_prefix = PathBuf::from("/Users/alex/.npm-global");
        let npm_config_prefix_upper = PathBuf::from("/Users/alex/.npm");

        let candidates = pi_binary_candidates_from_prefixes(
            Some(nvm_bin.clone()),
            Some(npm_config_prefix.clone()),
            Some(npm_config_prefix_upper.clone()),
        );

        assert_eq!(
            candidates,
            vec![
                nvm_bin.join("pi"),
                npm_config_prefix.join("bin/pi"),
                npm_config_prefix_upper.join("bin/pi"),
            ]
        );
    }

    #[test]
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-pi");
        let pi = dir.path().join("pi");
        std::fs::write(&pi, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), pi.display());

        assert_eq!(first_existing_path(&stdout), Some(pi));
    }
}
