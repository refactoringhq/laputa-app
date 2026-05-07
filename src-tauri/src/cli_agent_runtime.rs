use crate::ai_agents::{AiAgentPermissionMode, AiAgentStreamEvent};
use serde::Deserialize;
use std::ffi::OsString;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};

#[derive(Debug, Clone, Deserialize)]
pub struct AgentStreamRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
    pub permission_mode: AiAgentPermissionMode,
}

pub(crate) struct JsonLineRun {
    pub session_id: String,
    pub stderr_output: String,
    pub status: ExitStatus,
}

pub(crate) struct AgentCommandTarget {
    pub program: PathBuf,
    pub first_arg: Option<PathBuf>,
}

pub(crate) fn build_prompt(message: &str, system_prompt: Option<&str>) -> String {
    match system_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        Some(system_prompt) => {
            format!("System instructions:\n{system_prompt}\n\nUser request:\n{message}")
        }
        None => message.to_string(),
    }
}

pub(crate) fn mcp_server_path_string() -> Result<String, String> {
    Ok(crate::mcp::mcp_server_dir()?
        .join("index.js")
        .to_str()
        .ok_or("Invalid MCP server path")?
        .to_string())
}

pub(crate) fn version_for_binary(binary: &Path) -> Option<String> {
    let target = command_target_avoiding_windows_cmd_shim(binary).ok()?;
    let mut command = crate::hidden_command(&target.program);
    configure_agent_command_environment(&mut command, binary);
    if let Some(first_arg) = target.first_arg {
        command.arg(first_arg);
    }
    command
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn command_target_avoiding_windows_cmd_shim(
    binary: &Path,
) -> Result<AgentCommandTarget, String> {
    if is_windows_batch_shim(binary) {
        if let Some(script) = node_script_from_windows_cmd_shim(binary) {
            return Ok(AgentCommandTarget {
                program: crate::mcp::find_node()?,
                first_arg: Some(script),
            });
        }
    }

    Ok(AgentCommandTarget {
        program: binary.to_path_buf(),
        first_arg: None,
    })
}

pub(crate) fn configure_agent_command_environment(command: &mut Command, binary: &Path) {
    if let Some(path) = expanded_agent_path(binary) {
        command.env("PATH", path);
    }
}

fn expanded_agent_path(binary: &Path) -> Option<OsString> {
    let mut paths = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    for candidate in agent_path_candidates(binary) {
        push_unique_path(&mut paths, candidate);
    }

    std::env::join_paths(paths).ok()
}

fn agent_path_candidates(binary: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(parent) = binary
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        candidates.push(parent.to_path_buf());
    }

    if let Some(home) = dirs::home_dir() {
        candidates.extend([
            home.join(".local/bin"),
            home.join(".local/share/mise/shims"),
            home.join(".asdf/shims"),
            home.join(".npm-global/bin"),
            home.join(".npm/bin"),
            home.join(".bun/bin"),
            home.join(".linuxbrew/bin"),
            home.join("AppData/Roaming/npm"),
            home.join("AppData/Local/pnpm"),
            home.join("scoop/shims"),
        ]);
    }

    candidates.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ]);

    candidates
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if candidate.as_os_str().is_empty() {
        return;
    }
    if paths.iter().any(|path| path == &candidate) {
        return;
    }
    paths.push(candidate);
}

pub(crate) fn find_executable_binary_candidate(
    candidates: Vec<PathBuf>,
    agent_label: &str,
) -> Result<Option<PathBuf>, String> {
    let mut first_unusable_candidate = None;

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }

        if is_executable_file(&candidate) {
            return Ok(Some(candidate));
        }

        if first_unusable_candidate.is_none() {
            first_unusable_candidate = Some(candidate);
        }
    }

    match first_unusable_candidate {
        Some(candidate) => Err(format!(
            "{agent_label} binary found at {} but it is not executable. Fix the file permissions or reinstall the CLI.",
            candidate.display()
        )),
        None => Ok(None),
    }
}

fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::metadata(path)
            .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        path.is_file() && has_windows_cli_extension(path)
    }

    #[cfg(all(not(unix), not(windows)))]
    {
        path.is_file()
    }
}

pub(crate) fn has_windows_cli_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["bat", "cmd", "com", "exe"]
                .iter()
                .any(|expected| extension.eq_ignore_ascii_case(expected))
        })
}

fn is_windows_batch_shim(binary: &Path) -> bool {
    binary
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
}

fn node_script_from_windows_cmd_shim(binary: &Path) -> Option<PathBuf> {
    let contents = std::fs::read_to_string(binary).ok()?;
    contents
        .split('"')
        .skip(1)
        .step_by(2)
        .filter(|token| is_node_script_token(token))
        .find_map(|token| resolve_cmd_shim_script_path(binary, token))
}

