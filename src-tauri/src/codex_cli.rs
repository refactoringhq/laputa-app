use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
pub use crate::cli_agent_runtime::AgentStreamRequest;
use std::path::{Path, PathBuf};
use std::process::Stdio;

pub fn check_cli() -> AiAgentAvailability {
    let binary = match find_codex_binary() {
        Ok(binary) => binary,
        Err(_) => {
            return AiAgentAvailability {
                installed: false,
                version: None,
            }
        }
    };

    AiAgentAvailability {
        installed: true,
        version: crate::cli_agent_runtime::version_for_binary(&binary),
    }
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = find_codex_binary()?;
    run_agent_stream_with_binary(&binary, request, emit)
}

fn find_codex_binary() -> Result<PathBuf, String> {
    find_codex_binary_on_path()
        .filter(is_usable_codex_binary)
        .or_else(|| find_codex_binary_in_user_shell().filter(is_usable_codex_binary))
        .or_else(|| find_usable_codex_binary(codex_binary_candidates()))
        .ok_or_else(|| {
            "Codex CLI not found. Install it: https://developers.openai.com/codex/cli".into()
        })
}

fn find_codex_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(codex_path_lookup_command())
        .arg("codex")
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn codex_path_lookup_command() -> &'static str {
    if cfg!(windows) {
        "where"
    } else {
        "which"
    }
}

fn find_codex_binary_in_user_shell() -> Option<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| command_path_from_shell(&shell, "codex"))
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

fn codex_binary_candidates() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| codex_binary_candidates_for_home(&home))
        .unwrap_or_default()
}

fn codex_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join(".local/bin/codex"),
        home.join(".local/bin/codex.exe"),
        home.join(".codex/bin/codex"),
        home.join(".codex/bin/codex.exe"),
        home.join(".local/share/mise/shims/codex"),
        home.join(".local/share/mise/shims/codex.exe"),
        home.join(".asdf/shims/codex"),
        home.join(".asdf/shims/codex.exe"),
        home.join(".npm-global/bin/codex"),
        home.join(".npm-global/bin/codex.cmd"),
        home.join(".npm-global/bin/codex.exe"),
        home.join(".npm/bin/codex"),
        home.join(".npm/bin/codex.cmd"),
        home.join(".npm/bin/codex.exe"),
        home.join(".bun/bin/codex"),
        home.join(".bun/bin/codex.exe"),
        home.join(".linuxbrew/bin/codex"),
        home.join("AppData/Roaming/npm/codex.cmd"),
        home.join("AppData/Roaming/npm/codex.exe"),
        home.join("AppData/Local/pnpm/codex.cmd"),
        home.join("AppData/Local/pnpm/codex.exe"),
        home.join("scoop/shims/codex.exe"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
    ];
    candidates.extend(nvm_node_binary_candidates_for_home(home, "codex"));
    candidates
}

fn nvm_node_binary_candidates_for_home(home: &Path, binary_name: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) else {
        return Vec::new();
    };

    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| path.join("bin").join(binary_name))
        .collect::<Vec<_>>();
    candidates.sort();
    candidates
}

fn find_usable_codex_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(is_usable_codex_binary)
}

fn is_usable_codex_binary(binary: &PathBuf) -> bool {
    crate::cli_agent_runtime::version_for_binary(binary).is_some()
}

fn run_agent_stream_with_binary<F>(
    binary: &Path,
    request: AgentStreamRequest,
    emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let last_message_dir = tempfile::Builder::new()
        .prefix("tolaria-codex-last-message-")
        .tempdir()
        .map_err(|error| format!("Failed to create Codex output directory: {error}"))?;
    let last_message_path = last_message_dir.path().join("last-message.txt");
    let args = build_codex_args(&request, Some(&last_message_path))?;
    let prompt = build_codex_prompt(&request);
    let command = build_codex_command(binary, args, prompt, &request.vault_path);
    let emit = with_codex_last_message_fallback(emit, last_message_path);

    crate::cli_agent_runtime::run_ai_agent_json_stream(
        command,
        "codex",
        emit,
        codex_session_id,
        dispatch_codex_event,
        format_codex_error,
    )
}

fn with_codex_last_message_fallback<F>(
    mut emit: F,
    last_message_path: PathBuf,
) -> impl FnMut(AiAgentStreamEvent)
where
    F: FnMut(AiAgentStreamEvent),
{
    let mut text_emitted = false;

    move |event| {
        match &event {
            AiAgentStreamEvent::TextDelta { text } if !text.trim().is_empty() => {
                text_emitted = true;
            }
            AiAgentStreamEvent::Done if !text_emitted => {
                if let Some(text) = read_codex_last_message(&last_message_path) {
                    text_emitted = true;
                    emit(AiAgentStreamEvent::TextDelta { text });
                }
            }
            _ => {}
        }

        emit(event);
    }
}

