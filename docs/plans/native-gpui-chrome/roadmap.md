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

### Phase 8 — Modal chrome surfaces

One crate per task; each lands as its own commit.  Phase 2 inventory
carried over; behavioural reference in
[`components.md`](components.md).

| # | Crate | React source under `src/components/` |
|---|-------|---------------------------------------|
| 8.1 | `command_palette` (`Picker<CommandPaletteDelegate>` modal; uses `ui::Picker`) | `CommandPalette.tsx`, `CommandPaletteAiMode.tsx` |
| 8.2 | `quick_open` (`Picker<QuickOpenDelegate>` modal) | `QuickOpenPalette.tsx` |
| 8.3 | `dialogs` — Commit, ConfirmDelete, CreateNote, CreateType, CreateView, Feedback, McpSetup, TelemetryConsent, GitRequiredModal, ConflictResolverModal, AddRemoteModal, CloneVaultModal, NoteRetargetingDialogs, RetargetNoteDialog, OnboardingShell | every `*Dialog.tsx` / `*Modal.tsx` |
| 8.4 | `wikilink_inputs` — Picker-based wikilink combobox | `Wikilink{Chat,Suggestion,Inline}.tsx` |
| 8.5 | `image_lightbox` — full-screen image viewer | `ImageLightbox.tsx` |
| 8.6 | `emoji_picker` — popover grid | `EmojiPicker.tsx`, `TagsDropdown.tsx` |
| 8.7 | `startup` — Welcome + Startup screens | `WelcomeScreen.tsx`, `StartupScreen.tsx` |

## Planned

### Phase 9 — Service expansion

Each service is its own crate landing as its own commit.  Real
services replace mock fixtures shape-for-shape via the
`mock_fixtures` → `Global` swap pattern Phase 3 established.

| # | Service | Replaces |
|---|---------|----------|
| 9.1 | `git_provider` — git status / commit / push / pull / history | `MockGit` |
| 9.2 | `vault_search` — full-text + tag search index | `MockSearch` |
| 9.3 | `vault_watcher` (advanced — fs-notify, debounced refresh) | basic rescan in `vault` |
| 9.4 | `cli_agents` — Claude / Codex agent process management | `MockAi` |
| 9.5 | `mcp_bridge` — MCP server discovery + RPC | (new surface) |
| 9.6 | `telemetry` — PostHog event sink | (new surface) |
| 9.7 | `app_updater` — Sparkle-style updater | (new surface) |
| 9.8 | `localization` — `lara` translation pipeline | (new surface) |
| 9.9 | `settings_panel` persistence wiring | mock settings → real `settings_store` |

### Phase 10 — Parity hardening

| # | Task |
|---|------|
| 10.1 | Multi-tab `Pane` UX (close hotkey, drag-reorder, persistence) |
| 10.2 | Autogit checkpoints + conflict resolver flow |
| 10.3 | Onboarding flow (vault picker, first-run experience) |
| 10.4 | Measurement gate — memory, startup time, frame budgets; CI assertion |

## Where MockVault still lives after Phase 9

Even after Phase 9 swaps real services in, `mock_fixtures::MockVault`
stays around for:

- Test harnesses (every panel crate's `from_or_empty` + tests).
- The `TOLARIA_MOCK=1` launch path (handy for chrome work without
  a real vault on disk).

Removal of `mock_fixtures` is **not** on the roadmap; it's a
permanent test/dev utility.
