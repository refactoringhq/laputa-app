use crate::ai_agents::AiAgentAvailability;
use std::path::{Path, PathBuf};

pub(crate) fn check_cli() -> AiAgentAvailability {
    match find_binary() {
        Ok(binary) => AiAgentAvailability {
            installed: true,
            version: crate::cli_agent_runtime::version_for_binary(&binary),
        },
        Err(_) => AiAgentAvailability {
            installed: false,
            version: None,
        },
    }
}

pub(crate) fn find_binary() -> Result<PathBuf, String> {
    if let Some(binary) = find_binary_on_path() {
        return Ok(binary);
    }

    if let Some(binary) = find_binary_in_user_shell() {
        return Ok(binary);
    }

    if let Some(binary) = crate::cli_agent_runtime::find_executable_binary_candidate(
        opencode_binary_candidates(),
        "OpenCode CLI",
    )? {
        return Ok(binary);
    }

    Err("OpenCode CLI not found. Install it: https://opencode.ai/docs/".into())
}

fn find_binary_on_path() -> Option<PathBuf> {
    crate::hidden_command(path_lookup_command())
        .arg("opencode")
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn path_lookup_command() -> &'static str {
    if cfg!(windows) {
        "where"
    } else {
        "which"
    }
}

fn find_binary_in_user_shell() -> Option<PathBuf> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| command_path_from_shell(&shell, "opencode"))
}

fn user_shell_candidates() -> Vec<PathBuf> {
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

fn command_path_from_shell(shell: &Path, command: &str) -> Option<PathBuf> {
    crate::hidden_command(shell)
        .arg("-lc")
        .arg(format!("command -v {command}"))
        .output()
        .ok()
        .and_then(|output| path_from_successful_output(&output))
}

fn path_from_successful_output(output: &std::process::Output) -> Option<PathBuf> {
    if output.status.success() {
        first_existing_path(&String::from_utf8_lossy(&output.stdout))
    } else {
        None
    }
}

fn first_existing_path(stdout: &str) -> Option<PathBuf> {
    first_existing_path_for_platform(stdout, cfg!(windows))
}

fn first_existing_path_for_platform(stdout: &str, windows: bool) -> Option<PathBuf> {
    let mut paths = stdout.lines().filter_map(existing_path);
    if windows {
        return paths.find(|path| crate::cli_agent_runtime::has_windows_cli_extension(path));
    }

    paths.next()
}

fn existing_path(line: &str) -> Option<PathBuf> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    candidate.exists().then_some(candidate)
}

fn opencode_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = opencode_binary_candidates_from_env();

    if let Some(home) = dirs::home_dir() {
        candidates.extend(opencode_binary_candidates_for_home(&home));
    }

    candidates
}

fn opencode_binary_candidates_for_home(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/opencode"),
        home.join(".local/bin/opencode.cmd"),
        home.join(".local/bin/opencode.exe"),
        home.join(".opencode/bin/opencode"),
        home.join(".opencode/bin/opencode.cmd"),
        home.join(".opencode/bin/opencode.exe"),
        home.join(".local/share/mise/shims/opencode"),
        home.join(".local/share/mise/shims/opencode.cmd"),
        home.join(".local/share/mise/shims/opencode.exe"),
        home.join(".asdf/shims/opencode"),
        home.join(".asdf/shims/opencode.cmd"),
        home.join(".asdf/shims/opencode.exe"),
        home.join(".npm-global/bin/opencode"),
        home.join(".npm-global/bin/opencode.cmd"),
        home.join(".npm-global/bin/opencode.exe"),
        home.join(".npm/bin/opencode"),
        home.join(".npm/bin/opencode.cmd"),
        home.join(".npm/bin/opencode.exe"),
        home.join(".bun/bin/opencode"),
        home.join(".bun/bin/opencode.cmd"),
        home.join(".bun/bin/opencode.exe"),
        home.join(".linuxbrew/bin/opencode"),
        home.join("AppData/Roaming/npm/opencode.cmd"),
        home.join("AppData/Roaming/npm/opencode.exe"),
        home.join("AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode.exe"),
        home.join(
            "AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe",
        ),
        home.join(
            "AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-arm64/bin/opencode.exe",
        ),
        home.join("AppData/Local/pnpm/opencode.cmd"),
        home.join("AppData/Local/pnpm/opencode.exe"),
        home.join("scoop/shims/opencode.cmd"),
        home.join("scoop/shims/opencode.exe"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin/opencode"),
        PathBuf::from("/usr/local/bin/opencode"),
        PathBuf::from("/opt/homebrew/bin/opencode"),
    ]
}

fn opencode_binary_candidates_from_env() -> Vec<PathBuf> {
    opencode_binary_candidates_from_env_values(OpencodeEnvCandidateRoots::from_process_env())
}