fn is_node_script_token(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    (lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs"))
        && (lower.starts_with("%dp0%") || lower.starts_with("%~dp0"))
}

fn resolve_cmd_shim_script_path(binary: &Path, token: &str) -> Option<PathBuf> {
    let relative = token
        .strip_prefix("%dp0%")
        .or_else(|| token.strip_prefix("%~dp0"))?
        .trim_start_matches(['\\', '/']);
    let mut script = binary.parent()?.to_path_buf();
    for part in relative.split(['\\', '/']).filter(|part| !part.is_empty()) {
        script.push(part);
    }
    script.is_file().then_some(script)
}

pub(crate) fn parse_json_line(
    line: Result<String, std::io::Error>,
) -> Result<Option<serde_json::Value>, String> {
    let line = line.map_err(|error| format!("Read error: {error}"))?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(serde_json::from_str::<serde_json::Value>(trimmed).ok())
}

#[cfg(test)]
pub(crate) fn parse_ai_agent_json_line<F>(
    line: Result<String, std::io::Error>,
    emit: &mut F,
) -> Option<serde_json::Value>
where
    F: FnMut(AiAgentStreamEvent),
{
    match parse_json_line(line) {
        Ok(json) => json,
        Err(message) => {
            emit(AiAgentStreamEvent::Error { message });
            None
        }
    }
}

pub(crate) fn run_json_line_process<Event, F, H>(
    mut command: Command,
    process_name: &'static str,
    emit: &mut F,
    error_event: impl Fn(String) -> Event,
    mut handle_json: H,
) -> Result<JsonLineRun, String>
where
    F: FnMut(Event),
    H: FnMut(&serde_json::Value, &mut F, &mut String),
{
    let mut child = command
        .spawn()
        .map_err(|error| format_spawn_error(process_name, &error))?;
    let stdout = child.stdout.take().ok_or("No stdout handle")?;
    let reader = std::io::BufReader::new(stdout);
    let mut session_id = String::new();

    for line in reader.lines() {
        match parse_json_line(line) {
            Ok(Some(json)) => handle_json(&json, emit, &mut session_id),
            Ok(None) => {}
            Err(message) => {
                emit(error_event(message));
                break;
            }
        }
    }

    let stderr_output = child
        .stderr
        .take()
        .and_then(|stderr| std::io::read_to_string(stderr).ok())
        .unwrap_or_default();
    let status = child
        .wait()
        .map_err(|error| format!("Wait failed: {error}"))?;

    Ok(JsonLineRun {
        session_id,
        stderr_output,
        status,
    })
}

fn format_spawn_error(process_name: &str, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        return format!(
            "Failed to start {process_name}: the CLI or one of its runtime dependencies was not found. If it was installed with Homebrew, make sure /opt/homebrew/bin or /usr/local/bin contains the CLI and Node.js, then restart Tolaria. Details: {error}"
        );
    }

    format!("Failed to spawn {process_name}: {error}")
}

pub(crate) fn run_ai_agent_json_stream<F>(
    command: Command,
    process_name: &'static str,
    mut emit: F,
    session_id: impl Fn(&serde_json::Value) -> Option<&str>,
    dispatch_event: impl Fn(&serde_json::Value, &mut F),
    format_error: impl Fn(String, String) -> String,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let run = run_json_line_process(
        command,
        process_name,
        &mut emit,
        |message| AiAgentStreamEvent::Error { message },
        |json, emit, active_session_id| {
            if let Some(id) = session_id(json) {
                *active_session_id = id.to_string();
            }
            dispatch_event(json, emit);
        },
    )?;

    if !run.status.success() {
        emit(AiAgentStreamEvent::Error {
            message: format_error(run.stderr_output, run.status.to_string()),
        });
    }

    emit(AiAgentStreamEvent::Done);
    Ok(run.session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_keeps_system_prompt_first() {
        let prompt = build_prompt("Rename the note", Some("Be concise"));

        assert!(prompt.starts_with("System instructions:\nBe concise"));
        assert!(prompt.contains("User request:\nRename the note"));
    }

    #[test]
    fn build_prompt_skips_blank_system_prompt() {
        assert_eq!(
            build_prompt("Rename the note", Some("  ")),
            "Rename the note"
        );
    }

    #[test]
    fn parse_json_line_reports_read_errors_and_skips_blank_or_invalid_lines() {
        assert!(parse_json_line(Ok("   ".into())).unwrap().is_none());
        assert!(parse_json_line(Ok("not json".into())).unwrap().is_none());

        let error = parse_json_line(Err(std::io::Error::other("broken pipe"))).unwrap_err();
        assert!(error.contains("broken pipe"));
    }

    #[test]
    fn agent_command_environment_keeps_homebrew_shims_available() {
        let mut command = Command::new("/opt/homebrew/bin/codex");
        configure_agent_command_environment(&mut command, Path::new("/opt/homebrew/bin/codex"));
        let path = command
            .get_envs()
            .find(|(key, _)| *key == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, value)| value)
            .expect("PATH should be set");
        let paths = std::env::split_paths(path).collect::<Vec<_>>();

        assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(paths.contains(&PathBuf::from("/usr/local/bin")));
    }

    #[test]
    fn spawn_not_found_errors_explain_gui_path_runtime_dependencies() {
        let error = std::io::Error::new(std::io::ErrorKind::NotFound, "No such file or directory");
        let message = format_spawn_error("codex", &error);

        assert!(message.contains("Failed to start codex"));
        assert!(message.contains("/opt/homebrew/bin"));
        assert!(message.contains("Node.js"));
    }

    #[cfg(unix)]
    #[test]
    fn executable_binary_candidate_skips_unusable_file_when_later_candidate_works() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let unusable = dir.path().join("codex-unusable");
        let executable = dir.path().join("codex");
        std::fs::write(&unusable, "#!/bin/sh\n").unwrap();
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&unusable, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let found =
            find_executable_binary_candidate(vec![unusable, executable.clone()], "Codex CLI")
                .unwrap();

        assert_eq!(found, Some(executable));
    }

    #[cfg(unix)]
    #[test]
    fn executable_binary_candidate_reports_unusable_file_when_no_candidate_works() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let unusable = dir.path().join("opencode");
        std::fs::write(&unusable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&unusable, std::fs::Permissions::from_mode(0o644)).unwrap();

        let error =
            find_executable_binary_candidate(vec![unusable.clone()], "OpenCode CLI").unwrap_err();

        assert!(error.contains("OpenCode CLI binary found"));
        assert!(error.contains(&unusable.display().to_string()));
        assert!(error.contains("not executable"));
    }
}
