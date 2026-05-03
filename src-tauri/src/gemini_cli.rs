use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
pub use crate::cli_agent_runtime::AgentStreamRequest;
use std::path::Path;

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
    emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let settings_dir = tempfile::Builder::new()
        .prefix("tolaria-gemini-agent-")
        .tempdir()
        .map_err(|error| format!("Failed to create Gemini settings directory: {error}"))?;
    let command = crate::gemini_config::build_command(binary, &request, settings_dir.path())?;
    crate::cli_agent_runtime::run_ai_agent_json_stream(
        command,
        "gemini",
        emit,
        gemini_session_id,
        dispatch_gemini_event,
        format_gemini_error,
    )
}

fn gemini_session_id(json: &serde_json::Value) -> Option<&str> {
    json["session_id"].as_str()
}

fn dispatch_gemini_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    match json["type"].as_str().unwrap_or_default() {
        "init" => emit_gemini_init(json, emit),
        "message" => emit_gemini_message(json, emit),
        "tool_use" => emit_gemini_tool_start(json, emit),
        "tool_result" => emit_gemini_tool_done(json, emit),
        "error" => emit_gemini_error(json, emit),
        "result" => emit_gemini_result(json, emit),
        _ => {}
    }
}

fn emit_gemini_init<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(session_id) = json["session_id"].as_str() {
        emit(AiAgentStreamEvent::Init {
            session_id: session_id.to_string(),
        });
    }
}

fn emit_gemini_message<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if json["role"].as_str() != Some("assistant") {
        return;
    }

    if let Some(content) = json["content"]
        .as_str()
        .filter(|content| !content.is_empty())
    {
        emit(AiAgentStreamEvent::TextDelta {
            text: content.to_string(),
        });
    }
}

fn emit_gemini_tool_start<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let tool_name = json["tool_name"].as_str().unwrap_or("Gemini tool");
    let tool_id = json["tool_id"].as_str().unwrap_or(tool_name);
    let input = (!json["parameters"].is_null()).then(|| json["parameters"].to_string());

    emit(AiAgentStreamEvent::ToolStart {
        tool_name: tool_name.to_string(),
        tool_id: tool_id.to_string(),
        input,
    });
}

fn emit_gemini_tool_done<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let tool_id = json["tool_id"].as_str().unwrap_or("gemini-tool");
    let output = json["output"]
        .as_str()
        .or_else(|| json["error"]["message"].as_str())
        .map(str::to_string);

    emit(AiAgentStreamEvent::ToolDone {
        tool_id: tool_id.to_string(),
        output,
    });
}

fn emit_gemini_error<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(message) = json["message"].as_str() {
        emit(AiAgentStreamEvent::Error {
            message: message.to_string(),
        });
    }
}

fn emit_gemini_result<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if json["status"].as_str() != Some("error") {
        return;
    }

    if let Some(message) = json["error"]["message"].as_str() {
        emit(AiAgentStreamEvent::Error {
            message: message.to_string(),
        });
    }
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
    fn run_agent_stream_maps_gemini_stream_json_response() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"init","session_id":"gemini_1","model":"gemini-2.5-pro"}'
printf '%s\n' '{"type":"message","role":"assistant","content":"Done","delta":true}'
printf '%s\n' '{"type":"result","status":"success","stats":{"tool_calls":0}}'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "gemini_1");
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id == "gemini_1"
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::TextDelta { text } if text == "Done"
        ));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_maps_gemini_tool_events_before_final_text() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' '{"type":"init","session_id":"gemini_2","model":"gemini-2.5-pro"}'
printf '%s\n' '{"type":"tool_use","tool_name":"tolaria__search_notes","tool_id":"tool_1","parameters":{"query":"meeting"}}'
printf '%s\n' '{"type":"tool_result","tool_id":"tool_1","status":"success","output":"2 notes"}'
printf '%s\n' '{"type":"message","role":"assistant","content":"I found 2 notes.","delta":true}'
printf '%s\n' '{"type":"result","status":"success","stats":{"tool_calls":1}}'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(session_id, "gemini_2");
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::ToolStart { tool_name, tool_id, input }
                if tool_name == "tolaria__search_notes"
                    && tool_id == "tool_1"
                    && input.as_deref() == Some(r#"{"query":"meeting"}"#)
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::ToolDone { tool_id, output }
                if tool_id == "tool_1" && output.as_deref() == Some("2 notes")
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "I found 2 notes."
        )));
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

        assert!(session_id.is_empty());
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("not authenticated")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
