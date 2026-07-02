use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    crate::cli_agent_runtime::check_cli_availability(find_binary)
}

pub(crate) fn find_binary() -> Result<PathBuf, String> {
    crate::cli_agent_runtime::find_cli_binary(
        "copilot",
        copilot_binary_candidates(),
        "GitHub Copilot CLI",
        "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
    )
}

fn copilot_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| copilot_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn copilot_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join(".local/bin/copilot"),
        home.join(".local/bin/copilot.exe"),
        home.join(".local/bin/copilot.cmd"),
        home.join(".local/share/mise/shims/copilot"),
        home.join(".local/share/mise/shims/copilot.exe"),
        home.join(".local/share/mise/shims/copilot.cmd"),
        home.join(".asdf/shims/copilot"),
        home.join(".asdf/shims/copilot.exe"),
        home.join(".asdf/shims/copilot.cmd"),
        home.join(".npm-global/bin/copilot"),
        home.join(".npm-global/bin/copilot.cmd"),
        home.join(".npm-global/bin/copilot.exe"),
        home.join(".npm/bin/copilot"),
        home.join(".npm/bin/copilot.cmd"),
        home.join(".npm/bin/copilot.exe"),
        home.join(".bun/bin/copilot"),
        home.join(".bun/bin/copilot.exe"),
        home.join(".bun/bin/copilot.cmd"),
        home.join(".linuxbrew/bin/copilot"),
        home.join("AppData/Roaming/npm/copilot.cmd"),
        home.join("AppData/Roaming/npm/copilot.exe"),
        home.join("AppData/Local/pnpm/copilot.cmd"),
        home.join("AppData/Local/pnpm/copilot.exe"),
        home.join("scoop/shims/copilot.cmd"),
        home.join("scoop/shims/copilot.exe"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/copilot"),
        PathBuf::from("/usr/local/bin/copilot"),
        PathBuf::from("/opt/homebrew/bin/copilot"),
    ];
    candidates.extend(nvm_copilot_binary_candidates_for_home(home));
    candidates
}

fn nvm_copilot_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) else {
        return Vec::new();
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| path.join("bin").join("copilot"))
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
        let candidates = copilot_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/copilot"),
            home.join(".npm-global/bin/copilot"),
            home.join(".local/share/mise/shims/copilot"),
            home.join(".asdf/shims/copilot"),
            PathBuf::from("/opt/homebrew/bin/copilot"),
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
    fn binary_candidates_include_windows_node_shims() {
        let home = PathBuf::from("C:/Users/alex");
        let candidates = copilot_binary_candidates_for_home(&home);
        let expected = [
            home.join("AppData/Roaming/npm/copilot.cmd"),
            home.join("AppData/Local/pnpm/copilot.exe"),
            home.join("scoop/shims/copilot.cmd"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }
}
