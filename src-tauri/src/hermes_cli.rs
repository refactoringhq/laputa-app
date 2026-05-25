use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use crate::cli_agent_runtime::AgentStreamRequest;
use regex::Regex;
use std::io::{BufRead, Read};
use std::path::Path;
use std::process::{ChildStderr, ChildStdout, Stdio};

struct HermesError<'a> {
    stderr_output: &'a str,
    status: String,
}

pub fn check_cli() -> AiAgentAvailability {
    crate::hermes_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::hermes_discovery::find_binary()?;
    let prompt =
        crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref());

    let mut child = spawn_hermes_process(&binary, Path::new(&request.vault_path), &prompt)?;
    let stderr_handle = read_stderr_async(child.stderr.take().ok_or("No stderr handle")?);

    let session_id = generate_session_id();
    emit(AiAgentStreamEvent::Init {
        session_id: session_id.clone(),
    });

    stream_stdout(child.stdout.take().ok_or("No stdout handle")?, &mut emit);

    let stderr_output = stderr_handle.join().unwrap_or_default();
    let status = child.wait().map_err(|e| format!("Wait failed: {e}"))?;
    if !status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_hermes_error(HermesError {
                stderr_output: &stderr_output,
                status: status.to_string(),
            }),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(session_id)
}

fn spawn_hermes_process(
    binary: &Path,
    vault_path: &Path,
    prompt: &str,
) -> Result<std::process::Child, String> {
    let mut command = crate::hidden_command(binary);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command
        .arg("chat")
        .arg("-q")
        .arg(prompt)
        .arg("-Q")
        .arg("--yolo")
        .arg("-t")
        .arg("terminal,file")
        .current_dir(vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
        .spawn()
        .map_err(|e| format!("Failed to spawn hermes: {e}"))
}

fn generate_session_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("hermes-{}-{}", std::process::id(), ts)
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

fn strip_ansi_codes(input: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
    re.replace_all(input, "").to_string()
}

fn format_hermes_error(error: HermesError<'_>) -> String {
    if error.stderr_output.trim().is_empty() {
        format!("hermes exited with status {}", error.status)
    } else {
        error
            .stderr_output
            .lines()
            .take(3)
            .collect::<Vec<_>>()
            .join("\n")
    }
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
    fn format_hermes_error_returns_status_for_empty_stderr() {
        let result = format_hermes_error(HermesError {
            stderr_output: "",
            status: "1".into(),
        });
        assert!(result.contains("status 1"));
    }
}
