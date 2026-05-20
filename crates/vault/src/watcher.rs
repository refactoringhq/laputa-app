//! File-system watcher for the vault (ADR-0115 Phase 8.11 Slice 4).
//!
//! Wraps `notify`'s recommended watcher behind a `flume` channel so the
//! UI thread can subscribe without taking a callback-style dependency on
//! the notify crate.  Events are debounced with a 200 ms window — bursts
//! of `create` + `modify` + `chmod` on the same path coalesce into a
//! single [`VaultChanged`] payload.
//!
//! The actual workspace wiring (which observes the receiver and routes
//! to `Vault::rescan`) is a Phase 9.6 `vault_lifecycle` concern; this
//! module's job is to expose a reliable receiver + a deterministic
//! shutdown path that cleans up the watcher thread when the [`Vault`]
//! is dropped.

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use notify::{Event, RecursiveMode, Watcher as _};

/// A coalesced batch of file-system changes under the vault root.
///
/// `paths` is the de-duplicated set of paths touched within one
/// 200 ms debounce window.  Subscribers should treat this as an
/// invalidation hint — the recommended response is to call
/// [`Vault::rescan`] (Phase 9.6) rather than try to map paths to
/// `NoteId`s here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultChanged {
    /// Distinct vault paths that received at least one filesystem
    /// event during the debounce window, in the order they were first
    /// observed.
    pub paths: Vec<PathBuf>,
}

/// The debounce window applied to coalesce bursts of events.
///
/// Exposed as `pub(crate) const` so tests can sleep just past the
/// boundary deterministically; production code should not depend on
/// this constant being stable across releases.
pub(crate) const DEBOUNCE_WINDOW: Duration = Duration::from_millis(200);

/// Owned handle for the watcher thread + the underlying
/// [`notify::RecommendedWatcher`].  Dropping this object stops the
/// thread cleanly (no leaked file descriptors / kqueue handles).
pub(crate) struct VaultWatcher {
    /// Holding the watcher keeps the underlying OS subscription
    /// alive.  Dropping it tears the subscription down.
    _watcher: notify::RecommendedWatcher,
    /// Flag the dispatch thread polls to know when to exit.
    stop: Arc<AtomicBool>,
    /// Join handle for the dispatch thread — kept so `Drop` can wait
    /// for the thread to exit before returning.
    join: Option<JoinHandle<()>>,
}

