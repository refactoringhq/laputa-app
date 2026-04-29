use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
pub use crate::cli_agent_runtime::AgentStreamRequest;
use std::path::Path;
use std::process::Output;

pub fn check_cli() -> AiAgentAvailability {
    crate::gemini_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::gemini_discovery::find_binary()?;
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
    let settings_dir = tempfile::Builder::new()
        .prefix("tolaria-gemini-agent-")
        .tempdir()
        .map_err(|error| format!("Failed to create Gemini settings directory: {error}"))?;
    let mut command = crate::gemini_config::build_command(binary, &request, settings_dir.path())?;
    let output = command
        .output()
        .map_err(|error| format!("Failed to spawn gemini: {error}"))?;

    emit(AiAgentStreamEvent::Init {
        session_id: "gemini-headless".into(),
    });

    if output.status.success() {
        emit_gemini_success(&output, &mut emit);
    } else {
        emit(AiAgentStreamEvent::Error {
            message: format_gemini_error(output_stderr(&output), output.status.to_string()),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok("gemini-headless".into())
}

fn emit_gemini_success<F>(output: &Output, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    match gemini_response_text(&output_stdout(output)) {
        GeminiOutput::Response(text) => emit(AiAgentStreamEvent::TextDelta { text }),
        GeminiOutput::Error(message) => emit(AiAgentStreamEvent::Error { message }),
        GeminiOutput::Empty => {}
    }
}

enum GeminiOutput {
    Response(String),
    Error(String),
    Empty,
}

fn gemini_response_text(stdout: &str) -> GeminiOutput {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return GeminiOutput::Empty;
    }

    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(json) => response_from_json(&json),
        Err(_) => GeminiOutput::Response(trimmed.to_string()),
    }
}

fn response_from_json(json: &serde_json::Value) -> GeminiOutput {
    if let Some(message) = json["error"]["message"].as_str() {
        return GeminiOutput::Error(message.to_string());
    }
    if let Some(response) = json["response"].as_str() {
        return GeminiOutput::Response(response.to_string());
    }
    GeminiOutput::Empty
}

fn output_stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn output_stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn format_gemini_error(stderr_output: String, status: String) -> String {
    let lower = stderr_output.to_ascii_lowercase();
    if is_auth_error(&lower) {
        return "Gemini CLI is not authenticated. Run `gemini` in your terminal to sign in, or set GEMINI_API_KEY and retry.".into();
    }

    if stderr_output.trim().is_empty() {
        format!("gemini exited with status {status}")
    } else {
        stderr_output.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_auth_error(lower: &str) -> bool {
    [
        "auth",
        "login",
        "sign in",
        "api key",
        "gemini_api_key",
        "google_api_key",
        "oauth",
        "401",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_agents::AiAgentPermissionMode;

    #[cfg(unix)]
    fn executable_script(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("gemini");
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
    fn run_agent_stream_maps_gemini_json_response() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"response":"Done","stats":{"tools":{"totalCalls":0}}}'"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "gemini-headless");
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id == "gemini-headless"
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::TextDelta { text } if text == "Done"
        ));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_gemini_auth_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'oauth login required' >&2
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

        assert_eq!(session_id, "gemini-headless");
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("not authenticated")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[test]
    fn gemini_response_text_reads_json_response_or_plain_text() {
        match gemini_response_text(r#"{"response":"Structured"}"#) {
            GeminiOutput::Response(text) => assert_eq!(text, "Structured"),
            _ => panic!("expected response"),
        }

        match gemini_response_text("Plain answer") {
            GeminiOutput::Response(text) => assert_eq!(text, "Plain answer"),
            _ => panic!("expected response"),
        }
    }
}
