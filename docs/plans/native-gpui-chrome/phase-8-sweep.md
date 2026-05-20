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
(AGENTS.md §4 macOS / Tauri gotchas), but periscope's `type-text`,
`key`, `hover`, and `double-click` primitives send raw `CGEvent`
input that does reach the editor body.  Four of the five previously
gesture-dependent scenarios (03, 04, 05, 06) are now fully scripted;
only 1 of 10 (Scenario 09 — IME composition) remains gesture-dependent
because `CGEventKeyboardSetUnicodeString` bypasses the macOS IME layer
entirely (see §6 and Scenario 09 for the full explanation).

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
  ```sh
  # Focus the editor body (reuse Scenario 02's focus step — adjust
  # coords if the window layout has shifted since calibration).
  ./target/debug/periscope click --pid $BIN_PID --raise --x 880 --y 500

  # Type the slash trigger via CGEvent keyboard input (reaches the
  # WKWebView editor body — osascript keystroke does not).
  ./target/debug/periscope type-text --pid $BIN_PID --raise --text "/"
  sleep 0.25

  # Capture with the slash menu visible.
  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/03-slash-menu-open.png

  # Close the menu so subsequent scenarios start clean.
  ./target/debug/periscope key --pid $BIN_PID --raise --key "Escape"
  ```
- **Coordinate calibration note:** `--x 880 --y 500` targets the
  editor body at the pinned 1516×1052 window size.  If the slash
  menu does not appear, run `dump-tree` to find the current editor
  area bounds and adjust.
- **Verify:** slash menu visible below the cursor showing the
  default item list.

### Scenario 04 — side-menu handle

- **Captures:** `target/periscope/phase-8-sweep/04-side-menu-handle.png`
- **Covers:** Phase 8.25 (side menu `⋮⋮` handle on hover).
- **Preconditions:** BlockNote editor mounted (Scenario 02
  precondition).
- **Steps:**
  ```sh
  # Hover over a block to surface the ⋮⋮ side-menu handle.
  # CGEvent MouseMoved reaches the WKWebView, triggering BlockNote's
  # hover state without requiring a human cursor movement.
  ./target/debug/periscope hover --pid $BIN_PID --raise --x 880 --y 540
  sleep 0.25

  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/04-side-menu-handle.png

  # Move the cursor away so the handle doesn't bleed into the next capture.
  ./target/debug/periscope hover --pid $BIN_PID --raise --x 100 --y 100
  ```
- **Coordinate calibration note:** `--x 880 --y 540` targets a block
  row in the editor body at the pinned 1516×1052 window size.  The
  `⋮⋮` handle appears at the left edge of the hovered block; if the
  handle is not visible, adjust `--y` to land on a rendered block
  (run `dump-tree` to see the current layout).
- **Verify:** `⋮⋮` handle visible at the left edge of a block.

### Scenario 05 — formatting toolbar

- **Captures:** `target/periscope/phase-8-sweep/05-formatting-toolbar.png`
- **Covers:** Phase 8.25 (floating formatting toolbar over a
  selection).
- **Preconditions:** BlockNote editor mounted with at least one
  block of text content.
- **Steps:**
  ```sh
  # Focus the editor body and type a sentence so there is something
  # to double-click-select.
  ./target/debug/periscope click --pid $BIN_PID --raise --x 880 --y 500
  ./target/debug/periscope type-text --pid $BIN_PID --raise \
      --text "Phase eight smoke "

  # Double-click on the word "eight" (~x 925) to trigger BlockNote's
  # word selection and surface the floating formatting toolbar.
  # CALIBRATION FRAGILITY: the exact x coordinate of "eight" depends
  # on BlockNote's font metrics at the pinned window size.  If the
  # toolbar does not appear, adjust --x to land inside the word
  # (run dump-tree or tune empirically: try 910–945).
  ./target/debug/periscope double-click --pid $BIN_PID --raise --x 925 --y 500
  sleep 0.25

  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/05-formatting-toolbar.png

  # Dismiss the toolbar cleanly.
  ./target/debug/periscope key --pid $BIN_PID --raise --key "Escape"
  ```
- **Verify:** floating toolbar visible above a highlighted word
  (bold / italic / etc. controls).

### Scenario 06 — wikilink suggestion

