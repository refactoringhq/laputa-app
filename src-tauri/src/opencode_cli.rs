use crate::ai_agents::{AiAgentAvailability, AiAgentPermissionMode, AiAgentStreamEvent};
use std::io::BufRead;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct AgentStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
    pub permission_mode: AiAgentPermissionMode,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::opencode_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::opencode_discovery::find_binary()?;
    run_agent_stream_with_binary(&binary, request, emit)
}

fn run_agent_stream_with_binary<F>(
    binary: &Path,
    request: AgentStreamRequest,
    mut emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let mut command = crate::opencode_config::build_command(binary, &request)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn executable_script(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("opencode");
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
    fn run_agent_stream_maps_opencode_json_events() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"session","sessionID":"open_1"}'
printf '%s\n' '{"type":"message","text":"Done"}'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "open_1");
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id == "open_1"
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::TextDelta { text } if text == "Done"
        ));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_opencode_nonzero_exit_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"session","sessionID":"open_1"}'
printf '%s\n' 'provider login required' >&2
exit 3
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "open_1");
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("provider configured")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
