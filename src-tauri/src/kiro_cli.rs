use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use crate::cli_agent_runtime::AgentStreamRequest;
use regex::Regex;
use std::io::{BufRead, Read, Write};
use std::path::Path;
use std::process::{ChildStderr, ChildStdin, ChildStdout, Stdio};

struct KiroMcpConfig<'a> {
    vault_path: &'a str,
    vault_paths: &'a [String],
    mcp_server_path: &'a str,
}

struct KiroError<'a> {
    stderr_output: &'a str,
    status: String,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::kiro_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::kiro_discovery::find_binary()?;
    ensure_mcp_config(&request)?;
    let prompt =
        crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref());

    let mut child = spawn_kiro_process(&binary, Path::new(&request.vault_path))?;
    let prompt_handle = write_prompt_async(
        child.stdin.take().ok_or("No stdin handle")?,
        prompt.into_bytes(),
    );
    let stderr_handle = read_stderr_async(child.stderr.take().ok_or("No stderr handle")?);

    let session_id = generate_session_id();
    emit(AiAgentStreamEvent::Init {
        session_id: session_id.clone(),
    });

    stream_stdout(child.stdout.take().ok_or("No stdout handle")?, &mut emit);

    let mut stderr_output = stderr_handle.join().unwrap_or_default();
    if let Some(error) = prompt_write_error(prompt_handle) {
        append_stderr_line(&mut stderr_output, error);
    }
    let status = child.wait().map_err(|e| format!("Wait failed: {e}"))?;
    if !status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_kiro_error(KiroError {
                stderr_output: &stderr_output,
                status: status.to_string(),
            }),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(session_id)
}

fn spawn_kiro_process(binary: &Path, vault_path: &Path) -> Result<std::process::Child, String> {
    let mut command = crate::hidden_command(binary);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command
        .arg("chat")
        .arg("--no-interactive")
        .arg("--trust-all-tools")
        .current_dir(vault_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|e| format!("Failed to spawn kiro-cli: {e}"))
}

fn write_prompt_async(
    mut stdin: ChildStdin,
    prompt: Vec<u8>,
) -> std::thread::JoinHandle<Result<(), String>> {
    std::thread::spawn(move || {
        stdin
            .write_all(&prompt)
            .map_err(|e| format!("Failed to write kiro-cli stdin: {e}"))
    })
}

fn generate_session_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("kiro-{}-{}", std::process::id(), ts)
}

fn stream_stdout<F>(stdout: ChildStdout, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines() {
        match line {
            Ok(l) if !l.is_empty() => {
                emit(AiAgentStreamEvent::TextDelta {
                    text: format!("{}\n", strip_ansi_codes(&l)),
                });
            }
            Ok(_) => {
                emit(AiAgentStreamEvent::TextDelta {
                    text: "\n".to_string(),
                });
            }
            Err(e) => {
                emit(AiAgentStreamEvent::Error {
                    message: format!("Read error: {e}"),
                });
                break;
            }
        }
    }
}

fn read_stderr_async(mut stderr: ChildStderr) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output);
        output
    })
}

fn prompt_write_error(handle: std::thread::JoinHandle<Result<(), String>>) -> Option<String> {
    match handle.join() {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("Failed to write kiro-cli stdin: writer thread panicked".into()),
    }
}

fn append_stderr_line(stderr_output: &mut String, line: impl AsRef<str>) {
    if !stderr_output.is_empty() {
        stderr_output.push('\n');
    }
    stderr_output.push_str(line.as_ref());
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

    let active_vault_paths =
        crate::cli_agent_runtime::active_vault_paths_json(config.vault_path, config.vault_paths);
    servers["tolaria"] = serde_json::json!({
        "command": "node",
        "args": [config.mcp_server_path],
        "env": {
            "VAULT_PATH": config.vault_path,
            "VAULT_PATHS": active_vault_paths,
            "WS_UI_PORT": "9711"
        },
        "disabled": false
    });

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&json_config)
            .map_err(|e| format!("JSON serialize error: {e}"))?,
    )
    .map_err(|e| format!("Failed to write mcp.json: {e}"))?;

    Ok(())
}

fn strip_ansi_codes(input: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
    re.replace_all(input, "").to_string()
}

fn format_kiro_error(error: KiroError<'_>) -> String {
    if is_auth_error(error.stderr_output) {
        return "Kiro CLI is not authenticated. Run `kiro-cli login` in your terminal to sign in."
            .into();
    }
    if error.stderr_output.trim().is_empty() {
        format!("kiro-cli exited with status {}", error.status)
    } else {
        error
            .stderr_output
            .lines()
            .take(3)
            .collect::<Vec<_>>()
            .join("\n")
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
            strip_ansi_codes("\x1b[38;5;141m>  \x1b[0mHello! \x1b[2K"),
            ">  Hello! "
        );
        assert_eq!(strip_ansi_codes("plain text"), "plain text");
    }

    #[test]
    fn format_kiro_error_detects_auth_errors() {
        let result = format_kiro_error(KiroError {
            stderr_output: "Error: auth token expired",
            status: "1".into(),
        });
        assert!(result.contains("kiro-cli login"));
    }

    #[test]
    fn format_kiro_error_returns_status_for_empty_stderr() {
        let result = format_kiro_error(KiroError {
            stderr_output: "",
            status: "1".into(),
        });
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
