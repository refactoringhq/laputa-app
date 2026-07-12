use crate::ai_agents::{AiAgentAvailability, AiAgentStreamEvent};
use crate::cli_agent_runtime::{AgentStreamRequest, LineStreamProcess};
use std::path::Path;

pub fn check_cli() -> AiAgentAvailability {
    crate::antigravity_discovery::check_cli()
}

pub fn run_agent_stream<F>(request: AgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let binary = crate::antigravity_discovery::find_binary()?;
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
    let command = crate::antigravity_config::build_command(binary, &request)?;
    crate::cli_agent_runtime::run_ai_agent_line_stream(
        LineStreamProcess::new(command, "agy", "antigravity"),
        emit,
        format_antigravity_error,
    )
}

fn format_antigravity_error(stderr_output: &str, status: &str) -> String {
    if is_auth_or_setup_error(stderr_output) {
        return "Antigravity CLI is not ready. Run `agy` in your terminal to finish install and sign-in, then retry in Tolaria.".into();
    }

    let stderr = stderr_output.trim();
    if stderr.is_empty() {
        format!("agy exited with status {status}")
    } else {
        stderr.lines().take(3).collect::<Vec<_>>().join("\n")
    }
}

fn is_auth_or_setup_error(stderr_output: &str) -> bool {
    let lower = stderr_output.to_ascii_lowercase();
    [
        "auth",
        "api key",
        "keyring",
        "login",
        "oauth",
        "sign in",
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

        let script = dir.join("agy");
        std::fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_maps_stdout_and_writes_workspace_mcp_config() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'Hello from Antigravity'
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

        assert!(session_id.starts_with("antigravity-"));
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::Init { session_id } if session_id.starts_with("antigravity-")
        ));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Hello from Antigravity\n"
        )));
        assert!(vault
            .path()
            .join(".agents")
            .join("mcp_config.json")
            .exists());
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_reports_antigravity_auth_errors() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"printf '%s\n' 'oauth login required' >&2
exit 3
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert!(session_id.starts_with("antigravity-"));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::Error { message } if message.contains("not ready")
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }

    #[cfg(unix)]
    #[test]
    fn run_agent_stream_uses_supported_antigravity_workspace_flag() {
        let dir = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let binary = executable_script(
            dir.path(),
            r#"seen_add_dir=false
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--cwd" ]; then
    printf '%s\n' 'flags provided but not defined: -cwd' >&2
    exit 2
  fi
  case "$1" in
    --toolPermission*)
      printf '%s\n' 'flags provided but not defined: -toolPermission' >&2
      exit 2
      ;;
    --sandbox=*)
      printf '%s\n' 'invalid boolean flag format: --sandbox=*' >&2
      exit 2
      ;;
  esac
  if [ "$1" = "--add-dir" ]; then
    seen_add_dir=true
    shift
  fi
  shift
done
if [ "$seen_add_dir" != "true" ]; then
  printf '%s\n' 'missing --add-dir workspace argument' >&2
  exit 3
fi
printf '%s\n' 'Antigravity accepted flags'
"#,
        );

        let mut events = Vec::new();
        let session_id = run_agent_stream_with_binary(
            &binary,
            request(vault.path().to_string_lossy().into_owned()),
            |event| events.push(event),
        )
        .unwrap();

        assert!(session_id.starts_with("antigravity-"));
        assert!(events.iter().any(|event| matches!(
            event,
            AiAgentStreamEvent::TextDelta { text } if text == "Antigravity accepted flags\n"
        )));
        assert!(matches!(events.last(), Some(AiAgentStreamEvent::Done)));
    }
}
