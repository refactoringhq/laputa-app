use super::AgentCommandTarget;
use std::path::{Path, PathBuf};

pub(super) fn command_target(binary: &Path) -> Result<Option<AgentCommandTarget>, String> {
    if !is_batch_shim(binary) {
        return Ok(None);
    }

    let Some(target) = target_path(binary) else {
        return Ok(None);
    };

    if is_node_script(&target) {
        return Ok(Some(AgentCommandTarget {
            program: crate::mcp::find_node()?,
            first_arg: Some(target),
        }));
    }

    Ok(Some(AgentCommandTarget {
        program: target,
        first_arg: None,
    }))
}

fn is_batch_shim(binary: &Path) -> bool {
    has_extension(binary, &["cmd", "bat"])
}

fn target_path(binary: &Path) -> Option<PathBuf> {
    let contents = std::fs::read_to_string(binary).ok()?;
    contents
        .split('"')
        .skip(1)
        .step_by(2)
        .find_map(|token| resolve_target_path(binary, token))
}

fn resolve_target_path(binary: &Path, token: &str) -> Option<PathBuf> {
    let relative = token
        .strip_prefix("%dp0%")
        .or_else(|| token.strip_prefix("%~dp0"))?
        .trim_start_matches(['\\', '/']);
    let mut target = binary.parent()?.to_path_buf();
    for part in relative.split(['\\', '/']).filter(|part| !part.is_empty()) {
        target.push(part);
    }
    is_supported_target(&target)
        .then_some(target)
        .filter(|target| target.is_file())
}

fn is_supported_target(path: &Path) -> bool {
    is_node_script(path) || is_native_executable(path)
}

fn is_node_script(path: &Path) -> bool {
    has_extension(path, &["js", "mjs", "cjs"])
}

fn is_native_executable(path: &Path) -> bool {
    has_extension(path, &["exe", "com"]) && !has_file_name(path, "node.exe")
}

fn has_extension(path: &Path, expected_extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            expected_extensions
                .iter()
                .any(|expected| extension.eq_ignore_ascii_case(expected))
        })
}

fn has_file_name(path: &Path, expected_name: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(expected_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_target_uses_native_exe_from_windows_cmd_shim() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("claude.cmd");
        let native_exe = dir
            .path()
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("bin")
            .join("claude.exe");
        std::fs::create_dir_all(native_exe.parent().unwrap()).unwrap();
        std::fs::write(dir.path().join("node.exe"), "node runtime").unwrap();
        std::fs::write(&native_exe, "native claude launcher").unwrap();
        std::fs::write(
            &shim,
            r#"@ECHO off
IF EXIST "%~dp0\node.exe" (
  SET "_prog=%~dp0\node.exe"
)
"%~dp0\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*
"#,
        )
        .unwrap();

        let target = command_target(&shim).unwrap().unwrap();

        assert_eq!(target.program, native_exe);
        assert_eq!(target.first_arg, None);
    }
}
