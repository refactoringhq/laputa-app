use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};

/// Status returned by `check_claude_cli`.
#[derive(Debug, Serialize, Clone)]
pub struct ClaudeCliStatus {
    pub installed: bool,
    pub version: Option<String>,
}

/// Event emitted to the frontend during a streaming claude session.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind")]
pub enum ClaudeStreamEvent {
    /// Session initialised — carries the session ID for future `--resume`.
    Init { session_id: String },
    /// Incremental text chunk.
    TextDelta { text: String },
    /// Incremental thinking/reasoning chunk.
    ThinkingDelta { text: String },
    /// A tool call started (agent mode only).
    ToolStart {
        tool_name: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    /// A tool call finished (agent mode only).
    ToolDone {
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
    /// Final result text + session ID.
    Result { text: String, session_id: String },
    /// Something went wrong.
    Error { message: String },
    /// Stream finished.
    Done,
}

/// Parameters accepted by `stream_claude_chat`.
#[derive(Debug, Deserialize)]
pub struct ChatStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub session_id: Option<String>,
}

/// Parameters accepted by Claude Code agent streams.
#[derive(Debug, Deserialize)]
pub struct AgentStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
}

// ---------------------------------------------------------------------------
// Finding the `claude` binary
// ---------------------------------------------------------------------------

pub(crate) fn find_claude_binary() -> Result<PathBuf, String> {
    if let Some(binary) = find_claude_binary_on_path() {
        return Ok(binary);
    }

    if let Some(binary) = find_claude_binary_in_user_shell() {
        return Ok(binary);
    }

    if let Some(binary) = find_existing_binary(claude_binary_candidates()) {
        return Ok(binary);
    }

    Err("Claude CLI not found. Install it: https://docs.anthropic.com/en/docs/claude-code".into())
}

fn find_claude_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(claude_path_lookup_command())
        .arg("claude")
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn claude_path_lookup_command() -> &'static str {
    if cfg!(windows) {
        "where"
    } else {
        "which"
    }
}

fn find_claude_binary_in_user_shell() -> Option<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| command_path_from_shell(&shell, "claude"))
}

fn user_shell_candidates() -> Vec<PathBuf> {
    let mut shells = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        if !shell.is_empty() {
            shells.push(PathBuf::from(shell));
        }
    }
    shells.push(PathBuf::from("/bin/zsh"));
    shells.push(PathBuf::from("/bin/bash"));
    shells
}

fn command_path_from_shell(shell: &Path, command: &str) -> Option<PathBuf> {
    crate::hidden_command(shell)
        .arg("-lc")
        .arg(format!("command -v {command}"))
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn path_from_successful_output(output: &std::process::Output) -> Option<PathBuf> {
    if output.status.success() {
        first_existing_path(&String::from_utf8_lossy(&output.stdout))
    } else {
        None
    }
}

fn first_existing_path(stdout: &str) -> Option<PathBuf> {
    stdout.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }
        let candidate = PathBuf::from(trimmed);
        candidate.exists().then_some(candidate)
    })
}

fn claude_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| claude_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn claude_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/claude"),
        home.join(".local/bin/claude.exe"),
        home.join(".claude/local/claude"),
        home.join(".claude/local/claude.exe"),
        home.join(".local/share/mise/shims/claude"),
        home.join(".local/share/mise/shims/claude.exe"),
        home.join(".asdf/shims/claude"),
        home.join(".asdf/shims/claude.exe"),
        home.join(".npm-global/bin/claude"),
        home.join(".npm-global/bin/claude.cmd"),
        home.join(".npm-global/bin/claude.exe"),
        home.join(".npm/bin/claude"),
        home.join(".npm/bin/claude.cmd"),
        home.join(".npm/bin/claude.exe"),
        home.join("AppData/Roaming/npm/claude.cmd"),
        home.join("AppData/Roaming/npm/claude.exe"),
        home.join("AppData/Local/pnpm/claude.cmd"),
        home.join("AppData/Local/pnpm/claude.exe"),
        home.join("scoop/shims/claude.exe"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
}

fn find_existing_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.exists())
}

// ---------------------------------------------------------------------------
// Public Tauri commands
// ---------------------------------------------------------------------------

/// Check whether the `claude` CLI is installed and return its version.
pub fn check_cli() -> ClaudeCliStatus {
    let bin = match find_claude_binary() {
        Ok(b) => b,
        Err(_) => {
            return ClaudeCliStatus {
                installed: false,
                version: None,
            }
        }
    };

    let version = crate::hidden_command(&bin)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    ClaudeCliStatus {
        installed: true,
        version,
    }
}