#[derive(Default)]
struct OpencodeEnvCandidateRoots {
    opencode_path: Option<PathBuf>,
    nvm_bin: Option<PathBuf>,
    npm_config_prefix: Option<PathBuf>,
    npm_config_prefix_upper: Option<PathBuf>,
    pnpm_home: Option<PathBuf>,
    appdata: Option<PathBuf>,
    localappdata: Option<PathBuf>,
    program_files: Option<PathBuf>,
}

impl OpencodeEnvCandidateRoots {
    fn from_process_env() -> Self {
        Self {
            opencode_path: std::env::var_os("OPENCODE_PATH").map(PathBuf::from),
            nvm_bin: std::env::var_os("NVM_BIN").map(PathBuf::from),
            npm_config_prefix: std::env::var_os("npm_config_prefix").map(PathBuf::from),
            npm_config_prefix_upper: std::env::var_os("NPM_CONFIG_PREFIX").map(PathBuf::from),
            pnpm_home: std::env::var_os("PNPM_HOME").map(PathBuf::from),
            appdata: std::env::var_os("APPDATA").map(PathBuf::from),
            localappdata: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
        }
    }
}

fn opencode_binary_candidates_from_env_values(paths: OpencodeEnvCandidateRoots) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    extend_from_optional_path(
        &mut candidates,
        paths.opencode_path,
        opencode_candidates_for_configured_path,
    );
    for path in [paths.nvm_bin, paths.pnpm_home] {
        extend_from_optional_path(&mut candidates, path, opencode_executable_names);
    }
    for path in [paths.npm_config_prefix, paths.npm_config_prefix_upper] {
        extend_from_optional_path(&mut candidates, path, opencode_npm_prefix_candidates);
    }
    extend_from_optional_path(&mut candidates, paths.appdata, |path| {
        opencode_npm_prefix_candidates(&path.join("npm"))
    });
    extend_from_optional_path(&mut candidates, paths.localappdata, |path| {
        let mut local_candidates = opencode_executable_names(&path.join("pnpm"));
        local_candidates.extend(opencode_desktop_candidates_for_root(&path.join("Programs")));
        local_candidates
    });
    extend_from_optional_path(
        &mut candidates,
        paths.program_files,
        opencode_desktop_candidates_for_root,
    );

    candidates
}

fn extend_from_optional_path(
    candidates: &mut Vec<PathBuf>,
    path: Option<PathBuf>,
    build: impl FnOnce(&Path) -> Vec<PathBuf>,
) {
    if let Some(path) = non_empty_path(path) {
        candidates.extend(build(&path));
    }
}

fn non_empty_path(path: Option<PathBuf>) -> Option<PathBuf> {
    path.filter(|path| !path.as_os_str().is_empty())
}

fn opencode_candidates_for_configured_path(path: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![path.to_path_buf()];
    candidates.extend(opencode_executable_names(path));
    candidates
}

fn opencode_executable_names(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join("opencode"),
        root.join("opencode.cmd"),
        root.join("opencode.exe"),
    ]
}

fn opencode_npm_prefix_candidates(prefix: &Path) -> Vec<PathBuf> {
    let mut candidates = opencode_executable_names(prefix);
    candidates.extend(opencode_executable_names(&prefix.join("bin")));
    candidates.extend([
        prefix.join("node_modules/opencode-ai/bin/opencode.exe"),
        prefix.join("node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe"),
        prefix
            .join("node_modules/opencode-ai/node_modules/opencode-windows-arm64/bin/opencode.exe"),
        prefix.join("lib/node_modules/opencode-ai/bin/opencode"),
    ]);
    candidates
}

