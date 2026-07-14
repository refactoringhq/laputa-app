use crate::ai_agents::AiAgentPermissionMode;
use crate::cli_agent_runtime::EnvName;
use crate::opencode_cli::AgentStreamRequest;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;

const WINDOWS_COMMAND_LINE_STDIN_THRESHOLD: usize = 24 * 1024;

const OPENCODE_SHELL_ENV_KEYS: [EnvName<'static>; 25] = [
    EnvName::trusted("OPENCODE_CONFIG"),
    EnvName::trusted("OPENCODE_CONFIG_DIR"),
    EnvName::trusted("ANTHROPIC_API_KEY"),
    EnvName::trusted("ANTHROPIC_AUTH_TOKEN"),
    EnvName::trusted("ANTHROPIC_BASE_URL"),
    EnvName::trusted("ANTHROPIC_CUSTOM_HEADERS"),
    EnvName::trusted("ANTHROPIC_MODEL"),
    EnvName::trusted("ANTHROPIC_SMALL_FAST_MODEL"),
    EnvName::trusted("OPENAI_API_KEY"),
    EnvName::trusted("OPENAI_BASE_URL"),
    EnvName::trusted("OPENROUTER_API_KEY"),
    EnvName::trusted("GEMINI_API_KEY"),
    EnvName::trusted("GOOGLE_API_KEY"),
    EnvName::trusted("GOOGLE_GENERATIVE_AI_API_KEY"),
    EnvName::trusted("GROQ_API_KEY"),
    EnvName::trusted("XAI_API_KEY"),
    EnvName::trusted("MISTRAL_API_KEY"),
    EnvName::trusted("COHERE_API_KEY"),
    EnvName::trusted("DEEPSEEK_API_KEY"),
    EnvName::trusted("AZURE_OPENAI_API_KEY"),
    EnvName::trusted("AZURE_OPENAI_ENDPOINT"),
    EnvName::trusted("AWS_ACCESS_KEY_ID"),
    EnvName::trusted("AWS_SECRET_ACCESS_KEY"),
    EnvName::trusted("AWS_SESSION_TOKEN"),
    EnvName::trusted("AWS_REGION"),
];

pub(crate) struct OpencodeCommand {
    pub(crate) command: std::process::Command,
    pub(crate) stdin_input: Option<String>,
}

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
) -> Result<OpencodeCommand, String> {
    build_command_with_windows_limit(binary, request, cfg!(windows))
}

fn build_command_with_windows_limit(
    binary: &Path,
    request: &AgentStreamRequest,
    enforce_windows_limit: bool,
) -> Result<OpencodeCommand, String> {
    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    apply_opencode_shell_env(&mut command, request);
    command.args(&target.prefix_args);
    let args = build_args();
    let prompt = build_prompt(request);
    command.args(&args);
    let stdin_input = if should_pipe_prompt_for_windows(enforce_windows_limit, &args, &prompt) {
        Some(prompt)
    } else {
        command.arg(prompt);
        None
    };
    command
        .env(
            "OPENCODE_CONFIG_CONTENT",
            build_config(
                &request.vault_path,
                &request.vault_paths,
                request.permission_mode,
            )?,
        )
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    Ok(OpencodeCommand {
        command,
        stdin_input,
    })
}

fn build_args() -> Vec<String> {
    vec!["run".into(), "--format".into(), "json".into()]
}

fn should_pipe_prompt_for_windows(
    enforce_windows_limit: bool,
    args: &[String],
    prompt: &str,
) -> bool {
    if !enforce_windows_limit {
        return false;
    }

    let mut command_args = args.to_vec();
    command_args.push(prompt.to_string());
    args_exceed_windows_stdin_threshold(&command_args)
}

fn args_exceed_windows_stdin_threshold(args: &[String]) -> bool {
    windows_command_line_utf16_units(args) >= WINDOWS_COMMAND_LINE_STDIN_THRESHOLD
}

fn windows_command_line_utf16_units(args: &[String]) -> usize {
    args.iter().map(|arg| arg.encode_utf16().count() + 3).sum()
}

fn build_prompt(request: &AgentStreamRequest) -> String {
    crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref())
}

fn apply_opencode_shell_env(command: &mut std::process::Command, request: &AgentStreamRequest) {
    let referenced_names = referenced_config_env_names(Path::new(&request.vault_path));
    let referenced_env_names = referenced_names
        .iter()
        .filter_map(|name| EnvName::new(name))
        .collect::<Vec<_>>();
    let mut names = OPENCODE_SHELL_ENV_KEYS.to_vec();
    names.extend(referenced_env_names);
    crate::cli_agent_runtime::apply_user_shell_env_vars_if_missing(command, &names);
}

