use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use crate::cli_agent_runtime::{AgentStreamRequest, LineStreamProcess};
use std::path::Path;
use std::process::Stdio;

struct KiroMcpConfig<'a> {
    vault_path: &'a str,
    vault_paths: &'a [String],
    mcp_server_path: &'a str,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::kiro_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::kiro_discovery::find_binary()?;
    ensure_mcp_config(&request)?;
    let prompt =
        crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref());
    let command = build_kiro_command(&binary, Path::new(&request.vault_path))?;
    crate::cli_agent_runtime::run_ai_agent_line_stream(
        LineStreamProcess::new(command, "kiro-cli", "kiro").with_stdin(prompt),
        emit,
        format_kiro_error,
    )
}

fn build_kiro_command(binary: &Path, vault_path: &Path) -> Result<std::process::Command, String> {
    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command.args(&target.prefix_args);
    command
        .arg("chat")
        .arg("--no-interactive")
        .arg("--trust-all-tools")
        .current_dir(vault_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn ensure_mcp_config(request: &AgentStreamRequest) -> Result<(), String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    write_mcp_json(KiroMcpConfig {
        vault_path: &request.vault_path,
        vault_paths: &request.vault_paths,
        mcp_server_path: &mcp_server_path,
    })
}

fn write_mcp_json(config: KiroMcpConfig<'_>) -> Result<(), String> {
    let config_dir = Path::new(config.vault_path).join(".kiro").join("settings");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create .kiro/settings: {e}"))?;

    let config_path = config_dir.join("mcp.json");

    let mut json_config: serde_json::Value = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let servers = json_config
        .as_object_mut()
        .ok_or("Invalid mcp.json: not an object")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    let mut server = crate::cli_agent_runtime::tolaria_node_mcp_server(
        config.mcp_server_path,
        config.vault_path,
        config.vault_paths,
        true,
    );
    server["disabled"] = serde_json::json!(false);
    servers["tolaria"] = server;

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&json_config)
            .map_err(|e| format!("JSON serialize error: {e}"))?,
    )
    .map_err(|e| format!("Failed to write mcp.json: {e}"))?;

    Ok(())
}

fn format_kiro_error(stderr_output: &str, status: &str) -> String {
    if is_auth_error(stderr_output) {
        return "Kiro CLI is not authenticated. Run `kiro-cli login` in your terminal to sign in."
            .into();
    }
    if stderr_output.trim().is_empty() {
        format!("kiro-cli exited with status {status}")
    } else {
        stderr_output.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_auth_error(stderr_output: &str) -> bool {
    let lower = stderr_output.to_ascii_lowercase();
    ["auth", "login", "token"]
        .iter()
        .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_codes_removes_terminal_colors() {
        assert_eq!(
            crate::cli_agent_runtime::strip_ansi_codes("\x1b[38;5;141m>  \x1b[0mHello! \x1b[2K"),
            ">  Hello! "
        );
        assert_eq!(
            crate::cli_agent_runtime::strip_ansi_codes("plain text"),
            "plain text"
        );
    }

    #[test]
    fn format_kiro_error_detects_auth_errors() {
        let result = format_kiro_error("Error: auth token expired", "1");
        assert!(result.contains("kiro-cli login"));
    }

    #[test]
    fn format_kiro_error_returns_status_for_empty_stderr() {
        let result = format_kiro_error("", "1");
        assert!(result.contains("status 1"));
    }

    #[test]
    fn write_mcp_json_creates_config() {
        let dir = tempfile::tempdir().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        write_mcp_json(KiroMcpConfig {
            vault_path,
            vault_paths: &["/other/vault".into(), vault_path.into()],
            mcp_server_path: "/opt/mcp/index.js",
        })
        .unwrap();

        let config_path = dir.path().join(".kiro/settings/mcp.json");
        let content: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(content["mcpServers"]["tolaria"]["command"], "node");
        assert_eq!(
            content["mcpServers"]["tolaria"]["args"][0],
            "/opt/mcp/index.js"
        );
        assert_eq!(
            content["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
            vault_path
        );
        assert_eq!(
            content["mcpServers"]["tolaria"]["env"]["VAULT_PATHS"],
            serde_json::json!(serde_json::to_string(&vec![vault_path, "/other/vault"]).unwrap())
        );
        assert_eq!(
            content["mcpServers"]["tolaria"]["env"]["WS_UI_PORT"],
            "9711"
        );
    }

    #[test]
    fn write_mcp_json_merges_preserving_existing_servers() {
        let dir = tempfile::tempdir().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let config_dir = dir.path().join(".kiro/settings");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("mcp.json"),
            r#"{"mcpServers":{"other":{"command":"python","args":["server.py"]}}}"#,
        )
        .unwrap();

        write_mcp_json(KiroMcpConfig {
            vault_path,
            vault_paths: &[],
            mcp_server_path: "/new/index.js",
        })
        .unwrap();

        let content: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join(".kiro/settings/mcp.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(content["mcpServers"]["tolaria"]["args"][0], "/new/index.js");
        assert_eq!(content["mcpServers"]["other"]["command"], "python");
    }
}
