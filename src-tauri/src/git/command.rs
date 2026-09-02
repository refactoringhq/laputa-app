use std::io;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use super::git_command_at;

pub(super) fn git_output(dir: &Path, args: &[&str]) -> io::Result<Output> {
    unattended_git_command(dir, args)?.output()
}

fn unattended_git_command(dir: &Path, args: &[&str]) -> io::Result<Command> {
    let mut command = git_command_at(dir)?;
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "0")
        .env("GCM_GUI_PROMPT", "0")
        .stdin(Stdio::null());
    Ok(command)
}

fn interactive_git_command(dir: &Path, args: &[&str]) -> io::Result<Command> {
    let mut command = git_command_at(dir)?;
    command.args(args);
    Ok(command)
}

pub(super) fn git_output_result(dir: &Path, args: &[&str]) -> Result<Output, String> {
    git_output(dir, args).map_err(|e| format!("Failed to run git {}: {e}", git_command_label(args)))
}

pub(super) fn run_git(dir: &Path, args: &[&str]) -> Result<(), String> {
    let output = git_output_result(dir, args)?;

    command_result(output)
}

pub(super) fn run_git_interactive(dir: &Path, args: &[&str]) -> Result<(), String> {
    let output = interactive_git_command(dir, args)
        .map_err(|error| format!("Failed to run git {}: {error}", git_command_label(args)))?
        .output()
        .map_err(|error| format!("Failed to run git {}: {error}", git_command_label(args)))?;

    command_result(output)
}

fn command_result(output: Output) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }

    Err(stderr_text(&output))
}

pub(super) fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn stdout_lines(output: &Output) -> Vec<String> {
    stdout_text(output)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

pub(super) fn stderr_or_failure(command: &str, output: &Output) -> String {
    let stderr = stderr_text(output);
    if stderr.is_empty() {
        format!("{command} failed")
    } else {
        stderr
    }
}

pub(super) fn git_command_label<'a>(args: &'a [&'a str]) -> &'a str {
    if args.first() == Some(&"-c") {
        return args.get(2).copied().unwrap_or(args[0]);
    }

    args[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::process::Command;
    use tempfile::TempDir;

    fn command_envs(command: &Command) -> HashMap<String, Option<String>> {
        command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|entry| entry.to_string_lossy().to_string()),
                )
            })
            .collect()
    }

    #[test]
    fn unattended_git_commands_disable_credential_prompts() {
        let dir = TempDir::new().unwrap();
        let command = unattended_git_command(dir.path(), &["fetch", "--quiet"]).unwrap();
        let envs = command_envs(&command);

        assert_eq!(
            envs.get("GIT_TERMINAL_PROMPT"),
            Some(&Some("0".to_string()))
        );
        assert_eq!(envs.get("GCM_INTERACTIVE"), Some(&Some("0".to_string())));
        assert_eq!(envs.get("GCM_GUI_PROMPT"), Some(&Some("0".to_string())));
    }

    #[test]
    fn interactive_git_commands_do_not_override_prompt_settings() {
        let dir = TempDir::new().unwrap();
        let command = interactive_git_command(dir.path(), &["fetch", "origin"]).unwrap();
        let envs = command_envs(&command);

        assert!(!envs.contains_key("GIT_TERMINAL_PROMPT"));
        assert!(!envs.contains_key("GCM_INTERACTIVE"));
        assert!(!envs.contains_key("GCM_GUI_PROMPT"));
    }
}