fn referenced_config_env_names(vault_path: &Path) -> BTreeSet<String> {
    let home = dirs::home_dir();
    let custom_config = crate::cli_agent_runtime::env_value_from_process_or_user_shell(
        EnvName::trusted("OPENCODE_CONFIG"),
    );
    let candidates = config_file_candidates(home.as_deref(), vault_path, custom_config.as_deref());
    referenced_config_env_names_from_files(&candidates)
}

fn config_file_candidates(
    home: Option<&Path>,
    vault_path: &Path,
    custom_config: Option<&str>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = home {
        candidates.extend([
            home.join(".config/opencode/config.json"),
            home.join(".config/opencode/opencode.json"),
            home.join(".config/opencode/opencode.jsonc"),
            home.join(".opencode/opencode.json"),
            home.join(".opencode/opencode.jsonc"),
        ]);
    }
    if let Some(path) = custom_config.map(str::trim).filter(|path| !path.is_empty()) {
        candidates.push(PathBuf::from(path));
    }
    candidates.extend(project_config_candidates(vault_path));
    candidates
}

fn project_config_candidates(vault_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for ancestor in vault_path.ancestors() {
        candidates.push(ancestor.join("opencode.json"));
        candidates.push(ancestor.join("opencode.jsonc"));
        if ancestor.join(".git").exists() {
            break;
        }
    }
    candidates
}

fn referenced_config_env_names_from_files(paths: &[PathBuf]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for path in paths {
        if let Ok(config) = std::fs::read_to_string(path) {
            names.extend(referenced_env_names_in_config_text(&config));
        }
    }
    names
}

fn referenced_env_names_in_config_text(config: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut remaining = config;
    while let Some(start) = remaining.find("{env:") {
        let after_prefix = &remaining[start + "{env:".len()..];
        let Some(end) = after_prefix.find('}') else {
            break;
        };
        if let Some(name) = EnvName::new(after_prefix[..end].trim()) {
            names.insert(name.as_str().to_string());
        }
        remaining = &after_prefix[end + 1..];
    }
    names
}

