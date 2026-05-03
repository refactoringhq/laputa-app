use std::path::Path;
use std::process::{Command, Output, Stdio};

use super::git_command;

struct CloneRequest<'a> {
    url: &'a str,
    dest: &'a Path,
}

/// Clone a git repository to a local path using the system git configuration.
pub fn clone_repo(url: &str, local_path: &str) -> Result<String, String> {
    let dest = Path::new(local_path);
    let request = CloneRequest { url, dest };
    prepare_clone_destination(dest)?;

    if let Err(err) = run_clone(&request) {
        cleanup_failed_clone(dest);
        return Err(err);
    }

    Ok(format!("Cloned to {}", dest.display()))
}

fn prepare_clone_destination(dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        return ensure_parent_directory(dest);
    }

    ensure_empty_directory(dest)
}

fn ensure_empty_directory(dest: &Path) -> Result<(), String> {
    if !dest.is_dir() {
        return Err(format!(
            "Destination '{}' already exists and is not a directory",
            dest.display()
        ));
    }

    if directory_has_entries(dest)? {
        return Err(format!(
            "Destination '{}' already exists and is not empty",
            dest.display()
        ));
    }

    Ok(())
}

fn ensure_parent_directory(dest: &Path) -> Result<(), String> {
    let Some(parent) = dest.parent() else {
        return Ok(());
    };

    if parent.as_os_str().is_empty() {
        return Ok(());
    }

    std::fs::create_dir_all(parent).map_err(|e| {
        format!(
            "Failed to create parent directory for '{}': {}",
            dest.display(),
            e
        )
    })
}

fn directory_has_entries(dest: &Path) -> Result<bool, String> {
    dest.read_dir()
        .map_err(|e| format!("Failed to inspect destination '{}': {}", dest.display(), e))
        .map(|mut entries| entries.next().is_some())
}

fn run_clone(request: &CloneRequest<'_>) -> Result<(), String> {
    let destination = request.dest.to_str().ok_or_else(|| {
        format!(
            "Destination '{}' is not valid UTF-8",
            request.dest.display()
        )
    })?;
    let output = build_clone_command(request, destination)
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "git clone failed: {}",
        clone_failure_message(&output)
    ))
}

fn build_clone_command(request: &CloneRequest<'_>, destination: &str) -> Command {
    let mut command = git_command();
    command
        .args(["clone", "--quiet", request.url, destination])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null());
    command
}

fn clone_failure_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }

    format!("git clone exited with status {}", output.status)
}

fn cleanup_failed_clone(dest: &Path) {
    if dest.exists() && dest.is_dir() {
        let _ = std::fs::remove_dir_all(dest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::process::ExitStatusExt;
    use std::path::Path;
    use std::process::Command as StdCommand;

    fn init_source_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("welcome.md"), "# Welcome\n").unwrap();

        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.email", "tolaria@app.local"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.name", "Tolaria App"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    #[test]
    fn test_clone_repo_clones_local_repository() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("source");
        let dest = dir.path().join("dest");
        init_source_repo(&source);

        let result = clone_repo(source.to_str().unwrap(), dest.to_str().unwrap()).unwrap();

        assert_eq!(result, format!("Cloned to {}", dest.to_string_lossy()));
        assert!(dest.join(".git").exists());
        assert!(dest.join("welcome.md").exists());
    }

    #[test]
    fn test_clone_repo_nonempty_dest() {
        let dir = tempfile::TempDir::new().unwrap();
        fs::write(dir.path().join("existing.txt"), "data").unwrap();

        let result = clone_repo("https://example.com/repo.git", dir.path().to_str().unwrap());
        assert!(result.unwrap_err().contains("not empty"));
    }

    #[test]
    fn test_clone_repo_empty_dest_allowed() {
        let dir = tempfile::TempDir::new().unwrap();
        let dest = dir.path().join("empty-dir");
        fs::create_dir(&dest).unwrap();

        let result = clone_repo(
            "https://example.com/nonexistent/repo.git",
            dest.to_str().unwrap(),
        );
        assert!(result.unwrap_err().contains("git clone failed"));
    }

    #[test]
    fn test_clone_failure_message_falls_back_to_stdout() {
        let output = Output {
            status: std::process::ExitStatus::from_raw(128),
            stdout: b"fatal: stdout only".to_vec(),
            stderr: Vec::new(),
        };

        assert_eq!(clone_failure_message(&output), "fatal: stdout only");
    }

    #[test]
    fn test_build_clone_command_disables_interactive_prompts() {
        let dest = Path::new("/tmp/repo");
        let request = CloneRequest {
            url: "https://example.com/repo.git",
            dest,
        };
        let command = build_clone_command(&request, "/tmp/repo");
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|entry| entry.to_string_lossy().to_string()),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            envs.get("GIT_TERMINAL_PROMPT"),
            Some(&Some("0".to_string()))
        );
        assert_eq!(
            envs.get("SSH_ASKPASS_REQUIRE"),
            Some(&Some("never".to_string()))
        );
        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "core.quotePath=false".to_string(),
                "clone".to_string(),
                "--quiet".to_string(),
                "https://example.com/repo.git".to_string(),
                "/tmp/repo".to_string(),
            ]
        );
    }
}
