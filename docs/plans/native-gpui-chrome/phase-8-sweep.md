# Phase 8 periscope smoke sweep

> Closes the Strand C exit criterion *"Each slice ships at least one
> periscope smoke capture that exercises the behavior end-to-end
> through a real WKWebView"* and the global Phase 8 criterion that
> caps periscope at ~10 captures (full-chrome diff per theme + paths
> the in-process runner literally can't see).

Run on the user's macOS host — periscope needs Screen Recording +
Accessibility permission and a windowed Tolaria binary, neither of
which the Anthropic agent sandbox can provide.  See
`phase-8-issues.md` ("Periscope Phase 8 smoke sweep") for the
follow-up status entry.

The sweep is split into two pieces:

1. A thin harness script (`crates/periscope/tests/harness.sh`)
   that spawns `tolaria` against `demo-vault-v2` pinned to 1516×1052
   logical points, prints the binary pid + output directory, and
   blocks on stdin so the captures can be driven from a separate
   shell / agent session.
2. The ten scenarios in §3 below.  Each one is self-contained — an
   agent can pick up at any scenario as long as the harness is up.

`osascript keystroke` is blocked inside the WKWebView editor body
(AGENTS.md §4 macOS / Tauri gotchas), so five of the ten scenarios
depend on human gestures.  Each such scenario is flagged with an
"Expected gap" note — without synthetic input the PNG will look
identical to the preceding baseline, and that's the documented
behavior of this sweep until periscope grows `type-text` / `key` /
`hover` / `double-click` primitives (see §6 wish list).

---

## 1. Prerequisites

Before launching the harness, verify each row.  The harness itself
re-checks the windowed-app prerequisite; permissions are on you.

- [ ] **Screen Recording** granted to the terminal you'll launch the
      harness from.  System Settings → Privacy & Security → Screen
      Recording → toggle on for iTerm / Terminal / Ghostty / Claude
      Code itself.  Failure mode: every periscope capture errors
      with `PNG too small … Screen Recording permission missing for
      $TERM_PROGRAM`.
- [ ] **Accessibility** granted to the same terminal.  System
      Settings → Privacy & Security → Accessibility → toggle on.
      Required for `--raise` and `periscope list`.  Failure mode:
      `AXUIElement.windows attribute fetch failed`.
- [ ] `demo-vault-v2/` is present (default fixture; the harness
      passes `--vault demo-vault-v2`).  Should contain at least:
        - a markdown note with frontmatter + body
          (`area-building.md`)
        - a markdown note with wikilinks (`area-building.md` has
          `[[Building]]` and `[[responsibility-sponsorships]]`)
        - a yaml view note (`views/active-projects.yml`)
- [ ] `tolaria` and `periscope` built.  The harness uses the
      **debug** profile by default — a one-off `cargo build -p
      tolaria -p periscope` ahead of time avoids the cold-build
      delay on the first capture.  For release: `cargo build -p
      tolaria --release` first, then `TOLARIA_PROFILE=release` on
      the harness invocation (release builds skip the SIGUSR1
      `tree_dump` handler — `--id` lookups won't work).
- [ ] `git status --short -- demo-vault-v2` is clean (per AGENTS.md
      §3 demo-vault hygiene).  Captures land in
      `target/periscope/phase-8-sweep/`, not the vault.

---

## 2. Harness setup

The harness is a spawn/teardown shell — it brings up the app and waits.
Captures are driven against the live process from a separate shell.

The harness defaults its `OUT_DIR` to `target/periscope/sweep` (generic
across sweeps).  The Phase 8 sweep below references
`target/periscope/phase-8-sweep/` throughout, so prefix every invocation
with `OUT_DIR=$REPO_ROOT/target/periscope/phase-8-sweep` to make the
captures land where §3 / §4 / §5 expect them.

### Foreground (block on stdin)

```sh
OUT_DIR=$REPO_ROOT/target/periscope/phase-8-sweep \
    bash crates/periscope/tests/harness.sh
```

The script writes a banner like

```
==> Harness ready.
    BIN_PID=15654
    OUT_DIR=/Users/you/tolaria/target/periscope/phase-8-sweep

    Drive captures from another shell, e.g.:
       /Users/you/tolaria/target/periscope screenshot --pid 15654 --raise \
          --out /Users/you/tolaria/target/periscope/phase-8-sweep/00-light-baseline.png

    Scenario list: see the consuming doc (e.g. `docs/plans/native-gpui-chrome/phase-8-sweep.md`)

==> Press <enter> in this terminal to tear down.
```

Note the `BIN_PID` — every `/Users/you/tolaria/target/periscope …` invocation
in §3 expects it as `--pid $BIN_PID`.  When you've finished the
scenarios, hit `<enter>` in the harness terminal; the trap kills the
cargo child and waits for it.

### Background (run in foreground until SIGINT)

```sh
OUT_DIR=$REPO_ROOT/target/periscope/phase-8-sweep \
    bash crates/periscope/tests/harness.sh --no-block
# or
OUT_DIR=$REPO_ROOT/target/periscope/phase-8-sweep \
    BLOCK=0 bash crates/periscope/tests/harness.sh
```

`--no-block` keeps Tolaria alive in the foreground without the
interactive wait — useful when the harness is itself spawned by an
agent via `Bash run_in_background` (the banner still goes to stdout;
the agent reads `BIN_PID` from the first few lines).  Send SIGINT
(Ctrl-C, or `kill $TOLARIA_PID` from another shell) to tear down.

### Knobs

| Env var          | Default          | Notes |
|------------------|------------------|-------|
| `TOLARIA_PROFILE`| `debug`          | `release` skips the SIGUSR1 `tree_dump` handler — `--id` lookups won't resolve. |
| `VAULT`          | `demo-vault-v2`  | Path relative to the repo root. |
| `WIDTH`          | `1516`           | Logical points; matches the Tauri-era reference screenshots. |
| `HEIGHT`         | `1052`           | Same. |
| `BLOCK`          | `1`              | `0` equivalent to `--no-block`. |
| `OUT_DIR`        | `$REPO_ROOT/target/periscope/sweep` | Override per consuming doc. The Phase 8 sweep uses `$REPO_ROOT/target/periscope/phase-8-sweep` (set above so §3 / §4 / §5 paths line up). |

---

## 3. Scenarios — 10 captures

Each scenario writes one PNG into `$OUT_DIR =
target/periscope/phase-8-sweep/`.  Set `BIN_PID` from the harness
banner in the shell that drives captures, then copy-paste the
commands.

```sh
export BIN_PID=15654   # from the harness banner
export OUT_DIR=target/periscope/phase-8-sweep
```

### Scenario 00 — light baseline

- **Captures:** `target/periscope/phase-8-sweep/00-light-baseline.png`
- **Covers:** global Phase 8 full-chrome light-theme baseline.
- **Preconditions:** harness just came up; default `Light` theme,
  no note open, no modals on screen.
- **Steps:** none (initial state).
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/00-light-baseline.png
  ```
- **Verify:** PNG matches the layout of
  `docs/plans/native-gpui-chrome/tolaria-demo-vault-v2-light.png`
  (sidebar on the left, note-list column, empty editor area, status
  bar at the bottom; theme is light).

### Scenario 01 — dark baseline

- **Captures:** `target/periscope/phase-8-sweep/01-dark-baseline.png`
- **Covers:** global Phase 8 full-chrome dark-theme baseline.
- **Preconditions:** light baseline captured.
- **Steps:**
  - Toggle the status-bar theme chip:
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --id status-bar-theme-toggle
    ```
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/01-dark-baseline.png
  ```
- **Verify:** PNG matches
  `docs/plans/native-gpui-chrome/tolaria-demo-vault-v2-dark.png`
  (same layout, dark theme).
- **After:** restore light theme for the rest of the sweep so the
  reviewer compares against the light reference:
  ```sh
  ./target/debug/periscope click --pid $BIN_PID --raise \
      --id status-bar-theme-toggle
  ```

### Scenario 02 — BlockNote mount

- **Captures:** `target/periscope/phase-8-sweep/02-blocknote-mount.png`
- **Covers:** Phase 8.24 (BlockNote editor WKWebView).
- **Preconditions:** light theme restored; no note open yet.
- **Steps:**
  - Focus the note-list pane:
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --id workspace-note-list
    ```
  - Click the first row at the pinned size (no per-row `dump_as`
    yet — see §6 wish list).  Adjust the y coordinate if the list
    layout shifts; `dump-tree` shows current bounds:
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --x 220 --y 220
    ```
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/02-blocknote-mount.png
  ```
- **Verify:** PNG shows BlockNote text content (not a black rectangle
  in the editor area — the regression that pre-`xcap` builds had);
  glyphs render, theme is light.

### Scenario 03 — slash menu open

- **Captures:** `target/periscope/phase-8-sweep/03-slash-menu-open.png`
- **Covers:** Phase 8.25 (slash menu controller).
- **Preconditions:** BlockNote editor focused with cursor in an
  empty paragraph block (Scenario 02 left it that way; if not,
  click `workspace-note-list` then the first row, then click into
  the editor body to focus a block).
- **Steps:**
  - **Human action required.**  `osascript keystroke` is blocked
    inside the WKWebView editor body — type the gesture by hand:
    1. Click into the editor body (any block).
    2. Type `/`.
    3. Keep the slash menu open (don't dismiss with Escape).
- **Capture command:** (run from another shell while the menu is
  still on screen)
  ```sh
  ./target/debug/periscope -- screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/03-slash-menu-open.png
  ```
- **Verify:** slash menu visible below the cursor showing the
  default item list.
- **Expected gap:** if no human types `/`, the PNG is byte-identical
  to `02-blocknote-mount.png`.  That's the documented behavior of
  this sweep — `--raise` settles focus but cannot synthesize the
  keystroke.

### Scenario 04 — side-menu handle

- **Captures:** `target/periscope/phase-8-sweep/04-side-menu-handle.png`
- **Covers:** Phase 8.25 (side menu `⋮⋮` handle on hover).
- **Preconditions:** BlockNote editor mounted (Scenario 02
  precondition).
- **Steps:**
  - **Human action required.**  Hovering doesn't have a periscope
    primitive yet — the cursor must be over a block when the
    capture fires:
    1. Move the mouse cursor over any block in the editor body.
    2. The `⋮⋮` side-menu handle fades in on the left edge.
    3. Keep the mouse hovering.
- **Capture command:**
  ```sh
  ./target/debug/periscope -- screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/04-side-menu-handle.png
  ```
- **Verify:** `⋮⋮` handle visible at the left edge of a block.
- **Expected gap:** without a human cursor over a block, the handle
  fades out and the PNG looks identical to `02-blocknote-mount.png`.
  `--raise` brings the window forward but doesn't move the cursor.

### Scenario 05 — formatting toolbar

- **Captures:** `target/periscope/phase-8-sweep/05-formatting-toolbar.png`
- **Covers:** Phase 8.25 (floating formatting toolbar over a
  selection).
- **Preconditions:** BlockNote editor mounted with at least one
  block of text content.
- **Steps:**
  - **Human action required.**  No `double-click` primitive in
    periscope yet:
    1. Double-click a word in the editor body (selects it).
    2. The floating formatting toolbar appears above the
       selection.
    3. Don't click elsewhere.
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/05-formatting-toolbar.png
  ```
- **Verify:** floating toolbar visible above a highlighted word
  (bold / italic / etc. controls).
- **Expected gap:** without the human double-click the PNG is
  byte-identical to `02-blocknote-mount.png`.

### Scenario 06 — wikilink suggestion

- **Captures:** `target/periscope/phase-8-sweep/06-wikilink-suggestion.png`
- **Covers:** Phase 8.26 (wikilink suggestion popup) — list will be
  empty until bridge variants land (`phase-8-issues.md` "Bridge
  gaps" §1).
- **Preconditions:** BlockNote editor focused with cursor in a
  block.
- **Steps:**
  - **Human action required:**
    1. Click into the editor body.
    2. Type `[[`.
    3. Wikilink suggestion popup opens (empty list expected,
       pending 8.26 bridge work).
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/06-wikilink-suggestion.png
  ```
- **Verify:** popup visible at the cursor, list empty — caption the
  capture "popup open, empty list expected (pending 8.26 bridge
  work)" when filing the evidence.
- **Expected gap:** without the human `[[` keystroke the PNG is
  byte-identical to `02-blocknote-mount.png`.

### Scenario 07 — raw-mode yaml

- **Captures:** `target/periscope/phase-8-sweep/07-raw-mode-yaml.png`
- **Covers:** Phase 8.29 (CodeMirror raw-editor fallback for
  non-BlockNote shapes).
- **Preconditions:** harness up, any earlier scenario state — the
  sidebar `Views` section will be expanded by the first click.
- **Steps:**
  - Expand / focus the sidebar `Views` section:
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --id sidebar-section-views
    ```
  - Click the `Active Projects` row.  Coordinate-driven until
    `sidebar-row-views-active-projects` lands (see §6 wish list):
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --x 120 --y 360
    ```
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/07-raw-mode-yaml.png
  ```
- **Verify:** editor area shows yaml content of
  `views/active-projects.yml` rendered via the CodeMirror raw-mode
  fallback (monospaced text, syntax-highlighted yaml keys).

### Scenario 08 — save round-trip

- **Captures:** `target/periscope/phase-8-sweep/08-save-round-trip.png`
- **Covers:** Phase 8.24 / 8.30 (dirty-state clears after save).
- **Preconditions:** previous scenario left us on the yaml view.
  Re-open a markdown note first so Save targets a BlockNote note.
- **Steps:**
  - Refocus the note-list and click the first row (same as
    Scenario 02):
    ```sh
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --id workspace-note-list
    ./target/debug/periscope click --pid $BIN_PID --raise \
        --x 220 --y 220
    ```
  - Drive **File → Save** through the menu bar.  `Cmd+S` is *not*
    bound in `crates/actions/assets/default.json`, but the Save
    menu item exists (`crates/tolaria/src/menus.rs`) and AppKit
    menu scripting reaches it:
    ```sh
    osascript <<'OSA'
    tell application "System Events"
      tell process "tolaria"
        set frontmost to true
        click menu item "Save" of menu "File" of menu bar 1
      end tell
    end tell
    OSA
    ```
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/08-save-round-trip.png
  ```
- **Verify:** dirty indicator on `note-toolbar-sync` is **cleared**
  (round-trip succeeded), not present.

### Scenario 09 — IME composition

- **Captures:** `target/periscope/phase-8-sweep/09-ime-composition.png`
- **Covers:** Phase 8.27 (live macOS IME composition popup in the
  editor body).
- **Preconditions:** a markdown note is open (Scenario 08 ended
  there).
- **Steps:**
  - **Human action required, fully manual.**  No scripted IME
    driver works reliably inside a WKWebView:
    1. Switch the macOS input source to a composition IME (Pinyin
       Simplified, Japanese – Romaji, or Korean).  System Settings
       → Keyboard → Text Input → Input Sources.
    2. Click into the editor body.
    3. Type a composition glyph (e.g. `ni` for Pinyin → 你, or
       `konn` for Japanese → こん).
    4. Keep the underlined composition preview on screen.
- **Capture command:**
  ```sh
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/09-ime-composition.png
  ```
- **Verify:** composition preview (underlined Latin sequence above
  candidate glyphs) visible at the cursor.
- **After:** press `<escape>` to abort the composition before
  doing anything else — leaving a composition mid-flight can desync
  the editor.  Switch back to the U.S. keyboard layout when the
  sweep finishes.
- **Expected gap:** without the human IME composition the PNG is
  byte-identical to the previous markdown-note state.

---

## 4. Verification

After all ten captures, walk the directory once:

```sh
for f in target/periscope/phase-8-sweep/*.png; do
  size="$(stat -f%z "$f")"
  if [[ "$size" -lt 10240 ]]; then
    echo "TOO SMALL $f ($size bytes)"
  else
    echo "ok       $f ($size bytes)"
  fi
done
```

The 10 kB floor matches `periscope::capture::screenshot_macos`'s
own "Screen Recording permission missing" heuristic.  Any file
below it errored mid-capture — re-check the Screen Recording grant
for the terminal that drove the capture.

Also confirm by eye in Preview / `qlmanage -p`:

- [ ] Baselines (`00`, `01`): window decoration matches the
      reference, no missing-glyph rectangles, no black editor area.
- [ ] `02`: BlockNote text rendered (not black).
- [ ] `08`: dirty glyph on `note-toolbar-sync` is *cleared* (the
      round-trip succeeded), not present.
- [ ] Gesture scenarios (`03`, `04`, `05`, `06`, `09`): if the
      human gesture happened, the gesture-specific affordance is
      visible.  If not, the PNG matches the preceding non-gesture
      capture — flag it as "expected gap" in the evidence comment
      rather than treating it as a failed capture.

---

## 5. Cleanup

After the captures are filed in the Phase 8 close-out evidence:

```sh
# Tear down the harness — <enter> in the harness terminal, or:
kill "$TOLARIA_PID"

# Remove sweep artifacts (large; not needed long-term).
rm -rf target/periscope/phase-8-sweep/

# Restore demo-vault-v2 if manual gestures dirtied it (typing into
# an open note marks the note dirty even without an explicit save).
git checkout -- demo-vault-v2/
git clean -fd demo-vault-v2/

# Confirm clean per AGENTS.md §3 demo-vault hygiene.
git status --short -- demo-vault-v2
```

The harness itself does not modify the vault.  Dirt only appears
when the gesture scenarios (slash menu, formatting toolbar, wikilink
popup, IME composition) involve typing into an opened note before the
screenshot fires.

---

## 6. Wish list — stable ids + synthetic input

The sweep currently uses coordinate clicks (or manual gestures) for
anything that doesn't have a `.dump_as("name")` registration, and
falls back to "human types this" for everything inside the WKWebView
editor body.  Both gaps are addressable; neither is a blocker for
Phase 8 close-out.

### Stable element ids the sweep would use

A future `dump_as` patch (no app behavior change — pure test
ergonomics) would let the sweep drive every capture by `--id`
instead of by coordinate:

- `note-list-row-<index>` or `note-list-row-<slug>` — click a
  specific note in the list pane without depending on the visual
  layout.  Currently Scenario 02 / 08 use an absolute coordinate.
- `sidebar-row-<section>-<index>` — click a specific row inside
  `Views` / `Types` / `Folders`.  Currently Scenario 07 uses a
  coordinate.
- `editor-body` — a stable id on the BlockNote root so the sweep
  can `periscope click --id editor-body` to focus the editor
  before manual fallbacks.  Currently Scenario 02 clicks
  `workspace-note-list` as a proxy.
- `note-toolbar-save` (if a save button lands) — would let
  Scenario 08 drive Save entirely by `--id` instead of AppKit
  menu scripting.
- `slash-menu-popup`, `side-menu-handle`, `formatting-toolbar`,
  `wikilink-suggestion-popup` — these live inside the WKWebView,
  not the GPUI tree, so `dump_as` can't reach them directly.  A
  future enhancement would route a query through the
  `editor_bridge` envelope and surface the popup bounds back into
  the dump file.  Until then Scenarios 03–06 / 09 stay manual.

The current registered set the sweep depends on:

- `status-bar-theme-toggle` — Scenario 01.
- `workspace-note-list` — Scenarios 02, 08.
- `sidebar-section-views` — Scenario 07.
- `note-toolbar-sync` — Scenario 08 verification (visual only).

### Synthetic-input periscope primitives

These would close the five gesture gaps that currently print
"expected gap" notes:

- `periscope type-text --pid $BIN_PID "/"` — synthesize a
  printable-key sequence via `CGEvent` keyboard events, mirroring
  the `click` subcommand's `CGEvent` mouse path.  Closes Scenarios
  03 / 06 once it reaches the WKWebView editor body (needs
  verification — `keystroke` via AppleEvent doesn't, but raw
  `CGEvent` keyboard input *should*, because WKWebView listens on
  the system event queue the same way GPUI does).
- `periscope key --pid $BIN_PID escape` / `enter` / `tab` — same
  primitive, named key.  Closes Scenario 03's "dismiss menu"
  cleanup and would let Scenario 09 abort the IME composition
  without a human keypress.
- `periscope hover --pid $BIN_PID --x N --y M` — move the cursor
  without clicking.  Closes Scenario 04 (side-menu handle hover).
- `periscope double-click --pid $BIN_PID --x N --y M` — synthesize
  two `CGEvent` mouse-down/up pairs at the AppKit double-click
  interval.  Closes Scenario 05 (formatting toolbar over selection).

None of the four require new GPUI work — they're pure
`crates/periscope/src/click.rs`-style additions on top of the
existing `CGEvent` path.  Scoped out of this refactor (per the
task spec, the sweep landing the harness/scenarios split does
*not* modify `crates/periscope/`).
