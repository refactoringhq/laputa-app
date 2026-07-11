use crate::ai_agents::{AiAgentAvailability, AiAgentPermissionMode, AiAgentStreamEvent};
use crate::cli_agent_runtime::{AgentStreamRequest, LineStreamProcess};
use std::path::Path;
use std::process::{Command, Stdio};

struct CopilotCommandSpec {
    prompt: String,
    mcp_config: String,
    vault_path: String,
    permission_mode: AiAgentPermissionMode,
}

struct CopilotMcpConfigInput<'a> {
    request: &'a AgentStreamRequest,
    mcp_server_path: &'a str,
    node_command: &'a str,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::copilot_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::copilot_discovery::find_binary()?;
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
    let mcp_config = build_copilot_mcp_config(&request)?;
    let spec = command_spec(request, mcp_config);
    run_agent_stream_with_spec(binary, spec, emit)
}

fn command_spec(request: AgentStreamRequest, mcp_config: String) -> CopilotCommandSpec {
    let prompt =
        crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref());
    CopilotCommandSpec {
        prompt,
        mcp_config,
        vault_path: request.vault_path,
        permission_mode: request.permission_mode,
    }
}

fn run_agent_stream_with_spec<F>(
    binary: &Path,
    spec: CopilotCommandSpec,
    emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let command = build_copilot_command(binary, spec)?;
    crate::cli_agent_runtime::run_ai_agent_line_stream(
        LineStreamProcess::new(command, "copilot", "copilot"),
        emit,
        format_copilot_error,
    )
}

fn build_copilot_command(binary: &Path, spec: CopilotCommandSpec) -> Result<Command, String> {
    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command.args(&target.prefix_args);
    command
        .args(build_copilot_args(&spec))
        .current_dir(spec.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn build_copilot_args(spec: &CopilotCommandSpec) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        spec.prompt.clone(),
        "-s".into(),
        "--no-ask-user".into(),
        "--additional-mcp-config".into(),
        spec.mcp_config.clone(),
    ];
    append_permission_args(&mut args, spec.permission_mode);
    args
}

fn append_permission_args(args: &mut Vec<String>, permission_mode: AiAgentPermissionMode) {
    match permission_mode {
        AiAgentPermissionMode::Safe => {
            args.push("--available-tools=write,tolaria".into());
            args.push("--allow-tool=write,tolaria".into());
            args.push("--deny-tool=shell".into());
        }
        AiAgentPermissionMode::PowerUser => args.push("--allow-all-tools".into()),
    }
}

fn build_copilot_mcp_config(request: &AgentStreamRequest) -> Result<String, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    let node_path = crate::mcp::find_node()?;
    let node_command = node_path.to_string_lossy();
    copilot_mcp_config_json(CopilotMcpConfigInput {
        request,
        mcp_server_path: &mcp_server_path,
        node_command: node_command.as_ref(),
    })
}

fn copilot_mcp_config_json(input: CopilotMcpConfigInput<'_>) -> Result<String, String> {
    let mut server = crate::cli_agent_runtime::tolaria_node_mcp_server(
        input.mcp_server_path,
        &input.request.vault_path,
        &input.request.vault_paths,
        true,
    );
    server["type"] = serde_json::json!("stdio");
    server["tools"] = serde_json::json!(["*"]);
    server["command"] = serde_json::json!(input.node_command);

    let config = serde_json::json!({
        "mcpServers": {
            "tolaria": server
        }
    });
    serde_json::to_string(&config)
        .map_err(|error| format!("Failed to serialise MCP config: {error}"))
}