fn build_codex_command(
    binary: &Path,
    args: Vec<String>,
    prompt: String,
    vault_path: &str,
) -> std::process::Command {
    let mut command = crate::hidden_command(binary);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command
        .args(args)
        .arg(prompt)
        .current_dir(vault_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn build_codex_args(
    request: &AgentStreamRequest,
    last_message_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;

    let mut args = vec![
        "--sandbox".into(),
        codex_sandbox(request.permission_mode).into(),
        "--ask-for-approval".into(),
        codex_approval_policy(request.permission_mode).into(),
        "exec".into(),
        "--json".into(),
        "-C".into(),
        request.vault_path.clone(),
        "-c".into(),
        r#"mcp_servers.tolaria.command="node""#.into(),
        "-c".into(),
        format!(r#"mcp_servers.tolaria.args=["{}"]"#, mcp_server_path),
        "-c".into(),
        format!(
            r#"mcp_servers.tolaria.env={{VAULT_PATH="{}"}}"#,
            request.vault_path
        ),
    ];

    if let Some(path) = last_message_path {
        args.push("--output-last-message".into());
        args.push(path.to_string_lossy().into_owned());
    }

    Ok(args)
}

fn codex_sandbox(permission_mode: crate::ai_agents::AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        crate::ai_agents::AiAgentPermissionMode::Safe => "read-only",
        crate::ai_agents::AiAgentPermissionMode::PowerUser => "workspace-write",
    }
}

fn codex_approval_policy(permission_mode: crate::ai_agents::AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        crate::ai_agents::AiAgentPermissionMode::Safe => "untrusted",
        crate::ai_agents::AiAgentPermissionMode::PowerUser => "never",
    }
}

fn build_codex_prompt(request: &AgentStreamRequest) -> String {
    crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref())
}

fn codex_session_id(json: &serde_json::Value) -> Option<&str> {
    json["thread_id"].as_str()
}

fn dispatch_codex_event<F>(json: &serde_json::Value, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    match json["type"].as_str().unwrap_or_default() {
        "thread.started" => {
            if let Some(thread_id) = json["thread_id"].as_str() {
                emit(AiAgentStreamEvent::Init {
                    session_id: thread_id.to_string(),
                });
            }
        }
        "item.started" => emit_codex_item_event(json, false, emit),
        "item.completed" => emit_codex_item_event(json, true, emit),
        _ => {}
    }
}

fn emit_codex_item_event<F>(json: &serde_json::Value, completed: bool, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let item = &json["item"];
    let item_type = item["type"].as_str().unwrap_or_default();
    let item_id = item["id"].as_str().unwrap_or_default();

    match item_type {
        "command_execution" => {
            if completed {
                emit(AiAgentStreamEvent::ToolDone {
                    tool_id: item_id.to_string(),
                    output: item["aggregated_output"]
                        .as_str()
                        .map(|output| output.to_string()),
                });
            } else {
                emit(AiAgentStreamEvent::ToolStart {
                    tool_name: "Bash".into(),
                    tool_id: item_id.to_string(),
                    input: item["command"]
                        .as_str()
                        .map(|command| serde_json::json!({ "command": command }).to_string()),
                });
            }
        }
        "mcp_tool_call" => emit_codex_mcp_tool_event(item, item_id, completed, emit),
        "agent_message" if completed => {
            if let Some(text) = item["text"].as_str() {
                emit(AiAgentStreamEvent::TextDelta {
                    text: text.to_string(),
                });
            }
        }
        _ => {}
    }
}

fn emit_codex_mcp_tool_event<F>(
    item: &serde_json::Value,
    item_id: &str,
    completed: bool,
    emit: &mut F,
) where
    F: FnMut(AiAgentStreamEvent),
{
    if completed {
        emit(AiAgentStreamEvent::ToolDone {
            tool_id: item_id.to_string(),
            output: codex_tool_output(item),
        });
        return;
    }

    let tool_name = item["tool"].as_str().unwrap_or("MCP tool");
    let input = json_field_to_string(&item["arguments"]);
    emit(AiAgentStreamEvent::ToolStart {
        tool_name: tool_name.to_string(),
        tool_id: item_id.to_string(),
        input,
    });
}

fn codex_tool_output(item: &serde_json::Value) -> Option<String> {
    item["error"]["message"]
        .as_str()
        .map(|message| format!("Error: {message}"))
        .or_else(|| json_field_to_string(&item["result"]))
}

