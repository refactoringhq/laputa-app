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

---

## 1. Prerequisites checklist

Before invoking the sweep, verify each row.  The sweep script
re-checks the windowed-app prerequisite; the permissions are on you.

- [ ] **Screen Recording** granted to the terminal you'll run the
      sweep from.  System Settings → Privacy & Security → Screen
      Recording → toggle on for iTerm / Terminal / Ghostty / etc.
      Failure mode: every periscope capture errors with `PNG too
      small … Screen Recording permission missing for $TERM_PROGRAM`.
- [ ] **Accessibility** granted to the same terminal.  System
      Settings → Privacy & Security → Accessibility → toggle on.
      Required for `--raise` and for `periscope list`.  Failure
      mode: `AXUIElement.windows attribute fetch failed`.
- [ ] `demo-vault-v2/` is present (default fixture; the script
      passes `--vault demo-vault-v2`).  Contains:
        - a markdown note with frontmatter + body
          (`area-building.md`)
        - a markdown note with wikilinks (`area-building.md` has
          `[[Building]]` and `[[responsibility-sponsorships]]`)
        - a yaml view note (`views/active-projects.yml`)
- [ ] `tolaria` built.  The script uses **debug** by default — run
      a one-off `cargo build -p tolaria` if you want to avoid the
      cold-build delay on the first capture.  For the release
      profile, run `cargo build -p tolaria --release` first and set
      `TOLARIA_PROFILE=release` before invoking the script.
- [ ] `periscope` built.  Same caveat — `cargo build -p periscope`
      ahead of time avoids a build delay on the first capture.
- [ ] `git status --short -- demo-vault-v2` is clean (per AGENTS.md
      §3 demo-vault hygiene).  Any captures the sweep writes go to
      `target/periscope/phase-8-sweep/`, not the vault.

---

## 2. One-command invocation

```sh
bash crates/periscope/tests/periscope-phase-8-sweep.sh
```

The script:

1. Spawns `cargo run -p tolaria -- --vault demo-vault-v2 --width 1516
   --height 1052` as a child (pinned to the same logical-point size
   as `tolaria-demo-vault-v2-{light,dark}.png` so the captures align
   with the reference Tauri-era screenshots).
2. Polls `periscope list` for up to 30 s waiting for the `Tolaria`
   window.
3. Drives each capture below in sequence into
   `target/periscope/phase-8-sweep/`.
4. Tears the child down on exit (success, failure, or Ctrl-C) via a
   `trap`.
5. Prints a per-capture pass / fail summary + total byte count and
   exits non-zero if any expected file is missing or shorter than
   the 10 kB black-frame floor periscope already enforces.

Set `TOLARIA_PROFILE=release` before invoking to use the release
binary instead of debug (faster captures, no `tree_dump` snapshots
because Tolaria gates the SIGUSR1 handler on `debug_assertions` —
all `--id` captures will fall back to manual coordinates if you do
this, so leave it on debug for the sweep).

---

## 3. Capture list

Minimum 10 captures.  Each file lands at
`target/periscope/phase-8-sweep/<filename>`.

| #  | Filename                       | Slice       | What it exercises                                                                                       | Setup driver                                                                  |
|----|--------------------------------|-------------|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| 01 | `00-light-baseline.png`        | Full chrome | Default theme, full window — diff against `tolaria-demo-vault-v2-light.png`                             | none (initial state)                                                          |
| 02 | `01-dark-baseline.png`         | Full chrome | After toggling the status-bar theme chip — diff against `tolaria-demo-vault-v2-dark.png`                | `periscope click --id status-bar-theme-toggle`                                |
| 03 | `02-blocknote-mount.png`       | 8.24        | Markdown note open, BlockNote body rendered in the WKWebView                                            | `periscope click --id workspace-note-list` then row click for a markdown note |
| 04 | `03-slash-menu-open.png`       | 8.25        | Slash-menu popup over the editor body                                                                   | Manual — user types `/` in the editor body (see §6 manual fallback)           |
| 05 | `04-side-menu-handle.png`      | 8.25        | `⋮⋮` side-menu handle visible on hover                                                                  | Manual — user hovers the cursor over a block (mouse position before capture)  |
| 06 | `05-formatting-toolbar.png`    | 8.25        | Floating formatting toolbar over a selection                                                            | Manual — user selects text in the editor body                                 |
| 07 | `06-wikilink-suggestion.png`   | 8.26        | `[[`-triggered wikilink popup (the list will be empty pending bridge variants — caption it accordingly) | Manual — user types `[[` in the editor body                                   |
| 08 | `07-raw-mode-yaml.png`         | 8.29        | Yaml note (`views/active-projects.yml`) renders via the CodeMirror raw-editor fallback                  | Sidebar → `Views` section → `Active Projects` row                             |
| 09 | `08-save-round-trip.png`       | 8.24 / 8.30 | After invoking Save (File → Save menu item), the dirty state on `note-toolbar-sync` clears              | `osascript` clicks **File → Save** in the menu bar (no Cmd+S binding yet)     |
| 10 | `09-ime-composition.png`       | 8.27        | A live macOS IME composition popup in the editor body                                                   | Manual — user switches to Pinyin / Japanese IME, types a glyph (see §6)       |