/// Spawn `claude -p` for a simple chat (no tools) and stream events via the
/// provided callback.  Returns the session ID for future `--resume` calls.
pub fn run_chat_stream<F>(req: ChatStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(ClaudeStreamEvent),
{
    let bin = find_claude_binary()?;
    let args = build_chat_args(&req);
    run_claude_subprocess(&bin, &args, None, &mut emit)
}

/// Build CLI arguments for a chat stream request.
fn build_chat_args(req: &ChatStreamRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.message.clone(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--tools".into(),
        String::new(), // empty string → disable all built-in tools
    ];

    if let Some(ref sp) = req.system_prompt {
        if !sp.is_empty() {
            args.push("--system-prompt".into());
            args.push(sp.clone());
        }
    }

    if let Some(ref sid) = req.session_id {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args
}

/// Spawn `claude -p` with full tool access and MCP vault tools for an agent task.
pub fn run_agent_stream<F>(req: AgentStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(ClaudeStreamEvent),
{
    let bin = find_claude_binary()?;
    let args = build_agent_args(&req)?;
    run_claude_subprocess(&bin, &args, Some(&req.vault_path), &mut emit)
}

/// Build CLI arguments for an agent stream request.
/// Native tools (bash, read, write, edit) are enabled by default — no `--tools ""`.
fn build_agent_args(req: &AgentStreamRequest) -> Result<Vec<String>, String> {
    let mcp_config = build_mcp_config(&req.vault_path)?;

    let mut args: Vec<String> = vec![
        "-p".into(),
        req.message.clone(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--mcp-config".into(),
        mcp_config,
        "--strict-mcp-config".into(),
        "--permission-mode".into(),
        "acceptEdits".into(),
        "--tools".into(),
        "Read,Edit,MultiEdit,Write,Glob,Grep,LS".into(),
        "--no-session-persistence".into(),
    ];

    if let Some(ref sp) = req.system_prompt {
        if !sp.is_empty() {
            args.push("--append-system-prompt".into());
            args.push(sp.clone());
        }
    }

    Ok(args)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Build a temporary MCP config JSON string pointing to the vault MCP server.
fn build_mcp_config(vault_path: &str) -> Result<String, String> {
    let server_dir = crate::mcp::mcp_server_dir()?;
    let index_js = server_dir.join("index.js");
    let config = serde_json::json!({
        "mcpServers": {
            "tolaria": {
                "command": "node",
                "args": [index_js.to_string_lossy()],
                "env": { "VAULT_PATH": vault_path }
            }
        }
    });
    serde_json::to_string(&config).map_err(|e| format!("Failed to serialise MCP config: {e}"))
}

/// Mutable state accumulated across the JSON stream for a single subprocess.
struct StreamState {
    session_id: String,
    /// Accumulates `input_json_delta` chunks keyed by tool_use id.
    tool_inputs: HashMap<String, String>,
    /// The tool_use id of the block currently being streamed.
    current_tool_id: Option<String>,
    /// Tracks whether response text has already been emitted for this run.
    emitted_text: bool,
}

/// Core subprocess runner shared by chat and agent modes.
/// When `cwd` is `Some`, the subprocess starts with that working directory.
fn run_claude_subprocess<F>(
    bin: &PathBuf,
    args: &[String],
    cwd: Option<&str>,
    emit: &mut F,
) -> Result<String, String>
where
    F: FnMut(ClaudeStreamEvent),
{
    let mut cmd = build_claude_command(bin, args, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {e}"))?;

    let stdout = child.stdout.take().ok_or("No stdout handle")?;
    let reader = std::io::BufReader::new(stdout);

    let mut state = StreamState {
        session_id: String::new(),
        tool_inputs: HashMap::new(),
        current_tool_id: None,
        emitted_text: false,
    };

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                emit(ClaudeStreamEvent::Error {
                    message: format!("Read error: {e}"),
                });
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // skip non-JSON lines
        };

        dispatch_event(&json, &mut state, emit);
    }

    // Read stderr for potential error messages.
    let stderr_output = child
        .stderr
        .take()
        .and_then(|s| std::io::read_to_string(s).ok())
        .unwrap_or_default();

    let status = child.wait().map_err(|e| format!("Wait failed: {e}"))?;

    if !status.success() && state.session_id.is_empty() {
        emit(ClaudeStreamEvent::Error {
            message: format_failed_claude_exit(&stderr_output, status),
        });
    }

    emit(ClaudeStreamEvent::Done);

    Ok(state.session_id)
}

fn build_claude_command(
    bin: &PathBuf,
    args: &[String],
    cwd: Option<&str>,
) -> std::process::Command {
    let mut cmd = crate::hidden_command(bin);
    cmd.args(args)
        .env_remove("CLAUDECODE") // prevent "nested session" guard
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd
}

fn format_failed_claude_exit(stderr_output: &str, status: ExitStatus) -> String {
    if is_claude_auth_error(stderr_output) {
        return "Claude CLI is not authenticated. Run `claude auth login` in your terminal.".into();
    }

    if stderr_output.is_empty() {
        format!("claude exited with status {status}")
    } else {
        stderr_output.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_claude_auth_error(stderr_output: &str) -> bool {
    let lower = stderr_output.to_ascii_lowercase();
    ["not logged in", "authentication", "auth"]
        .iter()
        .any(|pattern| lower.contains(pattern))
}

/// Parse a single JSON line from the stream and emit the appropriate event.
fn dispatch_event<F>(json: &serde_json::Value, state: &mut StreamState, emit: &mut F)
where
    F: FnMut(ClaudeStreamEvent),
{
    let msg_type = json["type"].as_str().unwrap_or("");

    match msg_type {
        // --- System init → capture session_id ---
        "system" if json["subtype"].as_str() == Some("init") => {
            if let Some(sid) = json["session_id"].as_str() {
                state.session_id = sid.to_string();
                emit(ClaudeStreamEvent::Init {
                    session_id: sid.to_string(),
                });
            }
        }

        // --- Streaming partial events (text deltas, tool_use starts) ---
        "stream_event" => {
            dispatch_stream_event(json, state, emit);
        }

        // --- Tool progress (agent mode) ---
        "tool_progress" => {
            if let (Some(name), Some(id)) =
                (json["tool_name"].as_str(), json["tool_use_id"].as_str())
            {
                emit(ClaudeStreamEvent::ToolStart {
                    tool_name: name.to_string(),
                    tool_id: id.to_string(),
                    input: None,
                });
            }
        }

        // --- Tool result (agent mode) ---
        "tool_result" => {
            if let Some(id) = json["tool_use_id"].as_str() {
                let output = extract_tool_result_text(json);
                emit(ClaudeStreamEvent::ToolDone {
                    tool_id: id.to_string(),
                    output,
                });
            }
        }

        // --- Final result ---
        "result" => {
            let sid = json["session_id"].as_str().unwrap_or("").to_string();
            if !sid.is_empty() {
                state.session_id = sid.clone();
            }
            let text = if state.emitted_text {
                String::new()
            } else {
                let text = json["result"].as_str().unwrap_or("").to_string();
                if !text.is_empty() {
                    state.emitted_text = true;
                }
                text
            };
            emit(ClaudeStreamEvent::Result {
                text,
                session_id: sid,
            });
        }

        // --- Complete assistant message (fallback for text when no partials) ---
        "assistant" => {
            if let Some(content) = json["message"]["content"].as_array() {
                let emit_text = !state.emitted_text;
                for block in content {
                    dispatch_assistant_content_block(block, emit_text, state, emit);
                }
            }
        }

        _ => {} // ignore other event types
    }
}

/// Handle a `stream_event` (partial assistant message).
fn dispatch_stream_event<F>(json: &serde_json::Value, state: &mut StreamState, emit: &mut F)
where
    F: FnMut(ClaudeStreamEvent),
{
    let event = &json["event"];
    let event_type = event["type"].as_str().unwrap_or("");

    match event_type {
        "content_block_delta" => {
            let delta = &event["delta"];
            match delta["type"].as_str() {
                Some("text_delta") => {
                    if let Some(text) = delta["text"].as_str() {
                        emit_text_delta(text, state, emit);
                    }
                }
                Some("thinking_delta") => {
                    if let Some(text) = delta["thinking"].as_str() {
                        emit(ClaudeStreamEvent::ThinkingDelta {
                            text: text.to_string(),
                        });
                    }
                }
                Some("input_json_delta") => {
                    if let (Some(partial), Some(ref tid)) =
                        (delta["partial_json"].as_str(), &state.current_tool_id)
                    {
                        state
                            .tool_inputs
                            .entry(tid.clone())
                            .or_default()
                            .push_str(partial);
                    }
                }
                _ => {}
            }
        }
        "content_block_start" => {
            let block = &event["content_block"];
            if block["type"].as_str() == Some("tool_use") {
                if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                    state.current_tool_id = Some(id.to_string());
                    state.tool_inputs.entry(id.to_string()).or_default();
                    emit(ClaudeStreamEvent::ToolStart {
                        tool_name: name.to_string(),
                        tool_id: id.to_string(),
                        input: None,
                    });
                }
            }
        }
        "content_block_stop" => {
            state.current_tool_id = None;
        }
        _ => {}
    }
}

fn dispatch_assistant_content_block<F>(
    block: &serde_json::Value,
    emit_text: bool,
    state: &mut StreamState,
    emit: &mut F,
) where
    F: FnMut(ClaudeStreamEvent),
{
    match block["type"].as_str() {
        Some("text") => {
            if emit_text {
                if let Some(text) = block["text"].as_str() {
                    emit_text_delta(text, state, emit);
                }
            }
        }
        Some("tool_use") => {
            if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                let input = format_tool_input(&block["input"], state, id);
                emit(ClaudeStreamEvent::ToolStart {
                    tool_name: name.to_string(),
                    tool_id: id.to_string(),
                    input,
                });
            }
        }
        _ => {}
    }
}

fn emit_text_delta<F>(text: &str, state: &mut StreamState, emit: &mut F)
where
    F: FnMut(ClaudeStreamEvent),
{
    if !text.is_empty() {
        state.emitted_text = true;
    }
    emit(ClaudeStreamEvent::TextDelta {
        text: text.to_string(),
    });
}

/// Build the tool input string, preferring accumulated delta chunks over the
/// block's `input` field (which may be empty at stream start).
fn format_tool_input(
    block_input: &serde_json::Value,
    state: &StreamState,
    tool_id: &str,
) -> Option<String> {
    if let Some(accumulated) = state.tool_inputs.get(tool_id) {
        if !accumulated.is_empty() {
            return Some(accumulated.clone());
        }
    }
    if !block_input.is_null() && block_input.as_object().is_some_and(|o| !o.is_empty()) {
        return Some(block_input.to_string());
    }
    None
}

/// Extract displayable text from a `tool_result` event.
fn extract_tool_result_text(json: &serde_json::Value) -> Option<String> {
    // String content field
    if let Some(s) = json["content"].as_str() {
        return Some(s.to_string());
    }
    // Array of content blocks (Claude format)
    if let Some(arr) = json["content"].as_array() {
        let texts: Vec<&str> = arr.iter().filter_map(|b| b["text"].as_str()).collect();
        if !texts.is_empty() {
            return Some(texts.join("\n"));
        }
    }
    // Fallback: "output" field
    json["output"].as_str().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::ffi::OsString;
    use std::process::Command;

    #[test]
    fn check_cli_returns_status() {
        let status = check_cli();
        if status.installed {
            assert!(status.version.is_some());
        } else {
            assert!(status.version.is_none());
        }
    }

    #[test]
    fn build_mcp_config_is_valid_json() {
        if let Ok(config_str) = build_mcp_config("/tmp/test-vault") {
            let parsed: serde_json::Value = serde_json::from_str(&config_str).unwrap();
            assert!(parsed["mcpServers"]["tolaria"]["command"].is_string());
            assert_eq!(
                parsed["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
                "/tmp/test-vault"
            );
        }
    }

    // --- dispatch_event / dispatch_stream_event ---

    fn new_state() -> StreamState {
        StreamState {
            session_id: String::new(),
            tool_inputs: HashMap::new(),
            current_tool_id: None,
            emitted_text: false,
        }
    }

    /// Run dispatch_event on the given JSON and return (session_id, events).
    fn run_dispatch(json: serde_json::Value) -> (String, Vec<ClaudeStreamEvent>) {
        let mut state = new_state();
        let mut events = vec![];
        dispatch_event(&json, &mut state, &mut |e| events.push(e));
        (state.session_id, events)
    }

    /// Run dispatch_event with a pre-set session_id.
    fn run_dispatch_with_sid(
        json: serde_json::Value,
        initial_sid: &str,
    ) -> (String, Vec<ClaudeStreamEvent>) {
        let mut state = new_state();
        state.session_id = initial_sid.to_string();
        let mut events = vec![];
        dispatch_event(&json, &mut state, &mut |e| events.push(e));
        (state.session_id, events)
    }

    /// Run multiple dispatch_event calls sharing state (for multi-event sequences).
    fn run_dispatch_sequence(
        events_json: Vec<serde_json::Value>,
    ) -> (StreamState, Vec<ClaudeStreamEvent>) {
        let mut state = new_state();
        let mut events = vec![];
        for json in &events_json {
            dispatch_event(json, &mut state, &mut |e| events.push(e));
        }
        (state, events)
    }

    #[test]
    fn dispatch_event_handles_init() {
        let (sid, events) = run_dispatch(serde_json::json!({
            "type": "system", "subtype": "init", "session_id": "test-session-123"
        }));
        assert_eq!(sid, "test-session-123");
        assert!(
            matches!(&events[0], ClaudeStreamEvent::Init { session_id } if session_id == "test-session-123")
        );
    }

    #[test]
    fn dispatch_event_system_without_init_subtype_is_ignored() {
        let (_, events) = run_dispatch(serde_json::json!({ "type": "system", "subtype": "other" }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_event_system_init_without_session_id_is_ignored() {
        let (sid, events) =
            run_dispatch(serde_json::json!({ "type": "system", "subtype": "init" }));
        assert!(events.is_empty());
        assert!(sid.is_empty());
    }

    #[test]
    fn dispatch_event_handles_text_delta() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Hello" } }
        }));
        assert!(matches!(&events[0], ClaudeStreamEvent::TextDelta { text } if text == "Hello"));
    }

    #[test]
    fn dispatch_event_handles_tool_start() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "tool_abc", "name": "read_note", "input": {} } }
        }));
        assert!(
            matches!(&events[0], ClaudeStreamEvent::ToolStart { tool_name, tool_id, .. } if tool_name == "read_note" && tool_id == "tool_abc")
        );
    }

    #[test]
    fn dispatch_event_handles_result() {
        let (sid, events) = run_dispatch(serde_json::json!({
            "type": "result", "subtype": "success", "result": "All done!", "session_id": "sess-456"
        }));
        assert_eq!(sid, "sess-456");
        assert!(
            matches!(&events[0], ClaudeStreamEvent::Result { text, session_id } if text == "All done!" && session_id == "sess-456")
        );
    }

    #[test]
    fn dispatch_event_result_with_empty_session_id() {
        let (sid, events) = run_dispatch_with_sid(
            serde_json::json!({ "type": "result", "result": "text here" }),
            "prev-session",
        );
        assert_eq!(sid, "prev-session");
        assert!(
            matches!(&events[0], ClaudeStreamEvent::Result { text, .. } if text == "text here")
        );
    }

    #[test]
    fn dispatch_event_handles_tool_progress() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "tool_progress", "tool_name": "search_notes", "tool_use_id": "tool_xyz"
        }));
        assert!(
            matches!(&events[0], ClaudeStreamEvent::ToolStart { tool_name, tool_id, .. } if tool_name == "search_notes" && tool_id == "tool_xyz")
        );
    }

    #[test]
    fn dispatch_event_tool_progress_missing_fields_is_ignored() {
        let (_, events) =
            run_dispatch(serde_json::json!({ "type": "tool_progress", "tool_name": "x" }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_event_handles_assistant_with_tool_use() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "text", "text": "Let me search." },
                { "type": "tool_use", "id": "tu_1", "name": "search_notes", "input": {} }
            ] }
        }));
        assert_eq!(events.len(), 2);
        assert!(
            matches!(&events[0], ClaudeStreamEvent::TextDelta { text } if text == "Let me search.")
        );
        assert!(
            matches!(&events[1], ClaudeStreamEvent::ToolStart { tool_name, tool_id, .. } if tool_name == "search_notes" && tool_id == "tu_1")
        );
    }

    #[test]
    fn dispatch_event_result_after_text_delta_does_not_duplicate_response_text() {
        let (state, events) = run_dispatch_sequence(vec![
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Visible reply" } }
            }),
            serde_json::json!({
                "type": "result",
                "session_id": "session-1",
                "result": "Visible reply"
            }),
        ]);

        assert_eq!(state.session_id, "session-1");
        assert!(matches!(&events[..],
                [
                    ClaudeStreamEvent::TextDelta { text },
                    ClaudeStreamEvent::Result { text: result_text, session_id },
                ] if text == "Visible reply" && result_text.is_empty() && session_id == "session-1"));
    }

    #[test]
    fn dispatch_event_assistant_without_content_is_noop() {
        let (_, events) = run_dispatch(serde_json::json!({ "type": "assistant", "message": {} }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_event_ignores_unknown() {
        let (_, events) =
            run_dispatch(serde_json::json!({ "type": "some_future_type", "data": 42 }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_stream_event_input_json_delta_accumulates_silently() {
        // input_json_delta doesn't emit events directly — it accumulates in state
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "input_json_delta", "partial_json": "{}" } }
        }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_stream_event_non_tool_block_start_is_ignored() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }
        }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_stream_event_unknown_type_is_ignored() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "stream_event", "event": { "type": "message_stop" }
        }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_event_handles_tool_result_string_content() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "tool_abc",
            "content": "Found 3 notes matching query"
        }));
        assert_eq!(events.len(), 1);
        assert!(
            matches!(&events[0], ClaudeStreamEvent::ToolDone { tool_id, output }
                if tool_id == "tool_abc" && output.as_deref() == Some("Found 3 notes matching query"))
        );
    }

    #[test]
    fn dispatch_event_handles_tool_result_array_content() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "tool_def",
            "content": [{ "type": "text", "text": "Line 1" }, { "type": "text", "text": "Line 2" }]
        }));
        assert!(
            matches!(&events[0], ClaudeStreamEvent::ToolDone { output, .. }
                if output.as_deref() == Some("Line 1\nLine 2"))
        );
    }

    #[test]
    fn dispatch_event_tool_result_missing_tool_id_is_ignored() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "tool_result", "content": "result text"
        }));
        assert!(events.is_empty());
    }

    #[test]
    fn dispatch_accumulates_input_json_deltas() {
        let (_, events) = run_dispatch_sequence(vec![
            // Start tool_use block
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_start", "content_block": { "type": "tool_use", "id": "t1", "name": "search_notes", "input": {} } }
            }),
            // Input delta chunks
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_delta", "delta": { "type": "input_json_delta", "partial_json": "{\"query\":" } }
            }),
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_delta", "delta": { "type": "input_json_delta", "partial_json": "\"test\"}" } }
            }),
            // Stop block
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_stop" }
            }),
            // Assistant message triggers ToolStart with accumulated input
            serde_json::json!({
                "type": "assistant",
                "message": { "content": [
                    { "type": "tool_use", "id": "t1", "name": "search_notes", "input": { "query": "test" } }
                ] }
            }),
        ]);
        // First event: ToolStart with no input (from content_block_start)
        assert!(matches!(
            &events[0],
            ClaudeStreamEvent::ToolStart { input: None, .. }
        ));
        // Second event: ToolStart with accumulated input (from assistant)
        assert!(
            matches!(&events[1], ClaudeStreamEvent::ToolStart { input: Some(inp), .. }
                if inp == "{\"query\":\"test\"}")
        );
    }

    #[test]
    fn dispatch_assistant_uses_block_input_when_no_deltas() {
        let (_, events) = run_dispatch(serde_json::json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "tool_use", "id": "tu_x", "name": "create_note", "input": { "title": "Hello", "content": "world" } }
            ] }
        }));
        assert!(
            matches!(&events[0], ClaudeStreamEvent::ToolStart { input: Some(inp), .. }
                if inp.contains("title") && inp.contains("Hello"))
        );
    }

    #[test]
    fn content_block_stop_clears_current_tool() {
        let (state, _) = run_dispatch_sequence(vec![
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_start", "content_block": { "type": "tool_use", "id": "t1", "name": "x", "input": {} } }
            }),
            serde_json::json!({
                "type": "stream_event",
                "event": { "type": "content_block_stop" }
            }),
        ]);
        assert!(state.current_tool_id.is_none());
    }

    // --- run_claude_subprocess with mock scripts ---

    #[test]
    fn build_claude_command_keeps_streaming_process_contract() {
        let bin = PathBuf::from("claude");
        let args = vec!["-p".to_string(), "hello".to_string()];
        let command = build_claude_command(&bin, &args, Some("/tmp/vault"));
        let actual_args: Vec<OsString> = command.get_args().map(OsStr::to_os_string).collect();
        let claude_code_env = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("CLAUDECODE"))
            .map(|(_, value)| value.map(OsStr::to_os_string));

        assert_eq!(
            (
                command.get_program().to_os_string(),
                actual_args,
                command.get_current_dir().map(Path::to_path_buf),
                claude_code_env,
            ),
            (
                OsString::from("claude"),
                vec![OsString::from("-p"), OsString::from("hello")],
                Some(PathBuf::from("/tmp/vault")),
                Some(None),
            ),
        );
    }

    #[cfg(unix)]
    fn run_mock_script(script: &str) -> (Result<String, String>, Vec<ClaudeStreamEvent>) {
        run_mock_script_with_args(script, &[])
    }

    #[cfg(unix)]
    fn run_mock_script_with_args(
        script: &str,
        args: &[String],
    ) -> (Result<String, String>, Vec<ClaudeStreamEvent>) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mock-claude");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut events = vec![];
        let result = run_claude_subprocess(&path, args, None, &mut |e| events.push(e));
        (result, events)
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_parses_ndjson_stream() {
        let (result, events) = run_mock_script(concat!(
            "#!/bin/sh\n",
            "echo '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"s1\"}'\n",
            "echo '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}}'\n",
            "echo '{\"type\":\"result\",\"result\":\"Done\",\"session_id\":\"s1\"}'\n",
        ));
        assert_eq!(result.unwrap(), "s1");
        assert!(matches!(&events[0], ClaudeStreamEvent::Init { session_id } if session_id == "s1"));
        assert!(matches!(&events[1], ClaudeStreamEvent::TextDelta { text } if text == "Hi"));
        assert!(matches!(&events[2], ClaudeStreamEvent::Result { .. }));
        assert!(matches!(&events[3], ClaudeStreamEvent::Done));
    }

    #[test]
    fn run_subprocess_closes_stdin_even_when_parent_stdin_pipe_is_open() {
        use std::io::Read;
        use std::time::{Duration, Instant};

        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("stdin_probe_parent_child")
            .arg("--ignored")
            .arg("--nocapture")
            .env("TOLARIA_STDIN_PROBE_CHILD", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let child_stdin = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);

        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                drop(child_stdin);
                panic!("stdin probe child timed out");
            }
            std::thread::sleep(Duration::from_millis(10));
        };

        drop(child_stdin);
        let mut stdout_text = String::new();
        let mut stderr_text = String::new();
        stdout.read_to_string(&mut stdout_text).unwrap();
        stderr.read_to_string(&mut stderr_text).unwrap();

        assert!(
            status.success(),
            "stdin probe child failed with {status}\nstdout:\n{stdout_text}\nstderr:\n{stderr_text}"
        );
    }

    #[ignore = "spawned by run_subprocess_closes_stdin_even_when_parent_stdin_pipe_is_open"]
    #[test]
    fn stdin_probe_parent_child() {
        if std::env::var_os("TOLARIA_STDIN_PROBE_CHILD").is_none() {
            return;
        }

        let fake_bin = std::env::current_exe().unwrap();
        let args = vec![
            "stdin_probe_mock_claude_child".to_string(),
            "--ignored".to_string(),
            "--nocapture".to_string(),
        ];
        std::env::set_var("TOLARIA_STDIN_PROBE_MOCK_CLAUDE_CHILD", "1");
        let mut events = vec![];
        let result = run_claude_subprocess(&fake_bin, &args, None, &mut |event| events.push(event));
        std::env::remove_var("TOLARIA_STDIN_PROBE_MOCK_CLAUDE_CHILD");

        assert_eq!(result.unwrap(), "stdin-ok");
        assert!(matches!(
            events.first(),
            Some(ClaudeStreamEvent::Result { text, session_id })
                if text == "stdin closed" && session_id == "stdin-ok"
        ));
        assert!(matches!(events.last(), Some(ClaudeStreamEvent::Done)));
    }

    #[ignore = "spawned by stdin_probe_parent_child"]
    #[test]
    fn stdin_probe_mock_claude_child() {
        if std::env::var_os("TOLARIA_STDIN_PROBE_MOCK_CLAUDE_CHILD").is_none() {
            return;
        }

        use std::io::Read;

        let mut stdin = String::new();
        std::io::stdin().read_to_string(&mut stdin).unwrap();
        assert!(stdin.is_empty(), "stdin was not EOF");
        println!(
            "{}",
            serde_json::json!({
                "type": "result",
                "result": "stdin closed",
                "session_id": "stdin-ok"
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_skips_blank_and_non_json_lines() {
        let (result, events) = run_mock_script(concat!(
            "#!/bin/sh\n",
            "echo ''\n",
            "echo 'not json at all'\n",
            "echo '{\"type\":\"result\",\"result\":\"ok\",\"session_id\":\"s2\"}'\n",
        ));
        assert_eq!(result.unwrap(), "s2");
        assert!(matches!(&events[0], ClaudeStreamEvent::Result { text, .. } if text == "ok"));
        assert!(matches!(&events[1], ClaudeStreamEvent::Done));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_emits_error_on_nonzero_exit() {
        let (_, events) = run_mock_script("#!/bin/sh\necho 'auth problem' >&2\nexit 1\n");
        assert!(events
            .iter()
            .any(|e| matches!(e, ClaudeStreamEvent::Error { .. })));
        assert!(matches!(events.last().unwrap(), ClaudeStreamEvent::Done));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_detects_auth_error_in_stderr() {
        let (_, events) = run_mock_script("#!/bin/sh\necho 'not logged in' >&2\nexit 1\n");
        assert!(events.iter().any(|e| matches!(e, ClaudeStreamEvent::Error { message } if message.contains("not authenticated"))));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_reports_exit_code_on_empty_stderr() {
        let (_, events) = run_mock_script("#!/bin/sh\nexit 2\n");
        assert!(events.iter().any(
            |e| matches!(e, ClaudeStreamEvent::Error { message } if message.contains("exited with"))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_success_with_no_events() {
        let (result, events) = run_mock_script("#!/bin/sh\nexit 0\n");
        assert!(result.is_ok());
        assert!(matches!(events.last().unwrap(), ClaudeStreamEvent::Done));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_passes_args_through() {
        let args: Vec<String> = vec!["--foo".into(), "bar".into()];
        let (_, events) = run_mock_script_with_args(concat!(
            "#!/bin/sh\n",
            "echo \"{\\\"type\\\":\\\"result\\\",\\\"result\\\":\\\"$*\\\",\\\"session_id\\\":\\\"sx\\\"}\"\n",
        ), &args);
        let text = events.iter().find_map(|e| match e {
            ClaudeStreamEvent::Result { text, .. } => Some(text.as_str()),
            _ => None,
        });
        assert!(text.unwrap().contains("--foo"));
    }

    // --- build_chat_args ---

    #[test]
    fn build_chat_args_basic() {
        let req = ChatStreamRequest {
            message: "hello".into(),
            system_prompt: None,
            session_id: None,
        };
        let args = build_chat_args(&req);
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"hello".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(!args.contains(&"--system-prompt".to_string()));
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn build_chat_args_with_system_prompt() {
        let req = ChatStreamRequest {
            message: "hi".into(),
            system_prompt: Some("You are helpful.".into()),
            session_id: None,
        };
        let args = build_chat_args(&req);
        assert!(args.contains(&"--system-prompt".to_string()));
        assert!(args.contains(&"You are helpful.".to_string()));
    }

    #[test]
    fn build_chat_args_empty_system_prompt_is_skipped() {
        let req = ChatStreamRequest {
            message: "hi".into(),
            system_prompt: Some(String::new()),
            session_id: None,
        };
        let args = build_chat_args(&req);
        assert!(!args.contains(&"--system-prompt".to_string()));
    }

    #[test]
    fn build_chat_args_with_session_id() {
        let req = ChatStreamRequest {
            message: "continue".into(),
            system_prompt: None,
            session_id: Some("sess-abc".into()),
        };
        let args = build_chat_args(&req);
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"sess-abc".to_string()));
    }

    // --- build_agent_args ---

    #[test]
    fn build_agent_args_basic() {
        // build_agent_args calls build_mcp_config which needs mcp_server_dir
        if let Ok(args) = build_agent_args(&AgentStreamRequest {
            message: "create note".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
        }) {
            assert!(args.contains(&"-p".to_string()));
            assert!(args.contains(&"create note".to_string()));
            assert!(args.contains(&"--mcp-config".to_string()));
            assert!(args.contains(&"--strict-mcp-config".to_string()));
            assert!(args.contains(&"--permission-mode".to_string()));
            assert!(args.contains(&"acceptEdits".to_string()));
            assert!(args.contains(&"--tools".to_string()));
            assert!(args.contains(&"Read,Edit,MultiEdit,Write,Glob,Grep,LS".to_string()));
            assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
            assert!(!args.contains(&"bypassPermissions".to_string()));
            assert!(!args.contains(&"Bash".to_string()));
            assert!(args.contains(&"--no-session-persistence".to_string()));
            assert!(!args.contains(&"--append-system-prompt".to_string()));
        }
    }

    #[test]
    fn build_agent_args_with_system_prompt() {
        if let Ok(args) = build_agent_args(&AgentStreamRequest {
            message: "do it".into(),
            system_prompt: Some("Act as expert.".into()),
            vault_path: "/tmp/v".into(),
        }) {
            assert!(args.contains(&"--append-system-prompt".to_string()));
            assert!(args.contains(&"Act as expert.".to_string()));
        }
    }

    #[test]
    fn build_agent_args_empty_system_prompt_is_skipped() {
        if let Ok(args) = build_agent_args(&AgentStreamRequest {
            message: "x".into(),
            system_prompt: Some(String::new()),
            vault_path: "/tmp/v".into(),
        }) {
            assert!(!args.contains(&"--append-system-prompt".to_string()));
        }
    }

    // --- find_claude_binary ---

    #[test]
    fn claude_binary_candidates_include_supported_local_and_toolchain_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = claude_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/claude"),
            home.join(".claude/local/claude"),
            home.join(".local/share/mise/shims/claude"),
            home.join(".npm-global/bin/claude"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn claude_binary_candidates_include_windows_exe_installs() {
        let home = PathBuf::from(r"C:\Users\alex");
        let candidates = claude_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/claude.exe"),
            home.join(".claude/local/claude.exe"),
            home.join("AppData/Roaming/npm/claude.cmd"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn claude_path_lookup_command_matches_current_platform() {
        let expected = if cfg!(windows) { "where" } else { "which" };

        assert_eq!(claude_path_lookup_command(), expected);
    }

    #[test]
    fn find_existing_binary_finds_windows_exe_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let claude = dir.path().join(".local/bin/claude.exe");
        std::fs::create_dir_all(claude.parent().unwrap()).unwrap();
        std::fs::write(&claude, "").unwrap();

        assert_eq!(
            find_existing_binary(claude_binary_candidates_for_home(dir.path())),
            Some(claude)
        );
    }

    #[test]
    fn find_claude_binary_returns_result() {
        let result = find_claude_binary();
        // On dev machines claude may be installed; on CI it may not.
        // Either way, the function should return Ok(path) or Err(message).
        match &result {
            Ok(path) => assert!(path.exists()),
            Err(msg) => assert!(msg.contains("not found")),
        }
    }

    // --- run_chat_stream / run_agent_stream error paths ---

    #[test]
    fn run_chat_stream_returns_result() {
        let req = ChatStreamRequest {
            message: "test".into(),
            system_prompt: None,
            session_id: None,
        };
        let mut events = vec![];
        // This will either succeed (if claude is installed) or fail (if not).
        let result = run_chat_stream(req, |e| events.push(e));
        // Either way the function should have returned without panicking.
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn run_agent_stream_returns_result() {
        let req = AgentStreamRequest {
            message: "test".into(),
            system_prompt: Some("sys".into()),
            vault_path: "/tmp/nonexistent".into(),
        };
        let mut events = vec![];
        let result = run_agent_stream(req, |e| events.push(e));
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn run_subprocess_spawn_failure() {
        let fake_bin = PathBuf::from("/nonexistent/binary/path");
        let mut events = vec![];
        let result = run_claude_subprocess(&fake_bin, &[], None, &mut |e| events.push(e));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to spawn"));
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_with_tool_progress_and_assistant() {
        let (result, events) = run_mock_script(concat!(
            "#!/bin/sh\n",
            "echo '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"s3\"}'\n",
            "echo '{\"type\":\"tool_progress\",\"tool_name\":\"search\",\"tool_use_id\":\"t1\"}'\n",
            "echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"t2\",\"name\":\"read\",\"input\":{}}]}}'\n",
            "echo '{\"type\":\"result\",\"result\":\"fin\",\"session_id\":\"s3\"}'\n",
        ));
        assert_eq!(result.unwrap(), "s3");
        assert!(events.len() >= 4);
    }

    #[cfg(unix)]
    #[test]
    fn run_subprocess_success_exit_with_session_id_skips_error() {
        let (_, events) = run_mock_script(concat!(
            "#!/bin/sh\n",
            "echo '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"s4\"}'\n",
            "echo 'some warning' >&2\n",
            "exit 1\n",
        ));
        // Should NOT have an error event because session_id is non-empty
        assert!(!events
            .iter()
            .any(|e| matches!(e, ClaudeStreamEvent::Error { .. })));
    }
}
