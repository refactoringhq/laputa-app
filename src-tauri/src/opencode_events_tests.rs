use super::*;

#[test]
fn dispatch_maps_session_reasoning_and_text() {
    let mut events = Vec::new();
    let started = serde_json::json!({ "type": "session", "sessionID": "ses_1" });
    let reasoning = serde_json::json!({ "type": "reasoning", "text": "Checking links" });
    let text = serde_json::json!({ "type": "message", "text": "Done" });

    for event in [started, reasoning, text] {
        dispatch_event(&event, &mut |event| events.push(event));
    }

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::Init { session_id } if session_id == "ses_1"
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ThinkingDelta { text } if text == "Checking links"
    ));
    assert!(matches!(
        &events[2],
        AiAgentStreamEvent::TextDelta { text } if text == "Done"
    ));
}

#[test]
fn dispatch_maps_part_backed_reasoning_and_text() {
    let mut events = Vec::new();
    let reasoning = serde_json::json!({
        "type": "reasoning",
        "part": { "type": "reasoning", "text": "Checking links" }
    });
    let text = serde_json::json!({
        "type": "text",
        "part": { "type": "text", "text": "Done from OpenCode" }
    });

    for event in [reasoning, text] {
        dispatch_event(&event, &mut |event| events.push(event));
    }

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ThinkingDelta { text } if text == "Checking links"
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::TextDelta { text } if text == "Done from OpenCode"
    ));
}

#[test]
fn dispatch_maps_tool_events() {
    let mut events = Vec::new();
    let tool_start = serde_json::json!({
        "type": "tool_use",
        "id": "tool_1",
        "name": "read",
        "input": { "path": "Note.md" }
    });
    let tool_done = serde_json::json!({ "type": "tool_result", "id": "tool_1", "output": "ok" });

    dispatch_event(&tool_start, &mut |event| events.push(event));
    dispatch_event(&tool_done, &mut |event| events.push(event));

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ToolStart { tool_name, tool_id, input }
            if tool_name == "read" && tool_id == "tool_1" && input.as_deref() == Some(r#"{"path":"Note.md"}"#)
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ToolDone { tool_id, output }
            if tool_id == "tool_1" && output.as_deref() == Some("ok")
    ));
}

#[test]
fn dispatch_maps_part_backed_tool_events() {
    let mut events = Vec::new();
    let tool_start = serde_json::json!({
        "type": "tool_use",
        "part": {
            "id": "prt_tool_1",
            "tool": "read",
            "input": { "path": "Note.md" }
        }
    });
    let tool_done = serde_json::json!({
        "type": "tool_result",
        "part": {
            "id": "prt_tool_1",
            "output": "ok"
        }
    });

    dispatch_event(&tool_start, &mut |event| events.push(event));
    dispatch_event(&tool_done, &mut |event| events.push(event));

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ToolStart { tool_name, tool_id, input }
            if tool_name == "read" && tool_id == "prt_tool_1" && input.as_deref() == Some(r#"{"path":"Note.md"}"#)
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ToolDone { tool_id, output }
            if tool_id == "prt_tool_1" && output.as_deref() == Some("ok")
    ));
}

#[test]
fn format_error_explains_missing_auth_or_provider_setup() {
    let message = format_error(
        "provider auth failed: please login".into(),
        "exit status: 1".into(),
    );

    assert!(message.contains("OpenCode CLI is not authenticated"));
    assert!(message.contains("opencode auth login"));
}
