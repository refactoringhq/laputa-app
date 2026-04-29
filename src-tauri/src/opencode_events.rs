use crate::ai_agents::AiAgentStreamEvent;

#[cfg(test)]
pub(crate) fn parse_line<F>(
    line: Result<String, std::io::Error>,
    emit: &mut F,
) -> Option<serde_json::Value>
where
    F: FnMut(AiAgentStreamEvent),
{
    crate::cli_agent_runtime::parse_ai_agent_json_line(line, emit)
}

pub(crate) fn dispatch_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if json["type"].as_str() == Some("session") {
        emit_session_event(json, emit);
    }

    match json["type"].as_str().unwrap_or_default() {
        "message" | "text" => emit_text(json, emit),
        "reasoning" => emit_reasoning(json, emit),
        "tool_use" | "tool" => emit_tool_start(json, emit),
        "tool_result" | "tool_done" => emit_tool_done(json, emit),
        "error" => emit_error_event(json, emit),
        _ => {}
    }
}

pub(crate) fn session_id(json: &serde_json::Value) -> Option<&str> {
    json["sessionID"]
        .as_str()
        .or_else(|| json["session_id"].as_str())
        .or_else(|| json["session"]["id"].as_str())
}

pub(crate) fn format_error(stderr_output: String, status: String) -> String {
    let lower = stderr_output.to_ascii_lowercase();
    if is_auth_error(&lower) {
        return "OpenCode CLI is not authenticated or has no provider configured. Run `opencode auth login` or configure a provider in OpenCode, then retry.".into();
    }

    if stderr_output.trim().is_empty() {
        format!("opencode exited with status {status}")
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

fn emit_text<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(text) = text_value(json) {
        emit(AiAgentStreamEvent::TextDelta {
            text: text.to_string(),
        });
    }
}

fn emit_reasoning<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    if let Some(text) = text_value(json) {
        emit(AiAgentStreamEvent::ThinkingDelta {
            text: text.to_string(),
        });
    }
}

fn emit_tool_start<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let tool_id = tool_id(json).unwrap_or("tool").to_string();
    let tool_name = tool_name(json).unwrap_or("tool").to_string();
    let input = tool_input(json);

    emit(AiAgentStreamEvent::ToolStart {
        tool_name,
        tool_id,
        input,
    });
}

fn emit_tool_done<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let tool_id = tool_id(json).unwrap_or("tool").to_string();
    let output = tool_output(json);

    emit(AiAgentStreamEvent::ToolDone { tool_id, output });
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

fn tool_id(json: &serde_json::Value) -> Option<&str> {
    first_string_field(
        json,
        &["id", "toolID", "tool_id", "toolCallID", "toolCallId"],
    )
}

fn text_value(json: &serde_json::Value) -> Option<&str> {
    first_string_field(json, &["text", "content", "message"])
}

fn message_value(json: &serde_json::Value) -> Option<&str> {
    first_string_field(json, &["message", "error", "text"])
}

fn tool_name(json: &serde_json::Value) -> Option<&str> {
    first_string_field(json, &["name", "tool", "toolName"])
}

fn tool_input(json: &serde_json::Value) -> Option<String> {
    first_json_field(json, &["input", "args"]).map(|input| input.to_string())
}

fn tool_output(json: &serde_json::Value) -> Option<String> {
    first_json_field(json, &["output", "result"]).map(display_json_value)
}

fn first_string_field<'a>(json: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| json[*key].as_str().or_else(|| json["part"][*key].as_str()))
}

fn first_json_field<'a>(
    json: &'a serde_json::Value,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    keys.iter()
        .find_map(|key| json.get(*key).or_else(|| json["part"].get(*key)))
}

fn display_json_value(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(|output| output.to_string())
        .unwrap_or_else(|| value.to_string())
}

fn is_auth_error(lower: &str) -> bool {
    ["auth", "login", "sign in", "api key", "provider"]
        .iter()
        .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
#[path = "opencode_events_tests.rs"]
mod tests;
