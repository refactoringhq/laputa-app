use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use std::io::BufRead;

#[derive(Debug, Clone)]
pub struct AgentStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::opencode_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::opencode_discovery::find_binary()?;
    let mut command = crate::opencode_config::build_command(&binary, &request)?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn opencode: {error}"))?;

    let stdout = child.stdout.take().ok_or("No stdout handle")?;
    let reader = std::io::BufReader::new(stdout);
    let mut session_id = String::new();

    for line in reader.lines() {
        let json = match crate::opencode_events::parse_line(line, &mut emit) {
            Some(json) => json,
            None => continue,
        };

        if let Some(id) = crate::opencode_events::session_id(&json) {
            session_id = id.to_string();
        }

        crate::opencode_events::dispatch_event(&json, &mut emit);
    }

    let stderr_output = child
        .stderr
        .take()
        .and_then(|stderr| std::io::read_to_string(stderr).ok())
        .unwrap_or_default();
    let status = child
        .wait()
        .map_err(|error| format!("Wait failed: {error}"))?;
    if !status.success() {
        emit(AiAgentStreamEvent::Error {
            message: crate::opencode_events::format_error(stderr_output, status.to_string()),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(session_id)
}
