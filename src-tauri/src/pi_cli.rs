use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
pub use crate::cli_agent_runtime::AgentStreamRequest;
use std::cell::Cell;
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
    let saw_agent_output = Cell::new(false);
    let mut emit = emit;
    crate::cli_agent_runtime::run_ai_agent_json_stream_with_success_check(
        crate::cli_agent_runtime::JsonLineProcess::new(command, "pi"),
        |event| {
            if matches!(&event, AiAgentStreamEvent::TextDelta { text } if !text.is_empty()) {
                saw_agent_output.set(true);
            }
            emit(event);
        },
        crate::pi_events::session_id,
        crate::pi_events::dispatch_event,
        crate::pi_events::format_error,
        |run| {
            (run.parsed_json_lines == 0 || !saw_agent_output.get()).then(|| {
                crate::pi_events::format_empty_success(&format!(
                    "{}\n{}\n{}",
                    run.diagnostic_output(),
                    run.ignored_stdout_output,
                    run.stderr_output
                ))
            })
        },
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
            model: None,
            system_prompt: None,
            vault_path,
            vault_paths: Vec::new(),
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
printf '%s\n' 'added 42 packages, and audited 44 packages in 2s' >&2
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
        assert!(!events
            .iter()
            .any(|event| matches!(event, AiAgentStreamEvent::Error { .. })));
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

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_success_without_pi_events() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"session","id":"pi_1"}'
printf '%s\n' 'npm warn exec installing pi-mcp-adapter' >&2
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
            AiAgentStreamEvent::Error { message }
                if message.contains(r#""key":"ai.error.pi.emptyOutput""#)
                    && !message.contains("emptyOutputWithDiagnostic")
                    && !message.contains("npm warn exec")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_pi_failure_after_install_noise() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'npm warn deprecated node-domexception@1.0.0' >&2
printf '%s\n' 'added 42 packages, and audited 44 packages in 2s' >&2
printf '%s\n' 'found 0 vulnerabilities' >&2
printf '%s\n' 'Failed to load extension: incompatible runtime' >&2
exit 1
"#,
        );

        let mut events = Vec::new();
        run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message }
                if message == "Failed to load extension: incompatible runtime"
        )));
        assert!(!events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("added 42 packages")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
