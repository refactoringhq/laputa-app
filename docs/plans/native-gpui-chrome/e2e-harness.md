# e2e harness — Claude workflow for observing Tolaria

`crates/periscope/` is the screenshot harness that lets Claude (the
AI assistant) inspect a running `tolaria` window via its multimodal
`Read` tool.  This doc captures the typical flows Claude follows
during interactive debugging.

For library / CLI reference see `crates/periscope/README.md`.

---

## Setup, once per machine

1. Build the binaries: `cargo build -p tolaria -p periscope`.
2. Grant the parent terminal application **Screen Recording**
   permission under **System Settings → Privacy & Security →
   Screen Recording**.  Required for any capture to return a
   non-black PNG.
3. Grant the same terminal **Accessibility** permission (under
   **… → Accessibility**) — needed for the `--raise` flag and
   the `list` subcommand.

> **Run the binary directly during a session.**  `cargo run -p
> periscope -- …` re-walks the cargo metadata graph on every
> invocation (~300 ms per call even when up-to-date), which compounds
> badly across multi-capture sweeps and per-tick `watch` polls.  After
> the initial `cargo build -p periscope`, invoke
> `./target/debug/periscope …` directly — every example below uses
> that path.  For a release build, `cargo build -p periscope --release`
> then `./target/release/periscope …`.  Rebuild whenever the periscope
> source changes (CI does this automatically; for local hacking,
> re-run `cargo build -p periscope` after edits).

Confirm with the smoke test (opt-in via env var so the default
`cargo test` lane stays green on permission-less hosts):

```sh
TOLARIA_E2E_SMOKE=1 cargo test -p periscope
```

It spawns `tolaria --vault demo-vault-v2` against the demo fixture,
captures a PNG, asserts the file is > 100 kB (sized to catch the
`font-kit` regression — a window without rendered text serialises
at ~88 kB), and tears the child down.  If it errors with "PNG too
small", revisit the Screen Recording grant for the terminal that
ran the test.

---

## One-shot screenshot (the common case)