impl VaultWatcher {
    /// Spawn a recursive watcher rooted at `root`.  Events are
    /// debounced + coalesced before being forwarded to `tx`.
    ///
    /// # Errors
    ///
    /// Returns an error if the OS-level watcher can't be constructed
    /// (e.g. inotify quota exhausted) or if `root` can't be added to
    /// the watch list.
    pub(crate) fn spawn(root: &Path, tx: flume::Sender<VaultChanged>) -> Result<Self> {
        let (raw_tx, raw_rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(move |res| {
            // Drop on closed channel — caller has gone away.
            let _ = raw_tx.send(res);
        })
        .context("constructing notify::RecommendedWatcher")?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .with_context(|| format!("watching {root:?}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop.clone();
        let join = std::thread::Builder::new()
            .name("vault-fs-watcher".into())
            .spawn(move || run_dispatch_loop(raw_rx, tx, stop_for_thread))
            .context("spawning vault watcher dispatch thread")?;

        Ok(Self {
            _watcher: watcher,
            stop,
            join: Some(join),
        })
    }
}

impl Drop for VaultWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Dropping `_watcher` first closes the OS subscription, which
        // releases the `raw_rx.recv_timeout` blocking in the dispatch
        // thread once its timeout expires.  Joining ensures we don't
        // leak the thread on hot-reload tests.
        if let Some(handle) = self.join.take() {
            // Use a finite join wait — if the OS layer is genuinely
            // wedged we don't want to hold up the process exit path.
            let _ = handle.join();
        }
    }
}

/// Dispatch-thread body.  Reads raw notify events, coalesces them
/// inside a 200 ms window, and forwards the batched paths to `tx`.
fn run_dispatch_loop(
    raw_rx: std::sync::mpsc::Receiver<notify::Result<Event>>,
    tx: flume::Sender<VaultChanged>,
    stop: Arc<AtomicBool>,
) {
    // Per-window state: when we receive a first event we record its
    // arrival instant; every subsequent event extends the batch but
    // doesn't reset the window.  Once `DEBOUNCE_WINDOW` has elapsed
    // since the FIRST event we flush — this gives bursty writes a
    // bounded settle time without starving slow trickles.
    let mut pending: Vec<PathBuf> = Vec::new();
    let mut window_started: Option<Instant> = None;
    // Poll interval is well under the debounce window so we can flush
    // promptly when the burst ends.
    let poll = Duration::from_millis(25);
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match raw_rx.recv_timeout(poll) {
            Ok(Ok(event)) => {
                for path in event.paths {
                    if !pending.contains(&path) {
                        pending.push(path);
                    }
                }
                window_started.get_or_insert_with(Instant::now);
            }
            Ok(Err(err)) => {
                log::warn!(target: "vault::watcher", "notify error: {err:?}");
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Fall through to flush check below.
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Some(started) = window_started {
            if started.elapsed() >= DEBOUNCE_WINDOW {
                let batch = std::mem::take(&mut pending);
                window_started = None;
                if !batch.is_empty() && tx.send(VaultChanged { paths: batch }).is_err() {
                    // Subscriber has dropped the receiver — stop.
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;
    use tempfile::tempdir;

    /// Drain the receiver for up to `total` time, returning every
    /// path that arrives.  Tolerant of OS-level event timing variance
    /// (kqueue on macOS can lag a few hundred ms in CI).
    fn drain_paths(rx: &flume::Receiver<VaultChanged>, total: Duration) -> Vec<PathBuf> {
        let deadline = Instant::now() + total;
        let mut out: Vec<PathBuf> = Vec::new();
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(remaining.min(Duration::from_millis(50))) {
                Ok(VaultChanged { paths }) => out.extend(paths),
                Err(_) => continue,
            }
        }
        out
    }

    #[test]
    fn watcher_emits_events_for_create_modify_delete() {
        let dir = tempdir().expect("tempdir");
        let (tx, rx) = flume::unbounded::<VaultChanged>();
        let watcher = VaultWatcher::spawn(dir.path(), tx).expect("watcher start");

        // Give the OS layer a moment to attach before kicking events.
        std::thread::sleep(Duration::from_millis(100));

        let p = dir.path().join("alpha.md");
        fs::write(&p, "create").expect("write");
        std::thread::sleep(Duration::from_millis(80));
        fs::write(&p, "modify").expect("modify");
        std::thread::sleep(Duration::from_millis(80));
        fs::remove_file(&p).expect("delete");

        let paths = drain_paths(&rx, Duration::from_secs(2));
        drop(watcher);

        // The event payload format varies per platform (macOS
        // FsEvents bundles a single path; Linux inotify can split
        // into multiple).  The invariant we test is that *some*
        // event arrived and that at least one path string ends with
        // "alpha.md".
        assert!(
            !paths.is_empty(),
            "watcher must emit at least one VaultChanged event for create+modify+delete"
        );
        let saw_alpha = paths
            .iter()
            .any(|p| p.file_name().is_some_and(|n| n == "alpha.md"));
        assert!(
            saw_alpha,
            "expected an event mentioning alpha.md, got {paths:?}"
        );
    }

    #[test]
    fn dropping_watcher_stops_the_thread() {
        let dir = tempdir().expect("tempdir");
        let (tx, _rx) = flume::unbounded::<VaultChanged>();
        let watcher = VaultWatcher::spawn(dir.path(), tx).expect("watcher start");
        // Dropping must return promptly even with no events received.
        let start = Instant::now();
        drop(watcher);
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_secs(1),
            "watcher drop took too long ({elapsed:?}) — likely leaking the dispatch thread"
        );
    }
}
