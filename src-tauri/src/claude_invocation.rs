use crate::ai_agents::AiAgentPermissionMode;
use crate::claude_cli::ChatStreamRequest;
use crate::cli_agent_runtime::AgentStreamRequest;

const CLAUDE_SAFE_AGENT_TOOLS: &str = "Read,Edit,MultiEdit,Write,Glob,Grep,LS";
const CLAUDE_POWER_USER_AGENT_TOOLS: &str = "Read,Edit,MultiEdit,Write,Glob,Grep,LS,Bash";
const CLAUDE_CHAT_DISALLOWED_TOOLS_COMPAT: &str =
    "Bash,Glob,Grep,Read,Edit,Write,NotebookEdit,WebFetch,WebSearch,TodoWrite,Task,MultiEdit,LS";
const CLAUDE_SAFE_DISALLOWED_TOOLS_COMPAT: &str =
    "Bash,NotebookEdit,WebFetch,WebSearch,TodoWrite,Task";
const CLAUDE_POWER_USER_DISALLOWED_TOOLS_COMPAT: &str =
    "NotebookEdit,WebFetch,WebSearch,TodoWrite,Task";
const WINDOWS_COMMAND_LINE_STDIN_THRESHOLD: usize = 24 * 1024;

#[derive(Debug)]
pub(crate) struct ClaudeInvocation {
    pub(crate) args: Vec<String>,
    pub(crate) fallback_args: Vec<Vec<String>>,
    pub(crate) stdin_text: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PromptSource {
    Argument,
    Stdin,
}

pub(crate) fn chat(req: &ChatStreamRequest) -> ClaudeInvocation {
    chat_with_windows_limit(req, cfg!(windows))
}

pub(crate) fn agent(req: &AgentStreamRequest) -> Result<ClaudeInvocation, String> {
    agent_with_windows_limit(req, cfg!(windows))
}

fn chat_with_windows_limit(
    req: &ChatStreamRequest,
    enforce_windows_limit: bool,
) -> ClaudeInvocation {
    let args = chat_args(req);
    let fallback_args = vec![chat_args_compat(req)];
    if should_pipe_prompt_for_windows(enforce_windows_limit, &args, &fallback_args) {
        return ClaudeInvocation {
            args: chat_args_with_tool_policy(req, "--tools", String::new(), PromptSource::Stdin),
            fallback_args: vec![chat_args_with_tool_policy(
                req,
                "--disallowedTools",
                CLAUDE_CHAT_DISALLOWED_TOOLS_COMPAT.into(),
                PromptSource::Stdin,
            )],
            stdin_text: Some(stdin_prompt(&req.message, req.system_prompt.as_deref())),
        };
    }

    ClaudeInvocation {
        args,
        fallback_args,
        stdin_text: None,
    }
}

fn agent_with_windows_limit(
    req: &AgentStreamRequest,
    enforce_windows_limit: bool,
) -> Result<ClaudeInvocation, String> {
    let args = agent_args(req)?;
    let fallback_args = vec![
        agent_args_without_session_persistence(req)?,
        agent_args_compat(req)?,
    ];
    if should_pipe_prompt_for_windows(enforce_windows_limit, &args, &fallback_args) {
        return Ok(ClaudeInvocation {
            args: agent_args_with_tool_policy(
                req,
                AgentToolPolicy::strict(req.permission_mode),
                PromptSource::Stdin,
            )?,
            fallback_args: vec![
                agent_args_with_tool_policy(
                    req,
                    AgentToolPolicy::strict_without_session_persistence(req.permission_mode),
                    PromptSource::Stdin,
                )?,
                agent_args_with_tool_policy(
                    req,
                    AgentToolPolicy::compat(req.permission_mode),
                    PromptSource::Stdin,
                )?,
            ],
            stdin_text: Some(stdin_prompt(&req.message, req.system_prompt.as_deref())),
        });
    }

    Ok(ClaudeInvocation {
        args,
        fallback_args,
        stdin_text: None,
    })
}

fn chat_args(req: &ChatStreamRequest) -> Vec<String> {
    chat_args_with_tool_policy(req, "--tools", String::new(), PromptSource::Argument)
}

fn chat_args_compat(req: &ChatStreamRequest) -> Vec<String> {
    chat_args_with_tool_policy(
        req,
        "--disallowedTools",
        CLAUDE_CHAT_DISALLOWED_TOOLS_COMPAT.into(),
        PromptSource::Argument,
    )
}

fn chat_args_with_tool_policy(
    req: &ChatStreamRequest,
    tool_flag: &str,
    tool_value: String,
    prompt_source: PromptSource,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into()];
    if prompt_source == PromptSource::Argument {
        args.push(req.message.clone());
    }
    args.extend([
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        tool_flag.into(),
        tool_value,
    ]);

