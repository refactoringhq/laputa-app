# User reported issues from Phase 8 implmentaion

## 1. Blockers

1.1. ✅ Clicking on the notes search crashes with paniic
1.2. ✅ Note web view renders and goes blank once the mouse moved over it

## 2. High Priority

2.1. ✅ Note list top bar title need to reflect the title of the iems selected in the side bar
2.2. ✅ On startup Note List shows some note is slected. The note view should show an empty note state. It is the same as in React variant.
2.3. ✅ Active Projects view filer does not work
2.4. ✅ All clikable buttons lack the hints
2.5. ✅ Vault picker popup does not close on focs loss
2.6. ✅ Side bar Types, Views, Folder are not collpsable
2.7. ✅ System menu is missing items for File, View, Help
2.8. ✅ Note web view lacks any styling present in React variant
2.9. note-toolbar-star element is not wired
2.10. note-toolbar-organized element is not wired
2.11. note-toolbar-neighborhood element is not wired
2.12. note-toolbar-raw element is not wired
2.13. note-toolbar-ai element is not wired
2.14. note-toolbar-toc element is not wired
2.15. ✅ note-toolbar-reveal element is not wired
2.16. ✅ note-toolbar-copy-path element is not wired
2.17. note-toolbar-more element is not wired
2.18. ✅ note-toolbar-inspector element is not wired
2.19. ✅ Notes list top bar Add bottom does nothing
2.20. ✅ Notes list sort dropdown does not update the title after the user selects an option
2.21. ✅ Notes list sort dropdown appears under the web view pannel
2.22. ✅ Notes list top bar search: Esc button shodu close the search line and clear the search query
2.23. ✅ The sidebar-types-sort button should be Types Filter button
2.24. ✅ Install @blocknote/shadcn and restore BlockNote menu UI primitives
2.25. ✅ Redirect WebView console logs to the tolaria in-process simple logger
2.26. ✅ Round-tripping open/save reformats frontmatter
2.27. ✅ Frontmatter is rendered in preview mode
2.28. ✅ Match the note tollbar tolltips styles to the rest of the UI
2.29. ✅ Properties panel — add/remove/edit controls (type-aware editors for date/boolean/wikilink/list)
2.30. ✅ Notes list sort dropdown tooltip is out of place
2.31. ⏳ Inline chrome overlays via transparent GPUI base layer (Angle C2)

## 3. Low Priority

3.1. ✅ Inspector view should be opened in a separate windows, not a pannel
3.2. ✅ System window menu should display Show Sidebar|Hide Sidebar, Show Inspector|Hide Inspector depending on the current state

---

### Periscope Phase 8 smoke sweep

**Status:** ⏳ pending — run on host before Phase 8 close-out.

**Recipe:** see `phase-8-sweep.md`.  The sweep is now split into a thin spawn/teardown harness (`crates/periscope/tests/harness.sh` — spawns `tolaria`, prints `BIN_PID` + `OUT_DIR`, blocks on stdin) and ten self-contained scenarios in the companion doc that an agent drives from a separate shell.  Five scenarios (slash menu, side-menu hover, formatting toolbar, wikilink popup, IME) still depend on human gestures — the doc flags each with an "Expected gap" note because `osascript keystroke` can't reach the WKWebView editor body (AGENTS.md §4) and periscope doesn't have synthetic-input primitives yet (see the wish list in §6 of the companion doc).

**Why it's not automated yet:** periscope requires Screen Recording + Accessibility permissions on the parent terminal, plus a windowed Tolaria binary; the Anthropic agent sandbox can't satisfy either.

### Annotations and details

Heading match the corresponding issues numbers:

#### 2.4

note-toolbar tooltips now render in a `WindowKind::PopUp` panel via `ui::OverlayTooltipExt`, beating the WKWebView sibling-NSView z-order; remaining chrome crates keep gpui_component's inline tooltip for now

#### 2.24

SideMenu drag handle, etc. — depends on a ComponentsContext.Provider that only the UI subpackages install; tracked here so the 1.2 quick fix can land. Now wired via `@blocknote/shadcn`'s `BlockNoteView` which installs the ComponentsContext.Provider; SideMenuController re-mounted in menus.tsx without the e.SideMenu.Button throw.

#### 2.27

