# periscope

Rust e2e test harness for the Tolaria native macOS app
(ADR-0115 Phase 6-MVP).  Captures PNG screenshots of a running
`tolaria` window so an AI assistant (Claude) — or a human running
the smoke test in CI — can observe the live UI between turns.

External observation via the OS compositor: subprocess + `xcap` for
capture and the `accessibility` crate for window discovery / raise.
Not in-process GPUI rendering — that path can't see the embedded
WKWebView editor body (sibling NSView; not in the Metal drawable).

---

## Quick start

```sh
# Terminal A — launch the app (user)
cargo run -p tolaria -- --vault demo-vault-v2

# Terminal B — one-shot screenshot (Claude or human)
cargo run -q -p periscope -- screenshot \
    --title Tolaria --raise --out /tmp/tolaria-now.png

# Open or Read /tmp/tolaria-now.png to inspect the live UI.
```

Long-debug-session pattern: background `watch` mode and read
`target/e2e/latest.png` periodically:

```sh
cargo run -q -p periscope -- watch \
    --title Tolaria --dir target/e2e/ --interval-secs 3
```

Synthesize a left-click at window-local coordinates (used by the
smoke test to drive the open-note flow without a human cursor):

```sh
cargo run -q -p periscope -- click \
    --title Tolaria --raise --x 200 --y 100
```

Click by element name (looks up bounds from the `tree_dump` JSON):

```sh
cargo run -q -p periscope -- click \
    --title Tolaria --raise --id status-bar-theme-toggle
```

Capture a screenshot cropped to a named element:

```sh
cargo run -q -p periscope -- screenshot \
    --title Tolaria --raise \
    --id status-bar-theme-toggle \
    --out /tmp/toggle.png
```

Diagnostic:

```sh
cargo run -q -p periscope -- list
# pid=12345 app=Tolaria title=Tolaria
# pid=67890 app=Terminal title=…
```

---

## macOS permissions

Two separate Privacy & Security panels — both must be granted to the
parent terminal application (iTerm / Terminal / Ghostty / Claude
Code itself, whichever launches the binary):

| Permission | Used for | Failure mode |
|---|---|---|
| **Screen Recording** | `xcap::Window::capture_image()` | All-black / tiny PNG.  Harness emits a remediation error mentioning `$TERM_PROGRAM`. |
| **Accessibility** | `AXUIElement::raise()` + window enumeration | `--raise` and `list` fail with `AXUIElement.windows attribute fetch failed`. |

Grant under **System Settings → Privacy & Security → Screen Recording**
and **… → Accessibility**.  Re-grant after the binary path changes
(e.g. switching `target/debug/` ↔ `target/release/`).

---

## Smoke test

```sh
cargo test -p periscope
```

Skipped by default — opt in with `TOLARIA_E2E_SMOKE=1` on a host that
has Screen Recording granted to the cargo-launching terminal:

```sh
TOLARIA_E2E_SMOKE=1 cargo test -p periscope
```

Spawns `tolaria --vault demo-vault-v2` as a child, polls for the
window every 500 ms (15 s deadline), captures a PNG, asserts size
> 100 kB (chosen to catch invisible-text regressions: a Tolaria
window without rendered glyphs serialises at ~88 kB; with text,
~260 kB), kills the child.

---

## Library API

```rust
use periscope::{click, screenshot, raise, list_windows, WindowTarget};

screenshot(&WindowTarget::ByTitle("Tolaria".into()), Path::new("out.png"))?;
raise(&WindowTarget::ByPid(12345))?;
click(&WindowTarget::ByTitle("Tolaria".into()), 200.0, 100.0)?;
for w in list_windows()? { println!("{}: {}", w.app_name, w.title); }
```

`screenshot`, `raise`, and `click` all accept
`WindowTarget::ByTitle(String)` or `WindowTarget::ByPid(u32)`.  Title
matches `xcap::Window::title()` exactly (Tolaria sets its title to
`"Tolaria"` at `crates/tolaria/src/main.rs:214`).  `click` coordinates
are window-local (origin at the top-left, in window points); the
harness translates to screen space using `xcap`'s reported window
origin before posting a `CGEvent` mouse-down + mouse-up pair.
