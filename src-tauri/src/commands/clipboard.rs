#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::process::{Child, Command, Output, Stdio};
#[cfg(desktop)]
use std::thread;
#[cfg(desktop)]
use std::time::{Duration, Instant};

#[cfg(desktop)]
const NATIVE_CLIPBOARD_COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(desktop)]
const NATIVE_CLIPBOARD_COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[cfg(target_os = "macos")]
fn clipboard_command() -> Command {
    crate::hidden_command("pbcopy")
}

#[cfg(target_os = "macos")]
fn clipboard_read_command() -> Command {
    crate::hidden_command("pbpaste")
}

#[cfg(target_os = "windows")]
fn clipboard_command() -> Command {
    crate::hidden_command("clip.exe")
}

#[cfg(target_os = "windows")]
fn clipboard_read_command() -> Command {
    let mut command = crate::hidden_command("powershell.exe");
    command.args(["-NoProfile", "-Command", "Get-Clipboard -Raw"]);
    command
}

#[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows"))))]
fn clipboard_command() -> Command {
    let mut command = crate::hidden_command("sh");
    command.args([
        "-c",
        "if command -v wl-copy >/dev/null 2>&1; then wl-copy; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --input; else exit 127; fi",
    ]);
    command
}

#[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows"))))]
fn clipboard_read_command() -> Command {
    let mut command = crate::hidden_command("sh");
    command.args([
        "-c",
        "if command -v wl-paste >/dev/null 2>&1; then wl-paste; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -out; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --output; else exit 127; fi",
    ]);
    command
}

#[cfg(desktop)]
fn clipboard_failure_message(stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        "Native clipboard command failed".to_string()
    } else {
        format!("Native clipboard command failed: {message}")
    }
}

#[cfg(desktop)]
fn clipboard_timeout_message(timeout: Duration) -> String {
    format!(
        "Native clipboard command timed out after {}ms",
        timeout.as_millis()
    )
}

#[cfg(desktop)]
fn wait_for_native_clipboard_output(mut child: Child, timeout: Duration) -> Result<Output, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("Native clipboard command did not finish: {e}"));
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(clipboard_timeout_message(timeout));
            }
            Ok(None) => thread::sleep(NATIVE_CLIPBOARD_COMMAND_POLL_INTERVAL),
            Err(e) => return Err(format!("Native clipboard command did not finish: {e}")),
        }
    }
}

#[cfg(desktop)]
fn write_native_clipboard_with_timeout(
    mut command: Command,
    text: &str,
    timeout: Duration,
) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to open native clipboard command: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Native clipboard command did not expose stdin".to_string())?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|e| format!("Failed to write native clipboard text: {e}"))?;
    drop(stdin);

    let output = wait_for_native_clipboard_output(child, timeout)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(clipboard_failure_message(&output.stderr))
    }
}

#[cfg(desktop)]
fn write_native_clipboard(command: Command, text: &str) -> Result<(), String> {
    write_native_clipboard_with_timeout(command, text, NATIVE_CLIPBOARD_COMMAND_TIMEOUT)
}

#[cfg(desktop)]
fn read_native_clipboard_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<String, String> {
    let child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to read native clipboard text: {e}"))?;

    let output = wait_for_native_clipboard_output(child, timeout)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(clipboard_failure_message(&output.stderr))
    }
}

#[cfg(desktop)]
fn read_native_clipboard(command: Command) -> Result<String, String> {
    read_native_clipboard_with_timeout(command, NATIVE_CLIPBOARD_COMMAND_TIMEOUT)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || write_native_clipboard(clipboard_command(), &text))
        .await
        .map_err(|e| format!("Native clipboard task failed: {e}"))?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn read_text_from_clipboard() -> Result<String, String> {
    tokio::task::spawn_blocking(move || read_native_clipboard(clipboard_read_command()))
        .await
        .map_err(|e| format!("Native clipboard task failed: {e}"))?
}

#[cfg(mobile)]
#[tauri::command]
pub async fn copy_text_to_clipboard(_text: String) -> Result<(), String> {
    Err("Clipboard is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn read_text_from_clipboard() -> Result<String, String> {
    Err("Clipboard is not available on mobile".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(all(desktop, unix))]
    #[test]
    fn native_clipboard_write_times_out_slow_commands() {
        let mut command = Command::new("sh");
        command.args(["-c", "cat >/dev/null; sleep 2"]);

        let started = Instant::now();
        let result =
            write_native_clipboard_with_timeout(command, "copy me", Duration::from_millis(50));

        let error = result.expect_err("slow clipboard command should time out");
        assert!(
            error.contains("timed out"),
            "unexpected clipboard timeout error: {error}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "clipboard timeout should return promptly"
        );
    }
}
