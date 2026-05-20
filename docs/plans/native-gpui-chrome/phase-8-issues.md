# User reported issues from Phase 8 implmentaion

## Blockers

1. Clicking on the notes search crashes with paniic
2. Note web view renders and goes blank once the mouse moved over it

## High Priority

1. Note list top bar title need to reflect the title of the iems selected in the side bar
2. Active Projects view filer does not work
3. All clikable buttons lack the hints
4. Vault picker popup does not close on focs loss
5. Side bar Types, Views, Folder are not collpsable
6. System menu is missing items for File, View, Help

## Low Priority

1. Inspector view should be opened in a separate windows, not a pannel
2. System window menu shoud display Show Sidebar|Hide Sidebar, Show Inspector|Hide Inspector depending on the current state

### Periscope Phase 8 smoke sweep

**Status:** ⏳ pending — run on host before Phase 8 close-out.

**Recipe:** see `periscope-phase-8-sweep.md`.  The sweep is now split into a thin spawn/teardown harness (`crates/periscope/tests/periscope-phase-8-sweep.sh` — spawns `tolaria`, prints `BIN_PID` + `OUT_DIR`, blocks on stdin) and ten self-contained scenarios in the companion doc that an agent drives from a separate shell.  Five scenarios (slash menu, side-menu hover, formatting toolbar, wikilink popup, IME) still depend on human gestures — the doc flags each with an "Expected gap" note because `osascript keystroke` can't reach the WKWebView editor body (AGENTS.md §4) and periscope doesn't have synthetic-input primitives yet (see the wish list in §6 of the companion doc).

**Why it's not automated yet:** periscope requires Screen Recording + Accessibility permissions on the parent terminal, plus a windowed Tolaria binary; the Anthropic agent sandbox can't satisfy either.

### Bridge gaps

Two `editor_bridge` envelope extensions surfaced during Strand C
that the host stubs locally rather than landing new variants this
phase.  Each carries a deferred follow-up row.  No new
`ToHost` / `FromHost` variants land in Phase 8 — the snake_case wire
shape stays locked in by the Phase 4 `editor_bridge` tests.

1. **Wikilink suggestion bridge variants.**
   - **Missing variants:** `FromHost::WikilinkQuery { prefix }` and
     `ToHost::WikilinkSuggestions { items }` are not present in
     `crates/editor_bridge/src/lib.rs`.
   - **Effect:** the editor-host opens the wikilink suggestion menu
     on `[[` but renders an empty list because the provider has no
     way to ask the native side for vault titles.
   - **Stub:** `editor-host/src/wikilinkSuggestion.ts ::
     defaultWikilinkItemsProvider` returns `[]`.  Suggestion menu
     UI is fully wired; only the data source is stubbed.
   - **Source:** Phase 8.26 commit `0d871de4`.
   - **Target row:** Phase 10 (`vault_search`) — vault-wide title
     search lands the data side; the bridge variants ride along.
     Could also land earlier as a focused Phase 9 follow-up if a
     consumer needs it sooner.

2. **Rename-ripple bridge variants.**
   - **Missing variants:** `FromHost::RenameRequest { id, new_title }`
     and `ToHost::RenameReady { id }` are not present in
     `crates/editor_bridge/src/lib.rs`.
   - **Effect:** `useEditorSaveWithLinks` ships as a thin
     `useEditorSave` wrapper with an `onLinksChanged` seam that
     fires when the outgoing-wikilink set diverges, but the host
     has no way to ask the native side to rewrite inbound links to
     a renamed note.
   - **Stub:** `TODO(rename-bridge)` marker in
     `editor-host/src/useEditorSaveWithLinks.ts`.  The `onLinksChanged`
     callback fires correctly; it just doesn't propagate yet.
   - **Source:** Phase 8.30 commit `1e1f77ac`.
   - **Target row:** Phase 10.1 (`git_provider` rename pipeline) —
     the rename ripple needs a transactional rewrite-and-commit
     boundary that the git provider already owns.  Could also land
     under Phase 9.6 (`vault_lifecycle`) if the rename pipeline
     ships there first.