fn opencode_desktop_candidates_for_root(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join("OpenCode/opencode.exe"),
        root.join("opencode/opencode.exe"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_candidates_include_supported_local_installs() {
        let home = PathBuf::from("/Users/alex");
        let candidates = opencode_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/opencode"),
            home.join(".opencode/bin/opencode"),
            home.join(".local/share/mise/shims/opencode"),
            home.join(".asdf/shims/opencode"),
            home.join(".npm-global/bin/opencode"),
            home.join(".bun/bin/opencode"),
            PathBuf::from("/opt/homebrew/bin/opencode"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn binary_candidates_include_linuxbrew_installs() {
        let home = PathBuf::from("/home/alex");
        let candidates = opencode_binary_candidates_for_home(&home);
        let expected = [
            home.join(".linuxbrew/bin/opencode"),
            PathBuf::from("/home/linuxbrew/.linuxbrew/bin/opencode"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn binary_candidates_include_windows_npm_and_toolchain_shims() {
        let home = PathBuf::from(r"C:\Users\alex");
        let candidates = opencode_binary_candidates_for_home(&home);
        let expected = [
            home.join(".local/bin/opencode.cmd"),
            home.join(".opencode/bin/opencode.cmd"),
            home.join(".local/share/mise/shims/opencode.cmd"),
            home.join(".asdf/shims/opencode.cmd"),
            home.join(".npm-global/bin/opencode.cmd"),
            home.join(".npm-global/bin/opencode.exe"),
            home.join(".npm/bin/opencode.cmd"),
            home.join(".npm/bin/opencode.exe"),
            home.join(".bun/bin/opencode.cmd"),
            home.join("AppData/Roaming/npm/opencode.cmd"),
            home.join("AppData/Roaming/npm/opencode.exe"),
            home.join("AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode.exe"),
            home.join(
                "AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe",
            ),
            home.join(
                "AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-arm64/bin/opencode.exe",
            ),
            home.join("AppData/Local/pnpm/opencode.cmd"),
            home.join("AppData/Local/pnpm/opencode.exe"),
            home.join("scoop/shims/opencode.cmd"),
            home.join("scoop/shims/opencode.exe"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn path_lookup_command_matches_current_platform() {
        let expected = if cfg!(windows) { "where" } else { "which" };

        assert_eq!(path_lookup_command(), expected);
    }

    #[test]
    fn first_existing_path_skips_empty_and_missing_lines() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-opencode");
        let opencode = dir.path().join("opencode");
        std::fs::write(&opencode, "#!/bin/sh\n").unwrap();

        let stdout = format!("\n{}\n{}\n", missing.display(), opencode.display());

        assert_eq!(first_existing_path(&stdout), Some(opencode));
    }

    #[test]
    fn windows_path_lookup_prefers_cmd_shim_over_extensionless_npm_script() {
        let dir = tempfile::tempdir().unwrap();
        let shell_script = dir.path().join("opencode");
        let cmd_shim = dir.path().join("opencode.cmd");
        std::fs::write(&shell_script, "#!/bin/sh\n").unwrap();
        std::fs::write(&cmd_shim, "@ECHO off\n").unwrap();

        let stdout = format!("{}\n{}\n", shell_script.display(), cmd_shim.display());

        assert_eq!(
            first_existing_path_for_platform(&stdout, true),
            Some(cmd_shim)
        );
    }

    #[test]
    fn env_candidates_include_explicit_opencode_path_and_prefixes() {
        let opencode_path = PathBuf::from(r"C:\Tools\opencode\opencode.exe");
        let nvm_bin = PathBuf::from(r"C:\Users\alex\AppData\Roaming\nvm\v22.0.0");
        let npm_prefix = PathBuf::from(r"C:\Users\alex\AppData\Roaming\npm");
        let pnpm_home = PathBuf::from(r"C:\Users\alex\AppData\Local\pnpm");

        let candidates = opencode_binary_candidates_from_env_values(OpencodeEnvCandidateRoots {
            opencode_path: Some(opencode_path.clone()),
            nvm_bin: Some(nvm_bin.clone()),
            npm_config_prefix: Some(npm_prefix.clone()),
            pnpm_home: Some(pnpm_home.clone()),
            ..OpencodeEnvCandidateRoots::default()
        });

        let expected = [
            opencode_path,
            nvm_bin.join("opencode.exe"),
            npm_prefix.join("opencode.cmd"),
            npm_prefix.join("node_modules/opencode-ai/bin/opencode.exe"),
            npm_prefix.join(
                "node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe",
            ),
            pnpm_home.join("opencode.cmd"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }

    #[test]
    fn env_candidates_accept_opencode_path_directory_and_desktop_roots() {
        let configured_dir = PathBuf::from(r"C:\Tools\opencode");
        let appdata = PathBuf::from(r"C:\Users\alex\AppData\Roaming");
        let localappdata = PathBuf::from(r"C:\Users\alex\AppData\Local");
        let program_files = PathBuf::from(r"C:\Program Files");

        let candidates = opencode_binary_candidates_from_env_values(OpencodeEnvCandidateRoots {
            opencode_path: Some(configured_dir.clone()),
            appdata: Some(appdata.clone()),
            localappdata: Some(localappdata.clone()),
            program_files: Some(program_files.clone()),
            ..OpencodeEnvCandidateRoots::default()
        });

        let expected = [
            configured_dir.join("opencode.exe"),
            appdata.join("npm/opencode.cmd"),
            localappdata.join("pnpm/opencode.exe"),
            localappdata.join("Programs/OpenCode/opencode.exe"),
            program_files.join("OpenCode/opencode.exe"),
        ];

        for candidate in expected {
            assert!(
                candidates.contains(&candidate),
                "missing {}",
                candidate.display()
            );
        }
    }
}
