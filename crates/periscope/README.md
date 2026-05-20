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

## Synthetic input

The `click` / `click --id` path was the first synthetic-input primitive;
phase-8 added four more so the editor-body gesture scenarios (slash
menu, side-menu hover, formatting toolbar over selection, wikilink
suggestion) can run end-to-end without a human at the keyboard.

**Motivation.**  `osascript keystroke` is blocked inside the WKWebView
editor body (see `AGENTS.md` §4 macOS gotchas), so the harness can't
lean on AppleEvent keyboard input for the cases that matter most.  Raw
`CGEvent` keyboard input *does* reach the editor body because WKWebView
listens on the same system event queue GPUI does — that's the layer
this section documents.

### `type-text` — synthesize text input

```sh
./target/debug/periscope type-text \
    --pid $BIN_PID --raise --text "Hello, world"

# Slash menu trigger (the canonical use case):
./target/debug/periscope type-text --pid $BIN_PID --text "/"

# Read from a file (multi-line; `\n` becomes a Return key):
./target/debug/periscope type-text \
    --pid $BIN_PID --raise --text "$(cat /tmp/snippet.txt)"
```

Walks the string one Unicode scalar at a time; each character is
dispatched as a `CGEventCreateKeyboardEvent` pair with the scalar
attached via `CGEventKeyboardSetUnicodeString`, so non-ASCII characters
and dead-key sequences work regardless of the host keyboard layout.
`\n` and `\t` map to `Return` and `Tab` virtual keys (not the literal
control chars) because BlockNote and most text fields handle those as
keystrokes, not inserted text.

| Flag | Default | Purpose |
|------|---------|---------|
| `--text <s>` | required | The string to type. |
| `--delay-ms <n>` | `8` | Per-character pause.  `0` is allowed but unstable on busy machines. |
| `--raise` | off | Bring the target window forward before typing. |

### `key` — synthesize a single key press

```sh
./target/debug/periscope key --pid $BIN_PID --raise --key "Return"
./target/debug/periscope key --pid $BIN_PID --raise --key "s" --modifiers cmd
./target/debug/periscope key --pid $BIN_PID --raise --key "Tab" --modifiers shift,opt
./target/debug/periscope key --pid $BIN_PID --raise --key "Escape"
```

Key names (case-insensitive):

| Class | Names |
|-------|-------|
| Editing | `Return` / `Enter`, `Tab`, `Escape` / `Esc`, `Space`, `Delete` / `Backspace`, `ForwardDelete` |
| Arrows | `Up`, `Down`, `Left`, `Right` |
| Navigation | `Home`, `End`, `PageUp`, `PageDown` |
| Function | `F1`–`F20` |
| Character | any single character — letters (case-insensitive), digits `0`-`9`, and the punctuation `` ` `` `-` `=` `[` `]` `\` `;` `'` `,` `.` `/` |

Modifier names accepted in `--modifiers` (comma-separated, in any
order, case-insensitive):

| Modifier | Synonyms |
|----------|----------|
| `cmd` | `command`, `meta` |
| `shift` | — |
| `opt` | `option`, `alt` |
| `ctrl` | `control` |
| `fn` | `function` |

### `hover` — move the cursor without clicking

```sh
./target/debug/periscope hover --pid $BIN_PID --raise --x 220 --y 220
./target/debug/periscope hover --pid $BIN_PID --raise --id note-list-row-0
```

Posts a single `MouseMoved` `CGEvent`.  Useful for hover-only UI such
as BlockNote's side-menu `⋮⋮` handle, which only appears while the
cursor sits over an editor block.  Same `--x`/`--y` vs `--id` modes as
`click`.

### `double-click` — synthesize a double-click

```sh
./target/debug/periscope double-click --pid $BIN_PID --raise --x 220 --y 220
./target/debug/periscope double-click --pid $BIN_PID --raise --id editor-block-body
```

Two `LeftMouseDown` / `LeftMouseUp` pairs separated by ~60 ms with
`MOUSE_EVENT_CLICK_STATE` set to `1` then `2`, so AppKit treats the
pair as a single double-click gesture rather than two independent
single-clicks.  Same `--x`/`--y` vs `--id` modes as `click`.

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

A second opt-in test, `synthetic_input_smoke`, exercises each of the
new synthetic-input primitives (`hover`, `key`, `type-text`,
`double-click`) against the live app and only asserts they don't
error — visual verification of the resulting UI state is the job of
the phase-8 sweep.  Same env-var gate:

```sh
TOLARIA_E2E_SMOKE=1 cargo test -p periscope synthetic_input_smoke
```

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
