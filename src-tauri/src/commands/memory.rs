use serde::Serialize;
use std::process::Command;

const WEBKIT_AUX_PID_WINDOW: u32 = 512;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryEntry {
    pub pid: u32,
    pub parent_pid: u32,
    pub rss_bytes: u64,
    pub role: String,
    pub command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemorySnapshot {
    pub current_pid: u32,
    pub total_rss_bytes: u64,
    pub entries: Vec<ProcessMemoryEntry>,
}

struct ProcessRow {
    pid: u32,
    parent_pid: u32,
    rss_kib: u64,
    command: String,
}

#[tauri::command]
pub fn get_process_memory_snapshot() -> Result<ProcessMemorySnapshot, String> {
    let current_pid = std::process::id();
    let entries = collect_related_process_memory(current_pid)?;
    let total_rss_bytes = entries.iter().map(|entry| entry.rss_bytes).sum();

    Ok(ProcessMemorySnapshot {
        current_pid,
        total_rss_bytes,
        entries,
    })
}

fn collect_related_process_memory(current_pid: u32) -> Result<Vec<ProcessMemoryEntry>, String> {
    let rows = read_process_rows()?;
    Ok(rows
        .into_iter()
        .filter_map(|row| related_process_entry(row, current_pid))
        .collect())
}

fn related_process_entry(row: ProcessRow, current_pid: u32) -> Option<ProcessMemoryEntry> {
    let role = classify_related_process(&row, current_pid)?;
    Some(ProcessMemoryEntry {
        pid: row.pid,
        parent_pid: row.parent_pid,
        rss_bytes: row.rss_kib.saturating_mul(1024),
        role,
        command: row.command,
    })
}

fn classify_related_process(row: &ProcessRow, current_pid: u32) -> Option<String> {
    if row.pid == current_pid {
        return Some("app".to_string());
    }
    if !is_nearby_webkit_auxiliary(row, current_pid) {
        return None;
    }

    if row.command.contains("WebKit.WebContent") {
        return Some("webkit-webcontent".to_string());
    }
    if row.command.contains("WebKit.GPU") {
        return Some("webkit-gpu".to_string());
    }
    if row.command.contains("WebKit.Networking") {
        return Some("webkit-networking".to_string());
    }
    Some("webkit".to_string())
}

fn is_nearby_webkit_auxiliary(row: &ProcessRow, current_pid: u32) -> bool {
    row.pid > current_pid
        && row.pid.saturating_sub(current_pid) <= WEBKIT_AUX_PID_WINDOW
        && row.command.contains("com.apple.WebKit.")
}

fn parse_process_row(line: &str) -> Option<ProcessRow> {
    let mut fields = line.split_whitespace();
    let pid = fields.next()?.parse().ok()?;
    let parent_pid = fields.next()?.parse().ok()?;
    let rss_kib = fields.next()?.parse().ok()?;
    let command = fields.collect::<Vec<_>>().join(" ");
    if command.is_empty() {
        return None;
    }

    Some(ProcessRow {
        pid,
        parent_pid,
        rss_kib,
        command,
    })
}

#[cfg(unix)]
fn read_process_rows() -> Result<Vec<ProcessRow>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,rss=,command="])
        .output()
        .map_err(|error| format!("Failed to sample process memory: {error}"))?;

    if !output.status.success() {
        return Err("Failed to sample process memory with ps".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter_map(parse_process_row).collect())
}

#[cfg(not(unix))]
fn read_process_rows() -> Result<Vec<ProcessRow>, String> {
    Err("Process memory snapshots are only implemented on Unix platforms".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_rows_with_spaced_commands() {
        let row = parse_process_row("  42   1 1024 /System/WebKit WebContent").unwrap();

        assert_eq!(row.pid, 42);
        assert_eq!(row.parent_pid, 1);
        assert_eq!(row.rss_kib, 1024);
        assert_eq!(row.command, "/System/WebKit WebContent");
    }

    #[test]
    fn classifies_nearby_webkit_auxiliaries() {
        let row = ProcessRow {
            pid: 120,
            parent_pid: 1,
            rss_kib: 10,
            command: "/System/com.apple.WebKit.WebContent.xpc".to_string(),
        };

        assert_eq!(
            classify_related_process(&row, 100),
            Some("webkit-webcontent".to_string()),
        );
    }

    #[test]
    fn ignores_unrelated_webkit_auxiliaries() {
        let row = ProcessRow {
            pid: 900,
            parent_pid: 1,
            rss_kib: 10,
            command: "/System/com.apple.WebKit.WebContent.xpc".to_string(),
        };

        assert_eq!(classify_related_process(&row, 100), None);
    }
}
