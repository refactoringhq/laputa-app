use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    crate::cli_agent_runtime::check_cli_availability(find_binary)
}

pub(crate) fn find_binary() -> Result<PathBuf, String> {
    crate::cli_agent_runtime::find_cli_binary(
        "hermes",
        hermes_binary_candidates(),
        "Hermes Agent",
        "https://hermes-agent.nousresearch.com/docs",
    )
}

fn hermes_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| hermes_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn hermes_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/hermes"),
        home.join(".hermes/hermes-agent/venv/bin/hermes"),
        home.join(".local/share/mise/shims/hermes"),
        home.join(".asdf/shims/hermes"),
        home.join(".npm-global/bin/hermes"),
        home.join(".npm/bin/hermes"),
        home.join(".bun/bin/hermes"),
        PathBuf::from("/usr/local/bin/hermes"),
        PathBuf::from("/opt/homebrew/bin/hermes"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = hermes_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/hermes"),
            home.join(".hermes/hermes-agent/venv/bin/hermes"),
            home.join(".local/share/mise/shims/hermes"),
            PathBuf::from("/opt/homebrew/bin/hermes"),
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
