use crate::ai_agents::{AiAgentPermissionMode, AiAgentStreamEvent};
use serde::Deserialize;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, ExitStatus};

#[derive(Debug, Clone, Deserialize)]
pub struct AgentStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
    pub permission_mode: AiAgentPermissionMode,
}

pub(crate) struct JsonLineRun {
    pub session_id: String,
    pub stderr_output: String,
    pub status: ExitStatus,
}

pub(crate) fn build_prompt(message: &str, system_prompt: Option<&str>) -> String {
    match system_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        Some(system_prompt) => {
            format!("System instructions:\n{system_prompt}\n\nUser request:\n{message}")
        }
        None => message.to_string(),
    }
}

pub(crate) fn mcp_server_path_string() -> Result<String, String> {
    Ok(crate::mcp::mcp_server_dir()?
        .join("index.js")
        .to_str()
        .ok_or("Invalid MCP server path")?
        .to_string())
}

pub(crate) fn version_for_binary(binary: &PathBuf) -> Option<String> {
    crate::hidden_command(binary)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn parse_json_line(
    line: Result<String, std::io::Error>,
) -> Result<Option<serde_json::Value>, String> {
    let line = line.map_err(|error| format!("Read error: {error}"))?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(serde_json::from_str::<serde_json::Value>(trimmed).ok())
}

#[cfg(test)]
pub(crate) fn parse_ai_agent_json_line<F>(
    line: Result<String, std::io::Error>,
    emit: &mut F,
) -> Option<serde_json::Value>
where
    F: FnMut(AiAgentStreamEvent),
{
    match parse_json_line(line) {
        Ok(json) => json,
        Err(message) => {
            emit(AiAgentStreamEvent::Error { message });
            None
        }
    }
}

pub(crate) fn run_json_line_process<Event, F, H>(
    mut command: Command,
    process_name: &'static str,
    emit: &mut F,
    error_event: impl Fn(String) -> Event,
    mut handle_json: H,
) -> Result<JsonLineRun, String>
where
    F: FnMut(Event),
    H: FnMut(&serde_json::Value, &mut F, &mut String),
{
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn {process_name}: {error}"))?;
    let stdout = child.stdout.take().ok_or("No stdout handle")?;
    let reader = std::io::BufReader::new(stdout);
    let mut session_id = String::new();

    for line in reader.lines() {
        match parse_json_line(line) {
            Ok(Some(json)) => handle_json(&json, emit, &mut session_id),
            Ok(None) => {}
            Err(message) => {
                emit(error_event(message));
                break;
            }
        }
    }

    let stderr_output = child
        .stderr
        .take()
        .and_then(|stderr| std::io::read_to_string(stderr).ok())
        .unwrap_or_default();
    let status = child
        .wait()
        .map_err(|error| format!("Wait failed: {error}"))?;

    Ok(JsonLineRun {
        session_id,
        stderr_output,
        status,
    })
}

pub(crate) fn run_ai_agent_json_stream<F>(
    command: Command,
    process_name: &'static str,
    mut emit: F,
    session_id: impl Fn(&serde_json::Value) -> Option<&str>,
    dispatch_event: impl Fn(&serde_json::Value, &mut F),
    format_error: impl Fn(String, String) -> String,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let run = run_json_line_process(
        command,
        process_name,
        &mut emit,
        |message| AiAgentStreamEvent::Error { message },
        |json, emit, active_session_id| {
            if let Some(id) = session_id(json) {
                *active_session_id = id.to_string();
            }
            dispatch_event(json, emit);
        },
    )?;

    if !run.status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_error(run.stderr_output, run.status.to_string()),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(run.session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_keeps_system_prompt_first() {
        let prompt = build_prompt("Rename the note", Some("Be concise"));

        assert!(prompt.starts_with("System instructions:\nBe concise"));
        assert!(prompt.contains("User request:\nRename the note"));
    }

    #[test]
    fn build_prompt_skips_blank_system_prompt() {
        assert_eq!(
            build_prompt("Rename the note", Some("  ")),
            "Rename the note"
        );
    }

    #[test]
    fn parse_json_line_reports_read_errors_and_skips_blank_or_invalid_lines() {
        assert!(parse_json_line(Ok("   ".into())).unwrap().is_none());
        assert!(parse_json_line(Ok("not json".into())).unwrap().is_none());

        let error = parse_json_line(Err(std::io::Error::other("broken pipe"))).unwrap_err();
        assert!(error.contains("broken pipe"));
    }
}
