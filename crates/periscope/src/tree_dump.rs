//! Read side of Tolaria's `ui::tree_dump` SIGUSR1 IPC.
//!
//! Tolaria (debug builds) ships a tiny element-bounds registry that
//! every `.dump_as("name")`-tagged element writes to on each paint.
//! Sending `SIGUSR1` to the process makes it snapshot the registry to
//! `$TMPDIR/tolaria-ui-tree-<pid>.json` (atomic via tmp + rename).
//!
//! This module is the periscope-side reader.  It deliberately
//! duplicates `NamedBounds` instead of depending on the `ui` crate —
//! the JSON shape is the contract, and pulling `ui` into periscope
//! would drag GPUI / `gpui-component` into a harness that's supposed
//! to stay external.
//!
//! See `crates/ui/src/tree_dump.rs` for the writer side; the two
//! sides MUST agree on field names and the path format.

use anyhow::{Context as _, Result};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// One entry in the dump file.  Bounds are in **window-local logical
/// pixels** — the same coordinate space `periscope click --x --y`
/// accepts, so the click subcommand can pipe these straight through
/// without any transform.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct NamedBounds {
    /// Top-left x in logical points (origin at top-left of window).
    pub x: f32,
    /// Top-left y in logical points.
    pub y: f32,
    /// Width in logical points.
    pub width: f32,
    /// Height in logical points.
    pub height: f32,
}

impl NamedBounds {
    /// Geometric centre of the rectangle, in window-local logical
    /// points.  This is the point the `click --id` subcommand sends
    /// `CGEvent` mouse-down at.
    ///
    /// Computed in `f64` (with lossless `f32 -> f64` widening) so the
    /// midpoint isn't subject to single-precision rounding before it
    /// reaches `CGEvent`.
    pub fn center(&self) -> (f64, f64) {
        let x = f64::from(self.x);
        let y = f64::from(self.y);
        let w = f64::from(self.width);
        let h = f64::from(self.height);
        (x + w / 2.0, y + h / 2.0)
    }
}

/// Top-level wire format of `tolaria-ui-tree-<pid>.json`.  Mirrors
/// `ui::tree_dump::DumpFile`; the two sides MUST agree on field
/// names.  The `sequence` counter is bumped by every successful
/// writer-side `dump_to` and lets the reader detect a fresh dump
/// even when two writes land in the same `mtime` granularity bucket.
#[derive(Debug, Clone, Deserialize)]
pub struct DumpFile {
    /// Monotonic dump counter.
    pub sequence: u64,
    /// Element name → laid-out bounds.
    pub entries: BTreeMap<String, NamedBounds>,
}

/// Canonical dump path for a given Tolaria PID.  Must stay in sync
/// with `ui::tree_dump::default_dump_path_for_pid`.
pub fn default_dump_path_for_pid(pid: u32) -> PathBuf {
    let tmp = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    tmp.join(format!("tolaria-ui-tree-{pid}.json"))
}

/// Read and deserialise the dump file at `path`.  Used by both the
/// `click --id` subcommand and by integration tests that want to read
/// the bounds map directly.
pub fn load(path: &Path) -> Result<DumpFile> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("reading dump {path:?}"))?;
    serde_json::from_str(&raw).with_context(|| format!("parsing dump {path:?}"))
}

/// Read just the `sequence` counter, returning `0` when the file
/// is missing or malformed.  Used as the baseline by
/// [`wait_for_fresh_dump`] before sending SIGUSR1.
pub fn read_sequence(path: &Path) -> u64 {
    load(path).map(|d| d.sequence).unwrap_or(0)
}

/// Ask the Tolaria process to refresh its dump file by sending
/// `SIGUSR1` to `pid`.  Returns immediately; the writer side runs
/// on a dedicated thread inside the target process and typically
/// produces the file within a few ms.  Use [`wait_for_fresh_dump`]
/// to block until the file is observably newer than a reference
/// `mtime`.
///
/// Shells out to `/bin/kill -USR1 <pid>` rather than pulling in
/// `libc` / `nix` — keeps the periscope dep stack flat.
#[cfg(unix)]
pub fn request_dump_via_signal(pid: u32) -> Result<()> {
    let status = std::process::Command::new("kill")
        .arg("-USR1")
        .arg(pid.to_string())
        .status()
        .context("spawning kill -USR1")?;
    if !status.success() {
        anyhow::bail!("kill -USR1 {pid} exited with {status}");
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn request_dump_via_signal(_pid: u32) -> Result<()> {
    anyhow::bail!("tree_dump signal IPC is Unix-only")
}

/// Block until the dump file at `path` parses successfully and its
/// `sequence` is strictly greater than `previous_sequence`, or
/// `deadline` elapses.  Polls every 50 ms — well below the visible
/// UI tick rate but high enough to keep CPU noise out of the test
/// loop.
///
/// Sequence-based freshness sidesteps the `mtime`-granularity race
/// that two back-to-back dumps would expose on a fast filesystem:
/// the writer bumps `sequence` *before* the atomic write, so the
/// counter strictly increases across every successful refresh.
pub fn wait_for_fresh_dump(
    path: &Path,
    previous_sequence: u64,
    deadline: std::time::Instant,
) -> Result<DumpFile> {
    while std::time::Instant::now() < deadline {
        if let Ok(dump) = load(path) {
            if dump.sequence > previous_sequence {
                return Ok(dump);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    anyhow::bail!(
        "dump {path:?} did not refresh past sequence {previous_sequence} before deadline"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_bounds_center_is_midpoint() {
        let b = NamedBounds {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 30.0,
        };
        let (cx, cy) = b.center();
        assert_eq!(cx, 60.0);
        assert_eq!(cy, 35.0);
    }

    #[test]
    fn default_path_is_pid_keyed() {
        let p1 = default_dump_path_for_pid(123);
        let p2 = default_dump_path_for_pid(456);
        assert_ne!(p1, p2);
        assert!(p1.to_string_lossy().contains("123"));
    }

    #[test]
    fn load_parses_writer_schema() {
        // Matches the exact JSON shape `ui::tree_dump::dump_to` writes:
        // a top-level `sequence` counter alongside `entries`.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dump.json");
        std::fs::write(
            &path,
            r#"{
              "sequence": 7,
              "entries": {
                "status-bar-theme-toggle": {
                  "x": 1418.0,
                  "y": 1052.0,
                  "width": 28.0,
                  "height": 20.0
                }
              }
            }"#,
        )
        .unwrap();
        let dump = load(&path).unwrap();
        assert_eq!(dump.sequence, 7);
        let got = dump.entries.get("status-bar-theme-toggle").unwrap();
        assert_eq!(got.width, 28.0);
        assert_eq!(got.center(), (1432.0, 1062.0));
    }

    #[test]
    fn read_sequence_returns_zero_on_missing_or_bad_file() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.json");
        assert_eq!(read_sequence(&missing), 0, "missing file → 0");

        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "{not valid json").unwrap();
        assert_eq!(read_sequence(&bad), 0, "malformed file → 0");
    }
}
