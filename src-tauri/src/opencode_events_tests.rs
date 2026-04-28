use super::*;

fn dispatch_events(events: impl IntoIterator<Item = serde_json::Value>) -> Vec<AiAgentStreamEvent> {
    let mut mapped = Vec::new();

    for event in events {
        dispatch_event(&event, &mut |event| mapped.push(event));
    }

    mapped
}

struct ToolExpectation<'a> {
    tool_id: &'a str,
    tool_name: &'a str,
    input: Option<&'a str>,
    output: Option<&'a str>,
}

fn assert_tool_pair(events: &[AiAgentStreamEvent], expected: ToolExpectation<'_>) {
    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ToolStart {
            tool_name: actual_name,
            tool_id: actual_id,
            input: actual_input,
        } if actual_name == expected.tool_name
            && actual_id == expected.tool_id
            && actual_input.as_deref() == expected.input
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ToolDone {
            tool_id: actual_id,
            output: actual_output,
        } if actual_id == expected.tool_id && actual_output.as_deref() == expected.output
    ));
}

#[test]
fn parse_line_reports_read_errors_and_skips_blank_or_invalid_lines() {
    let mut events = Vec::new();

    let read_error = parse_line(Err(std::io::Error::other("broken pipe")), &mut |event| {
        events.push(event)
    });
    let blank = parse_line(Ok("   ".into()), &mut |event| events.push(event));
    let invalid = parse_line(Ok("not json".into()), &mut |event| events.push(event));

    assert!(read_error.is_none());
    assert!(blank.is_none());
    assert!(invalid.is_none());
    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::Error { message } if message.contains("broken pipe")
    ));
}

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
    let direct = dispatch_events([
        serde_json::json!({
            "type": "tool_use",
            "id": "tool_1",
            "name": "read",
            "input": { "path": "Note.md" }
        }),
        serde_json::json!({ "type": "tool_result", "id": "tool_1", "output": "ok" }),
    ]);
    let part_backed = dispatch_events([
        serde_json::json!({
            "type": "tool_use",
            "part": {
                "id": "prt_tool_1",
                "tool": "read",
                "input": { "path": "Note.md" }
            }
        }),
        serde_json::json!({
            "type": "tool_result",
            "part": {
                "id": "prt_tool_1",
                "output": "ok"
            }
        }),
    ]);

    assert_tool_pair(
        &direct,
        ToolExpectation {
            tool_id: "tool_1",
            tool_name: "read",
            input: Some(r#"{"path":"Note.md"}"#),
            output: Some("ok"),
        },
    );
    assert_tool_pair(
        &part_backed,
        ToolExpectation {
            tool_id: "prt_tool_1",
            tool_name: "read",
            input: Some(r#"{"path":"Note.md"}"#),
            output: Some("ok"),
        },
    );
}

#[test]
fn dispatch_maps_error_events() {
    let mut events = Vec::new();
    let error = serde_json::json!({ "type": "error", "message": "provider failed" });

    dispatch_event(&error, &mut |event| events.push(event));

    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::Error { message } if message == "provider failed"
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

#[test]
fn format_error_uses_status_or_first_stderr_lines() {
    let empty = format_error(String::new(), "exit status: 2".into());
    let truncated = format_error("line 1\nline 2\nline 3\nline 4".into(), "ignored".into());

    assert_eq!(empty, "opencode exited with status exit status: 2");
    assert_eq!(truncated, "line 1\nline 2\nline 3");
}
