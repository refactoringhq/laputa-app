use crate::ai_agents::AiAgentPermissionMode;
use crate::cli_agent_runtime::AgentStreamRequest;
use std::path::Path;
use std::process::Stdio;

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
) -> Result<std::process::Command, String> {
    ensure_workspace_mcp_config(request)?;
    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command.args(&target.prefix_args);
    command
        .arg("-p")
        .arg(build_prompt(request))
        .arg("--add-dir")
        .arg(&request.vault_path)
        .arg(format!(
            "--sandbox={}",
            sandbox_enabled(request.permission_mode)
        ))
        .arg(format!(
            "--toolPermission={}",
            tool_permission(request.permission_mode)
        ))
        .env("NO_COLOR", "1")
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn build_prompt(request: &AgentStreamRequest) -> String {
    crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref())
}

fn sandbox_enabled(permission_mode: AiAgentPermissionMode) -> bool {
    permission_mode == AiAgentPermissionMode::Safe
}

fn tool_permission(permission_mode: AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        AiAgentPermissionMode::Safe => "proceed-in-sandbox",
        AiAgentPermissionMode::PowerUser => "always-proceed",
    }
}

fn ensure_workspace_mcp_config(request: &AgentStreamRequest) -> Result<(), String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    write_workspace_mcp_config(&request.vault_path, &request.vault_paths, &mcp_server_path)
}

fn write_workspace_mcp_config(
    vault_path: &str,
    vault_paths: &[String],
    mcp_server_path: &str,
) -> Result<(), String> {
    let config_dir = Path::new(vault_path).join(".agents");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create .agents directory: {e}"))?;

    let config_path = config_dir.join("mcp_config.json");
    let mut config = read_json_object(&config_path)?;
    let servers_value = config
        .as_object_mut()
        .ok_or("Invalid mcp_config.json: not an object")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    let servers = servers_value
        .as_object_mut()
        .ok_or("Invalid mcp_config.json: mcpServers is not an object")?;
    servers.insert(
        "tolaria".to_string(),
        crate::cli_agent_runtime::tolaria_node_mcp_server(
            mcp_server_path,
            vault_path,
            vault_paths,
            true,
        ),
    );

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize Antigravity MCP config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write .agents/mcp_config.json: {e}"))?;

    Ok(())
}

fn read_json_object(config_path: &Path) -> Result<serde_json::Value, String> {
    if !config_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let raw = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read .agents/mcp_config.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid .agents/mcp_config.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;

    fn request(vault_path: String, permission_mode: AiAgentPermissionMode) -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: None,
            vault_path,
            vault_paths: Vec::new(),
            permission_mode,
        }
    }

    #[test]
    fn command_uses_one_shot_prompt_and_workspace_mcp_config() {
        let vault = tempfile::tempdir().unwrap();
        let request = request(
            vault.path().to_string_lossy().into_owned(),
            AiAgentPermissionMode::Safe,
        );
        let command = build_command(&PathBuf::from("agy"), &request).unwrap();
        let args = command.get_args().collect::<Vec<_>>();

        assert_eq!(command.get_program(), OsStr::new("agy"));
        assert!(args
            .windows(2)
            .any(|pair| pair == [OsStr::new("-p"), OsStr::new("Rename the note")]));
        assert!(args
            .windows(2)
            .any(|pair| pair == [OsStr::new("--add-dir"), vault.path().as_os_str()]));
        assert!(!args.contains(&OsStr::new("--cwd")));
        assert!(args.contains(&OsStr::new("--sandbox=true")));
        assert!(args.contains(&OsStr::new("--toolPermission=proceed-in-sandbox")));
        assert_eq!(command.get_current_dir(), Some(vault.path()));
        assert!(vault
            .path()
            .join(".agents")
            .join("mcp_config.json")
            .exists());
    }

    #[test]
    fn power_user_command_allows_non_sandboxed_autonomy_without_skip_flag() {
        let vault = tempfile::tempdir().unwrap();
        let request = request(
            vault.path().to_string_lossy().into_owned(),
            AiAgentPermissionMode::PowerUser,
        );
        let command = build_command(&PathBuf::from("agy"), &request).unwrap();
        let args = command.get_args().collect::<Vec<_>>();

        assert!(args.contains(&OsStr::new("--sandbox=false")));
        assert!(args.contains(&OsStr::new("--toolPermission=always-proceed")));
        assert!(!args.contains(&OsStr::new("--dangerously-skip-permissions")));
    }

    #[test]
    fn workspace_mcp_config_preserves_other_servers() {
        let vault = tempfile::tempdir().unwrap();
        let config_path = vault.path().join(".agents").join("mcp_config.json");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::write(
            &config_path,
            serde_json::to_string(&serde_json::json!({
                "mcpServers": {
                    "other": { "command": "example" }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        write_workspace_mcp_config(vault.path().to_str().unwrap(), &[], "/mcp/index.js").unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();

        assert_eq!(config["mcpServers"]["other"]["command"], "example");
        assert_eq!(config["mcpServers"]["tolaria"]["command"], "node");
        assert_eq!(config["mcpServers"]["tolaria"]["env"]["WS_UI_PORT"], "9711");
    }

    #[test]
    fn workspace_mcp_config_rejects_non_object_servers() {
        let vault = tempfile::tempdir().unwrap();
        let config_path = vault.path().join(".agents").join("mcp_config.json");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::write(
            &config_path,
            serde_json::to_string(&serde_json::json!({ "mcpServers": [] })).unwrap(),
        )
        .unwrap();

        let error =
            write_workspace_mcp_config(vault.path().to_str().unwrap(), &[], "/mcp/index.js")
                .unwrap_err();

        assert!(error.contains("mcpServers is not an object"));
    }
}
