use crate::ai_agents::AiAgentPermissionMode;
use crate::gemini_cli::AgentStreamRequest;
use std::path::{Path, PathBuf};
use std::process::Stdio;

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
    settings_dir: &Path,
) -> Result<std::process::Command, String> {
    let settings_path = write_settings(settings_dir, &request.vault_path, request.permission_mode)?;
    let mut command = crate::hidden_command(binary);
    command
        .args(build_args(request.permission_mode))
        .arg("--prompt")
        .arg(build_prompt(request))
        .env("GEMINI_CLI_SYSTEM_SETTINGS_PATH", settings_path)
        .env("NO_COLOR", "1")
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn build_args(permission_mode: AiAgentPermissionMode) -> Vec<String> {
    vec![
        "--output-format".into(),
        "json".into(),
        "--approval-mode".into(),
        approval_mode(permission_mode).into(),
    ]
}

fn approval_mode(permission_mode: AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        AiAgentPermissionMode::Safe => "auto_edit",
        AiAgentPermissionMode::PowerUser => "yolo",
    }
}

fn build_prompt(request: &AgentStreamRequest) -> String {
    crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref())
}

fn write_settings(
    settings_dir: &Path,
    vault_path: &str,
    permission_mode: AiAgentPermissionMode,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(settings_dir)
        .map_err(|error| format!("Failed to create Gemini settings directory: {error}"))?;
    let settings_path = settings_dir.join("settings.json");
    let settings = build_settings(vault_path, permission_mode)?;
    std::fs::write(&settings_path, settings)
        .map_err(|error| format!("Failed to write Gemini settings: {error}"))?;
    Ok(settings_path)
}

fn build_settings(
    vault_path: &str,
    permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    let mut settings = serde_json::json!({
        "mcpServers": {
            "tolaria": {
                "command": "node",
                "args": [mcp_server_path],
                "env": {
                    "VAULT_PATH": vault_path,
                    "WS_UI_PORT": "9711"
                },
                "description": "Tolaria active vault MCP server",
                "trust": permission_mode == AiAgentPermissionMode::PowerUser
            }
        }
    });

    if permission_mode == AiAgentPermissionMode::Safe {
        settings["tools"] = serde_json::json!({
            "exclude": ["run_shell_command"]
        });
    }

    serde_json::to_string(&settings)
        .map_err(|error| format!("Failed to serialize Gemini settings: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn request() -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
            permission_mode: AiAgentPermissionMode::Safe,
        }
    }

    #[test]
    fn command_uses_headless_json_mode_and_temp_settings() {
        let settings_dir = tempfile::tempdir().unwrap();
        let command =
            build_command(&PathBuf::from("gemini"), &request(), settings_dir.path()).unwrap();
        let actual_args: Vec<&OsStr> = command.get_args().collect();
        let settings_path = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("GEMINI_CLI_SYSTEM_SETTINGS_PATH"))
            .and_then(|(_, value)| value);

        assert_eq!(command.get_program(), OsStr::new("gemini"));
        assert_eq!(actual_args[0], OsStr::new("--output-format"));
        assert_eq!(actual_args[1], OsStr::new("json"));
        assert!(actual_args.contains(&OsStr::new("--prompt")));
        assert_eq!(actual_args.last(), Some(&OsStr::new("Rename the note")));
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
        assert!(settings_path.is_some());
        assert!(settings_dir.path().join("settings.json").exists());
    }

    #[test]
    fn safe_settings_include_tolaria_mcp_and_exclude_shell() {
        let settings = build_settings("/tmp/vault", AiAgentPermissionMode::Safe).unwrap();
        let json: serde_json::Value = serde_json::from_str(&settings).unwrap();

        assert_eq!(json["mcpServers"]["tolaria"]["command"], "node");
        assert_eq!(
            json["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
            "/tmp/vault"
        );
        assert_eq!(json["mcpServers"]["tolaria"]["env"]["WS_UI_PORT"], "9711");
        assert_eq!(json["mcpServers"]["tolaria"]["trust"], false);
        assert_eq!(json["tools"]["exclude"][0], "run_shell_command");
        assert!(json["mcpServers"]["tolaria"]["args"][0]
            .as_str()
            .unwrap()
            .ends_with("index.js"));
    }

    #[test]
    fn power_user_settings_trust_tolaria_and_allow_shell_discovery() {
        let settings = build_settings("/tmp/vault", AiAgentPermissionMode::PowerUser).unwrap();
        let json: serde_json::Value = serde_json::from_str(&settings).unwrap();

        assert_eq!(json["mcpServers"]["tolaria"]["trust"], true);
        assert!(json.get("tools").is_none());
        assert_eq!(approval_mode(AiAgentPermissionMode::PowerUser), "yolo");
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
