use crate::ai_agents::AiAgentPermissionMode;
use crate::opencode_cli::AgentStreamRequest;
use std::path::Path;
use std::process::Stdio;

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
) -> Result<std::process::Command, String> {
    let mut command = crate::hidden_command(binary);
    command
        .args(build_args())
        .arg(build_prompt(request))
        .env(
            "OPENCODE_CONFIG_CONTENT",
            build_config(&request.vault_path, request.permission_mode)?,
        )
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn build_args() -> Vec<String> {
    vec!["run".into(), "--format".into(), "json".into()]
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

fn build_config(
    vault_path: &str,
    permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    let mcp_server = crate::mcp::mcp_server_dir()?.join("index.js");
    let mcp_server_path = mcp_server
        .to_str()
        .ok_or("Invalid MCP server path")?
        .to_string();

    serde_json::to_string(&serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "permission": permission_config(permission_mode),
        "mcp": {
            "tolaria": {
                "type": "local",
                "command": ["node", mcp_server_path],
                "environment": { "VAULT_PATH": vault_path },
                "enabled": true
            }
        }
    }))
    .map_err(|error| format!("Failed to serialize opencode config: {error}"))
}

fn permission_config(permission_mode: AiAgentPermissionMode) -> serde_json::Value {
    let bash_permission = match permission_mode {
        AiAgentPermissionMode::Safe => "deny",
        AiAgentPermissionMode::PowerUser => "allow",
    };

    serde_json::json!({
        "read": "allow",
        "edit": "allow",
        "glob": "allow",
        "grep": "allow",
        "list": "allow",
        "external_directory": "deny",
        "bash": bash_permission
    })
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
    fn args_use_documented_safe_run_mode() {
        let args = build_args();

        assert_eq!(args, vec!["run", "--format", "json"]);
        assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(!args.contains(&"--dir".to_string()));
        assert!(!args.contains(&"--thinking".to_string()));
    }

    #[test]
    fn command_sets_vault_cwd_and_mcp_config() {
        let command = build_command(&PathBuf::from("opencode"), &request()).unwrap();
        let actual_args: Vec<&OsStr> = command.get_args().collect();
        let config_value = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("OPENCODE_CONFIG_CONTENT"))
            .and_then(|(_, value)| value);

        assert_eq!(command.get_program(), OsStr::new("opencode"));
        assert_eq!(actual_args[0], OsStr::new("run"));
        assert_eq!(actual_args[1], OsStr::new("--format"));
        assert_eq!(actual_args[2], OsStr::new("json"));
        assert_eq!(actual_args.last(), Some(&OsStr::new("Rename the note")));
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
        assert!(config_value.is_some());
    }

    #[test]
    fn config_includes_permissions_and_tolaria_mcp_server() {
        if let Ok(config) =
            build_config("/tmp/vault", crate::ai_agents::AiAgentPermissionMode::Safe)
        {
            let json: serde_json::Value = serde_json::from_str(&config).unwrap();
            assert_eq!(json["permission"]["edit"], "allow");
            assert_eq!(json["permission"]["external_directory"], "deny");
            assert_eq!(json["permission"]["bash"], "deny");
            assert_eq!(json["mcp"]["tolaria"]["type"], "local");
            assert_eq!(json["mcp"]["tolaria"]["command"][0], "node");
            assert_eq!(
                json["mcp"]["tolaria"]["environment"]["VAULT_PATH"],
                "/tmp/vault"
            );
            assert!(json["mcp"]["tolaria"]["command"][1]
                .as_str()
                .unwrap()
                .ends_with("index.js"));
        }
    }

    #[test]
    fn power_user_config_allows_bash_but_keeps_external_directories_denied() {
        if let Ok(config) = build_config(
            "/tmp/vault",
            crate::ai_agents::AiAgentPermissionMode::PowerUser,
        ) {
            let json: serde_json::Value = serde_json::from_str(&config).unwrap();
            assert_eq!(json["permission"]["bash"], "allow");
            assert_eq!(json["permission"]["external_directory"], "deny");
        }
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
