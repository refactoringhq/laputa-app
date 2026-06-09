use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    crate::cli_agent_runtime::check_cli_availability(find_binary)
}

pub(crate) fn find_binary() -> Result<PathBuf, String> {
    crate::cli_agent_runtime::find_cli_binary(
        "kiro-cli",
        kiro_binary_candidates(),
        "Kiro CLI",
        "https://kiro.dev/docs/cli",
    )
}

fn kiro_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| kiro_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn kiro_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/kiro-cli"),
        home.join(".local/bin/kiro-cli.exe"),
        home.join(".kiro/bin/kiro-cli"),
        home.join(".kiro/bin/kiro-cli.exe"),
        home.join(".local/share/mise/shims/kiro-cli"),
        home.join(".local/share/mise/shims/kiro-cli.exe"),
        home.join(".asdf/shims/kiro-cli"),
        home.join(".asdf/shims/kiro-cli.exe"),
        home.join(".volta/bin/kiro-cli"),
        home.join(".volta/bin/kiro-cli.cmd"),
        home.join(".volta/bin/kiro-cli.exe"),
        home.join(".npm-global/bin/kiro-cli"),
        home.join(".npm-global/bin/kiro-cli.cmd"),
        home.join(".npm-global/bin/kiro-cli.exe"),
        home.join(".npm/bin/kiro-cli"),
        home.join(".npm/bin/kiro-cli.cmd"),
        home.join(".npm/bin/kiro-cli.exe"),
        home.join(".local/share/pnpm/kiro-cli"),
        home.join(".local/share/pnpm/kiro-cli.cmd"),
        home.join(".local/share/pnpm/kiro-cli.exe"),
        home.join("Library/pnpm/kiro-cli"),
        home.join("Library/pnpm/kiro-cli.cmd"),
        home.join("Library/pnpm/kiro-cli.exe"),
        home.join(".bun/bin/kiro-cli"),
        home.join(".bun/bin/kiro-cli.exe"),
        home.join(".linuxbrew/bin/kiro-cli"),
        home.join("AppData/Roaming/npm/kiro-cli.cmd"),
        home.join("AppData/Roaming/npm/kiro-cli.exe"),
        home.join("AppData/Local/pnpm/kiro-cli.cmd"),
        home.join("AppData/Local/pnpm/kiro-cli.exe"),
        home.join("scoop/shims/kiro-cli.exe"),
        PathBuf::from("/usr/local/bin/kiro-cli"),
        PathBuf::from("/opt/homebrew/bin/kiro-cli"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/kiro-cli"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = kiro_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/kiro-cli"),
            home.join(".kiro/bin/kiro-cli"),
            home.join(".npm-global/bin/kiro-cli"),
            PathBuf::from("/opt/homebrew/bin/kiro-cli"),
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
        let candidates = kiro_binary_candidates_for_home(&home);
        let expected = [
            home.join(".npm-global/bin/kiro-cli.cmd"),
            home.join(".npm-global/bin/kiro-cli.exe"),
            home.join(".npm/bin/kiro-cli.cmd"),
            home.join(".npm/bin/kiro-cli.exe"),
            home.join(".local/share/pnpm/kiro-cli.cmd"),
            home.join(".local/share/pnpm/kiro-cli.exe"),
            home.join("Library/pnpm/kiro-cli.cmd"),
            home.join("Library/pnpm/kiro-cli.exe"),
            home.join("AppData/Roaming/npm/kiro-cli.cmd"),
            home.join("AppData/Roaming/npm/kiro-cli.exe"),
            home.join("AppData/Local/pnpm/kiro-cli.cmd"),
            home.join("AppData/Local/pnpm/kiro-cli.exe"),
            home.join("scoop/shims/kiro-cli.exe"),
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