fn format_copilot_error(stderr_output: &str, status: &str) -> String {
    if is_auth_or_setup_error(stderr_output) {
        return "GitHub Copilot CLI is not ready. Run `copilot login` in your terminal, then run `copilot` from this vault folder and trust it before retrying in Tolaria.".into();
    }

    let stderr = stderr_output.trim();
    if stderr.is_empty() {
        format!("copilot exited with status {status}")
    } else {
        stderr.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_auth_or_setup_error(stderr_output: &str) -> bool {
    let lower = stderr_output.to_ascii_lowercase();
    [
        "auth",
        "login",
        "oauth",
        "policy",
        "sign in",
        "subscription",
        "token",
        "trust",
        "unauthorized",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn spec(permission_mode: AiAgentPermissionMode) -> CopilotCommandSpec {
        CopilotCommandSpec {
            prompt: "Prompt".into(),
            mcp_config: r#"{"mcpServers":{"tolaria":{}}}"#.into(),
            vault_path: "/tmp/vault".into(),
            permission_mode,
        }
    }

    fn request(vault_path: String, permission_mode: AiAgentPermissionMode) -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Summarize".into(),
            system_prompt: Some("Use Tolaria conventions".into()),
            vault_path,
            vault_paths: vec!["/team-vault".into()],
            permission_mode,
        }
    }

    #[cfg(unix)]
    fn executable_script(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("copilot");
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[test]
    fn build_copilot_command_uses_programmatic_prompt_and_safe_tools() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("copilot");
        let command = build_copilot_command(&binary, spec(AiAgentPermissionMode::Safe)).unwrap();
        let actual_args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
        assert_eq!(command.get_program(), binary.as_os_str());
        assert!(actual_args
            .windows(2)
            .any(|window| window == ["-p", "Prompt"]));
        assert!(actual_args.contains(&"-s".to_string()));
        assert!(actual_args.contains(&"--no-ask-user".to_string()));
        assert!(actual_args.contains(&"--available-tools=write,tolaria".to_string()));
        assert!(actual_args.contains(&"--allow-tool=write,tolaria".to_string()));
        assert!(actual_args.contains(&"--deny-tool=shell".to_string()));
        assert!(!actual_args
            .iter()
            .any(|arg| arg == "--allow-all" || arg == "--yolo"));
    }

    #[test]
    fn build_copilot_args_uses_power_user_without_path_bypass() {
        let args = build_copilot_args(&spec(AiAgentPermissionMode::PowerUser));

        assert!(args.contains(&"--allow-all-tools".to_string()));
        assert!(!args.iter().any(|arg| {
            matches!(
                arg.as_str(),
                "--allow-all" | "--yolo" | "--allow-all-paths" | "--allow-all-urls"
            )
        }));
    }

    #[test]
    fn copilot_mcp_config_uses_tolaria_stdio_server() {
        let request = request("/tmp/vault".into(), AiAgentPermissionMode::Safe);
        let config = copilot_mcp_config_json(CopilotMcpConfigInput {
            request: &request,
            mcp_server_path: "/opt/tolaria/mcp-server/index.js",
            node_command: "/usr/local/bin/node",
        })
        .unwrap();
        let json: serde_json::Value = serde_json::from_str(&config).unwrap();
        let server = &json["mcpServers"]["tolaria"];

        assert_eq!(server["type"], "stdio");
        assert_eq!(server["command"], "/usr/local/bin/node");
        assert_eq!(server["args"][0], "/opt/tolaria/mcp-server/index.js");
        assert_eq!(server["tools"][0], "*");
        assert_eq!(server["env"]["VAULT_PATH"], "/tmp/vault");
        assert_eq!(server["env"]["WS_UI_PORT"], "9711");
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_maps_copilot_stdout() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'Hello from Copilot'
printf '%s\n' 'Second line'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_spec(
            &binary,
            CopilotCommandSpec {
                vault_path: vault.path().to_string_lossy().into_owned(),
                ..spec(AiAgentPermissionMode::Safe)
            },
            |event| events.push(event),
        )
        .unwrap();

        assert!(session_id.starts_with("copilot-"));
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id.starts_with("copilot-")
        ));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Hello from Copilot\n"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Second line\n"
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_copilot_auth_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'login required' >&2
exit 2
"#,
        );

        let mut events = Vec::new();
        run_agent_stream_with_spec(
            &binary,
            CopilotCommandSpec {
                vault_path: vault.path().to_string_lossy().into_owned(),
                ..spec(AiAgentPermissionMode::Safe)
            },
            |event| events.push(event),
        )
        .unwrap();

        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("copilot login")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