fn json_field_to_string(value: &serde_json::Value) -> Option<String> {
    if value.is_null() {
        None
    } else {
        value
            .as_str()
            .map(str::to_string)
            .or_else(|| Some(value.to_string()))
    }
}

fn read_codex_last_message(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn format_codex_error(stderr_output: String, status: String) -> String {
    let lower = stderr_output.to_ascii_lowercase();
    if is_codex_auth_error(&lower) {
        return "Codex CLI is not authenticated. Run `codex login` or launch `codex` in your terminal.".into();
    }

    if is_codex_write_permission_error(&lower) {
        return "Codex could not write to the active vault. Vault Safe uses a read-only Codex sandbox; switch to Power User for shell-backed local writes, or verify the selected vault folder is writable and retry. Writes outside the active vault remain blocked.".into();
    }

    if stderr_output.trim().is_empty() {
        format!("codex exited with status {status}")
    } else {
        stderr_output.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_codex_auth_error(lower: &str) -> bool {
    ["auth", "login", "sign in"]
        .iter()
        .any(|pattern| lower.contains(pattern))
}

fn is_codex_write_permission_error(lower: &str) -> bool {
    [
        "read-only sandbox",
        "writing is blocked",
        "rejected by user approval",
        "rejected by the environment",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_agents::AiAgentPermissionMode;
    use std::ffi::OsStr;

    #[cfg(unix)]
    fn executable_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join(name);
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn codex_request(
        vault_path: &Path,
        permission_mode: AiAgentPermissionMode,
    ) -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Summarize".into(),
            system_prompt: None,
            vault_path: vault_path.to_string_lossy().into_owned(),
            permission_mode,
        }
    }

    fn assert_codex_permission_contract(args: &[String], permission_mode: AiAgentPermissionMode) {
        let sandbox = codex_sandbox(permission_mode);
        let approval = codex_approval_policy(permission_mode);
        let prefix = ["--sandbox", sandbox, "--ask-for-approval", approval];

        assert_eq!(&args[..prefix.len()], prefix);
        assert!(!args.iter().any(|arg| arg == "danger-full-access"));
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox"));
    }

    #[cfg(unix)]
    fn run_codex_script(body: &str) -> (String, Vec<AiAgentStreamEvent>) {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(dir.path(), "codex", body);
        let mut events = Vec::new();
        let thread_id = run_agent_stream_with_binary(
            &binary,
            codex_request(vault.path(), AiAgentPermissionMode::Safe),
            |event| events.push(event),
        )
        .unwrap();

        (thread_id, events)
    }

    fn assert_codex_text_flow(events: &[AiAgentStreamEvent], session: &str, text_delta: &str) {
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id == session
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::TextDelta { text } if text == text_delta
        ));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[test]
    fn build_codex_prompt_keeps_system_prompt_first() {
        let prompt = build_codex_prompt(&AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: Some("Be concise".into()),
            vault_path: "/tmp/vault".into(),
            permission_mode: AiAgentPermissionMode::Safe,
        });

        assert!(prompt.starts_with("System instructions:\nBe concise"));
        assert!(prompt.contains("User request:\nRename the note"));
    }

    #[test]
    fn build_codex_args_uses_safe_default_permissions() {
        if let Ok(args) = build_codex_args(
            &AgentStreamRequest {
                message: "Rename the note".into(),
                system_prompt: None,
                vault_path: "/tmp/vault".into(),
                permission_mode: AiAgentPermissionMode::Safe,
            },
            None,
        ) {
            assert_eq!(args[4], "exec");
            assert_codex_permission_contract(&args, AiAgentPermissionMode::Safe);
            assert!(args.contains(&"--json".to_string()));
            assert!(args.contains(&"-C".to_string()));
        }
    }

    #[test]
    fn codex_power_user_keeps_workspace_write_without_dangerous_bypass() {
        if let Ok(args) = build_codex_args(
            &AgentStreamRequest {
                message: "Rename the note".into(),
                system_prompt: None,
                vault_path: "/tmp/vault".into(),
                permission_mode: AiAgentPermissionMode::PowerUser,
            },
            None,
        ) {
            assert_codex_permission_contract(&args, AiAgentPermissionMode::PowerUser);
        }
    }

    #[test]
    fn build_codex_args_can_request_last_message_output_file() {
        if let Ok(args) = build_codex_args(
            &AgentStreamRequest {
                message: "Rename the note".into(),
                system_prompt: None,
                vault_path: "/tmp/vault".into(),
                permission_mode: AiAgentPermissionMode::Safe,
            },
            Some(Path::new("/tmp/tolaria-codex-last-message.txt")),
        ) {
            assert!(args.windows(2).any(|window| window
                == [
                    "--output-last-message",
                    "/tmp/tolaria-codex-last-message.txt",
                ]));
        }
    }

    #[test]
    fn build_codex_command_keeps_agent_process_contract() {
        let binary = PathBuf::from("codex");
        let args = vec!["exec".to_string(), "--json".to_string()];
        let command = build_codex_command(&binary, args, "Summarize".into(), "/tmp/vault");
        let actual_args: Vec<&OsStr> = command.get_args().collect();

        assert_eq!(command.get_program(), OsStr::new("codex"));
        assert_eq!(
            actual_args,
            vec![
                OsStr::new("exec"),
                OsStr::new("--json"),
                OsStr::new("Summarize")
            ]
        );
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
    }

    #[test]
    fn build_codex_command_extends_path_with_resolved_homebrew_bin() {
        let binary = PathBuf::from("/opt/homebrew/bin/codex");
        let command = build_codex_command(
            &binary,
            vec!["exec".to_string(), "--json".to_string()],
            "Summarize".into(),
            "/tmp/vault",
        );
        let path_value = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("PATH"))
            .and_then(|(_, value)| value)
            .expect("PATH should be set");
        let paths = std::env::split_paths(path_value).collect::<Vec<_>>();

        assert!(
            paths.contains(&PathBuf::from("/opt/homebrew/bin")),
            "PATH should include the resolved Codex binary directory, got {paths:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_codex_agent_stream_reads_ndjson_and_returns_thread_id() {
        let (thread_id, events) = run_codex_script(
            r#"printf '%s\n' '{"type":"thread.started","thread_id":"thread_1"}'
printf '%s\n' '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Done"}}'
"#,
        );

        assert_eq!(thread_id, "thread_1");
        assert_codex_text_flow(&events, "thread_1", "Done");
    }

    #[cfg(unix)]
    #[test]
    fn run_codex_agent_stream_uses_last_message_file_when_stream_has_no_text() {
        let (thread_id, events) = run_codex_script(
            r#"last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
printf '%s\n' '{"type":"thread.started","thread_id":"thread_1"}'
printf '%s' 'Recovered final answer' > "$last_message"
"#,
        );

        assert_eq!(thread_id, "thread_1");
        assert_codex_text_flow(&events, "thread_1", "Recovered final answer");
    }

    #[cfg(unix)]
    #[test]
    fn run_codex_agent_stream_does_not_duplicate_last_message_file_after_text_event() {
        let (thread_id, events) = run_codex_script(
            r#"last_message=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    last_message="$1"
  fi
  shift
done
printf '%s\n' '{"type":"thread.started","thread_id":"thread_1"}'
printf '%s\n' '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Streamed answer"}}'
printf '%s' 'Recovered final answer' > "$last_message"
"#,
        );

        let text_events = events
            .iter()
            .filter(|event| matches!(event, AiAgentStreamEvent::TextDelta { .. }))
            .count();

        assert_eq!(thread_id, "thread_1");
        assert_eq!(text_events, 1);
        assert_codex_text_flow(&events, "thread_1", "Streamed answer");
    }

    #[cfg(unix)]
    #[test]
    fn run_codex_agent_stream_reports_nonzero_exit_errors() {
        let (thread_id, events) = run_codex_script(
            r#"printf '%s\n' '{"type":"thread.started","thread_id":"thread_1"}'
printf '%s\n' 'login required' >&2
exit 2
"#,
        );

        assert_eq!(thread_id, "thread_1");
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("not authenticated")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[test]
    fn codex_binary_candidates_include_supported_macos_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = codex_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/codex"),
            home.join(".codex/bin/codex"),
            home.join(".local/share/mise/shims/codex"),
            home.join(".asdf/shims/codex"),
            home.join(".npm-global/bin/codex"),
            home.join(".bun/bin/codex"),
            PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
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
    fn codex_binary_candidates_include_linuxbrew_installs() {
        let home = PathBuf::from("/home/alex");
        let candidates = codex_binary_candidates_for_home(&home);
        let expected = [
            home.join(".linuxbrew/bin/codex"),
            PathBuf::from("/home/linuxbrew/.linuxbrew/bin/codex"),
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
    fn codex_binary_candidates_include_windows_npm_and_toolchain_shims() {
        let home = PathBuf::from("C:/Users/alex");
        let candidates = codex_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/codex.exe"),
            home.join(".local/share/mise/shims/codex.exe"),
            home.join(".asdf/shims/codex.exe"),
            home.join(".npm-global/bin/codex.cmd"),
            home.join(".npm-global/bin/codex.exe"),
            home.join(".npm/bin/codex.cmd"),
            home.join(".npm/bin/codex.exe"),
            home.join("AppData/Roaming/npm/codex.cmd"),
            home.join("AppData/Roaming/npm/codex.exe"),
            home.join("AppData/Local/pnpm/codex.cmd"),
            home.join("AppData/Local/pnpm/codex.exe"),
            home.join("scoop/shims/codex.exe"),
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
    fn codex_binary_candidates_include_nvm_managed_node_installs() {
        let home = tempfile::tempdir().unwrap();
        let codex = home.path().join(".nvm/versions/node/v22.12.0/bin/codex");
        std::fs::create_dir_all(codex.parent().unwrap()).unwrap();
        std::fs::write(&codex, "#!/bin/sh\n").unwrap();

        let candidates = codex_binary_candidates_for_home(home.path());

        assert!(candidates.contains(&codex), "missing {}", codex.display());
    }

    #[cfg(unix)]
    #[test]
    fn usable_codex_binary_skips_broken_shims() {
        let dir = tempfile::tempdir().unwrap();
        let broken = executable_script(dir.path(), "broken-codex", "exit 1\n");
        let working = executable_script(dir.path(), "codex", "echo codex-cli 0.124.0-alpha.2\n");

        let found = find_usable_codex_binary(vec![broken, working.clone()]);

        assert_eq!(found, Some(working));
    }

    #[test]
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-codex");
        let codex = dir.path().join("codex");
        std::fs::write(&codex, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), codex.display());

        assert_eq!(first_existing_path(&stdout), Some(codex));
    }

    #[cfg(unix)]
    #[test]
    fn command_path_from_shell_finds_codex_from_login_shell() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let codex = dir.path().join("codex");
        std::fs::write(&codex, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o755)).unwrap();

        let shell = dir.path().join("shell");
        std::fs::write(
            &shell,
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"-lc\" ]; then echo '{}'; fi\n",
                codex.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(command_path_from_shell(&shell, "codex"), Some(codex));
    }

    #[test]
    fn dispatch_codex_command_events_maps_to_bash_events() {
        let mut events = Vec::new();
        let started = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_1",
                "type": "command_execution",
                "command": "/bin/zsh -lc pwd"
            }
        });
        let completed = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "command_execution",
                "aggregated_output": "/private/tmp\n"
            }
        });

        dispatch_codex_event(&started, &mut |event| events.push(event));
        dispatch_codex_event(&completed, &mut |event| events.push(event));

        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::ToolStart { tool_name, tool_id, .. }
                if tool_name == "Bash" && tool_id == "item_1"
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::ToolDone { tool_id, output }
                if tool_id == "item_1" && output.as_deref() == Some("/private/tmp\n")
        ));
    }

    #[test]
    fn dispatch_codex_mcp_tool_call_maps_to_tool_events() {
        let mut events = Vec::new();
        let started = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_1",
                "type": "mcp_tool_call",
                "server": "tolaria",
                "tool": "search_notes",
                "arguments": { "query": "meeting", "limit": 5 },
                "status": "in_progress"
            }
        });
        let completed = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "mcp_tool_call",
                "server": "tolaria",
                "tool": "search_notes",
                "arguments": { "query": "meeting", "limit": 5 },
                "result": [{ "title": "Meeting notes" }],
                "status": "completed"
            }
        });

        dispatch_codex_event(&started, &mut |event| events.push(event));
        dispatch_codex_event(&completed, &mut |event| events.push(event));

        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::ToolStart { tool_name, tool_id, input }
                if tool_name == "search_notes"
                    && tool_id == "item_1"
                    && input.as_deref().is_some_and(|value| value.contains("meeting"))
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::ToolDone { tool_id, output }
                if tool_id == "item_1"
                    && output.as_deref().is_some_and(|value| value.contains("Meeting notes"))
        ));
    }

    #[test]
    fn dispatch_codex_agent_message_maps_to_text_delta() {
        let mut events = Vec::new();
        let completed = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_2",
                "type": "agent_message",
                "text": "All set"
            }
        });

        dispatch_codex_event(&completed, &mut |event| events.push(event));

        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::TextDelta { text } if text == "All set"
        ));
    }

    #[test]
    fn format_codex_error_explains_vault_write_permission_failures() {
        let message = format_codex_error(
            "The patch was rejected by the environment: writing is blocked by read-only sandbox; rejected by user approval settings".into(),
            "exit status: 1".into(),
        );

        assert!(message.contains("active vault"));
        assert!(message.contains("writable"));
        assert!(message.contains("outside"));
    }
}
