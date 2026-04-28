use super::*;

#[test]
fn dispatch_maps_session_thinking_and_text() {
    let mut events = Vec::new();
    let started = serde_json::json!({ "type": "session", "id": "pi-session" });
    let thinking = serde_json::json!({
        "type": "message_update",
        "assistantMessageEvent": { "type": "thinking_delta", "delta": "Checking links" }
    });
    let text = serde_json::json!({
        "type": "message_update",
        "assistantMessageEvent": { "type": "text_delta", "delta": "Done" }
    });

    for event in [started, thinking, text] {
        dispatch_event(&event, &mut |event| events.push(event));
    }

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::Init { session_id } if session_id == "pi-session"
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
fn dispatch_maps_tool_events() {
    let mut events = Vec::new();
    let tool_start = serde_json::json!({
        "type": "tool_execution_start",
        "toolCallId": "tool_1",
        "toolName": "search_notes",
        "args": { "query": "today" }
    });
    let tool_done = serde_json::json!({
        "type": "tool_execution_end",
        "toolCallId": "tool_1",
        "toolName": "search_notes",
        "result": { "ok": true }
    });

    dispatch_event(&tool_start, &mut |event| events.push(event));
    dispatch_event(&tool_done, &mut |event| events.push(event));

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ToolStart { tool_name, tool_id, input }
            if tool_name == "search_notes" && tool_id == "tool_1" && input.as_deref() == Some(r#"{"query":"today"}"#)
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ToolDone { tool_id, output }
            if tool_id == "tool_1" && output.as_deref() == Some(r#"{"ok":true}"#)
    ));
}

#[test]
fn format_error_explains_missing_auth_or_provider_setup() {
    let message = format_error(
        "provider auth failed: api key required".into(),
        "exit status: 1".into(),
    );

    assert!(message.contains("Pi CLI is not authenticated"));
    assert!(message.contains("pi /login"));
}