    if prompt_source == PromptSource::Argument {
        append_non_empty_arg_pair(&mut args, "--system-prompt", req.system_prompt.as_deref());
    }
    if let Some(ref session_id) = req.session_id {
        args.push("--resume".into());
        args.push(session_id.clone());
    }

    args
}

fn agent_args(req: &AgentStreamRequest) -> Result<Vec<String>, String> {
    agent_args_with_tool_policy(
        req,
        AgentToolPolicy::strict(req.permission_mode),
        PromptSource::Argument,
    )
}

fn agent_args_without_session_persistence(req: &AgentStreamRequest) -> Result<Vec<String>, String> {
    agent_args_with_tool_policy(
        req,
        AgentToolPolicy::strict_without_session_persistence(req.permission_mode),
        PromptSource::Argument,
    )
}

fn agent_args_compat(req: &AgentStreamRequest) -> Result<Vec<String>, String> {
    agent_args_with_tool_policy(
        req,
        AgentToolPolicy::compat(req.permission_mode),
        PromptSource::Argument,
    )
}

fn agent_args_with_tool_policy(
    req: &AgentStreamRequest,
    policy: AgentToolPolicy,
    prompt_source: PromptSource,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["-p".into()];
    if prompt_source == PromptSource::Argument {
        args.push(req.message.clone());
    }
    args.extend([
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--mcp-config".into(),
        mcp_config(&req.vault_path, &req.vault_paths)?,
        "--strict-mcp-config".into(),
        "--permission-mode".into(),
        "acceptEdits".into(),
        policy.tool_flag.into(),
        policy.tool_value.into(),
    ]);

    if policy.include_session_persistence_flag {
        args.push("--no-session-persistence".into());
    }
    if let Some(allowed_tools) = policy.preapproved_tools {
        args.push("--allowedTools".into());
        args.push(allowed_tools.into());
    }
    if let Some(disallowed_tools) = policy.disallowed_tools {
        args.push("--disallowedTools".into());
        args.push(disallowed_tools.into());
    }
    if prompt_source == PromptSource::Argument {
        append_non_empty_arg_pair(
            &mut args,
            "--append-system-prompt",
            req.system_prompt.as_deref(),
        );
    }

    Ok(args)
}

fn append_non_empty_arg_pair(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        args.push(flag.into());
        args.push(value.into());
    }
}

fn stdin_prompt(message: &str, system_prompt: Option<&str>) -> String {
    crate::cli_agent_runtime::build_prompt(message, system_prompt)
}

fn mcp_config(vault_path: &str, vault_paths: &[String]) -> Result<String, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    let config = serde_json::json!({
        "mcpServers": {
            "tolaria": crate::cli_agent_runtime::tolaria_node_mcp_server(
                &mcp_server_path,
                vault_path,
                vault_paths,
                false,
            )
        }
    });
    serde_json::to_string(&config).map_err(|e| format!("Failed to serialise MCP config: {e}"))
}

fn should_pipe_prompt_for_windows(
    enforce_windows_limit: bool,
    args: &[String],
    fallback_args: &[Vec<String>],
) -> bool {
    enforce_windows_limit
        && std::iter::once(args)
            .chain(fallback_args.iter().map(Vec::as_slice))
            .any(args_exceed_windows_stdin_threshold)
}

fn args_exceed_windows_stdin_threshold(args: &[String]) -> bool {
    windows_command_line_utf16_units(args) >= WINDOWS_COMMAND_LINE_STDIN_THRESHOLD
}