- **Captures:** `target/periscope/phase-8-sweep/06-wikilink-suggestion.png`
- **Covers:** Phase 8.26 (wikilink suggestion popup) — list will be
  empty until bridge variants land (`phase-8-issues.md` "Bridge
  gaps" §1; no `FromHost::WikilinkQuery` variant yet).  The capture
  shows the menu chrome — that is the Phase 8 evidence we want.
- **Preconditions:** BlockNote editor focused with cursor in a
  block (Scenario 05 cleanup left the cursor there; if not, click
  `--x 880 --y 500` to re-focus).
- **Steps:**
  ```sh
  # Type the wikilink trigger via CGEvent keyboard input.
  ./target/debug/periscope type-text --pid $BIN_PID --raise --text "[["
  sleep 0.25

  ./target/debug/periscope screenshot --pid $BIN_PID --raise \
      --out $OUT_DIR/06-wikilink-suggestion.png

  # Close the popup and clean up the two bracket characters.
  ./target/debug/periscope key --pid $BIN_PID --raise --key "Escape"
  ./target/debug/periscope key --pid $BIN_PID --raise --key "Backspace"
  ./target/debug/periscope key --pid $BIN_PID --raise --key "Backspace"
  ```
- **Verify:** popup visible at the cursor, list empty — caption the
  capture "popup open, empty list expected (pending 8.26 bridge
  work)" when filing the evidence.

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
  - **Human action required, fully manual.**  `periscope type-text`
    uses `CGEventKeyboardSetUnicodeString`, which **bypasses the
    macOS IME layer entirely**.  That API posts Unicode scalars
    directly to the system event queue, skipping the `TSMDocument`
    / `NSInputContext` infrastructure that the IME hooks into.  As a
    result, no CGEvent-based synthetic input can enter the underlined
    composition state that BlockNote's IME guard intercepts.
    1. Switch the macOS input source to a composition IME (Pinyin
       Simplified, Japanese – Romaji, or Korean).  System Settings
       → Keyboard → Text Input → Input Sources.
    2. Click into the editor body.
    3. Type a composition glyph (e.g. `ni` for Pinyin → 你, or
       `konn` for Japanese → こん).
    4. Keep the underlined composition preview on screen.
  - The behavior that this capture exercises IS covered by
    automated Vitest tests — see
    `editor-host/src/imeCompositionKeyGuardExtension.test.ts` for
    the unit-level coverage of the composition key guard logic.
    The periscope capture serves as a visual/integration witness
    that the WKWebView surface renders the composition preview
    correctly end-to-end.
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
  byte-identical to the previous markdown-note state.  This is the
  one irreducible manual step in the sweep — the CGEvent / IME-layer
  mismatch cannot be resolved by periscope primitives alone (see §6).

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
- [ ] `03`: slash menu visible below the cursor.
- [ ] `04`: `⋮⋮` side-menu handle visible at the left edge of a block.
- [ ] `05`: floating formatting toolbar visible above a highlighted word.
- [ ] `06`: wikilink suggestion popup visible (empty list is expected
      pending 8.26 bridge work — caption accordingly).
- [ ] `08`: dirty glyph on `note-toolbar-sync` is *cleared* (the
      round-trip succeeded), not present.
- [ ] Scenario `09` (IME composition): if the human gesture happened,
      the composition preview (underlined text + candidate glyphs) is
      visible.  If not, the PNG matches the preceding markdown-note
      state — flag it as "expected gap (IME / CGEvent layer mismatch)"
      in the evidence comment rather than treating it as a failed
      capture.

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

The harness itself does not modify the vault.  Dirt can appear when
the scripted scenarios (slash menu, formatting toolbar, wikilink
popup) or the manual IME scenario type into an opened note before the
screenshot fires.  The cleanup commands above reset any such state.

---

## 6. Wish list — stable ids + remaining gaps

The sweep uses coordinate clicks for anything that doesn't have a
`.dump_as("name")` registration.  Synthetic input for editor-body
gestures is now fully implemented (commit `f3f65a26`) — Scenarios
03 / 04 / 05 / 06 are scripted end-to-end.  One gap remains.

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
  can `periscope click --id editor-body` to focus the editor.
  Currently Scenarios 03 / 05 / 06 click a hard-coded coordinate.
- `note-toolbar-save` (if a save button lands) — would let
  Scenario 08 drive Save entirely by `--id` instead of AppKit
  menu scripting.
- `slash-menu-popup`, `side-menu-handle`, `formatting-toolbar`,
  `wikilink-suggestion-popup` — these live inside the WKWebView,
  not the GPUI tree, so `dump_as` can't reach them directly.  A
  future enhancement would route a query through the
  `editor_bridge` envelope and surface the popup bounds back into
  the dump file.

The current registered set the sweep depends on:

- `status-bar-theme-toggle` — Scenario 01.
- `workspace-note-list` — Scenarios 02, 08.
- `sidebar-section-views` — Scenario 07.
- `note-toolbar-sync` — Scenario 08 verification (visual only).

### Synthetic-input periscope primitives

As of commit `f3f65a26`, all four planned primitives are
implemented in `crates/periscope/`:

- ~~`periscope type-text` — synthesize text input via `CGEvent`
  keyboard events.~~  **Implemented.**  Closes Scenarios 03 / 06.
- ~~`periscope key` — single named key press with optional
  modifiers.~~  **Implemented.**  Used for menu cleanup (`Escape`)
  and bracket cleanup (`Backspace`) across Scenarios 03 / 05 / 06.
- ~~`periscope hover` — move the cursor without clicking.~~
  **Implemented.**  Closes Scenario 04 (side-menu handle hover).
- ~~`periscope double-click` — synthesize a double-click gesture.~~
  **Implemented.**  Closes Scenario 05 (formatting toolbar over
  selection).

### Remaining gap — IME composition (Scenario 09)

`periscope type-text` uses `CGEventKeyboardSetUnicodeString`, which
bypasses the macOS IME layer (`TSMDocument` / `NSInputContext`)
entirely.  Unicode scalars are posted directly onto the system event
queue, so the IME never enters composition state and no underlined
preview is generated.

This is a fundamental constraint of the CGEvent API, not a missing
primitive — adding another periscope subcommand wouldn't fix it.
Scenario 09 therefore remains fully manual.

The composition key guard behavior that Scenario 09 visually
witnesses IS covered by automated Vitest tests:
`editor-host/src/imeCompositionKeyGuardExtension.test.ts`.  The
periscope capture is supplementary visual evidence, not the primary
correctness signal.
