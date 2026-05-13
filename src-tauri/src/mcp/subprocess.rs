use std::ffi::OsStr;
use std::process::Command;

#[cfg(any(test, all(desktop, target_os = "linux")))]
const APPIMAGE_ENV_REMOVALS: [&str; 3] = ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIT_EXEC_PATH"];

pub(super) fn command(program: impl AsRef<OsStr>) -> Command {
    let mut command = crate::hidden_command(program);
    sanitize_appimage_env(&mut command);
    command
}

#[cfg(all(desktop, target_os = "linux"))]
fn sanitize_appimage_env(command: &mut Command) {
    sanitize_appimage_env_for_launch(command, appimage_env_present());
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn sanitize_appimage_env(_command: &mut Command) {}

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn sanitize_appimage_env_for_launch(command: &mut Command, is_appimage: bool) {
    if !is_appimage {
        return;
    }

    for key in APPIMAGE_ENV_REMOVALS {
        command.env_remove(key);
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn appimage_env_present() -> bool {
    ["APPIMAGE", "APPDIR"]
        .into_iter()
        .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_envs(command: &Command) -> std::collections::HashMap<String, Option<String>> {
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
    fn appimage_mcp_subprocesses_remove_loader_env() {
        let mut command = crate::hidden_command("node");

        sanitize_appimage_env_for_launch(&mut command, true);

        let envs = command_envs(&command);
        for key in APPIMAGE_ENV_REMOVALS {
            assert_eq!(envs.get(key), Some(&None));
        }
    }

    #[test]
    fn non_appimage_mcp_subprocesses_keep_parent_env_unmodified() {
        let mut command = crate::hidden_command("node");

        sanitize_appimage_env_for_launch(&mut command, false);

        let envs = command_envs(&command);
        for key in APPIMAGE_ENV_REMOVALS {
            assert!(!envs.contains_key(key));
        }
    }
}
