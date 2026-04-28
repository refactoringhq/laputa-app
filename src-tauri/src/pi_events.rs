use crate::ai_agents::AiAgentStreamEvent;

pub(crate) fn parse_line<F>(
    line: Result<String, std::io::Error>,
    emit: &mut F,
) -> Option<serde_json::Value>
where
    F: FnMut(AiAgentStreamEvent),
{
    let line = match line {
        Ok(line) => line,
        Err(error) => {
            emit(AiAgentStreamEvent::Error {
                message: format!("Read error: {error}"),
            });
            return None;
        }
    };

    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    serde_json::from_str::<serde_json::Value>(trimmed).ok()
}

pub(crate) fn dispatch_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if json["type"].as_str() == Some("session") {
        emit_session_event(json, emit);
    }

    match json["type"].as_str().unwrap_or_default() {
        "message_update" => emit_message_update(json, emit),
        "tool_execution_start" => emit_tool_start(json, emit),
        "tool_execution_end" => emit_tool_done(json, emit),
        "error" => emit_error_event(json, emit),
        _ => {}
    }
}

pub(crate) fn session_id(json: &serde_json::Value) -> Option<&str> {
    json["id"]
        .as_str()
        .or_else(|| json["session_id"].as_str())
        .or_else(|| json["session"]["id"].as_str())
}

pub(crate) fn format_error(stderr_output: String, status: String) -> String {
    let lower = stderr_output.to_ascii_lowercase();
    if is_auth_error(&lower) {
        return "Pi CLI is not authenticated. Run `pi /login` in your terminal or configure a provider API key, then retry.".into();
    }

    if stderr_output.trim().is_empty() {
        format!("pi exited with status {status}")
    } else {
        stderr_output.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn emit_session_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(session_id) = session_id(json) {
        emit(AiAgentStreamEvent::Init {
            session_id: session_id.to_string(),
        });
    }
}

fn emit_message_update<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let event = &json["assistantMessageEvent"];
    match event["type"].as_str().unwrap_or_default() {
        "text_delta" => emit_delta(event, emit, |text| AiAgentStreamEvent::TextDelta { text }),
        "thinking_delta" => emit_delta(event, emit, |text| AiAgentStreamEvent::ThinkingDelta {
            text,
        }),
        _ => {}
    }
}

fn emit_delta<F>(
    json: &serde_json::Value,
    emit: &mut F,
    build: impl FnOnce(String) -> AiAgentStreamEvent,
) where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(delta) = json["delta"].as_str() {
        emit(build(delta.to_string()));
    }
}

fn emit_tool_start<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    emit(AiAgentStreamEvent::ToolStart {
        tool_name: tool_name(json),
        tool_id: tool_id(json),
        input: json.get("args").map(|args| args.to_string()),
    });
}

fn emit_tool_done<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    emit(AiAgentStreamEvent::ToolDone {
        tool_id: tool_id(json),
        output: json.get("result").map(|result| result.to_string()),
    });
}

fn emit_error_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(message) = message_value(json) {
        emit(AiAgentStreamEvent::Error {
            message: message.to_string(),
        });
    }
}

fn tool_name(json: &serde_json::Value) -> String {
    json["toolName"].as_str().unwrap_or("tool").to_string()
}

fn tool_id(json: &serde_json::Value) -> String {
    json["toolCallId"].as_str().unwrap_or("tool").to_string()
}

fn message_value(json: &serde_json::Value) -> Option<&str> {
    json["message"]
        .as_str()
        .or_else(|| json["error"].as_str())
        .or_else(|| json["text"].as_str())
}

fn is_auth_error(lower: &str) -> bool {
    [
        "auth", "login", "sign in", "api key", "api.key", "provider", "401",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
#[path = "pi_events_tests.rs"]
mod tests;