fn windows_command_line_utf16_units(args: &[String]) -> usize {
    args.iter().map(|arg| arg.encode_utf16().count() + 3).sum()
}

struct AgentToolPolicy {
    tool_flag: &'static str,
    tool_value: &'static str,
    include_session_persistence_flag: bool,
    preapproved_tools: Option<&'static str>,
    disallowed_tools: Option<&'static str>,
}

impl AgentToolPolicy {
    fn strict(permission_mode: AiAgentPermissionMode) -> Self {
        Self {
            tool_flag: "--tools",
            tool_value: agent_tools(permission_mode),
            include_session_persistence_flag: true,
            preapproved_tools: preapproved_agent_tools(permission_mode),
            disallowed_tools: None,
        }
    }

    fn strict_without_session_persistence(permission_mode: AiAgentPermissionMode) -> Self {
        Self {
            include_session_persistence_flag: false,
            ..Self::strict(permission_mode)
        }
    }

    fn compat(permission_mode: AiAgentPermissionMode) -> Self {
        Self {
            tool_flag: "--allowedTools",
            tool_value: agent_tools(permission_mode),
            include_session_persistence_flag: false,
            preapproved_tools: None,
            disallowed_tools: Some(disallowed_agent_tools_compat(permission_mode)),
        }
    }
}

fn agent_tools(permission_mode: AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        AiAgentPermissionMode::Safe => CLAUDE_SAFE_AGENT_TOOLS,
        AiAgentPermissionMode::PowerUser => CLAUDE_POWER_USER_AGENT_TOOLS,
    }
}

fn preapproved_agent_tools(permission_mode: AiAgentPermissionMode) -> Option<&'static str> {
    match permission_mode {
        AiAgentPermissionMode::Safe => None,
        AiAgentPermissionMode::PowerUser => Some("Bash"),
    }
}

