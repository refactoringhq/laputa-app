//! End-to-end smoke test for the `periscope` harness.
//!
//! Builds the `tolaria` binary via `cargo build -p tolaria`, then
//! execs `target/debug/tolaria --vault demo-vault-v2` directly so
//! `child.id()` is the binary's pid (not a `cargo run` wrapper).
//! Polls for the window to appear, then exercises both `screenshot`
//! and `click`:
//!
//! 1. Capture `periscope-smoke-before.png` (note list rendered, center
//!    pane empty).
//! 2. Synthesize a left-click at `(200, 100)` window-local — the first
//!    note row in `NoteListPane`.
//! 3. Capture `periscope-smoke-after.png` once the UI has had time to
//!    react.
//! 4. Assert each PNG passes the size threshold AND the two captures
//!    differ — i.e. the click reached the row and `OpenNoteEvent`
//!    actually mounted the `NoteItem` placeholder in the center pane.
//!
//! Opt-in via `TOLARIA_E2E_SMOKE=1`.  The test is skipped by default
//! because the host needs Screen Recording permission granted to the
//! cargo-launching terminal — set the env var only on a workstation
//! where that's true (headless CI typically isn't).

#![cfg(target_os = "macos")]

use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const SMOKE_TIMEOUT_SECS: u64 = 15;
const SMOKE_POLL_INTERVAL_MS: u64 = 500;

/// Logical-point window dimensions taken from the Tauri-era reference
/// captures at `docs/plans/native-gpui-chrome/tolaria-demo-vault-v2-{light,dark}.png`.
/// The PNGs are 3032×2104 physical pixels at 2× Retina, so the
/// designer-intended logical size is 1516×1052.  Passing these
/// explicitly via `--width` / `--height` pins the window to the
/// reference geometry regardless of what's currently persisted in
/// `~/Library/Application Support/Tolaria/settings.json` on the host.
const REFERENCE_WIDTH: u32 = 1516;
const REFERENCE_HEIGHT: u32 = 1052;

/// Window-local coordinates of the first row in `NoteListPane`.
/// Title bar ≈ 28 pt + filter strip 32 pt + ~half a row → ~y = 100 lands
/// reliably inside the first list row; x = 200 sits inside the left dock
/// for any reasonable initial window width.
const FIRST_NOTE_ROW_X: f64 = 200.0;
const FIRST_NOTE_ROW_Y: f64 = 100.0;

/// AppKit needs a moment after the synthetic click for the
/// `OpenNoteEvent` → `add_item_to_active_pane` round-trip to land and
/// the center pane to repaint with the `NoteItem` placeholder.  500 ms
/// is comfortably above the observed settling time without being
/// perceptibly slow for the smoke test.
const CLICK_SETTLE_MS: u64 = 500;

/// Threshold tuned to catch the "invisible glyphs" regression discovered in
/// Phase 6-MVP verification: a Tolaria window that renders chrome geometry
/// but no text serialises at ~88 kB; one with text reaches ~260 kB on the
/// reference machine.  100 kB sits comfortably above the no-text floor and
/// well below typical real captures.  Bumping this number is a deliberate
/// trade-off — keep it strict enough that `gpui_platform`'s `font-kit`
/// feature getting dropped (silent at the GPUI layer) trips the smoke test.
const MIN_USEFUL_PNG_BYTES: u64 = 100_000;

/// RAII wrapper around the spawned `tolaria` child so a panicking
/// assertion still tears the GPUI window down on stack unwind.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl ChildGuard {
    fn id(&self) -> u32 {
        self.0.id()
    }
}