Notes on each row:

- **01 / 02 — baselines.**  These are the "one full-chrome screenshot
  diff per theme" the global Phase 8 exit criterion mandates.  The
  size pin (`--width 1516 --height 1052`) makes them directly
  comparable to the existing Tauri-era references in
  `docs/plans/native-gpui-chrome/`.
- **03 — BlockNote mount.**  Verifies the WKWebView actually
  composites BlockNote's editor body over the GPUI chrome — the
  whole reason periscope exists, since `Window::render_to_image()`
  would show a black rectangle here.  Drive the click via
  `workspace-note-list` (registered dump-as) then a coordinate
  click for the row (no per-row `dump_as` yet — see "Stable ids
  that don't exist yet" below).
- **04 / 05 / 06 / 07 — slash menu, side menu, formatting toolbar,
  wikilink popup.**  All four require typing or hovering inside the
  WKWebView editor body.  Per AGENTS.md §4 macOS gotchas,
  `osascript keystroke` is blocked inside the editor body, so these
  are flagged Manual — the sweep script will pause and prompt the
  user to perform the setup gesture, then continue capturing on
  enter.  See §6.
- **06 — wikilink suggestion.**  Per `phase-8-issues.md` / Strand C
  row 8.26, the wikilink popup currently renders empty pending
  bridge variants.  Capture it anyway so the regression baseline
  lives somewhere; caption the file as "popup open, empty list
  expected (pending 8.26 bridge work)" when filing the sweep
  evidence.
- **08 — raw-mode yaml.**  The yaml note in `demo-vault-v2/views/`
  is the simplest non-BlockNote-shaped file that lights up the
  CodeMirror fallback (8.29).  The sidebar `Views` section is
  collapsable; the script clicks `sidebar-section-views` first to
  expand if needed, then a coordinate click for the row.
- **09 — save round-trip.**  `cmd-s` is *not* bound in
  `crates/actions/assets/default.json` — only `cmd-q`, `cmd-w`,
  `cmd-,`, `cmd-shift-r`, `cmd-alt-i`.  The Save menu item exists
  (`crates/tolaria/src/menus.rs:31`) and an `osascript` menu-bar
  click reaches it, so the script drives Save that way.  After the
  click, capture once and look for the dirty glyph on
  `note-toolbar-sync` clearing.
- **10 — IME composition.**  Manual; no scripted IME driver works
  reliably inside a WKWebView from `osascript`.  The sweep script
  prompts the user to switch input source, type a glyph, then
  hits enter to capture.  Mark the capture as "manual" in the
  follow-up evidence comment.

---

## 4. Verification checklist (per capture)

After the sweep finishes, walk each PNG in
`target/periscope/phase-8-sweep/` and confirm:

- [ ] File exists.
- [ ] File size > 10 kB.  Periscope's `capture::screenshot_macos`
      already errors out below this threshold (the "Screen Recording
      permission missing" heuristic), so a short file means a
      capture errored mid-sweep — re-check stderr.
- [ ] PNG opens in Preview / `qlmanage -p`.  A corrupt frame is
      unusual but cheap to verify.
- [ ] The expected element is visible (per the table above).  Pay
      particular attention to:
        - Baselines: window decoration matches the reference, no
          missing-glyph rectangles.
        - BlockNote: text rendered (not a black rectangle — the
          regression that pre-`xcap`-capture builds had).
        - Save round-trip: dirty indicator on `note-toolbar-sync`
          is *cleared* (the round-trip succeeded), not present.
- [ ] No `Screen Recording permission missing` line in the
      script's per-capture stderr block.

Files that fail any of the above need the screenshot redone before
Phase 8 close-out.

---

## 5. Cleanup

After the sweep evidence is filed in the Phase 8 close-out comment:

```sh
# Remove sweep artifacts (large; not needed long-term).
rm -rf target/periscope/phase-8-sweep/

# Restore demo-vault-v2 if your manual gestures dirtied it
# (typing inside an open note marks the note dirty even if you
# didn't save).
git checkout -- demo-vault-v2/
git clean -fd demo-vault-v2/

# Confirm clean.
git status --short -- demo-vault-v2
```

The sweep script itself does not modify the vault.  Dirt only
appears when the manual fallback captures (slash menu, formatting
toolbar, wikilink popup, IME composition) involve actually typing
into an opened note before the screenshot.

---

## 6. Manual fallbacks

`osascript keystroke` does not reliably deliver text into the
WKWebView editor body (AGENTS.md §4 macOS / Tauri gotchas).  Five
captures need human gestures.  For each, the sweep script pauses,
prints a prompt, and waits for `<enter>` before capturing.

### 6.1 Slash menu (`03-slash-menu-open.png`)

1. Click into the editor body so the caret is inside a block.
2. Type `/`.
3. The slash menu appears with command suggestions.
4. **Without dismissing the menu, hit `<enter>` in the sweep terminal.**
5. The script captures the window.

If the menu dismisses before the capture, repeat step 2.  The menu
hides on focus loss — keep the editor focused while the capture
fires.

### 6.2 Side-menu handle (`04-side-menu-handle.png`)

1. Hover the cursor over any block in the editor body.
2. The `⋮⋮` side-menu handle fades in on the left edge.
3. Keep the mouse hovering and hit `<enter>` in the sweep terminal.
4. The script captures the window.

If the handle disappears before the capture, the BlockNote
hover-guard expired — re-hover and try again.

### 6.3 Formatting toolbar (`05-formatting-toolbar.png`)

1. Click into the editor body and select a word (double-click).
2. The floating formatting toolbar appears above the selection.
3. Without clicking elsewhere, hit `<enter>` in the sweep terminal.
4. The script captures the window.

### 6.4 Wikilink suggestion (`06-wikilink-suggestion.png`)

1. Click into the editor body.
2. Type `[[`.
3. The wikilink suggestion popup opens.  **Pre-bridge-variants
   completion, the suggestion list will be empty — capture it
   anyway as the regression baseline.**
4. Hit `<enter>` in the sweep terminal.
5. The script captures the window.

### 6.5 IME composition (`09-ime-composition.png`)

1. Switch the macOS input source to a composition-based IME
   (Pinyin Simplified, Japanese – Romaji, or Korean).
   System Settings → Keyboard → Text Input → Input Sources.
2. Click into the editor body.
3. Type a sequence that triggers composition (e.g. `ni` for
   Pinyin → 你, or `konn` for Japanese → こん).
4. While the underlined composition preview is showing, hit
   `<enter>` in the sweep terminal.
5. The script captures the window.
6. Press `<escape>` to abort the composition before continuing —
   leaving a composition mid-flight can desync the editor on the
   next interaction.

Switch back to the U.S. keyboard layout when the sweep finishes.

---

## 7. Where the captures land

```
target/periscope/phase-8-sweep/
├── 00-light-baseline.png
├── 01-dark-baseline.png
├── 02-blocknote-mount.png
├── 03-slash-menu-open.png
├── 04-side-menu-handle.png
├── 05-formatting-toolbar.png
├── 06-wikilink-suggestion.png
├── 07-raw-mode-yaml.png
├── 08-save-round-trip.png
└── 09-ime-composition.png
```

When filing the Phase 8 close-out evidence, attach all ten files
plus the sweep script's stdout / stderr.  If a capture is missing
or under 10 kB, the sweep script's exit code is non-zero — fix the
underlying issue (typically a permission grant or a missed manual
gesture) and re-run.

---

## 8. Stable element ids referenced by the sweep

The script uses `--id` lookups against the SIGUSR1 `tree_dump` JSON
for everything that has a dump-as registration.  The current set
the sweep depends on:

- `status-bar-theme-toggle` — light/dark toggle (capture #2).
- `workspace-note-list` — note-list pane (#3, #8 row click bases).
- `sidebar-section-views` — sidebar `Views` collapsible (#8).
- `note-toolbar-sync` — dirty / saved glyph (#9 verification).

Per-row note-list ids and per-section-row sidebar ids would let the
sweep drive every capture by `--id` instead of by coordinate; see
the next section.

---

## 9. Stable ids that don't exist yet (follow-up wish list)

The sweep currently uses coordinate clicks (or manual gestures) for
anything that doesn't have a `.dump_as("name")` registration.  The
list below is what a future agent / `dump_as` patch would let the
sweep drive by name (no behavior change to the app — pure test
ergonomics):

- `note-list-row-<index>` or `note-list-row-<slug>` — clicking a
  specific note in the list pane without depending on the visual
  layout.  Currently the sweep uses an absolute coordinate.
- `sidebar-row-<section>-<index>` — clicking a specific row inside
  `Views` / `Types` / `Folders`.
- `editor-body` — a stable id on the BlockNote root so the sweep
  can `periscope click --id editor-body` to focus the editor
  before manual fallbacks.  Currently the sweep clicks
  `workspace-center` as a proxy.
- `note-toolbar-save` (if a save button lands) — would let the
  sweep drive #9 entirely by `--id` instead of by AppKit menu
  scripting.
- `slash-menu-popup`, `side-menu-handle`,
  `formatting-toolbar`, `wikilink-suggestion-popup` — these live
  inside the WKWebView (not in the GPUI tree), so `dump_as` can't
  reach them directly.  A future enhancement would route a query
  through the `editor_bridge` envelope and surface the popup bounds
  back into the dump file.  Until then captures 4-7 stay manual.

None of these are blockers for Phase 8 close-out — the sweep
already produces the required ≥10-capture evidence without them.
They're documented here so the next pass can decide whether to
invest in driver-friendly ids.