fn disallowed_agent_tools_compat(permission_mode: AiAgentPermissionMode) -> &'static str {
    match permission_mode {
        AiAgentPermissionMode::Safe => CLAUDE_SAFE_DISALLOWED_TOOLS_COMPAT,
        AiAgentPermissionMode::PowerUser => CLAUDE_POWER_USER_DISALLOWED_TOOLS_COMPAT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! assert_args_contain {
        ($args:expr, [$($value:expr),+ $(,)?] $(,)?) => {
            $(
                assert!($args.contains(&$value.to_string()), "missing {}", $value);
            )+
        };
    }

    macro_rules! assert_args_lack {
        ($args:expr, [$($value:expr),+ $(,)?] $(,)?) => {
            $(
                assert!(!$args.iter().any(|arg| arg == &$value.to_string()), "unexpected {}", $value);
            )+
        };
    }

    macro_rules! assert_no_arg_contains {
        ($args:expr, $fragment:expr $(,)?) => {
            assert!(!$args.iter().any(|arg| arg.contains($fragment)));
        };
    }

    macro_rules! chat_request {
        ($message:expr, None, None $(,)?) => {
            ChatStreamRequest {
                message: $message.into(),
                system_prompt: None,
                session_id: None,
            }
        };
        ($message:expr, Some($system_prompt:expr), None $(,)?) => {
            ChatStreamRequest {
                message: $message.into(),
                system_prompt: Some($system_prompt.to_string()),
                session_id: None,
            }
        };
        ($message:expr, None, Some($session_id:expr) $(,)?) => {
            ChatStreamRequest {
                message: $message.into(),
                system_prompt: None,
                session_id: Some($session_id.to_string()),
            }
        };
        ($message:expr, Some($system_prompt:expr), Some($session_id:expr) $(,)?) => {
            ChatStreamRequest {
                message: $message.into(),
                system_prompt: Some($system_prompt.to_string()),
                session_id: Some($session_id.to_string()),
            }
        };
    }

    fn agent_request(
        message: &str,
        system_prompt: Option<&str>,
        permission_mode: AiAgentPermissionMode,
    ) -> AgentStreamRequest {
        AgentStreamRequest {
            message: message.into(),
            system_prompt: system_prompt.map(str::to_string),
            vault_path: "/tmp/vault".into(),
            vault_paths: Vec::new(),
            permission_mode,
        }
    }

    fn arg_value_after<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
        let index = args.iter().position(|arg| arg == name)?;
        args.get(index + 1).map(String::as_str)
    }

    #[test]
    fn chat_args_basic() {
        let args = chat_args(&chat_request!("hello", None, None));

        assert_args_contain!(args, ["-p", "hello", "stream-json"]);
        assert_args_lack!(args, ["--system-prompt", "--resume"]);
    }

    #[test]
    fn chat_args_with_system_prompt() {
        let args = chat_args(&chat_request!("hi", Some("You are helpful."), None));

        assert_args_contain!(args, ["--system-prompt", "You are helpful."]);
    }

    #[test]
    fn chat_args_empty_system_prompt_is_skipped() {
        let args = chat_args(&chat_request!("hi", Some(""), None));

        assert!(!args.contains(&"--system-prompt".to_string()));
    }

    #[test]
    fn chat_args_with_session_id() {
        let args = chat_args(&chat_request!("continue", None, Some("sess-abc")));

        assert_args_contain!(args, ["--resume", "sess-abc"]);
    }

    #[test]
    fn chat_args_compat_disallows_builtin_tools_when_tools_flag_is_unavailable() {
        let args = chat_args_compat(&chat_request!("hello", None, None));

        assert_args_contain!(args, ["--disallowedTools"]);
        assert_args_lack!(args, ["--tools"]);
        assert!(arg_value_after(&args, "--disallowedTools")
            .is_some_and(|tools| tools.contains("NotebookEdit")));
    }

    #[test]
    fn oversized_windows_invocations_pipe_prompt_to_stdin() {
        let long_message = "x".repeat(WINDOWS_COMMAND_LINE_STDIN_THRESHOLD);
        let chat_req = chat_request!(&long_message, Some("Use context."), Some("sess-abc"));
        let chat_invocation = chat_with_windows_limit(&chat_req, true);

        assert_eq!(chat_invocation.args.first().map(String::as_str), Some("-p"));
        assert_args_lack!(
            chat_invocation.args,
            [long_message.as_str(), "--system-prompt", "Use context."]
        );
        assert_args_contain!(chat_invocation.args, ["--resume", "sess-abc"]);
        assert!(chat_invocation
            .fallback_args
            .iter()
            .flatten()
            .all(|arg| arg != &long_message));
        let chat_stdin = chat_invocation.stdin_text.as_deref().unwrap();
        assert!(chat_stdin.contains("System instructions:\nUse context."));
        assert!(chat_stdin.contains("User request:\n"));
        assert!(chat_stdin.contains(&long_message));

        let agent_req = agent_request(
            &long_message,
            Some("Read the active vault first."),
            AiAgentPermissionMode::Safe,
        );
        let agent_invocation = agent_with_windows_limit(&agent_req, true).unwrap();

        assert_eq!(
            agent_invocation.args.first().map(String::as_str),
            Some("-p")
        );
        assert_args_lack!(
            agent_invocation.args,
            [
                long_message.as_str(),
                "--append-system-prompt",
                "Read the active vault first."
            ]
        );
        assert_args_contain!(
            agent_invocation.args,
            ["--mcp-config", "--strict-mcp-config"]
        );
        assert!(agent_invocation
            .fallback_args
            .iter()
            .flatten()
            .all(|arg| arg != &long_message));
        let agent_stdin = agent_invocation.stdin_text.as_deref().unwrap();
        assert!(agent_stdin.contains("System instructions:\nRead the active vault first."));
        assert!(agent_stdin.contains("User request:\n"));
        assert!(agent_stdin.contains(&long_message));
    }

    #[test]
    fn agent_args_with_system_prompt() {
        if let Ok(args) = agent_args(&agent_request(
            "do it",
            Some("Act as expert."),
            AiAgentPermissionMode::Safe,
        )) {
            assert_args_contain!(args, ["--append-system-prompt", "Act as expert."]);
        }
    }

    #[test]
    fn agent_args_empty_system_prompt_is_skipped() {
        if let Ok(args) = agent_args(&agent_request("x", Some(""), AiAgentPermissionMode::Safe)) {
            assert!(!args.contains(&"--append-system-prompt".to_string()));
        }
    }

    #[test]
    fn agent_args_without_session_persistence_keeps_tools_allowlist() {
        let args = agent_args_without_session_persistence(&agent_request(
            "Rename the note",
            None,
            AiAgentPermissionMode::Safe,
        ))
        .unwrap();

        assert_args_contain!(args, ["--tools", "Read,Edit,MultiEdit,Write,Glob,Grep,LS"]);
        assert_args_lack!(args, ["--no-session-persistence"]);
    }

    #[test]
    fn agent_args_compat_uses_allowed_and_disallowed_tools_without_removed_flags() {
        let args = agent_args_compat(&agent_request(
            "Rename the note",
            None,
            AiAgentPermissionMode::Safe,
        ))
        .unwrap();

        assert_eq!(
            arg_value_after(&args, "--allowedTools"),
            Some("Read,Edit,MultiEdit,Write,Glob,Grep,LS")
        );
        assert_args_contain!(args, ["--disallowedTools"]);
        assert_args_lack!(args, ["--tools"]);
        assert_args_lack!(args, ["--no-session-persistence"]);
    }

    #[test]
    fn agent_args_use_safe_mode_without_bash_by_default() {
        let args = agent_args(&agent_request(
            "Rename the note",
            None,
            AiAgentPermissionMode::Safe,
        ))
        .unwrap();

        assert_args_contain!(
            args,
            ["--strict-mcp-config", "--permission-mode", "acceptEdits"]
        );
        assert_args_contain!(args, ["Read,Edit,MultiEdit,Write,Glob,Grep,LS"]);
        assert_no_arg_contains!(args, "Bash");
        assert_args_lack!(args, ["--allowedTools"]);
        assert_args_lack!(args, ["--dangerously-skip-permissions"]);
    }

    #[test]
    fn agent_args_allow_bash_in_power_user_mode_without_dangerous_bypass() {
        let args = agent_args(&agent_request(
            "Rename the note",
            None,
            AiAgentPermissionMode::PowerUser,
        ))
        .unwrap();

        assert_args_contain!(args, ["--strict-mcp-config"]);
        assert_args_contain!(args, ["Read,Edit,MultiEdit,Write,Glob,Grep,LS,Bash"]);
        assert_args_lack!(args, ["--dangerously-skip-permissions"]);
    }

    #[test]
    fn agent_args_preapprove_bash_for_power_user_runs() {
        let args = agent_args(&agent_request(
            "Run a local script",
            None,
            AiAgentPermissionMode::PowerUser,
        ))
        .unwrap();

        assert_eq!(arg_value_after(&args, "--allowedTools"), Some("Bash"));
    }

    #[test]
    fn agent_invocation_keeps_short_windows_prompt_on_args() {
        let req = agent_request(
            "summarize the inbox",
            Some("Read the active vault first."),
            AiAgentPermissionMode::Safe,
        );
        let invocation = agent_with_windows_limit(&req, true).unwrap();

        assert_args_contain!(
            invocation.args,
            ["-p", "summarize the inbox", "--append-system-prompt"]
        );
        assert!(invocation.stdin_text.is_none());
    }

    #[test]
    fn mcp_config_is_valid_json() {
        let extra_vaults = vec!["/tmp/secondary-vault".to_string()];
        if let Ok(config_str) = mcp_config("/tmp/test-vault", &extra_vaults) {
            let parsed: serde_json::Value = serde_json::from_str(&config_str).unwrap();
            assert!(parsed["mcpServers"]["tolaria"]["command"].is_string());
            assert_eq!(
                parsed["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
                "/tmp/test-vault"
            );
            assert_eq!(
                parsed["mcpServers"]["tolaria"]["env"]["VAULT_PATHS"],
                "[\"/tmp/test-vault\",\"/tmp/secondary-vault\"]"
            );
        }
    }
}