#[test]
fn screenshot_smoke() {
    if std::env::var("TOLARIA_E2E_SMOKE").is_err() {
        eprintln!("periscope::screenshot_smoke skipped (TOLARIA_E2E_SMOKE not set)");
        return;
    }

    let vault_path = repo_root().join("demo-vault-v2");
    assert!(
        vault_path.is_dir(),
        "demo-vault-v2 missing at {vault_path:?} — smoke test fixture is broken"
    );

    // First, ensure the binary is built — without this `cargo run` would
    // print compilation noise that the test framework would log against
    // this test.  We run a separate `cargo build` step, then exec the
    // binary directly so `child.id()` returns the binary's pid (and not
    // the surrounding `cargo` wrapper's).
    let build_status = Command::new("cargo")
        .args(["build", "-p", "tolaria"])
        .current_dir(repo_root())
        .status()
        .expect("cargo build -p tolaria");
    assert!(build_status.success(), "cargo build -p tolaria failed");

    let bin = repo_root().join("target").join("debug").join("tolaria");
    assert!(
        bin.is_file(),
        "tolaria binary missing at {bin:?} after cargo build"
    );

    let child = Command::new(&bin)
        .arg("--vault")
        .arg(&vault_path)
        .arg("--width")
        .arg(REFERENCE_WIDTH.to_string())
        .arg("--height")
        .arg(REFERENCE_HEIGHT.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn tolaria");
    let guard = ChildGuard(child);

    let pid = guard.id();
    let target = periscope::WindowTarget::ByPid(pid);
    let tmp_dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let before_path = tmp_dir.join("periscope-smoke-before.png");
    let after_path = tmp_dir.join("periscope-smoke-after.png");
    let deadline = Instant::now() + Duration::from_secs(SMOKE_TIMEOUT_SECS);

    // Phase 1 — poll until the window appears, then capture the initial
    // state (note list rendered, center pane empty).
    let before_capture = loop {
        match periscope::screenshot(&target, &before_path) {
            Ok(path) => break Ok(path),
            Err(err) if Instant::now() < deadline => {
                eprintln!("periscope::screenshot_smoke: waiting for window ({err:#})");
                thread::sleep(Duration::from_millis(SMOKE_POLL_INTERVAL_MS));
            }
            Err(err) => break Err(err),
        }
    };

    let before_path = before_capture.expect("initial screenshot within the deadline");
    let before_bytes = std::fs::read(&before_path).expect("read initial smoke PNG");
    assert!(
        before_bytes.len() as u64 >= MIN_USEFUL_PNG_BYTES,
        "initial PNG too small ({} bytes) — Screen Recording permission \
         missing or font rendering broken (see `Cargo.toml` font-kit note)",
        before_bytes.len(),
    );

    // Phase 2 — synthesize a click on the first note row, give AppKit
    // time to paint the resulting `NoteItem` placeholder, then capture
    // again.  Raise the window first so the click reaches the right
    // process even if focus drifted between launch and now.
    periscope::raise(&target).expect("raise tolaria window before click");
    thread::sleep(Duration::from_millis(250));
    periscope::click(&target, FIRST_NOTE_ROW_X, FIRST_NOTE_ROW_Y)
        .expect("synthesize click on first note row");
    thread::sleep(Duration::from_millis(CLICK_SETTLE_MS));

    let after_path =
        periscope::screenshot(&target, &after_path).expect("post-click screenshot succeeds");
    let after_bytes = std::fs::read(&after_path).expect("read post-click smoke PNG");
    assert!(
        after_bytes.len() as u64 >= MIN_USEFUL_PNG_BYTES,
        "post-click PNG too small ({} bytes) — Tolaria likely crashed \
         on the click (e.g. `OpenNoteEvent` re-entrancy regression)",
        after_bytes.len(),
    );

    // The click MUST have changed something on screen.  Identical PNGs
    // mean either: the click missed the row (coordinates drifted from
    // the NoteListPane layout), the click reached the row but no event
    // was emitted (NoteListPane subscription broke), or the
    // subscription fired but `add_item_to_active_pane` no-op'd
    // (workspace center-pane wiring regressed).  All three are real
    // defects worth catching.
    assert_ne!(
        before_bytes, after_bytes,
        "click at ({FIRST_NOTE_ROW_X}, {FIRST_NOTE_ROW_Y}) didn't change \
         the rendered output — note-open flow is broken end-to-end"
    );

    // `guard` drops here (or on assertion-unwind above), killing the
    // GPUI window regardless of test outcome.
}

/// Exercise the synthetic-input primitives (`type-text`, `key`, `hover`,
/// `double-click`) against the live app.  Like [`screenshot_smoke`],
/// requires Screen Recording + Accessibility on the cargo-launching
/// terminal — opt in with `TOLARIA_E2E_SMOKE=1`.
///
/// The assertion is intentionally weak ("primitives don't error out");
/// the value here is catching the obvious wiring breakage where a new
/// CLI subcommand can't even resolve the target window or compose the
/// CGEvent.  Visual verification (did the keystrokes land in the
/// editor?) is the job of the phase-8 sweep, not this smoke pass.
#[test]
fn synthetic_input_smoke() {
    if std::env::var("TOLARIA_E2E_SMOKE").is_err() {
        eprintln!("periscope::synthetic_input_smoke skipped (TOLARIA_E2E_SMOKE not set)");
        return;
    }

    let vault_path = repo_root().join("demo-vault-v2");
    assert!(
        vault_path.is_dir(),
        "demo-vault-v2 missing at {vault_path:?}"
    );

    let build_status = Command::new("cargo")
        .args(["build", "-p", "tolaria"])
        .current_dir(repo_root())
        .status()
        .expect("cargo build -p tolaria");
    assert!(build_status.success(), "cargo build -p tolaria failed");

    let bin = repo_root().join("target").join("debug").join("tolaria");
    let child = Command::new(&bin)
        .arg("--vault")
        .arg(&vault_path)
        .arg("--width")
        .arg(REFERENCE_WIDTH.to_string())
        .arg("--height")
        .arg(REFERENCE_HEIGHT.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn tolaria");
    let guard = ChildGuard(child);

    let pid = guard.id();
    let target = periscope::WindowTarget::ByPid(pid);
    let deadline = Instant::now() + Duration::from_secs(SMOKE_TIMEOUT_SECS);
    let tmp_dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let warmup_path = tmp_dir.join("periscope-synthetic-warmup.png");

    // Phase 1 — wait for the window to appear (reusing the screenshot
    // poll as the readiness signal so the test doesn't race the startup).
    loop {
        match periscope::screenshot(&target, &warmup_path) {
            Ok(_) => break,
            Err(err) if Instant::now() < deadline => {
                eprintln!("synthetic_input_smoke: waiting for window ({err:#})");
                thread::sleep(Duration::from_millis(SMOKE_POLL_INTERVAL_MS));
            }
            Err(err) => panic!("window never appeared: {err:#}"),
        }
    }

    periscope::raise(&target).expect("raise tolaria");
    thread::sleep(Duration::from_millis(250));

    // Hover over the centre of the window — should never error even if
    // nothing is there to react.
    periscope::hover(&target, 400.0, 200.0).expect("hover should not error");

    // Synthesize Escape — a no-op when no modal is open, but proves the
    // key-press path resolves the keycode and posts the event.
    periscope::press_named_key(&target, "Escape", "").expect("key Escape should not error");

    // Type a short ASCII string into focus.  We don't assert anything
    // about the editor body here — that's the job of the sweep doc —
    // just that the primitive doesn't error and the burst doesn't crash
    // the app.  Use a tiny delay so the test isn't slow.
    periscope::type_text(&target, "abc", 4).expect("type-text should not error");

    // Synthesize a double-click somewhere safe (top-left of the workspace
    // chrome, well above the editor body).  Should not crash the target.
    periscope::double_click(&target, 50.0, 50.0).expect("double-click should not error");

    // Final settle + capture so a future regression investigation has a
    // post-state PNG to look at.
    thread::sleep(Duration::from_millis(250));
    let final_path = tmp_dir.join("periscope-synthetic-after.png");
    periscope::screenshot(&target, &final_path).expect("post-sequence screenshot");
}

/// Repo root deduced from `CARGO_MANIFEST_DIR`, which Cargo sets to
/// `crates/periscope/`.  Going up two levels lands on the workspace
/// root that owns `demo-vault-v2/`.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root above crates/periscope")
        .to_path_buf()
}
