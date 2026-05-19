# Live roadmap — single canonical phase order

> **Authoritative.**  Anchored to [`mvp-scope.md`](mvp-scope.md)
> (what "MVP" means) and [`components.md`](components.md) (the
> per-component visual contract).  [`progress.md`](progress.md)
> mirrors this numbering as the running ledger.
>
> Workflow and verification rules live in [`process.md`](process.md);
> the periscope screenshot loop is in
> [`e2e-harness.md`](e2e-harness.md).

## Why MVP-first

Original plan ordered work as **chrome → services → editor host** to
maximize visible UI progress.  After Phase 2 we had a populated
chrome shell (3 docks + 7 panels + status bar + breadcrumb + toasts
+ banners) running against `mock_fixtures` Globals.  Strong visual
deliverable but didn't let the user *do* anything yet.

The MVP cut reordered the remaining work so phases 3 / 4 / 5 / 6
landed an actually-usable app — open a vault, navigate, render and
save a note — before the long tail of chrome modals, service
expansion, and cross-platform.  Effect:

- **Dogfood sooner.**  Phase 7+ work happens with the maintainer
  using the new app for actual notes.
- **De-risk the editor-host bridge earlier.**  Phase 4 was the
  highest-risk integration; the production bridge is bigger than
  the `embed_poc` spike validated.

## Shipped

| # | Name | Notes |
|---|------|-------|
| 0 | `embed_poc` spike | WKWebView-in-GPUI viability proof; 26 in-process GPUI tests for the ADR-0115 §6 re-eval triggers |
| 1 | Foundation crates | `paths` / `theme` / `actions` / `ui` / `settings_store` / `workspace` / `tolaria` |
| 2 | Chrome surfaces against mocks | 2a topology + Picker; 2b first chrome (`status_bar`, `breadcrumb_bar`, `toasts`, `banners`); 2c wiring + `TOLARIA_MOCK`; 2d big panels (`sidebar_panel`, `note_list_pane`, `inspector_panel`, `ai_panel`, `search_panel`, `settings_panel`, `diff_view`) |
| 3 | Vault service (minimal) | `vault` crate: open dir / list / read / save / basic rescan.  Shape-compatible swap with `mock_fixtures::MockVault` |
| 4 | Editor host integration | `editor-host/` Vite project; `editor_bridge` crate; `note_item` crate (per-note WKWebView via `gpui-wry`) |
| 5 | MVP wiring + launch | `tolaria --vault <path>`; chrome `from_vault`; `open_note` helper; IPC channel routing; `NoteListPane` mounted in the left dock |
| 6 | Periscope e2e screenshot harness | macOS-only Rust harness (`xcap` + `accessibility`); `screenshot` / `watch` / `click` / `click-id` / `dump-tree` / `list` CLI; SIGUSR1 tree-dump IPC; window-frame-aware CGEvent click |

**✅ MVP cut shipped at `9509f092`** — app opens a local vault,
navigates, renders + saves notes.  Tauri stack still parallel.

### Phase 7 — Visual fidelity pass

Polish the shipped chrome until the live capture matches
[`tolaria-demo-vault-v2-light.png`](tolaria-demo-vault-v2-light.png)
and [`tolaria-demo-vault-v2-dark.png`](tolaria-demo-vault-v2-dark.png)
row-by-row in both themes.  Each sub-task ships its own commit.

