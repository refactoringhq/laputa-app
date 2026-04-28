use crate::ai_agents::AiAgentPermissionMode;
use crate::pi_cli::AgentStreamRequest;
use std::path::Path;
use std::process::Stdio;

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
    agent_dir: &Path,
) -> Result<std::process::Command, String> {
    write_mcp_config(agent_dir, &request.vault_path, request.permission_mode)?;

    let mut command = crate::hidden_command(binary);
    command
        .args(build_args())
        .arg(build_prompt(request))
        .env("PI_CODING_AGENT_DIR", agent_dir)
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn build_args() -> Vec<String> {
    vec![
        "--mode".into(),
        "json".into(),
        "--no-session".into(),
        "--extension".into(),
        "npm:pi-mcp-adapter".into(),
    ]
}

fn build_prompt(request: &AgentStreamRequest) -> String {
    match request
        .system_prompt
        .as_ref()
        .map(|prompt| prompt.trim())
        .filter(|prompt| !prompt.is_empty())
    {
        Some(system_prompt) => format!(
            "System instructions:\n{system_prompt}\n\nUser request:\n{}",
            request.message
        ),
        None => request.message.clone(),
    }
}

fn write_mcp_config(
    agent_dir: &Path,
    vault_path: &str,
    permission_mode: AiAgentPermissionMode,
) -> Result<(), String> {
    std::fs::create_dir_all(agent_dir)
        .map_err(|error| format!("Failed to create Pi agent directory: {error}"))?;
    let config = build_mcp_config(vault_path, permission_mode)?;
    std::fs::write(agent_dir.join("mcp.json"), config)
        .map_err(|error| format!("Failed to write Pi MCP config: {error}"))
}

fn build_mcp_config(
    vault_path: &str,
    _permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    let mcp_server = crate::mcp::mcp_server_dir()?.join("index.js");
    let mcp_server_path = mcp_server
        .to_str()
        .ok_or("Invalid MCP server path")?
        .to_string();

    serde_json::to_string(&serde_json::json!({
        "settings": {
            "toolPrefix": "none",
            "idleTimeout": 10
        },
        "mcpServers": {
            "tolaria": {
                "command": "node",
                "args": [mcp_server_path],
                "env": {
                    "VAULT_PATH": vault_path,
                    "WS_UI_PORT": "9711"
                },
                "lifecycle": "lazy",
                "directTools": true
            }
        }
    }))
    .map_err(|error| format!("Failed to serialize Pi MCP config: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;

    fn request() -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
            permission_mode: crate::ai_agents::AiAgentPermissionMode::Safe,
        }
    }

    #[test]
    fn args_use_documented_json_mode_with_mcp_adapter() {
        let args = build_args();

        assert_eq!(args[0], "--mode");
        assert_eq!(args[1], "json");
        assert!(args.contains(&"--no-session".to_string()));
        assert!(args.contains(&"--extension".to_string()));
        assert!(args.contains(&"npm:pi-mcp-adapter".to_string()));
        assert!(!args.contains(&"--no-tools".to_string()));
    }

    #[test]
    fn command_sets_vault_cwd_closed_stdin_and_config_dir() {
        let agent_dir = tempfile::tempdir().unwrap();
        let command = build_command(&PathBuf::from("pi"), &request(), agent_dir.path()).unwrap();
        let actual_args: Vec<&OsStr> = command.get_args().collect();
        let config_dir = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("PI_CODING_AGENT_DIR"))
            .and_then(|(_, value)| value);

        assert_eq!(command.get_program(), OsStr::new("pi"));
        assert_eq!(actual_args[0], OsStr::new("--mode"));
        assert_eq!(actual_args[1], OsStr::new("json"));
        assert_eq!(actual_args.last(), Some(&OsStr::new("Rename the note")));
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
        assert_eq!(config_dir, Some(agent_dir.path().as_os_str()));
        assert!(agent_dir.path().join("mcp.json").exists());
    }

    #[test]
    fn mcp_config_includes_tolaria_server_for_active_vault() {
        if let Ok(config) =
            build_mcp_config("/tmp/vault", crate::ai_agents::AiAgentPermissionMode::Safe)
        {
            let json: serde_json::Value = serde_json::from_str(&config).unwrap();
            assert_eq!(json["settings"]["toolPrefix"], "none");
            assert_eq!(json["mcpServers"]["tolaria"]["command"], "node");
            assert_eq!(json["mcpServers"]["tolaria"]["lifecycle"], "lazy");
            assert_eq!(json["mcpServers"]["tolaria"]["directTools"], true);
            assert_eq!(
                json["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
                "/tmp/vault"
            );
            assert_eq!(json["mcpServers"]["tolaria"]["env"]["WS_UI_PORT"], "9711");
            assert!(json["mcpServers"]["tolaria"]["args"][0]
                .as_str()
                .unwrap()
                .ends_with("index.js"));
        }
    }

    #[test]
    fn power_user_mode_uses_the_same_pi_mcp_config_as_safe_mode() {
        let safe =
            build_mcp_config("/tmp/vault", crate::ai_agents::AiAgentPermissionMode::Safe).unwrap();
        let power = build_mcp_config(
            "/tmp/vault",
            crate::ai_agents::AiAgentPermissionMode::PowerUser,
        )
        .unwrap();

        assert_eq!(safe, power);
    }

    #[test]
    fn prompt_keeps_system_prompt_first() {
        let prompt = build_prompt(&AgentStreamRequest {
            system_prompt: Some("Be concise".into()),
            ..request()
        });

        assert!(prompt.starts_with("System instructions:\nBe concise"));
        assert!(prompt.contains("User request:\nRename the note"));
    }
}