fn build_config(
    vault_path: &str,
    vault_paths: &[String],
    permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    let vault_paths = crate::cli_agent_runtime::active_vault_paths_json(vault_path, vault_paths);

    serde_json::to_string(&serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "permission": permission_config(permission_mode),
        "mcp": {
            "tolaria": {
                "type": "local",
                "command": ["node", mcp_server_path],
                "environment": {
                    "VAULT_PATH": vault_path,
                    "VAULT_PATHS": vault_paths
                },
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

    fn request() -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
            vault_paths: Vec::new(),
            permission_mode: crate::ai_agents::AiAgentPermissionMode::Safe,
        }
    }

    #[test]
    fn args_use_documented_safe_run_mode() {
        let args = build_args();
        let forbidden_args = (
            args.contains(&"--dangerously-skip-permissions".to_string()),
            args.contains(&"--dir".to_string()),
            args.contains(&"--thinking".to_string()),
        );

        assert_eq!(
            (args, forbidden_args),
            (
                vec![
                    "run".to_string(),
                    "--format".to_string(),
                    "json".to_string()
                ],
                (false, false, false),
            )
        );
    }

    #[test]
    fn command_sets_vault_cwd_and_mcp_config() {
        let built = build_command(&PathBuf::from("opencode"), &request()).unwrap();
        let command = built.command;
        let actual_args: Vec<&OsStr> = command.get_args().collect();
        let config_value = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("OPENCODE_CONFIG_CONTENT"))
            .and_then(|(_, value)| value);

        assert_eq!(
            (
                command.get_program(),
                actual_args[0],
                actual_args[1],
                actual_args[2],
                actual_args.last().copied(),
                command.get_current_dir(),
                config_value.is_some(),
            ),
            (
                OsStr::new("opencode"),
                OsStr::new("run"),
                OsStr::new("--format"),
                OsStr::new("json"),
                Some(OsStr::new("Rename the note")),
                Some(Path::new("/tmp/vault")),
                true,
            )
        );
        assert!(built.stdin_input.is_none());
    }

    #[test]
    fn short_windows_prompt_stays_on_command_line() {
        let built =
            build_command_with_windows_limit(&PathBuf::from("opencode"), &request(), true).unwrap();
        let actual_args = built.command.get_args().collect::<Vec<_>>();

        assert!(built.stdin_input.is_none());
        assert!(actual_args
            .iter()
            .any(|arg| *arg == OsStr::new("Rename the note")));
    }

    #[test]
    fn oversized_windows_prompt_uses_stdin() {
        let long_message = "x".repeat(WINDOWS_COMMAND_LINE_STDIN_THRESHOLD);
        let request = AgentStreamRequest {
            message: long_message.clone(),
            system_prompt: Some("Use context.".into()),
            ..request()
        };

        let built =
            build_command_with_windows_limit(&PathBuf::from("opencode"), &request, true).unwrap();
        let actual_args = built.command.get_args().collect::<Vec<_>>();
        let stdin = built.stdin_input.as_deref().unwrap();

        assert!(actual_args
            .iter()
            .all(|arg| *arg != OsStr::new(long_message.as_str())));
        assert!(stdin.contains("System instructions:\nUse context."));
        assert!(stdin.contains("User request:\n"));
        assert!(stdin.contains(&long_message));
    }

    #[test]
    fn command_provider_env_keys_cover_terminal_backed_opencode_configs() {
        assert!(OPENCODE_SHELL_ENV_KEYS.contains(&EnvName::trusted("OPENCODE_CONFIG")));
        assert!(OPENCODE_SHELL_ENV_KEYS.contains(&EnvName::trusted("OPENAI_API_KEY")));
        assert!(OPENCODE_SHELL_ENV_KEYS.contains(&EnvName::trusted("ANTHROPIC_API_KEY")));
        assert!(OPENCODE_SHELL_ENV_KEYS.contains(&EnvName::trusted("GEMINI_API_KEY")));
    }

    #[test]
    fn config_file_candidates_follow_opencode_precedence_locations() {
        let home = Path::new("/Users/alex");
        let vault = Path::new("/Users/alex/project");
        let candidates =
            config_file_candidates(Some(home), vault, Some("/Users/alex/custom/opencode.json"));

        assert!(candidates.contains(&home.join(".config/opencode/config.json")));
        assert!(candidates.contains(&home.join(".config/opencode/opencode.json")));
        assert!(candidates.contains(&PathBuf::from("/Users/alex/custom/opencode.json")));
        assert!(candidates.contains(&vault.join("opencode.json")));
        assert!(candidates.contains(&vault.join("opencode.jsonc")));
    }

    #[test]
    fn referenced_env_names_are_read_from_opencode_config_files() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("opencode.json");
        std::fs::write(
            &config,
            r#"{
                "provider": {
                    "anthropic": { "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" } },
                    "custom": { "options": { "apiKey": "{env:TOLARIA_CUSTOM_KEY}" } },
                    "bad": "{env:bad-name}"
                }
            }"#,
        )
        .unwrap();

        let names = referenced_config_env_names_from_files(&[config]);

        assert_eq!(
            names,
            BTreeSet::from([
                "ANTHROPIC_API_KEY".to_string(),
                "TOLARIA_CUSTOM_KEY".to_string(),
            ])
        );
    }

    #[test]
    fn command_avoids_windows_cmd_shim_for_run_args() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("opencode.cmd");
        let script = dir
            .path()
            .join("node_modules")
            .join("opencode")
            .join("bin")
            .join("opencode.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "console.log('opencode')\n").unwrap();
        std::fs::write(
            &shim,
            r#"@ECHO off
"%_prog%" "%~dp0\node_modules\opencode\bin\opencode.js" %*
"#,
        )
        .unwrap();

        let built = build_command(&shim, &request()).unwrap();
        let command = built.command;
        let actual_args = command.get_args().collect::<Vec<_>>();

        assert_ne!(
            command.get_program(),
            shim.as_os_str(),
            "OpenCode npm .cmd shims cannot be spawned directly on Windows"
        );
        assert_eq!(
            (
                actual_args.first().copied(),
                actual_args.iter().any(|arg| *arg == OsStr::new("run")),
                actual_args.iter().any(|arg| *arg == OsStr::new("json")),
                actual_args
                    .iter()
                    .any(|arg| *arg == OsStr::new("Rename the note")),
            ),
            (Some(script.as_os_str()), true, true, true)
        );
    }

    #[test]
    fn config_includes_permissions_and_tolaria_mcp_server() {
        if let Ok(config) = build_config(
            "/tmp/vault",
            &[],
            crate::ai_agents::AiAgentPermissionMode::Safe,
        ) {
            let json: serde_json::Value = serde_json::from_str(&config).unwrap();
            assert_eq!(
                (
                    json["permission"]["edit"].as_str(),
                    json["permission"]["external_directory"].as_str(),
                    json["permission"]["bash"].as_str(),
                    json["mcp"]["tolaria"]["type"].as_str(),
                    json["mcp"]["tolaria"]["command"][0].as_str(),
                    json["mcp"]["tolaria"]["environment"]["VAULT_PATH"].as_str(),
                    json["mcp"]["tolaria"]["command"][1]
                        .as_str()
                        .is_some_and(|path| path.ends_with("index.js")),
                ),
                (
                    Some("allow"),
                    Some("deny"),
                    Some("deny"),
                    Some("local"),
                    Some("node"),
                    Some("/tmp/vault"),
                    true,
                )
            );
            assert_eq!(
                json["mcp"]["tolaria"]["environment"]["VAULT_PATHS"],
                r#"["/tmp/vault"]"#
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
            &[],
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