> **Targeting note.**  Tolaria's NSWindow has `title: None` (the
> custom titlebar strip lives inside the GPUI workspace), so
> `--title Tolaria` no longer resolves.  Every periscope invocation
> below uses `--pid` instead.  Resolve the pid with `pgrep` (one-shot)
> or from the spawn harness banner (multi-capture sessions — see
> [§Long debug session](#long-debug-session--spawn-harness)).

```sh
# Terminal A — user starts the app once.  `--width` / `--height`
# pin the window to the logical-point size of the Tauri-era
# reference captures (`docs/plans/native-gpui-chrome/tolaria-demo-vault-v2-*.png`,
# 3032×2104 @ 2× Retina) so harness screenshots line up with
# the references without any window-resizing wrangling.
cargo run -p tolaria -- \
    --vault demo-vault-v2 \
    --width 1516 --height 1052

# Terminal B — Claude (via the Bash tool) captures the current state.
# `pgrep -nf` picks the newest matching process.
BIN_PID=$(pgrep -nf 'target/debug/tolaria --vault')
./target/debug/periscope screenshot \
    --pid $BIN_PID --raise --out /tmp/tolaria-now.png
```

Then Claude calls `Read /tmp/tolaria-now.png` — the multimodal Read
returns the image content directly to the model.

`--raise` brings the Tolaria window forward via the Accessibility
API before capture.  Drop it if the window is already focused (saves
a ~250 ms settle delay).

`--width` / `--height` are independent overrides for the persisted
`WindowSettings` in `~/Library/Application Support/Tolaria/settings.json`.
Each takes a strictly-positive `f32` in logical points; omit either
to fall back to the persisted value.  The smoke test passes both —
see `crates/periscope/tests/screenshot_smoke.rs`.

---

## Driving the UI — `click` subcommand

When inspection alone isn't enough — e.g. you want to verify the
note-open flow lands an item in the center pane — synthesize a
left-click at a window-local coordinate:

```sh
./target/debug/periscope click \
    --pid $BIN_PID --raise --x 200 --y 100
```

Coordinates are in window points with the origin at the window's
top-left corner (matching GPUI's layout coordinates).  The harness
translates to screen space via `xcap::Window::x()` / `.y()` before
posting a `CGEvent` mouse-down + mouse-up pair through the OS event
queue, so GPUI's own hit-testing sees the click as if it had come
from a real cursor.

This is what the smoke test uses to exercise `NoteListPane`'s
`OpenNoteEvent` end-to-end: capture before, click at the first row,
capture after, assert the rendered output differs.  See
`crates/periscope/tests/screenshot_smoke.rs`.

The Accessibility-API path that GPUI components offer is *not* an
option — GPUI draws controls into a Metal layer, so the AX
hierarchy doesn't see them and `AXUIElementPerformAction` never
reaches the click handlers.  CGEvent is the only path that works.

---

## Driving the UI by element name — `dump-tree` + `click --id`

Hand-picked pixel coordinates rot the moment a layout tweak shifts an
element.  For stable targets, Tolaria (in debug builds) ships a
SIGUSR1-triggered **element-tree dump** that records the laid-out
window-local bounds of every `.dump_as("name")`-tagged element.
Periscope reads that JSON to translate names → click coordinates.

Typical loop:

```sh
# 1. Discover what's available (refreshes the dump first):
./target/debug/periscope dump-tree --pid $BIN_PID

# 2. Drive a click by name:
./target/debug/periscope click \
    --pid $BIN_PID --raise --id status-bar-theme-toggle
```

### `dump-tree` — discover + diagnose

`dump-tree` is the **diagnostic surface**: it triggers a fresh SIGUSR1
snapshot, waits for the on-disk sequence counter to bump, then
pretty-prints every name → bounds in the registry.  Use it to find
what's registered, sanity-check element geometry after a layout
change, or diagnose `click --id: no element registered as "..."`
errors.

```sh
./target/debug/periscope dump-tree --pid $BIN_PID
```

Output is one header line plus one row per registered element,
aligned for legibility:

```
# tree_dump  pid=15654  path="/var/folders/.../tolaria-ui-tree-15654.json"  sequence=1  entries=1
status-bar-theme-toggle                  x= 1422.0 y= 1056.5 w=  27.0 h=  19.5
```

- `pid` — owning process id (passed via `--pid`).
- `path` — JSON file the dump was written to (under `$TMPDIR`,
  falls back to `/tmp/`).
- `sequence` — monotonic counter bumped by every successful dump.
  Two consecutive `dump-tree` runs against the same Tolaria
  instance show `sequence=N` then `sequence=N+1`; a reset to `1`
  means Tolaria was restarted.
- `entries` — count of `.dump_as("name")`-tagged elements that
  participated in the most recent paint pass.

Flags:

| Flag | Default | Purpose |
|------|---------|---------|
| `--title <s>` *or* `--pid <u32>` | — | Exactly one is required.  `--title` is exact-match against the OS window title and **does not resolve for Tolaria** (the window has `title: None`); use `--pid` for any Tolaria target. |
| `--no-refresh` | off | Skip the SIGUSR1 trigger; print whatever's on disk.  Useful when the target is paused under `lldb` or you want to see the snapshot from a previous run. |
| `--timeout-ms <ms>` | `2000` | How long to wait for the writer to bump the sequence counter before erroring out. |

`dump-tree` is intentionally distinct from `click --id` so it can be
used purely as a registry probe — it never moves the cursor and
never modifies the target's state.  It's the safe diagnostic when
something doesn't show up where you expected.

#### Reading the JSON directly

`dump-tree`'s pretty-print is a convenience wrapper.  The JSON file
itself is the contract:

```json
{
  "sequence": 1,
  "entries": {
    "status-bar-theme-toggle": {
      "x": 1422.0,
      "y": 1056.5,
      "width": 27.0,
      "height": 19.5
    }
  }
}
```

Coordinates are in **window-frame logical points** (origin at the
top-left of the frame *including* the native macOS title bar) —
the same coordinate system `periscope click --x --y` expects.  No
transform is needed between the dump and a click.

Trigger a fresh dump from any shell without going through periscope:

```sh
kill -USR1 $(pgrep -f "target/debug/tolaria --vault")
cat "$TMPDIR/tolaria-ui-tree-$(pgrep -f "target/debug/tolaria --vault").json"
```

### `click --id` — click an element by name

```sh
./target/debug/periscope click \
    --pid $BIN_PID --raise --id status-bar-theme-toggle
```

Same flags as `dump-tree` (`--title`/`--pid`, `--no-refresh`,
`--timeout-ms`) plus:

| Flag | Default | Purpose |
|------|---------|---------|
| `--id <name>` | required | The `.dump_as("name")` identifier to click. |
| `--raise` | off | Bring the target forward via the Accessibility API before clicking (mirrors `screenshot --raise`). |

The flow under the hood:

1. `periscope` resolves the target window's PID (via `xcap`).
2. `periscope` reads the current `sequence` from the on-disk JSON
   (or `0` if missing/malformed).
3. `periscope` sends `SIGUSR1` to the PID.
4. Tolaria's `ui::tree_dump` signal-handler thread snapshots its
   registry (every paint pass writes laid-out bounds for opted-in
   elements), bumps `sequence`, and writes
   `$TMPDIR/tolaria-ui-tree-<pid>.json` atomically (tmp + rename).
5. `periscope` polls the file every 50 ms until `sequence`
   strictly exceeds the value read in step 2, or `--timeout-ms`
   expires.  Sequence-based freshness sidesteps the `mtime`
   collision race two back-to-back writes would otherwise produce
   on filesystems with coarse timestamp resolution.
6. `periscope` reads the JSON, looks up `--id`, and calls
   `periscope::click(target, center_x, center_y)` at the
   geometric centre of the recorded bounds.

Coordinate-space note: the JSON's `y` is **frame-relative** (includes
the 28 pt native title bar offset).  GPUI hands `paint` callbacks
content-area-relative bounds; `tolaria/src/main.rs` calls
`ui::tree_dump::set_window_y_offset(workspace::NATIVE_TITLE_BAR_HEIGHT_PT)`
at startup so the offset is applied at register time and the dump
ends up in the same coordinate system as `periscope click --x --y`.
Bumping the chrome's title-bar spacer stays a one-line change
because the constant lives in `workspace` and is referenced from
both the spacer `div` and the dump wiring.

### Opting an element in

Add `.dump_as("stable-name")` to the relevant GPUI element:

```rust
use ui::tree_dump::DumpAsExt as _;

div()
    .id("status-bar-theme-toggle")
    .cursor_pointer()
    .on_click(|_, _window, cx| theme::cycle(cx))
    .child(theme_toggle_label)
    .dump_as("status-bar-theme-toggle")
```

`.dump_as` wraps the inner element so its laid-out
`Bounds<Pixels>` get written to the process-global registry from
the `paint` lifecycle hook.  Names are `&'static str` (zero-alloc)
and overwrite in place on every paint pass — the registry always
reflects the most recent layout, no cleanup story.

#### Naming convention — prefixed hierarchy

Names follow `<container>-<child>-<leaf>` so the dump-tree output
groups related elements next to each other and `--id` lookups read
left-to-right from coarse to fine.  Examples:

- `status-bar` — the whole bottom strip
- `status-bar-theme-toggle` — the toggle inside the status bar
- `status-bar-vault-menu` — the vault menu inside the status bar
- `note-list-pane` — the note list container
- `note-list-pane-row-0` — the first row in the list
- `note-list-pane-row-0-status-icon` — the status icon inside that row
- `editor-host` — the WKWebView wrapper
- `editor-host-body` — the BlockNote / CodeMirror body
- `editor-host-body-block-0` — the first BlockNote block

Whenever you register a leaf, register its container too.  An
unregistered container is a missed cropping opportunity later: e.g.
without `status-bar` you can't `screenshot --id status-bar` to diff
the whole strip in one go, even if every leaf inside is registered.

This convention buys two things downstream:

1. **Cropped captures by container.**  `periscope screenshot --id status-bar`
   crops to the strip; `--id note-list-pane` crops to the list;
   `--id editor-host` crops to the editor body.  Tighter captures
   diff faster across runs and the image-bytes diff is much smaller
   for an unrelated layout shift in another part of the chrome.
   Prefer cropped baselines over full-window baselines whenever the
   regression you're guarding is local to a container — a status-bar
   colour change shouldn't churn the note-list and editor-body bytes.

2. **Targeted clicks / hovers / typing without coordinates.**
   `periscope click --id status-bar-theme-toggle` resolves the leaf
   and clicks its center — no need for `--x 1422 --y 1057` that rots
   the moment the title bar grows by a point.

#### Prefer ids over screen coordinates

`periscope click`, `screenshot`, `hover`, `double-click`, and
`dump-tree` all accept `--id` in place of `--x`/`--y`.  Default to
`--id` whenever the target has a registered name.  Reserve
`--x`/`--y` for two cases:

- One-off probes during interactive debugging where you don't want
  to add a `.dump_as("...")` to the source just to click once.
- Click points that genuinely don't correspond to a named element
  (e.g. positioning the cursor inside the BlockNote body — the
  body's `dump_as` bounds give you a region, not a glyph offset).
  Even here, prefer `--id editor-host-body` to query the region,
  then offset within those bounds rather than hard-coding a window-
  relative pair.

Pixel coordinates rot.  Names survive layout shuffles.  Pick names
that describe semantics (`status-bar-theme-toggle`), not visual
position (`toggle-3`, `top-right-button`).  Periscope's `click --id`
is a string lookup; renaming a registered element breaks every
harness call site that depended on it, so treat registered names
as an API surface — add ADR-style discipline before renaming.

The Phase 8 sweep scenarios in
[`phase-8-sweep.md`](phase-8-sweep.md) follow this rule: scenarios
that target a chrome element use `--id`; scenarios that target a
point inside the editor body use coordinates but document the
target region via the surrounding `--id` lookup.

### Why SIGUSR1?

It's the cheapest cross-process trigger that doesn't bring up an
IPC socket or a debug-only HTTP server.  Tolaria already runs an
event loop; the signal-handler thread is one extra OS thread, IO
happens off the signal-delivery path
(`signal-hook::iterator::Signals` uses an atomic pipe), and the
bash one-liner `kill -USR1 <pid>` is all an external tool needs.
Release builds skip the install entirely
(`#[cfg(debug_assertions)]` in `crates/tolaria/src/main.rs`), so
the developer-facing IPC channel never ships.

---

## Long debug session — spawn harness

For multi-turn debugging where Claude drives several captures /
clicks against the same Tolaria instance, prefer the **spawn
harness** over re-resolving the pid each turn:

```sh
# Terminal A — bring Tolaria up and print BIN_PID.
bash crates/periscope/tests/harness.sh
# ==> Harness ready.
#     BIN_PID=15654
#     OUT_DIR=/Users/you/tolaria/target/periscope/sweep
#
#     Drive captures from another shell, e.g.:
#       ./target/debug/periscope screenshot --pid 15654 --raise \
#           --out /Users/you/tolaria/target/periscope/sweep/foo.png
#
# ==> Press <enter> in this terminal to tear down.
```

The harness:

- Spawns `cargo run -q -p tolaria -- --vault demo-vault-v2 --width 1516 --height 1052`
  (override with `VAULT`, `WIDTH`, `HEIGHT`, `TOLARIA_PROFILE` env vars).
- Polls `periscope list` for an `app=tolaria` row, picks its pid, and
  prints the banner above.
- Blocks on stdin (Foreground / interactive teardown) by default.
  Pass `--no-block` (or `BLOCK=0`) for an agent-driven flow that
  keeps Tolaria alive until SIGINT.
- Sends SIGTERM + waits on the cargo child via a `trap` on exit / INT
  / TERM.

The agent then drives captures + clicks from a separate shell using
the printed `BIN_PID`:

```sh
export BIN_PID=15654   # from the harness banner
./target/debug/periscope screenshot --pid $BIN_PID --raise \
    --out target/periscope/sweep/00-light.png
```

`OUT_DIR` defaults to `target/periscope/sweep`; sweep docs override
it per their own conventions (e.g. `target/periscope/phase-8-sweep`
for `phase-8-sweep.md`).

`TOLARIA_PROFILE=release` skips the SIGUSR1 `tree_dump` handler —
`--id` lookups won't resolve.  Use `debug` (the default) for any
sweep that calls `click --id` or `dump-tree`.

## Long debug session — `watch` mode

For passive monitoring where Claude just inspects the UI between
turns (no clicks, no scripted captures), `watch` polls and writes
`latest.png` on each tick:

```sh
# Background watch — kill with Ctrl-C or `pkill periscope`
./target/debug/periscope watch \
    --pid $BIN_PID --dir target/e2e/ --interval-secs 3
```

The harness writes `target/e2e/frame-0001.png`, `frame-0002.png`, …
and maintains a `target/e2e/latest.png` symlink to the most recent
frame.  Claude just `Read target/e2e/latest.png` whenever it wants
to look.

Add `--max-frames N` to stop automatically after N frames; default
`0` loops forever.

Clean the directory between sessions:

```sh
rm -rf target/e2e/
```

---

## Diagnostics

`window not found` errors against Tolaria are *expected* if `--title`
was used: the window has `title: None` and only resolves by `--pid`.
Dump every visible window to find the pid:

```sh
./target/debug/periscope list
```

Expected output looks like:

```
pid=12345    app=tolaria                          title=
pid=67890    app=Terminal                         title=Terminal — bash …
pid=11111    app=Finder                           title=
```

If the Tolaria row is missing, the app isn't running.  The `title=`
column is empty for Tolaria by design; match on `app=tolaria` and
take the `pid=` value, then pass it via `--pid` (or use the harness
banner; see [§Long debug session](#long-debug-session--spawn-harness)).

`list` requires Accessibility permission — same panel as `--raise`.

---

## Observing editor-host logs

Every `console.{log,info,warn,error,debug}` call inside the
`editor-host/` bundle — plus every uncaught `Error` and unhandled
promise rejection — is forwarded from the WKWebView to Tolaria's
in-process `env_logger` stream under the **`webview`** target.
(Worklist 2.25 wired this up via a `with_initialization_script` shim
in `crates/note_item/src/lib.rs::macos::spawn_webview` that posts
`{"__t":"console_log","level","msg"}` envelopes through the same
`window.ipc.postMessage` channel as `editor_bridge`; the IPC handler
discriminates the envelope before falling through to
`editor_bridge::decode_from_host`.)

Launch tolaria with `RUST_LOG` set to whichever slice you need:

| Use case | `RUST_LOG=` | Effect |
|---|---|---|
| Just the WebView, every level | `webview=debug` | Only `target=webview` lines; `console.debug` included |
| Normal Tolaria logs + verbose WebView | `info,webview=debug` | Rust at info; WebView at debug (recommended default for debugging) |
| WebView only, drop the noise | `webview=info` | `console.log` / `info` / `warn` / `error` only; `console.debug` dropped |
| Everything everywhere | `debug` | All targets at debug — loud, but useful when triaging cross-layer races |

The JS `console.log` channel has no direct Rust level, so it maps to
`Info`; unknown level strings map to `Info` too so typos upstream
never silently drop a line.  Uncaught errors arrive as
`level=error` with `[uncaught] <message> at <file>:<line>:<col>` and
a stack trace; unhandled promise rejections arrive as `level=error`
with `[unhandledrejection] <stack-or-string>`.

Example session — observing the BlockNote `e.SideMenu.Button` throw
that took worklist 1.2 three wrong-angle attempts to find without
this hook:

```sh
RUST_LOG=info,webview=debug ./target/debug/tolaria --vault demo-vault-v2
# ...open a note, mouse over the editor body...
# [INFO  webview] id=NoteId(1) [editor-host:from_host] {"k":"ready"}
# [ERROR webview] id=NoteId(1) [uncaught] TypeError: undefined is not an object (evaluating 'e.SideMenu.Button')
#                 at index.html:1:12345
#                 <stack lines>
```

When `tolaria` is already running under the spawn harness (see
[§Long debug session](#long-debug-session--spawn-harness)) the
inherited environment already includes whatever `RUST_LOG` the
parent terminal had at launch.  To change levels mid-session, tear
down (press `<enter>` in the harness terminal) and respawn with
the desired `RUST_LOG` — there's no live-reload for `env_logger`.

The shim is a no-op when `window.ipc?.postMessage` is missing, so
the same bundle still works under `pnpm dev` / vitest / a plain
browser tab; logs only flow to the host when the bundle is loaded
inside the WKWebView.

---

## Failure modes and what to do

| Symptom | Likely cause | Fix |
|---|---|---|
| Error: `PNG too small (X bytes) — Screen Recording permission missing for $TERM_PROGRAM` | Screen Recording not granted | System Settings → Privacy & Security → Screen Recording; toggle on for the terminal app |
| Error: `AXUIElement.windows attribute fetch failed` | Accessibility not granted | … → Accessibility; toggle on for the terminal app |
| Error: `no visible window with title "Tolaria"` | Used `--title Tolaria`; Tolaria's window has `title: None` | Switch to `--pid $BIN_PID`; resolve the pid via `pgrep -nf 'target/debug/tolaria --vault'` or read it from the harness banner |
| Smoke test hangs / times out at 15s | Cold debug build, WKWebView slow to init | Run `cargo build -p tolaria` first; retry; bump deadline in `tests/screenshot_smoke.rs` if persistent |
| `list` shows `app=tolaria title=` (empty) | This is the shipped behaviour | Match on `app=tolaria` to find the pid; do not try to match the title column |

---

## What captures look like

A successful capture is a full-window PNG: GPUI chrome (left dock
with `NoteListPane`, status bar, modal layer if open) **plus** the
WKWebView editor body content (markdown text from the loaded note).
This is the load-bearing reason for OS-compositor capture — in-process
`Window::render_to_image()` would have a black rectangle where the
editor body lives.

A capture missing the editor body (black rectangle in the middle of
the screenshot) usually means the harness pivoted to in-process
capture by mistake; check that `xcap::Window::capture_image()` is
still the capture path in `crates/periscope/src/capture.rs`.

---

## Screenshots by element id

Both `screenshot` and `watch` accept `--id <name>` to crop the output to
the bounds of the named element.  The full window is captured first, then
sliced in-memory before writing to disk — no intermediate full-window PNG
is stored.

```sh
# Crop to a single element — great for tight regression captures:
./target/debug/periscope screenshot \
    --pid $BIN_PID --raise \
    --id status-bar-theme-toggle \
    --out /tmp/toggle.png

# Same in watch mode — latest.png stays cropped on every tick:
./target/debug/periscope watch \
    --pid $BIN_PID --dir target/e2e/ --interval-secs 3 \
    --id status-bar-theme-toggle
```

The element bounds come from the same `tree_dump` SIGUSR1 IPC as
`click --id`.  A fresh refresh is triggered before the first capture
(skip with `--no-refresh`); `--timeout-ms` controls the wait.

Device-pixel scaling (Retina 2×) is derived automatically from the ratio
of the captured image's pixel dimensions to the window's logical-point
size as reported by `xcap`.  If the element bounds clamp to an empty
rectangle (element off-screen or occluded), the command exits with a
clear error rather than writing a zero-byte PNG.

### `click` — coordinate or element id

The `click` subcommand accepts either `--x`/`--y` (absolute window-local
coordinates) or `--id` (element lookup).  The two modes are mutually
exclusive and enforced by the argument parser.

```
Usage: periscope click [OPTIONS]

Options:
      --title <TITLE>     Match by exact window title.  Note: Tolaria's window has `title: None`, so target it by --pid instead.
      --pid <PID>         Match by owning process id
      --raise             Raise the window via the Accessibility API before clicking
      --x <X>             X coordinate, window-local (origin at top-left, in window points)
      --y <Y>             Y coordinate, window-local (origin at top-left, in window points)
      --id <ID>           Search for element by id. --id and --x/y are mutually exclusive.
      --no-refresh        Skip SIGUSR1 refresh (--id mode only)
      --timeout-ms <MS>   Max wait for fresh dump in ms [default: 2000] (--id mode only)
```

---

## Synthetic input — `type-text`, `key`, `hover`, `double-click`

These four primitives extend the `click` path so the editor-body
gesture scenarios in `docs/plans/native-gpui-chrome/phase-8-sweep.md`
can run without a human in the loop.  `osascript keystroke` is blocked
inside the WKWebView editor body (`AGENTS.md` §4 macOS gotchas), but
raw `CGEvent` keyboard / mouse events go through the system queue
WKWebView listens on.

See `crates/periscope/README.md` § *Synthetic input* for the full key /
modifier name tables.  Quick reference:

### `type-text` — synthesize text input

```sh
# Trigger the slash menu (Scenarios 3 / 6).  The `/` reaches the
# BlockNote editor because CGEvent posts straight to the system queue:
./target/debug/periscope type-text \
    --pid $BIN_PID --raise --text "/"

# Multi-character input (e.g. wikilink suggestion in Scenario 6):
./target/debug/periscope type-text \
    --pid $BIN_PID --raise --text "[[Note"
```

`\n` becomes a `Return` keystroke, `\t` a `Tab` keystroke; every other
character is dispatched as a single `CGEvent` pair with the Unicode
scalar attached via `CGEventKeyboardSetUnicodeString`.  Tune the burst
rate with `--delay-ms` (default `8` ms).

### `key` — synthesize a single named key press

```sh
# Dismiss a menu / modal (Scenario 03 cleanup, Scenario 09 IME abort):
./target/debug/periscope key --pid $BIN_PID --raise --key Escape

# Save via Cmd+S:
./target/debug/periscope key --pid $BIN_PID --raise --key s --modifiers cmd
```

`--key` accepts named keys (`Return`, `Tab`, `Escape`, …, `F1`–`F20`)
or any single character.  `--modifiers` is a comma-separated list
(`cmd,shift,opt,ctrl,fn`).  See the README for synonyms.

### `hover` — move the cursor without clicking

```sh
# Surface the BlockNote side-menu `⋮⋮` handle (Scenario 04):
./target/debug/periscope hover --pid $BIN_PID --raise --x 320 --y 240

# Or by element name:
./target/debug/periscope hover --pid $BIN_PID --raise --id note-list-row-0
```

Posts a single `MouseMoved` `CGEvent`.  Same `--x`/`--y` vs `--id`
modes as `click`.

### `double-click` — synthesize a double-click

```sh
# Open the formatting toolbar over a word selection (Scenario 05):
./target/debug/periscope double-click \
    --pid $BIN_PID --raise --x 420 --y 380

# Or by element name:
./target/debug/periscope double-click \
    --pid $BIN_PID --raise --id editor-block-body
```

Two `LeftMouseDown`/`LeftMouseUp` pairs separated by ~60 ms with
`MOUSE_EVENT_CLICK_STATE` set to `1` then `2`, so AppKit recognises the
pair as a single double-click gesture.