**Reversed** — the read-only `<PropertiesPanel>` that rendered frontmatter as a key/value table above the BlockNote body was removed at the user's request.  The frontmatter data plumbing still runs end-to-end: `dispatchToHost` peels the YAML prefix off on `note_open` via `splitFrontmatter`, stashes it in `frontmatterRef`, and re-prepends it on both `save_request` and the `editor.onChange` auto-save path so YAML round-trips byte-for-byte (worklist 2.26).  Only the display surface is gone — no chrome renders the frontmatter inside BlockNote mode.  `editor-host/src/propertiesPanel.tsx` is preserved (parser export `parseFrontmatterEntries` is still useful for the bridge tests and a future re-introduction in a different shape), but the React component has no JSX consumer.

Worklist 2.26 follow-up landed alongside the reversal: BlockNote's parse+serialize cycle was (a) stripping the leading blank line between frontmatter and body, (b) normalising trailing newlines, (c) absolutising note-relative image URLs against `document.baseURI`, and (d) rewriting bullet markers / blank lines / HTML entities the way the React variant already mitigates via `compactMarkdown`.  Fix captures the original body's leading + trailing whitespace into two new handler-ref slots (`bodyLeadingRef`, `bodyTrailingRef`) on every `note_open`, sandwiches the BlockNote-serialised buffer between them on save, strips the WebView origin from any `(http://localhost:…/…)` link/image target in `blocksToMarkdown`, and routes the body through a verbatim port of `compactMarkdown` to `editor-host/src/compactMarkdown.ts`.  The same construction flows through both save paths (explicit `save_request` and the auto-save inside `editor.onChange`) via the shared `buildMarkdownSaveBody` helper.  `roundtripVault.test.ts` now passes 31/31 across all `demo-vault-v2/*.md`.

#### 2.28

OverlayTooltipExt now used by every chrome surface; `gpui_component::Tooltip` is no longer referenced by application code.  The note-list Sort `Button` is wrapped in a thin `div().id("note-list-sort-trigger")` so it satisfies the `StatefulInteractiveElement + ParentElement` bound the trait needs.

**Hover-latency cache (Angle-C C4).**  Hovering a chrome button previously re-opened a fresh `WindowKind::PopUp` `NSPanel` on every hover-enter — `cx.open_window` + Metal renderer init costs ~50–200 ms cold, which the user perceived as lag.  `OverlayTooltipState` now caches a single `WindowHandle<OverlayTooltipView>` for the App's lifetime: the first hover pays the cold-open cost, every subsequent hover updates the cached entity's `text`, repositions the panel, and re-orders it onto screen.  Hover-exit hides the panel without destroying it.

(a) **Cache strategy.**  Process-global `gpui::Global` slot holding `Option<WindowHandle<OverlayTooltipView>>` plus a `visible: bool` so the duplicate hover-enter events some platforms deliver short-circuit on the second call.  Stale-handle `Err` on the warm-path `update` falls through to `open_cold` after clearing the slot.

(b) **GPUI API surface.**  GPUI's `Window` exposes neither a public `set_window_bounds` / `set_visible` setter nor a `hide` / `show` method.  We route around this by reaching into the underlying `NSWindow` via `raw_window_handle::HasWindowHandle` (already implemented by `gpui::Window` on macOS) and calling AppKit selectors directly through `objc2-app-kit`:
- **Repositioning:** `NSWindow::setFrameTopLeftPoint(NSPoint)` with the y-axis flip mirroring `gpui_macos/src/window.rs:753-758` — AppKit screen coords have y growing UP from the screen's bottom edge, so we subtract our top-down logical `bounds.origin.y` from `NSScreen::frame().size.height`.  Followed by `NSWindow::setContentSize(NSSize)` for idempotent size cleanup.
- **Visibility:** `NSWindow::orderFront(None)` to show, `NSWindow::orderOut(None)` to hide.  Both leave the `NSPanel` (and its `CAMetalLayer`) intact — only the screen list membership flips.

The platform glue lives in a `cfg(target_os = "macos") mod macos { … }` block inside `crates/ui/src/overlay_tooltip.rs`; non-macOS targets stub the helpers because the overlay primitive itself only exists to dodge an AppKit-specific z-order problem (sibling-NSView WebView occlusion).

(c) **Deferred follow-up.**  Worklist row `2.31` tracks the proper architectural fix (Angle-C C2): a transparent GPUI base layer that lives below the WebView and hosts inline overlays so we no longer need a separate `NSPanel` at all.  C4 (this commit) is the cheapest lag fix that keeps the existing separate-window approach.

