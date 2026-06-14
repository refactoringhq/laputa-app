use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use crate::cli_agent_runtime::AgentStreamRequest;
use regex::Regex;
use std::io::{BufRead, Read};
use std::path::Path;
use std::process::{ChildStderr, ChildStdout, Command, Stdio};

struct HermesProcessError {
    stderr_output: String,
    status: String,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::hermes_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::hermes_discovery::find_binary()?;
    run_agent_stream_with_binary(&binary, request, emit)
}

fn run_agent_stream_with_binary<F>(
    binary: &Path,
    request: AgentStreamRequest,
    mut emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let prompt =
        crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref());
    let mut child = build_hermes_command(binary, prompt, &request.vault_path)?
        .spawn()
        .map_err(|error| format!("Failed to spawn hermes: {error}"))?;
    let stderr_handle = read_stderr_async(child.stderr.take().ok_or("No stderr handle")?);
    let session_id = hermes_session_id();

    emit(AiAgentStreamEvent::Init {
        session_id: session_id.clone(),
    });
    stream_stdout(child.stdout.take().ok_or("No stdout handle")?, &mut emit);

    let stderr_output = stderr_handle.join().unwrap_or_default();
    let status = child
        .wait()
        .map_err(|error| format!("Wait failed: {error}"))?;
    if !status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_hermes_error(HermesProcessError {
                stderr_output,
                status: status.to_string(),
            }),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(session_id)
}

fn build_hermes_command(
    binary: &Path,
    prompt: String,
    vault_path: &str,
) -> Result<Command, String> {
    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    if let Some(first_arg) = target.first_arg {
        command.arg(first_arg);
    }
    command
        .arg("chat")
        .arg("--quiet")
        .arg("--source")
        .arg("tolaria")
        .arg("-q")
        .arg(prompt)
        .current_dir(vault_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn hermes_session_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("hermes-{}-{ts}", std::process::id())
}

fn stream_stdout<F>(stdout: ChildStdout, emit: &mut F)
where
    F: FnMut(AiAgentStreamEvent),
{
    let reader = std::io::BufReader::new(stdout);
    for line in reader.lines() {
        match line {
            Ok(line) => emit(AiAgentStreamEvent::TextDelta {
                text: format!("{}\n", strip_ansi_codes(&line)),
            }),
            Err(error) => {
                emit(AiAgentStreamEvent::Error {
                    message: format!("Read error: {error}"),
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

fn strip_ansi_codes(input: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
    re.replace_all(input, "").to_string()
}

fn format_hermes_error(error: HermesProcessError) -> String {
    if is_auth_or_setup_error(&error.stderr_output) {
        return "Hermes Agent is not ready. Run `hermes setup`, choose a model with `hermes model`, then run `hermes doctor` in your terminal before retrying in Tolaria.".into();
    }

    let stderr = error.stderr_output.trim();
    if stderr.is_empty() {
        format!("hermes exited with status {}", error.status)
    } else {
        stderr.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_auth_or_setup_error(stderr_output: &str) -> bool {
    let lower = stderr_output.to_ascii_lowercase();
    [
        "auth",
        "api key",
        "login",
        "model",
        "provider",
        "setup",
        "token",
        "unauthorized",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_agents::AiAgentPermissionMode;
    use std::path::PathBuf;

    fn request(vault_path: String) -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Summarize".into(),
            system_prompt: Some("Use Tolaria conventions".into()),
            vault_path,
            vault_paths: Vec::new(),
            permission_mode: AiAgentPermissionMode::Safe,
        }
    }

    #[cfg(unix)]
    fn executable_script(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("hermes");
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[test]
    fn build_hermes_command_uses_quiet_chat_query() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("hermes");
        let command = build_hermes_command(&binary, "Prompt".into(), "/tmp/vault").unwrap();
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            ["chat", "--quiet", "--source", "tolaria", "-q", "Prompt"]
        );
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_maps_hermes_stdout() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'Hello from Hermes'
printf '%s\n' 'Second line'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert!(session_id.starts_with("hermes-"));
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id.starts_with("hermes-")
        ));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Hello from Hermes\n"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Second line\n"
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_hermes_setup_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'provider api key missing' >&2
exit 2
"#,
        );

        let mut events = Vec::new();
        run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("hermes setup")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[test]
    fn format_hermes_error_returns_status_for_empty_stderr() {
        let result = format_hermes_error(HermesProcessError {
            stderr_output: String::new(),
            status: "1".into(),
        });

        assert!(result.contains("status 1"));
    }

    #[test]
    fn strip_ansi_codes_removes_terminal_colors() {
        assert_eq!(strip_ansi_codes("\x1b[32mHermes\x1b[0m"), "Hermes");
    }
}
