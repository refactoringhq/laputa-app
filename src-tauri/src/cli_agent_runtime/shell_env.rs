use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const OUTPUT_PREFIX: &str = "__TOLARIA_ENV__:";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EnvName<'a>(&'a str);

impl<'a> EnvName<'a> {
    pub(crate) fn new(raw: &'a str) -> Option<Self> {
        is_valid_name(raw).then_some(Self(raw))
    }

    pub(crate) const fn trusted(raw: &'a str) -> Self {
        Self(raw)
    }

    pub(crate) fn as_str(self) -> &'a str {
        self.0
    }
}

pub(crate) fn apply_user_shell_env_vars_if_missing(command: &mut Command, names: &[EnvName<'_>]) {
    let missing = valid_unique_names(names)
        .into_iter()
        .filter(|name| !process_has_value(name) && !command_has_value(command, name))
        .collect::<Vec<_>>();
    for binding in user_shell_bindings(&missing) {
        command.env(binding.name, binding.value);
    }
}

pub(crate) fn env_value_from_process_or_user_shell(name: EnvName<'_>) -> Option<String> {
    process_value(name).or_else(|| user_shell_value(name))
}

#[derive(Debug, PartialEq, Eq)]
struct EnvBinding {
    name: String,
    value: String,
}

fn process_has_value(name: &EnvName<'_>) -> bool {
    std::env::var_os(name.as_str()).is_some_and(|value| !value.is_empty())
}

fn command_has_value(command: &Command, name: &EnvName<'_>) -> bool {
    command.get_envs().any(|(key, value)| {
        key == OsStr::new(name.as_str()) && value.is_some_and(|value| !value.is_empty())
    })
}

fn process_value(name: EnvName<'_>) -> Option<String> {
    std::env::var(name.as_str())
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn user_shell_value(name: EnvName<'_>) -> Option<String> {
    user_shell_bindings(&[name])
        .into_iter()
        .find_map(|binding| (binding.name == name.as_str()).then_some(binding.value))
}

fn user_shell_bindings(names: &[EnvName<'_>]) -> Vec<EnvBinding> {
    let names = valid_unique_names(names);
    if names.is_empty() {
        return Vec::new();
    }
    user_shell_bindings_for_platform(&names)
}

fn valid_unique_names<'a>(names: &[EnvName<'a>]) -> Vec<EnvName<'a>> {
    let mut unique = Vec::new();
    for name in names.iter().copied() {
        if !unique.iter().any(|existing| existing == &name) {
            unique.push(name);
        }
    }
    unique
}

fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

#[cfg(unix)]
fn user_shell_bindings_for_platform(names: &[EnvName<'_>]) -> Vec<EnvBinding> {
    shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| user_shell_bindings_from_shell(&shell, names))
        .unwrap_or_default()
}

