use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
pub use crate::cli_agent_runtime::AgentStreamRequest;
use std::path::Path;

pub fn check_cli() -> AiAgentAvailability {
    crate::pi_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::pi_discovery::find_binary()?;
    run_agent_stream_with_binary(&binary, request, emit)
}

fn run_agent_stream_with_binary<F>(
    binary: &Path,
    request: AgentStreamRequest,
    emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let agent_dir = tempfile::Builder::new()
        .prefix("tolaria-pi-agent-")
        .tempdir()
        .map_err(|error| format!("Failed to create Pi config directory: {error}"))?;
    let command = crate::pi_config::build_command(binary, &request, agent_dir.path())?;
    crate::cli_agent_runtime::run_ai_agent_json_stream(
        command,
        "pi",
        emit,
        crate::pi_events::session_id,
        crate::pi_events::dispatch_event,
        crate::pi_events::format_error,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_agents::AiAgentPermissionMode;

    #[cfg(unix)]
    fn executable_script(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("pi");
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn request(vault_path: String) -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Summarize".into(),
            system_prompt: None,
            vault_path,
            permission_mode: AiAgentPermissionMode::Safe,
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_maps_pi_json_events() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"session","id":"pi_1"}'
printf '%s\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Done"}}'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "pi_1");
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id == "pi_1"
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::TextDelta { text } if text == "Done"
        ));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_pi_nonzero_exit_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"session","id":"pi_1"}'
printf '%s\n' 'api key login required' >&2
exit 4
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "pi_1");
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("not authenticated")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