| # | Task | Status |
|---|------|--------|
| 7.1 | 4-column workspace + sidebar mount + status bar + CSS-derived theme | ✅ shipped (`6454140c`) |
| 7.2 | Clickable theme toggle (`theme::cycle`) + reference window dimensions (1516×1052 default) | ✅ shipped (`721a2fb4`) |
| 7.3 | `tolaria --width` / `--height` CLI overrides + periscope smoke pins reference size | ✅ shipped (`dac9441c`) |
| 7.4 | `actions::ToggleInspector` → `Window::toggle_inspector` (`Cmd+Alt+I`); `ui::tree_dump` SIGUSR1 IPC; periscope `click-id` / `dump-tree` | ✅ shipped (`5cd51756`) |
| 7.5 | Dark-mode panel-background parity — `NoteListPane`, `PaneGroup`, `Pane` paint `theme.background` | ✅ shipped (`897091bf`) |
| 7.6 | Sidebar visual parity — filename-prefix-derived TYPES, colour-coded leading dot, `Path::file_name` folder leaves | ✅ shipped (`897091bf`) |
| 7.7 | Note-list visual parity — `MMM D · Created MMM D` metadata line; `selected_id` + `theme.list_active` pale-accent row | ✅ shipped (`897091bf`) |
| 7.8 | Custom title-bar strip — `workspace::title_bar::TitleBar` + `TRAFFIC_LIGHTS_PADDING_PT`; `TitlebarOptions::appears_transparent` | ✅ shipped (`897091bf`) |
| 7.9 | WKWebView editor-body dark-mode CSS — `editor-host/style.css` palette + `NoteItem::set_theme` + theme-observer broadcast | ✅ shipped (`897091bf`) |
| 7.10 | Visual-issue QA wave — interactive periscope-driven catalogue + per-issue commits (#001–#021); see [`visual-issues.md`](visual-issues.md) and `progress.md` § Phase 7 follow-up | ✅ shipped |

**✅ Phase 7 complete.**  Live chrome matches
`tolaria-demo-vault-v2-{light,dark}.png` row-by-row in both themes
(`897091bf` baseline), and every reported visual delta in
`visual-issues.md` (#001 through #021) has shipped its own per-issue
commit.  The `embed_poc` spike that validated the WKWebView-in-GPUI
approach in Phase 0 is no longer load-bearing now that the resize
artifact fixes have been ported into the production `note_item`
path — schedule its removal under Phase 7 close-out.

## Active

### Phase 8 — Behavioral fidelity pass

Phase 7 brought the chrome to **visual** parity with the React app.
Phase 8 brings it to **behavioral** parity — the chrome looks right,
but row clicks don't navigate, bulk-action buttons no-op, inspector
sub-panels render `"Phase 3 wires…"` placeholders, the search panel
has no query field, and a dozen React-side surfaces (frontmatter
editing, folder tree, filter builder, vault switcher, …) have no
GPUI counterpart at all.  Phase 8 closes both gaps.

Two strands run in parallel:

- **Strand A — stub completion.** Every crate that ships visually
  today still carries log-only handlers, immutable buffers, or
  placeholder strings where real wiring belongs.  Each Strand A row
  replaces a specific stub with a wired interaction or real data
  source against the existing service shape (mock fixtures still
  back tests).
- **Strand B — missing surfaces.** The Tauri-era app has 10+
  user-facing surfaces with no GPUI counterpart on the previous
  roadmap.  Each Strand B row adds the missing crate, shape-mirrored
  from the React component(s); `from_or_empty` is preserved so
  chrome continues to run on `TOLARIA_MOCK=1`.
- **Strand C — editor-host body parity.** Phase 4b shipped the
  editor-host (`editor-host/`, Vite single-file bundle embedded by
  `note_item`) as a `<textarea>` MVP and explicitly deferred the
  BlockNote + CodeMirror carry-over from the Tauri-era
  `src/components/blockNote*.ts` / `src/extensions/*` /
  `src/components/useEditor*.ts` modules to post-MVP.  No later
  phase had picked this work up, so it lands here in Phase 8 as a
  dedicated strand: the editor-host gains a real rich editor body
  (BlockNote with the existing slash-menu, side-menu, formatting
  toolbar, link-click, suggestion-menu, code-block control, table
  handles, copy compatibility, and IME composition behavior) plus
  the CodeMirror fallback for non-Markdown files.  Wiring stays on
  the existing `editor_bridge` envelope — no new `ToHost` /
  `FromHost` variants land here unless an existing React behavior
  demonstrably requires one.

Lands as commit-per-row.  Strand A, Strand B, and Strand C can
interleave — they share no merge dependencies.  Several Strand A
rows depend on crates from **Phase 9** (the behavioral-layer
extraction): e.g. `actions` (8.13) consumes Phase 9.1
`command_registry`; `note_list_pane` (8.2) and `folder_tree` (8.17)
both consume Phase 9.3 `multi_select`.  For those rows, stub the
Phase 9 dependency locally in Phase 8 and back-fill in Phase 9 —
or land the Phase 9 row first.

#### Strand A — stub completion (existing crates → wired)

| # | Crate | What gets wired (vs. current stub state) | React reference |
|---|-------|-------------------------------------------|------------------|
| 8.1 | `sidebar_panel` | Row click dispatches workspace nav; section chevron toggles collapse; type / view / folder filter drives `note_list_pane` | `Sidebar.tsx`, `sidebar/*` |
| 8.2 | `note_list_pane` | Bulk action bar (delete / archive) handlers; sort / filter glyph dropdowns; per-row status icons; filter text field wired | `NoteList.tsx`, `BulkActionBar.tsx`, `FilterPills.tsx` |
| 8.3 | `note_item` | `FromHost::LinkClick` routes to workspace; `Keydown` dispatch; real `Item::save` coordinating editor + vault | (bridge work; no React equivalent) |
| 8.4 | `inspector_panel` | Backlinks resolver, type instances, references, relationships, outline parser — replace the four `"Phase 3 wires…"` placeholder sections | `inspector/*` |
| 8.5 | `search_panel` | Query input field + live dispatch; result click → open note; relevance ranking | `SearchPanel.tsx`, `NoteSearchList.tsx` |
| 8.6 | `status_bar` | Vault chevron menu, service health probes (git / MCP / Claude), `Contribute` / `Docs` / `Settings` click handlers | `StatusBar.tsx`, `status-bar/*` |
| 8.7 | `breadcrumb_bar` | Click → navigation history; missing icons rendered | `BreadcrumbBar.tsx` |
| 8.8 | `actions` | Phase 2+ handlers — `NewNote`, `Save`, `QuickOpen`, `CommandPalette`, `ToggleSidebar`, `ToggleInspector`, `CloseTab` (consumes Phase 9.1 `command_registry`) | `appCommandCatalog.ts`, `appCommandDispatcher.ts` |
| 8.9 | `banners` | Action handlers — archive, accept rename, install update, restore trash, dismiss | `ArchivedNoteBanner.tsx` + 5 others |
| 8.10 | `toasts` | Auto-dismiss timer; `ToastLayer` integration; click → action | `Toast.tsx` |
| 8.11 | `vault` | Background executor (async reads); fs-watcher; frontmatter parser; folders / assets surfaced | `useVaultLoader`, `useVaultWatcher` |
| 8.12 | `theme` | Settings-store observer → palette swap on user setting change | `useTheme`, `useThemeMode` |
| 8.13 | `workspace` | Pane resize observers; tab close / drag; modal form submit / cancel handlers | (workspace-level glue) |
| 8.14 | `settings_panel` | Real controls per tab — theme, font, vault path, git, AI keys, privacy | `SettingsPanel.tsx` + 6 section files |

#### Strand B — missing surfaces (new crates)

| # | New crate | Mirrors |
|---|-----------|---------|
| 8.15 | `frontmatter_panel` — properties / type / icon editing | `DynamicPropertiesPanel.tsx`, `AddPropertyForm.tsx`, `EditableValue.tsx`, `PropertyValueCells.tsx`, `TypeSelector.tsx`, `TypeCustomizePopover.tsx`, `IconEditableValue.tsx`, `ColorInput.tsx`, `AccentColorPicker.tsx`, `NoteIcon.tsx`, `NoteTitleIcon.tsx` |
| 8.16 | `raw_editor` — CodeMirror fallback for non-Markdown files | `RawEditorView.tsx`, `RawEditorFindBar.tsx` |
| 8.17 | `folder_tree` — interactive folder browser | `FolderTree.tsx`, `folder-tree/*` |
| 8.18 | `filter_builder` — filter / sort / status / tag controls | `FilterBuilder.tsx`, `FilterPills.tsx`, `InboxFilterPills.tsx`, `FilterFieldCombobox.tsx`, `filter-builder/*`, `SortDropdown.tsx`, `StatusDropdown.tsx`, `TagsDropdown.tsx` |
| 8.19 | `workspace_switcher` — vault picker + multi-vault management | `WorkspaceSelector.tsx`, `WorkspaceMoveButtons.tsx`, `WorkspaceInitialsBadge.tsx`, `status-bar/VaultMenu.tsx`, `WorkspaceSettingsRows.tsx` |
| 8.20 | `note_retargeting` — rename ripple to all wikilinks | `note-retargeting/RetargetNoteDialog.tsx`, `NoteRetargetingDialogs.tsx` |
| 8.21 | `rendering_primitives` — non-editor rendering surfaces | `MarkdownContent.tsx`, `SafeMarkup.tsx`, `MermaidDiagram.tsx`, `TldrawWhiteboard.tsx`, `FilePreview.tsx` |
| 8.22 | `onboarding_prompts` — in-app prompts (distinct from Phase 11.7 `startup` first-run screens) | `AiAgentsOnboardingPrompt.tsx`, `ClaudeCodeOnboardingPrompt.tsx`, `OnboardingShell.tsx`, `TelemetryConsentDialog.tsx` |
| 8.23 | `ai_panel` | Mutable input buffer + send dispatch; thread mutation; tool-call rendering | `AiPanel.tsx`, `AiMessage.tsx` |

#### Strand C — editor-host body parity (BlockNote + CodeMirror carry-over)

Lifts the rich-editor body from the Tauri-era TypeScript into the
`editor-host/` Vite project introduced in Phase 4b.  Phase 4b
intentionally shipped a `<textarea>` MVP and deferred this work as
"BlockNote+CodeMirror carry-over from `src/` deferred to post-MVP"
([`progress.md` Phase 4 entry](progress.md#phase-4--editor-host-integration));
no later phase had picked it up before this revision.  Each row
lands as its own commit; all share the existing `editor_bridge`
envelope (no new `ToHost` / `FromHost` variants unless an existing
React behavior demonstrably requires one).

| # | Editor-host slice | What gets ported (from `src/` Tauri-era) | TypeScript reference |
|---|-------------------|------------------------------------------|----------------------|
| 8.24 | BlockNote core mount | Replace the Phase-4b `<textarea>` with a real BlockNote editor instance bound to the `editor_bridge` envelope (`NoteOpen` → `editor.replaceBlocks(...)`, content change → `Dirty`, `SaveRequest` → markdown serialization → `Save`) | `App.tsx` (`@blocknote/*` mount), `src/utils/richEditorMarkdown.ts`, `src/components/tolariaEditorFormattingConfig.ts` |
| 8.25 | Slash menu + side menu + formatting toolbar | Port the suggestion / side / formatting menus, including the hover-guard fixes that suppress menus when the cursor leaves the block | `blockNoteSideMenuHoverGuard.{ts,test.ts}`, `blockNoteFormattingToolbarHoverGuard.{ts,test.ts,extra.test.ts}`, `tolariaBlockNoteSideMenu.test.tsx`, `blockNoteSideMenu.regression.test.ts` |
| 8.26 | Wikilink suggestion menu + link-click + cursor target | Wikilink autocomplete, click-to-navigate (routes through `editor_bridge::FromHost::LinkClick` already wired in Phase 8.3), cursor-target restoration after edit | `blockNoteCursorTarget.ts`, `blockNoteSuggestionMenu.regression.test.ts`, `blockNoteSuggestionWrapper.regression.test.tsx`, `blockNoteLinkClick.regression.test.ts`, `useEditorLinkActivation.{ts,test.tsx}`, `src/utils/suggestionEnrichment.{ts,test.ts}` |
| 8.27 | IME composition + render-recovery + transform-error guard | macOS IME mid-composition handling (Phase 0 §6 trigger #2), render-recovery for prosemirror state corruption, ProseMirror transform-error recovery extension | `useEditorComposing.ts`, `imeCompositionKeyGuardExtension.ts`, `blockNoteRenderRecovery.{ts,test.ts}`, `richEditorTransformErrorRecoveryExtension.ts` |
| 8.28 | Code-block control, table handles, copy compatibility, checklist | Carry over the four BlockNote behavior regressions locked in by `src/lib/blockNote*.regression.test.ts` so the GPUI port doesn't regress against React parity | `blockNoteCodeBlockControl.regression.test.ts`, `blockNoteTableHandles.regression.test.ts`, `blockNoteCopyCompatibility.regression.test.ts`, `blockNoteChecklist.regression.test.ts`, `blockNotePopover.regression.test.ts` |
| 8.29 | CodeMirror raw-mode fallback inside the editor-host | Port the CodeMirror raw-editor pipeline (markdown + frontmatter highlight, zoom cursor fix, raw-editor utilities) into the editor-host so non-BlockNote-shaped notes render with the same behavior as the React `RawEditorView`.  Coordinates with Strand B 8.16 `raw_editor`: 8.29 owns the embedded WKWebView path; 8.16 covers any chrome glue / find-bar that lives on the GPUI side | `src/extensions/markdownHighlight.{ts,test.ts}`, `src/extensions/frontmatterHighlight.{ts,test.ts}`, `src/extensions/zoomCursorFix.{ts,behavior.test.ts,extra.test.ts}`, `src/utils/rawEditorUtils.ts`, `RawEditorView.{tsx,test.tsx}`, `RawEditorFindBar.tsx` |
| 8.30 | Editor mode / tab-swap / focus / save hand-offs | Port the editor lifecycle hooks that coordinate BlockNote ↔ raw-mode switching, tab-swap state preservation, focus restoration, save-with-links rename ripple, and the memory-probe controller used to detect WebView OOMs | `useEditorModePositionSync.{ts,test.tsx}`, `useEditorTabSwap.{ts,test.ts,selection.test.ts,rename.test.ts,performance.test.ts}`, `useEditorFocus.{ts,test.ts}`, `useEditorSave.{ts,test.ts}`, `useEditorSaveWithLinks.{ts,test.ts}`, `useEditorMemoryProbeController.ts`, `src/components/editor-content/useEditorContentModel.ts` |

**Strand C verification (in addition to the global Phase 8 exit
criteria):**

- Each editor-host slice ships **Vitest** coverage inside
  `editor-host/` mirroring the React tests it replaces.  No test is
  allowed to be dropped silently — if a React test does not port
  (e.g., because the underlying behavior is now natively handled
  by GPUI instead of the WebView), `progress.md` records the
  rationale in the per-row entry.
- Each slice ships at least one **periscope smoke** capture that
  exercises the behavior end-to-end through a real WKWebView
  (slash-menu open + insert, side-menu drag, formatting toolbar
  bold, wikilink suggestion + click, IME composition, raw-mode
  switch, save round-trip).  These are explicitly the kind of
  paths the global criteria reserves for periscope (round-trip
  through the embedded WebView).
- The `editor-host/` single-file bundle stays embedded by
  `note_item` via `include_str!()`.  If the bundle grows past the
  Phase 4b size of ~3.95 kB by more than 5× (i.e., past ~20 kB),
  record the new size in `progress.md` alongside the commit so
  startup-cost regressions are visible.
- Bridge-envelope churn is logged: if a slice forces a new
  `ToHost` / `FromHost` variant, the row's entry calls it out and
  links the `editor_bridge` test that locks in the snake_case wire
  shape.

**Exit criteria:**

- Every Strand A row replaces its stub with a wired interaction; the
  corresponding placeholder string (`"Phase 3 wires…"`, log-only
  handlers, immutable buffers) no longer appears in shipped code.
- Every Strand B row ships a new crate that mirrors the React
  surface shape-for-shape (mock-fixture-backed); `from_or_empty`
  preserved so chrome continues to run on `TOLARIA_MOCK=1`.
- **In-process `#[gpui::test]` coverage is the primary verification.**
  Every wired interaction has an in-process test that dispatches the
  action and asserts the observable consequence (entity state change,
  observer fired, panel content update, focus shift).  The runner
  used by the existing workspace tests is extended; no compositor
  needed, no window appears, `cargo test --workspace` stays under
  ~30 s on the dev machine.  Examples:
  - `sidebar_panel_row_click_dispatches_navigate`
  - `note_list_pane_bulk_archive_drops_selection_and_count_chip`
  - `search_panel_query_input_updates_result_entity`
  - `inspector_panel_backlinks_resolver_returns_seeded_links`
  - `toast_layer_auto_dismiss_timer_fires_after_5s`
- **Periscope smoke tests are reserved for paths the in-process
  runner literally can't see** — primarily WKWebView round-trips
  (editor focus, save via JS bridge, link-click → workspace nav)
  plus one full-chrome screenshot diff per theme to catch visual
  regressions.  Kept under ~10 captures total so the smoke suite
  stays under ~60 s.  Anything verifiable in-process MUST land as
  `#[gpui::test]` instead.

**Visual fidelity pass:**

User driven feedback phase for new surfaces implemented in Phase 8

## Planned


### Phase 9 — Behavioral layers

The React/Tauri-era app has ~131 hooks under `src/hooks/` that
together form an unstated state-machine library: global command
dispatch, navigation history, multi-select, dialog stack, vault
lifecycle, autogit policy, telemetry pipeline.  Phase 8 leans on
ad-hoc closures and `cx.observe()` calls to wire the visible chrome;
Phase 9 formalises this cross-cutting glue into named GPUI crates
so Phase 10 service expansion and Phase 11 modal chrome both
consume a stable layer instead of re-deriving slices of it.

Lands as commit-per-crate; each crate is `mock_fixtures`-compatible.

| # | Crate | Mirrors |
|---|-------|---------|
| 9.1 | `command_registry` — global command dispatch + shortcut table (consumed by `actions` and Phase 11.1 `command_palette`) | `appCommandCatalog.ts`, `appCommandDispatcher.ts`, `useCommandRegistry`, `useAppKeyboard` |
| 9.2 | `nav_history` — back / forward / neighborhood drill-down (consumed by title-bar triplet, breadcrumb) | `useNavigationHistory`, `useNeighborhoodSelection`, `useNavigationGestures`, `useTabManagement` |
| 9.3 | `multi_select` — shared multi-row selection model (consumed by `note_list_pane`, `folder_tree`, search results) | `useMultiSelect`, `useBulkActions`, `useDeleteActions` |
| 9.4 | `dialog_stack` — modal queue, focus return, Escape handling (foundation for Phase 11 modal chrome) | `useDialogs` |
| 9.5 | `auto_git` — checkpoint policy, commit-message format, debounce (wraps Phase 10.1 `git_provider`; consumed by Phase 12.2 autogit flow) | `useAutoGit`, `useAutoGitWork`, `useCommitFlow`, `useConflictFlow` |
| 9.6 | `vault_lifecycle` — open / switch / rename-detection state machine (wraps `vault` crate's data API; consumed by Phase 8.19 `workspace_switcher`) | `useVaultLoader`, `useVaultWatcher`, `useVaultRenameDetection`, `useVaultSwitcher`, `useVaultBridge` |
| 9.7 | `telemetry_pipeline` — event sink, redaction, sampling (wraps Phase 10.6 `telemetry` service) | `useTelemetry`, `productAnalytics`, `sensitiveTextRedaction`, `telemetryConfig`, `feedbackDiagnostics` |

**Why between Phase 8 and Phase 10:** Phase 8 builds the visible
behavior using whatever local closures + `cx.observe()` calls each
crate needs — fastest path to a usable chrome.  Phase 9 then
extracts the cross-cutting patterns that emerge into named crates
so Phase 10 service expansion and Phase 11 modal chrome don't each
re-derive a shortcut table / dialog stack / autogit policy.
Refactoring Phase 8's local closures to call Phase 9's crates is
in-scope for each Phase 9 row.

### Phase 10 — Service expansion

Each service is its own crate landing as its own commit.  Real
services replace mock fixtures shape-for-shape via the
`mock_fixtures` → `Global` swap pattern Phase 3 established.  This
phase is the GPUI port of the Tauri backend under `src-tauri/src/`
(35 Rust files); each row names the React/Tauri surface it
replaces.  Lands before Phase 11 modal chrome because most modals
consume one of these services (CommitDialog → `git_provider`;
CloneVaultModal → `git_provider`; ConfirmDelete → `vault`;
ConflictResolverModal → `auto_git` + `git_provider`).

| # | Service | Replaces |
|---|---------|----------|
| 10.1 | `git_provider` — git status / commit / push / pull / history | `MockGit`, `src-tauri/src/lib.rs` git IPC commands |
| 10.2 | `vault_search` — full-text + tag search index | `MockSearch`, `src-tauri/src/search.rs` |
| 10.3 | `vault_watcher` (advanced — fs-notify, debounced refresh) | basic rescan in `vault`, `src-tauri/src/vault_watcher.rs` |
| 10.4 | `cli_agents` — 6 backends × `_cli` + `_config` + `_discovery` + `_events` (~22 files: Claude, Codex, Gemini, Kiro, OpenCode, Pi) | `MockAi`, `src-tauri/src/{claude,codex,gemini,kiro,opencode,pi}_*.rs` |
| 10.5 | `mcp_bridge` — MCP server discovery + RPC | `src-tauri/src/mcp.rs` |
| 10.6 | `telemetry` — PostHog event sink | `src-tauri/src/telemetry.rs` |
| 10.7 | `app_updater` — Sparkle-style updater | `src-tauri/src/app_updater.rs` |
| 10.8 | `localization` — `lara` translation pipeline (17 locale files; en → 16 targets) | `src/locales/*.json`, `lara.yaml`, `lara.lock` |
| 10.9 | `vault_registry` — multi-vault list, recent vaults, last-opened (consumed by Phase 8.19 `workspace_switcher`) | `src-tauri/src/vault_list.rs` |
| 10.10 | `window_state` — window position / size restoration across launches | `src-tauri/src/window_state.rs` |
| 10.11 | `native_text_assistance` — OS spell-check, accent input, smart quotes (macOS NSTextInputClient bridge) | `src/lib/nativeTextAssistance.ts` |
| 10.12 | `settings_panel` persistence wiring | mock settings → real `settings_store`, `src-tauri/src/settings.rs` |

### Phase 11 — Modal chrome surfaces

One crate per task; each lands as its own commit.  Phase 2 inventory
carried over; behavioural reference in
[`components.md`](components.md).

| # | Crate | React source under `src/components/` |
|---|-------|---------------------------------------|
| 11.1 | `command_palette` (`Picker<CommandPaletteDelegate>` modal; uses `ui::Picker`) | `CommandPalette.tsx`, `CommandPaletteAiMode.tsx` |
| 11.2 | `quick_open` (`Picker<QuickOpenDelegate>` modal) | `QuickOpenPalette.tsx` |
| 11.3 | `dialogs` — Commit, ConfirmDelete, CreateNote, CreateType, CreateView, Feedback, McpSetup, TelemetryConsent, GitRequiredModal, ConflictResolverModal, AddRemoteModal, CloneVaultModal, OnboardingShell (Note: `NoteRetargetingDialogs`, `RetargetNoteDialog` live in Phase 8.20 `note_retargeting`) | every `*Dialog.tsx` / `*Modal.tsx` |
| 11.4 | `wikilink_inputs` — Picker-based wikilink combobox | `Wikilink{Chat,Suggestion,Inline}.tsx` |
| 11.5 | `image_lightbox` — full-screen image viewer | `ImageLightbox.tsx` |
| 11.6 | `emoji_picker` — popover grid | `EmojiPicker.tsx`, `TagsDropdown.tsx` |
| 11.7 | `startup` — Welcome + Startup screens | `WelcomeScreen.tsx`, `StartupScreen.tsx` |

### Phase 12 — Parity hardening  ⚠️ needs clarification

**Status: specification incomplete.**  Each row below names a task
but no doc spells out the acceptance contract, scope boundary, or
required upstream dependency.  Before Phase 12 can start, each row
needs a 1-page spec answering the open questions called out below.

| # | Task | Open questions before this can be picked up |
|---|------|---------------------------------------------|
| 12.1 | Multi-tab `Pane` UX (close hotkey, drag-reorder, persistence) | What is a "tab" — note items only, or also search / settings / inspector targets?  Persistence key — per-vault or per-app?  Where do reopened tabs land on next launch (focus, scroll position)?  Drag-reorder: same pane only, or across panes?  Close hotkey conflicts with `actions::CloseWindow` — need to disambiguate. |
| 12.2 | Autogit checkpoints + conflict resolver flow | Depends on Phase 10.1 (`git_provider`) shape being locked first.  Checkpoint cadence (per save? on quit? interval?).  Commit-message format (React side uses `useAutoGit`; need to port the *policy*, not just the trigger).  Workflow policy lives in Phase 9.5 (`auto_git`); resolver UI in Phase 11.3 (`dialogs::ConflictResolverModal`) — but the resolution *logic* (3-way merge? side-by-side picker?) is unscoped. |
| 12.3 | Onboarding flow (vault picker, first-run experience) | Overlaps with Phase 11.7 (`startup` = `WelcomeScreen` + `StartupScreen`) and Phase 8.23 (`onboarding_prompts`) — what's the boundary?  First-run = absence of `settings.json`, or a separate flag?  Permission prompts (Screen Recording / Accessibility for periscope; FS access) — in scope? |
| 12.4 | Measurement gate — memory, startup time, frame budgets; CI assertion | Budgets are unspecified — memory ceiling at what vault size?  Startup time on what hardware?  Frame budget under which scene (idle?  scrolling note list?  typing in editor body)?  CI runner — periscope needs Screen Recording + Accessibility grants, doesn't run on hosted GitHub runners.  Where does the harness live (self-hosted Mac mini? local-only gate?)? |

**Resolution path:** write `phase-12-spec.md` (or per-row sub-specs)
and re-evaluate dependency order against Phases 8 / 9 / 10 / 11.
Until then this phase stays **planned but blocked** — do not pick
up a Phase 12 row without first landing its spec.

## Where MockVault still lives after Phase 10

Even after Phase 10 swaps real services in, `mock_fixtures::MockVault`
stays around for:

- Test harnesses (every panel crate's `from_or_empty` + tests).
- The `TOLARIA_MOCK=1` launch path (handy for chrome work without
  a real vault on disk).

Removal of `mock_fixtures` is **not** on the roadmap; it's a
permanent test/dev utility.
