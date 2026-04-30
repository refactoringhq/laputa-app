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
        gemini_binary_candidates(),
        "Gemini CLI",
    )? {
        return Ok(binary);
    }

    Err("Gemini CLI not found. Install it: https://google-gemini.github.io/gemini-cli/".into())
}

fn find_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(path_lookup_command())
        .arg("gemini")
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
        .find_map(|shell| command_path_from_shell(&shell, "gemini"))
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

fn gemini_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| gemini_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn gemini_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join(".local/bin/gemini"),
        home.join(".local/bin/gemini.exe"),
        home.join(".gemini/bin/gemini"),
        home.join(".gemini/bin/gemini.exe"),
        home.join(".local/share/mise/shims/gemini"),
        home.join(".local/share/mise/shims/gemini.exe"),
        home.join(".asdf/shims/gemini"),
        home.join(".asdf/shims/gemini.exe"),
        home.join(".npm-global/bin/gemini"),
        home.join(".npm-global/bin/gemini.cmd"),
        home.join(".npm-global/bin/gemini.exe"),
        home.join(".npm/bin/gemini"),
        home.join(".npm/bin/gemini.cmd"),
        home.join(".npm/bin/gemini.exe"),
        home.join(".bun/bin/gemini"),
        home.join(".bun/bin/gemini.exe"),
        home.join(".linuxbrew/bin/gemini"),
        home.join("AppData/Roaming/npm/gemini.cmd"),
        home.join("AppData/Roaming/npm/gemini.exe"),
        home.join("AppData/Local/pnpm/gemini.cmd"),
        home.join("AppData/Local/pnpm/gemini.exe"),
        home.join("scoop/shims/gemini.exe"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/gemini"),
        PathBuf::from("/usr/local/bin/gemini"),
        PathBuf::from("/opt/homebrew/bin/gemini"),
    ];
    candidates.extend(nvm_binary_candidates_for_home(home));
    candidates
}

fn nvm_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) else {
        return Vec::new();
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| path.join("bin").join("gemini"))
        .collect::<Vec<_>>();
    candidates.sort();
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = gemini_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/gemini"),
            home.join(".gemini/bin/gemini"),
            home.join(".local/share/mise/shims/gemini"),
            home.join(".asdf/shims/gemini"),
            home.join(".npm-global/bin/gemini"),
            home.join(".bun/bin/gemini"),
            PathBuf::from("/opt/homebrew/bin/gemini"),
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
    fn binary_candidates_include_linuxbrew_installs() {
        let home = PathBuf::from("/home/alex");
        let candidates = gemini_binary_candidates_for_home(&home);
        let expected = [
            home.join(".linuxbrew/bin/gemini"),
            PathBuf::from("/home/linuxbrew/.linuxbrew/bin/gemini"),
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
        let missing = dir.path().join("missing-gemini");
        let gemini = dir.path().join("gemini");
        std::fs::write(&gemini, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), gemini.display());

        assert_eq!(first_existing_path(&stdout), Some(gemini));
    }
}