#[cfg(not(unix))]
fn user_shell_bindings_for_platform(_names: &[EnvName<'_>]) -> Vec<EnvBinding> {
    Vec::new()
}

#[cfg(unix)]
fn user_shell_bindings_from_shell(shell: &Path, names: &[EnvName<'_>]) -> Option<Vec<EnvBinding>> {
    let output = crate::hidden_command(shell)
        .arg("-lc")
        .arg(shell_probe_script(shell, names))
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let bindings = parse_probe_output(&String::from_utf8_lossy(&output.stdout), names);
    (!bindings.is_empty()).then_some(bindings)
}

#[cfg(unix)]
fn shell_candidates() -> Vec<PathBuf> {
    let mut shells = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        if !shell.is_empty() {
            shells.push(PathBuf::from(shell));
        }
    }
    shells.push(PathBuf::from("/bin/zsh"));
    shells.push(PathBuf::from("/bin/bash"));
    shells
}

#[cfg(unix)]
fn shell_probe_script(shell: &Path, names: &[EnvName<'_>]) -> String {
    format!(
        "{}\nfor name in {}; do\n  value=$(printenv \"$name\" 2>/dev/null || true)\n  if [ -n \"$value\" ]; then\n    printf '{}%s=%s\\n' \"$name\" \"$value\"\n  fi\ndone\n",
        rc_source_command(shell),
        joined_names(names),
        OUTPUT_PREFIX
    )
}

fn joined_names(names: &[EnvName<'_>]) -> String {
    names
        .iter()
        .map(|name| name.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(unix)]
fn rc_source_command(shell: &Path) -> &'static str {
    let name = shell
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    if name.contains("zsh") {
        return "if [ -n \"${ZDOTDIR:-}\" ] && [ -r \"${ZDOTDIR}/.zshrc\" ]; then . \"${ZDOTDIR}/.zshrc\" >/dev/null 2>&1 || true; elif [ -r \"$HOME/.zshrc\" ]; then . \"$HOME/.zshrc\" >/dev/null 2>&1 || true; fi";
    }
    if name.contains("bash") {
        return "if [ -r \"$HOME/.bashrc\" ]; then . \"$HOME/.bashrc\" >/dev/null 2>&1 || true; fi";
    }
    ""
}

struct ProbeOutput<'a>(&'a str);

struct ProbeLine<'a>(&'a str);

fn parse_probe_output(stdout: &str, names: &[EnvName<'_>]) -> Vec<EnvBinding> {
    ProbeOutput(stdout)
        .0
        .lines()
        .filter_map(|line| parse_probe_line(ProbeLine(line), names))
        .collect()
}

fn parse_probe_line(line: ProbeLine<'_>, names: &[EnvName<'_>]) -> Option<EnvBinding> {
    let (name, value) = line.0.strip_prefix(OUTPUT_PREFIX)?.split_once('=')?;
    let name = EnvName::new(name)?;
    let value = value.trim();
    (names.iter().any(|expected| expected == &name) && !value.is_empty()).then(|| EnvBinding {
        name: name.as_str().to_string(),
        value: value.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_value_uses_trimmed_process_value() {
        let key = "TOLARIA_TEST_SHELL_ENV_PROCESS_VALUE";
        std::env::set_var(key, "  process-secret  ");

        let value = env_value_from_process_or_user_shell(EnvName::trusted(key));

        std::env::remove_var(key);
        assert_eq!(value.as_deref(), Some("process-secret"));
    }

    #[test]
    fn command_value_marks_name_as_already_available() {
        let mut command = Command::new("demo");
        command.env("TOLARIA_TEST_COMMAND_VALUE", "command-secret");

        apply_user_shell_env_vars_if_missing(
            &mut command,
            &[EnvName::trusted("TOLARIA_TEST_COMMAND_VALUE")],
        );

        let values = command
            .get_envs()
            .map(|(key, value)| (key.to_string_lossy().to_string(), value.is_some()))
            .collect::<Vec<_>>();
        assert_eq!(values, vec![("TOLARIA_TEST_COMMAND_VALUE".into(), true)]);
    }

    #[test]
    fn parse_probe_output_filters_invalid_unexpected_and_blank_values() {
        let names = [
            EnvName::trusted("GOOD_VALUE"),
            EnvName::trusted("OTHER_VALUE"),
        ];

        let bindings = parse_probe_output(
            "__TOLARIA_ENV__:GOOD_VALUE=kept\n\
             ignored\n\
             __TOLARIA_ENV__:BAD-NAME=bad\n\
             __TOLARIA_ENV__:OTHER_VALUE=   \n\
             __TOLARIA_ENV__:UNEXPECTED=value\n",
            &names,
        );

        assert_eq!(
            bindings,
            vec![EnvBinding {
                name: "GOOD_VALUE".into(),
                value: "kept".into(),
            }]
        );
    }

    #[cfg(unix)]
    #[test]
    fn user_shell_bindings_from_shell_returns_none_for_failing_shell() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("zsh");
        std::fs::write(&shell, "#!/bin/sh\nexit 7\n").unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

        let values = user_shell_bindings_from_shell(&shell, &[EnvName::trusted("MISSING")]);

        assert_eq!(values, None);
    }

    #[cfg(unix)]
    #[test]
    fn rc_source_command_ignores_unknown_shells() {
        assert_eq!(rc_source_command(Path::new("fish")), "");
    }

    #[cfg(unix)]
    #[test]
    fn user_shell_bindings_from_shell_reads_zshrc_exports_for_requested_keys() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("zsh");
        let zshrc = dir.path().join(".zshrc");
        std::fs::write(
            &shell,
            "#!/bin/sh\nexport HOME=$(dirname \"$0\")\nexec /bin/sh -c \"$2\"\n",
        )
        .unwrap();
        std::fs::write(
            &zshrc,
            "export ANTHROPIC_API_KEY=from-zshrc\nexport ANTHROPIC_BASE_URL=https://proxy.example.test\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

        let values = user_shell_bindings_from_shell(
            &shell,
            &[
                EnvName::trusted("ANTHROPIC_API_KEY"),
                EnvName::trusted("ANTHROPIC_BASE_URL"),
                EnvName::trusted("IGNORED_SECRET"),
            ],
        )
        .expect("zshrc exports should be readable");

        assert_eq!(
            values,
            vec![
                EnvBinding {
                    name: "ANTHROPIC_API_KEY".to_string(),
                    value: "from-zshrc".to_string(),
                },
                EnvBinding {
                    name: "ANTHROPIC_BASE_URL".to_string(),
                    value: "https://proxy.example.test".to_string(),
                },
            ]
        );
    }
}