#### 3.1

The `actions::ToggleInspector` verb is now user-facing: it opens (or closes) a separate macOS `NSWindow` that hosts `inspector_panel::InspectorPanel` via `cx.open_window` with `WindowKind::Normal` (default), `is_movable / is_resizable / is_minimizable: true`, and a regular AppKit titlebar.  The GPUI built-in debug element-picker overlay moved to a new `actions::ToggleElementInspector` action bound to `Cmd+Alt+I` in `crates/actions/assets/default.json` — same `window.toggle_inspector(app_cx)` body, new name so the user-facing verb is freed up.  Lifecycle lives in a process-global slot `OnceLock<Mutex<Option<AnyWindowHandle>>>` in `crates/tolaria/src/inspector.rs`: each `ToggleInspector` dispatch consults the slot, calls `handle.update(..) |w| w.remove_window()` on close (stale-handle `Err`s are logged at `debug` and swallowed so the next toggle opens a fresh window), or `cx.open_window(..)` + stash on open.  Worklist 3.2 will read `is_inspector_open()` to drive dynamic menu labels — that read seam is exposed now but the menu rebuild is deferred to 3.2.

#### 3.2

The View menu's two toggle entries now pick their label from the current sidebar / inspector state instead of the static `"Toggle …"` verb.  `menus::app_menus` takes a small `MenuState { sidebar_open: bool, inspector_open: bool }` snapshot (a `Copy` value, not a `gpui::Global` — the menu data is derived, not stored): `sidebar_open` flips `"Show Sidebar"` ↔ `"Hide Sidebar"`, `inspector_open` flips `"Show Inspector"` ↔ `"Hide Inspector"`.

(a) **`MenuState` parameter.** New `pub struct MenuState` in `crates/tolaria/src/menus.rs`; `app_menus(state: MenuState)` and `view_menu(state: MenuState)` consume it.  `MenuState::default()` (both `false`) renders the empty-app `"Show …"` labels, which is also the value used at the initial `cx.set_menus` site before any window opens.

(b) **Three rebuild trigger points.**
1. **Initial set + post-window-open re-sync.**  `cx.set_menus(menus::app_menus(MenuState::default()))` lands before window open; a follow-up `rebuild_menus(cx)` runs *after* `cx.open_window` returns so the View entry's label reflects whatever startup state the dock actually has.  Both calls live in `crates/tolaria/src/main.rs::macos::run`.
2. **`ToggleSidebar` action handler.**  Rebuilds inside the same `dispatch_to_workspace` deferred closure as the dock toggle (`rebuild_menus_with_workspace(ws, cx)`), so the rebuild observes the *post-toggle* state — calling `rebuild_menus(cx)` at the outer scope would land before the deferred toggle executes.  Covers menu clicks, `Cmd`-keyed accelerators, and the title-bar toggle button (re-routed below) in one path.
3. **`ToggleInspector` action handler.**  Rebuilds via the active-window-lookup `rebuild_menus(cx)` helper immediately after the slot mutation completes (open or close).  Covers menu clicks, `Cmd`-keyed accelerators, and the note-toolbar inspector button from worklist 2.18 — every entry point already dispatches through `actions::ToggleInspector`.

(c) **Reach-the-workspace approach.**  Mirrors `dispatch_to_workspace`: `cx.active_window()` → `handle.update(cx, ...)` → `downcast::<gpui_component::Root>()` → `root.view().downcast::<TolariaWorkspace>()` → `workspace.read(cx).is_sidebar_open(cx)`.  No `gpui::Global` was introduced — the read uses the same active-window seam that the existing dispatcher uses, and `read_sidebar_open` returns `false` (the "Show …" default) when no window resolves so the menu falls back cleanly between window close and reopen.  Sidebar state is exposed via a new `TolariaWorkspace::is_sidebar_open(&App) -> bool` thin accessor over `left_dock.read(cx).is_open()`; inspector state continues to flow through `crate::inspector::is_inspector_open()`.

The title-bar sidebar toggle button (`crates/workspace/src/title_bar.rs`) was re-routed from a direct `Dock::toggle` call to `cx.dispatch_action(&actions::ToggleSidebar)` so the click fires the action handler and the menu rebuild covers it too.  `TitleBar` no longer needs its cached `Entity<Dock>` field; the constructor is now `TitleBar::new()` and the workspace wires it without passing a dock handle.

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
