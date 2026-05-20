# ADR-0115 migration progress ledger

Branch: `feat/native-gpui-chrome`.  Push-to-`main` workflow per
ADR-0021; intermediates are dogfood-only.  Tauri stack under
`src-tauri/` stays untouched throughout.

Numbering aligned to [`roadmap.md`](roadmap.md) (single canonical
phase order).  Workflow + verification rules live in
[`process.md`](process.md); per-component visual + behavioural
spec lives in [`components.md`](components.md).

## Status table

| Phase | Status | Commit | Tests | Crates added |
|-------|--------|--------|-------|--------------|
| 0 — `embed_poc` spike | ✅ done | `9f26531e` | 26 | `embed_poc` |
| 1 — Foundation crates | ✅ done | `3a8d54d5` | +19 (45) | `paths`, `theme`, `actions`, `ui`, `settings_store`, `workspace`, `tolaria` (bin) |
| 2a — Workspace topology + mocks + Picker | ✅ done | `956f8c58` | +51 (96) | `mock_fixtures`; expanded `workspace` (Dock/Pane/PaneGroup/Panel/Item/MockNoteItem); vendored Picker into `ui` |
| 2b — First chrome surfaces | ✅ done | `e31bc7fc` | +19 (115) | `status_bar`, `breadcrumb_bar`, `toasts`, `banners` |
| 2c — Chrome wiring + `TOLARIA_MOCK` | ✅ done | `3131ccc7` | +3 (118) | — (integration wave; touched 5 existing crates) |
| 2d — Big panels | ✅ done | `6d96cca8` | +31 (149) | `sidebar_panel`, `note_list_pane`, `inspector_panel`, `ai_panel`, `search_panel`, `settings_panel`, `diff_view` |
| 3 — Vault service (minimal) | ✅ done | `ad1581cb` | +9 (158) | `vault` |
| 4 — Editor host integration | ✅ done | `8c31dd32` / `a6d221ec` / `bc69b714` | +29 (187) | `editor_bridge`, `note_item`; `editor-host/` Vite project |
| 5 — MVP wiring + launch | ✅ done | `f3eef114` / `e0a2b6f0` / `11ace568` | +4 (191) | `tolaria --vault`; chrome `from_vault`; `open_note` helper; IPC channel routing; `NoteListPane` mounted in left dock |
| 6 — Periscope e2e screenshot harness | ✅ done | `9509f092` | +1 (192) | `periscope` |
| **MVP cut** | shipped at `9509f092` | 192 | App opens local vault, navigates, renders + saves notes.  Tauri stack still parallel. |
| 5d-followup — flicker + first-flash fix | ✅ done | — | +2 (209) | `NoteItem::open_in_webview` reuses the WKWebView across note clicks; `open_note::preload_blank_webview` constructs the WKWebView at workspace startup so the first click is an IPC swap instead of an NSView allocation. |
| 7.1 — 4-column workspace + sidebar mount + status bar + CSS-derived theme | ✅ done | `6454140c` | (folded into 209) | Workspace gains a fixed `note_list_column` between left dock and center group.  `status_bar` rewritten to 2-cluster layout.  `theme::palette::{apply_light, apply_dark}` overwrites `gpui_component::ThemeColor` with values derived from `src/index.css`. |
| 7.2 — Clickable theme toggle + reference window dimensions | ✅ done | `721a2fb4` | (209) | `theme::cycle(cx)` flips Light ↔ Dark; status-bar "Theme" cell is interactive.  `WindowSettings` default bumped to 1516×1052 to match the Tauri-era reference screenshots. |
| 7.3 — `tolaria --width` / `--height` CLI + periscope smoke pins reference size | ✅ done | `dac9441c` | (209) | Independent CLI overrides for persisted `WindowSettings`; periscope `screenshot_smoke` passes `--width 1516 --height 1052`. |
| 7.4 — GPUI inspector + SIGUSR1 tree dump + periscope click-by-id | ✅ done | `5cd51756` | +5 (216) | `actions::ToggleInspector` → `Window::toggle_inspector` (`Cmd+Alt+I`); `ui::tree_dump` SIGUSR1 IPC with monotonic sequence counter; `workspace::NATIVE_TITLE_BAR_HEIGHT_PT` shared const; periscope `click-id` / `dump-tree` subcommands. |
| 7.5 — Dark-mode panel-background parity | ✅ done | `897091bf` | +0 (216) | `NoteListPane`, `PaneGroup`, `Pane::render` paint `theme.background` so the centre column tracks dark mode instead of bleeding through. |
| 7.6 — Sidebar visual parity | ✅ done | `897091bf` | +2 (218) | `sidebar_panel`: `type_label_for` (filename-prefix → display label) + `type_color` palette, 8-pt coloured leading-dot glyph, `Path::file_name` folder leaves. |
| 7.7 — Note-list visual parity | ✅ done | `897091bf` | +3 (221) | `NoteListPane`: `MMM D · Created MMM D` metadata line, `selected_id` field + `open` / `set_active` helpers, `theme.list_active` pale-accent on the active row, `visible_entries` returns `impl Iterator`. |
| 7.8 — Custom title-bar strip | ✅ done | `897091bf` | +1 (222) | `workspace::title_bar::TitleBar` view + `TRAFFIC_LIGHTS_PADDING_PT = 72.0`; mounted by `TolariaWorkspace::empty`; `TitlebarOptions::appears_transparent` lets GPUI draw under the macOS chrome.  Each cell is `id()`-tagged + `dump_as`-registered. |
| 7.9 — WKWebView editor-body dark-mode CSS | ✅ done | `897091bf` | (222) | `editor-host/style.css` gains `--fg-muted`, `caret-color`, italic placeholder, `color-mix(...)` selection; `NoteItem::set_theme` propagates via `document.documentElement.dataset.theme` (no `tolariaBridge` Ready dependency); `tolaria/main.rs` observes `gpui_component::theme::Theme` and broadcasts. |
| 7.10 — Visual-issue QA wave | ✅ done | `6b92a6ba` → `3c70b6b9` | (~234) | Periscope-driven interactive QA loop catalogued and closed visual deltas #001–#021 in their own per-issue commits.  Final per-issue rundown in the [Phase 7 follow-up](#phase-7-follow-up--visual-issue-qa-wave) table below; full diagnostic notes in [`visual-issues.md`](visual-issues.md). |
| **✅ Phase 7 complete** | shipped at `3c70b6b9` | ~234 | Visual fidelity baseline (`897091bf`) plus 21 closed visual issues.  The `embed_poc` spike is no longer load-bearing — schedule removal under Phase 7 close-out. |
| 8.x — Behavioral fidelity pass (Strand A — stub completion) | ✅ done (14 of 14) | `fa3267b4` (8.1), `2271f925` (8.2), `ce3af214` (8.3), `b830c42d` (8.4), `62b3beae` (8.5), `0fbe3568` (8.6), `3dad69ce` (8.7), `88afa9f7` (8.8), `c876ce8b` (8.9), `333bbc92` (8.10), `07c7ec7f` / `dbf8c00f` / `c65ac9de` / `aad8dbbb` (8.11.1–8.11.4), `97487dce` (8.12), `95b1ee4b` + `6470e304` (8.13), `66014021` (8.14 scaffold), `a98cdfcd` (8.23) | (folded into 271+) | Wired interactions land per crate.  8.11 vault gains frontmatter parser, folder/asset surfacing, background executor, and notify-based fs-watcher (4 sub-rows).  8.13 completes with pane resize observer + tab close/reorder events.  8.14 ships the structured per-tab scaffold; real editable controls remain Phase 9-blocked.  Action `Save` / `NewNote` / `OpenSettings` / `QuickOpen` / `CommandPalette` stay `log_stub` placeholders — wired by Phase 9.1 `command_registry` + Phase 8.14 follow-ups + Phase 11.x. |
| 8.x — Behavioral fidelity pass (Strand B — missing surfaces) | ✅ done (8 of 8 crates) | `13421226` (8.17), `ef520117` (8.15), `65d6ec71` (8.16), `481c89ab` (8.18), `af7d3e14` (8.19), `3111ed89` (8.20), `cfdfc5e4` (8.21), `6190d076` (8.22) | (folded into 271+) | New crates shipped: `folder_tree`, `frontmatter_panel`, `raw_editor`, `filter_builder`, `workspace_switcher`, `note_retargeting`, `rendering_primitives`, `onboarding_prompts`.  Each follows the `from_or_empty` + `from_mock` pattern set by `folder_tree`. |
| 8.x — Behavioral fidelity pass (Strand C — editor-host body parity) | ✅ done (7 of 7) | `4c7998e7` (8.24), `fa1aae40` (8.25), `0d871de4` (8.26), `7afa7072` (8.27), `48cddd2b` (8.28), `63c79224` (8.29), `1e1f77ac` (8.30) | (folded into 271+; vitest 0 → 271) | BlockNote + CodeMirror carry-over from `src/components/blockNote*.ts` / `src/extensions/*` / `src/components/useEditor*.ts` into `editor-host/`, replacing the Phase-4b `<textarea>` MVP.  Bundle 3.95 kB → 2.26 MiB (~580× — see [Bundle-size record](#bundle-size-record-phase-8-close-out) below).  Two bridge gaps stubbed for Phase 9/10 follow-up — see [`phase-8-issues.md`](phase-8-issues.md#bridge-gaps).  Zero new `ToHost` / `FromHost` variants this phase. |
| **✅ Phase 8 complete** | shipped at `1e1f77ac` (Strand C tail) + `6190d076` (Strand B tail) + `aad8dbbb` (Strand A tail) | 271+ | All 30 rows landed across Strand A (14), Strand B (8), Strand C (7), plus Strand A 8.13 modal subset and 8.14 scaffold.  Editor-host vitest suite grew from 0 → 271 over Strand C; workspace + crate tests grew from ~261 → ~271+ over Strand A.  Two bridge-envelope gaps logged for Phase 9/10 follow-up.  Phase 8 visual issues catalogued in [`phase-8-issues.md`](phase-8-issues.md). |
| 9.x — Behavioral layers | ⏳ planned | — | — | `command_registry`, `nav_history`, `multi_select`, `dialog_stack`, `auto_git`, `vault_lifecycle`, `telemetry_pipeline` (9.1–9.7). |
| 10.x — Service expansion | ⏳ planned | — | — | `git_provider`, `vault_search`, `vault_watcher` (advanced), `cli_agents`, `mcp_bridge`, `telemetry`, `app_updater`, `localization`, `vault_registry`, `window_state`, `native_text_assistance`, `settings_panel` persistence. |
| 11.x — Modal chrome surfaces | ⏳ planned | — | — | `command_palette`, `quick_open`, `dialogs`, `wikilink_inputs`, `image_lightbox`, `emoji_picker`, `startup` (one task per crate). |
| 12.x — Parity hardening | ⏳ planned | — | — | Multi-tab `Pane`; autogit + conflict resolver; onboarding; measurement gate. |

---

## Phase-by-phase detail

### Phase 0 — `embed_poc` spike

Validation crate proving the four ADR-0115 §6 re-evaluation triggers
on macOS: WKWebView focus handoff, IME mid-composition, frame-sync
during sidebar drag, Cmd+S delivery via native menu.  26 in-process
GPUI tests (Test*Context, `simulate_keystrokes`,
`simulate_window_resize`) cover Scenarios 1/3/4; IME stays a manual
pass.

### Phase 1 — Foundation

Seven crates, empty native shell:

- `paths` — app data/config dir resolver; panics on `dirs::data_dir()` miss
- `theme` — wraps `gpui_component::Theme` as idempotent Global
- `actions` — `actions!()` registry + default+user keymap merge (infallible)
- `ui` — Phase 2 compounds placeholder
- `settings_store` — `Global`; atomic JSON persist via `.tmp`+rename; observer fan-out
- `workspace` — `TolariaWorkspace` skeleton; `ModalLayer` + `ToastLayer`; public methods (`empty`, `push_toast`, `toggle_modal`, `dismiss_modal`, `has_active_modal`, `toast_count`)
- `tolaria` — binary; native menu + Cmd+Q; opens root window

API decisions during per-crate idiomatic-rust-review pass:

- `actions::init` dropped `Result` (always `Ok`)
- `SettingsStore.settings` → `pub(crate)`; callers use `::get(cx)`
- `TolariaWorkspace` overlay fields private + delegate methods

### Phase 2a — Workspace topology + mocks + Picker

Three foundation deliverables that unblock the chrome panel waves:

**`workspace` expansion** — Dock + DockState enum (`Empty/Closed/Open`) + Pane + PaneGroup + Panel trait + Item trait + ItemHandle object-safe wrapper + Activation enum + MockNoteItem stub.  `TolariaWorkspace::empty` mounts 3 docks (Left/Right/Bottom) + center PaneGroup via `h_resizable`.

**`mock_fixtures` crate** — MockVault (30 seeded notes), MockGit (3 modified + 1 untracked + 5-commit history), MockSearch (keyword table, `f32::total_cmp` sort), MockAi (1 four-turn thread with tool-use round-trip), MockSettings.  Every public method returns `Task<T>` (via `Task::ready` for instant) so Phase 3 swap is shape-compatible.

**Picker port from Zed** — `crates/ui/src/picker.rs` (~495 LOC).  PickerDelegate trait (8 methods, RPITIT default for placeholder_text).  Enter / Cmd+Enter consumed via `on_action(InputEnter)`; Esc → `DismissEvent`.  Module header lists every dropped upstream feature with `TODO(Phase 2)` tags.  Upstream sha: `f2df3f9e`.

### Phase 2b — First chrome surfaces

Four small, isolated chrome crates against mock_fixtures (each self-contained, wiring deferred):

- `status_bar` — StatusItem enum (VaultName/GitBranch/DirtyCount/Mode); EditorMode (Normal/Search); `from_mock(cx)` pulls from MockVault/MockGit
- `breadcrumb_bar` — stateless view; BreadcrumbSegment {label, icon}; namespaced ElementIds
- `toasts` — typed Toast variants (Info/Success/Warning/Error); opaque ToastId via `AtomicU64`; `#[non_exhaustive]`; div-based renderer
- `banners` — 6 plan-locked variants (ArchivedNote/ConflictNote/RenameDetected/Update/TrashWarning/DeleteProgressNotice); BannerSeverity; `gpui_component::alert::Alert` renderer

Review pass: 1 MUST + 13 SHOULDs applied (`breadcrumb_bar` is_last fix; toasts public-field tightening; `Default` impl on `BreadcrumbBar`; namespaced ElementIds; `# Panics` docs; etc.).

### Phase 2c — Chrome wiring + `TOLARIA_MOCK`

Integration wave:

- `StatusBar::from_or_empty(cx)` helper — returns `from_mock(cx)` if mock globals registered, empty otherwise
- `workspace::ToastLayer` switched from `Vec<SharedString>` to `Vec<toasts::Toast>` + `toasts::render_toast`
- `TolariaWorkspace::push_toast` now takes `Toast` directly; new `status_bar: Entity<StatusBar>` field rendered in the status-bar slot
- `MockNoteItem` composes `Vec<BreadcrumbSegment>` (derived from path) + `Vec<Banner>` stack via `with_banner(...)` builder
- `tolaria` binary reads `TOLARIA_MOCK` env var (truthy: `1`/`true`/`yes`/`on`, case-insensitive); installs MockVault/MockGit/MockAi/MockSearch as Globals before `observe_global` registrations

Manual verify: `TOLARIA_MOCK=1 cargo run -p tolaria` launches cleanly; log shows `installed mock_fixtures globals`.

Review pass: 2 MUST + 3 SHOULD applied (status_bar doc concatenation; mock-install ordering; `bar: BreadcrumbBar` → direct `Vec<BreadcrumbSegment>`; tightened `TOLARIA_MOCK` truthy match; inlined awkward two-step construction).

### Phase 2d — Big panels

Seven panel crates landed in three waves, matching the per-crate
visual contract in [`components.md`](components.md): `sidebar_panel`,
`note_list_pane`, `inspector_panel`, `ai_panel`, `search_panel`,
`settings_panel`, `diff_view`.  31 new tests across the wave.

### Phase 3 — Vault service (minimal)

First service crate.  Public API mirrors `mock_fixtures::MockVault` so chrome panels can swap implementations in Phase 5 with minimal call-site churn.

- `Vault: Global` rooted at a canonicalised path; opens via `Vault::open_at(root)`
- `Note { id: NoteId, title: SharedString, path: PathBuf, kind: NoteKind, modified: DateTime<Utc>, byte_size: u64 }`
- `NoteId(u64)` newtype: monotonically increasing within a single `Vault` instance, never reused after delete+rescan, not persisted (restart at 0 on reopen)
- `VaultError::{NotFound(NoteId), Io { path, source }}` via `thiserror`
- Methods: `notes() -> Task<Vec<NoteId>>`, `note(id) -> Task<Option<Note>>`, `note_content(id) -> Task<Result<String, VaultError>>`, `save(id, &str) -> Task<Result<(), VaultError>>`, `search_titles(query) -> Task<Vec<NoteId>>`, `rescan() -> Result<()>`
- Recursive markdown walker, depth cap 32, skips hidden directories (`.git/`, `.obsidian/`), markdown-only (assets + folders deferred to Phase 10.3)
- Synchronous IO inside `Task::ready(...)` for MVP; Phase 10.3 moves long ops to `cx.background_executor().spawn(...)` + adds the FS watcher
- 9 tests cover the core contract.

Review pass: 1 MUST + 4 SHOULD applied (metadata-refresh failure now `log::warn!` instead of silent swallow; `NoteId` docstring spells out monotonic-never-reused-not-persisted contract; `save_sync` test backdoor; `save` takes `&str`; `note_ids_vec()` dedups).

### Phase 4 — Editor host integration

Three deliverables wire the embedded editor into the native shell; Phase 5 glues IPC routing back into GPUI entities.

**`editor_bridge` crate (4a, `8c31dd32`)** — typed JSON envelope.  `ToHost` (native → editor): NoteOpen, FocusEditor, SaveRequest, ThemeSet.  `FromHost` (editor → native): Ready, Dirty, Save, Saved, LinkClick, Keydown.  `{ "k": "<kind>", "v": <payload> }` shape via `#[serde(tag, content, rename_all = "snake_case")]`.  Typed `Mods { alt, ctrl, meta, shift }` with `skip_serializing_if`.  `vault::NoteId` gains `#[derive(Serialize, Deserialize)] + #[serde(transparent)]`.  `BridgeError::{Encode,Decode}` carries the `serde_json::Error` source chain.  17 in-process tests including snake_case lock-in for every variant.

**`editor-host/` Vite project (4b)** — minimal markdown editor inside the WKWebView.  Single-file output via `vite-plugin-singlefile` so `dist/index.html` is fully self-contained (~3.95 kB) and `crates/note_item` embeds it via `include_str!()`.  `src/bridge.ts` mirrors the Rust enums as discriminated unions; `src/editor.ts` is a `<textarea>` MVP that emits Dirty/Save/Keydown and accepts NoteOpen/FocusEditor/SaveRequest/ThemeSet.  BlockNote + CodeMirror carry-over from `src/components/blockNote*.ts` / `src/extensions/*` / `src/components/useEditor*.ts` was deferred to post-MVP at Phase 4b time; it is now picked up by Phase 8 Strand C (rows 8.24–8.30) — see [`roadmap.md` Phase 8 Strand C](roadmap.md#strand-c--editor-host-body-parity-blocknote--codemirror-carry-over).

**`note_item` crate (4c)** — `workspace::Item` implementation owning a per-note WKWebView.  Pure-logic `apply_from_host(&mut self, FromHost) -> Outcome` dispatches Dirty/Save/Saved/LinkClick/Keydown; `Outcome::{None, PersistSave{body}, NavigateLink(LinkTarget)}` describes follow-up effects.  `LinkTarget::classify` discriminates wikilinks from URLs.  macOS `new_with_webview` returns `Result<Self>` (no panics on user-triggered paths).  `InstrumentedWebView` mirrors `embed_poc`'s 0.5px epsilon-guard pattern.  All macOS-specific code lives in `mod macos { … }`.  12 tests cover dispatch + classification + HTML embedding.

Review pass: 2 MUST + 5 SHOULD applied.

### Phase 5 — MVP wiring + launch

End-to-end integration.  Shipped in two commit waves: 5a/b/c (vault wiring) and 5d/e (open-note + IPC channel).

**5a — Type unification.**  `vault::NoteId` is canonical; `mock_fixtures` re-exports it.  All `NoteId(N)` construction sites swept across `mock_fixtures`, `inspector_panel`, `note_list_pane`, `search_panel`, `sidebar_panel`.

**5b — `tolaria --vault <path>` CLI flag.**  `parse_args()` walks argv; `Vault::open_at(path)` installs the real vault as a `Global` before observers register.  `TOLARIA_MOCK=1` path still works.

**5c — `SidebarPanel::from_vault` / `NoteListPane::from_vault`.**  Mirror existing `from_mock` constructors against real vault.  `from_or_empty` precedence: `vault::Vault` > `MockVault` > empty.

**5d — Open-note flow.**  `note_list_pane::OpenNoteEvent` + `EventEmitter<OpenNoteEvent>`; row click emits via `cx.emit`.  `workspace::TolariaWorkspace::add_item_to_active_pane` adds an `ItemHandle` to the center `PaneGroup`'s active `Pane`.  `tolaria::open_note::open_note(workspace, id, window, cx)` helper reads metadata + body from `vault::Vault`, builds `NoteItem::new_with_webview`, routes through `add_item_to_active_pane`.

**5e — IPC channel routing + save persistence.**  `note_item::spawn_webview` takes a `flume::Sender<FromHost>`; the wry IPC handler decodes each message and pushes it down the channel.  `NoteItem::install_dispatch_task(entity, rx, cx)` spawns a detached foreground task that drains the receiver, runs `apply_from_host`, and on `Outcome::PersistSave` calls `vault::Vault::save(id, &body).detach()`.

End-to-end test `dispatch_task_persists_save_to_vault` proves MVP save persistence works without a real WKWebView.

**UI mounting (5d-followup, `11ace568`).**  `NoteListPane` impls `workspace::panel::Panel`; the `tolaria` binary mounts it in the left dock via `TolariaWorkspace::attach_left_dock`; `cx.subscribe_in` routes every `OpenNoteEvent` to `open_note::open_note`.

### Phase 6 — Periscope e2e screenshot harness (`9509f092`)

`crates/periscope/` — macOS-only Rust harness that lets Claude observe a running `tolaria` window between conversational turns by capturing PNG screenshots through its multimodal `Read` tool.

**Capture-strategy decision.** GPUI's `Window::render_to_image()` reads the Metal drawable texture only — which contains GPUI chrome, NOT the embedded WKWebView editor body (a sibling NSView composited by the OS).  External compositor capture (via `xcap` → `CGWindowListCreateImage` / ScreenCaptureKit) is mandatory.

**Crate stack.**  `xcap = "0.9.4"` for window enumeration + capture; `accessibility = "0.2.0"` (eiz on crates.io) for `AXUIElement::raise()` and cross-process window discovery.

**Library API (`periscope::`).** `WindowTarget::{ByTitle, ByPid}` + constructors + `Display`; `screenshot(&WindowTarget, &Path) -> Result<PathBuf>`; `raise(&WindowTarget) -> Result<()>`; `list_windows() -> Result<Vec<WindowSummary>>`; `click(target, x, y)`.  Black-frame detection samples 32×32 pixels; remediation string includes `$TERM_PROGRAM`.

**CLI binary.** `screenshot`, `watch` (atomic `latest.png` symlink), `click`, `list`.  `--raise` brings the window forward via the Accessibility API and sleeps `RAISE_SETTLE` (250 ms).

**Smoke test.**  Builds tolaria, execs directly, polls for window appearance, asserts PNG > 100 kB, RAII-cleanup via `ChildGuard`.  Opt in with `TOLARIA_E2E_SMOKE=1`.

**macOS permissions.**  Two separate System Settings panels — both must be granted to the parent terminal: **Screen Recording** for capture, **Accessibility** for raise + window enumeration.

Review pass: 1 MUST + 7 SHOULD applied.

#### Phase 6 follow-up — `gpui_platform/font-kit` invisible-text bug

First manual verification capture showed Tolaria chrome painting row dividers but **zero rendered glyphs**.  Root cause: workspace pinned `gpui_platform` with `features = ["runtime_shaders"]` only; without `font-kit`, `gpui_macos::MacPlatform::new` substitutes `gpui::NoopTextSystem`.  Fix: `gpui_platform = { features = ["runtime_shaders", "font-kit"] }`.

Regression locked in by:

- `tolaria::tests::platform_text_system_enumerates_system_fonts` — asserts `Platform::text_system().all_font_names().len() > 50`.
- `periscope::screenshot_smoke` threshold bumped from 10 kB → 100 kB.

#### Phase 6 follow-up — `periscope::click` + smoke test selects a note

`crates/periscope/src/input.rs` posts `CGEventCreateMouseEvent` at a window-local coordinate, translated to screen space via `xcap::Window::x()` / `.y()`.  Exposed as `periscope::click(target, x, y)` from the library and `periscope click --title Tolaria --raise --x 200 --y 100` from the CLI.

The smoke test captures before-click, clicks at `(200, 100)` (first `NoteListPane` row), settles, captures after-click, asserts the two PNGs differ.

First attempt triggered a Phase 5d re-entrancy panic — `open_note::open_note` called `workspace.update` from inside a `cx.subscribe_in` callback that was already under the workspace's update lock.  Fixed by changing `open_note` to take `&TolariaWorkspace` + `&mut Context<TolariaWorkspace>` directly.

### Phase 7.1 — 4-column workspace + sidebar mount + status bar + CSS-derived theme (`6454140c`)

Workspace gains a fixed `note_list_column` between left dock and center group so `sidebar_panel` (vault tree) and `note_list_pane` are side-by-side, matching the reference.  Dock no longer clamps its own width (resizable panel parent owns it).  `min_h_0 + overflow_hidden` on the row prevents tall sidebars from pushing the status bar off-screen.  `status_bar` rewritten to a 2-cluster layout.  `theme::palette::{apply_light, apply_dark}` overwrites `gpui_component::ThemeColor` with values derived from `src/index.css`.

### Phase 7.2 — Clickable theme toggle + reference window dimensions (`721a2fb4`)

`theme::cycle(cx)` flips Light ↔ Dark via `ActiveTheme::is_dark`.  Status-bar "Theme" cell becomes a stateful interactive `div` with `id`, `cursor_pointer`, and an `on_click` handler.  Label reflects the *target* mode ("Dark" in light, "Light" in dark).  `WindowSettings::default()` bumped from 1200×800 → 1516×1052 (logical-point size of the reference screenshots).

### Phase 7.3 — `tolaria --width` / `--height` CLI overrides + periscope smoke pins reference size (`dac9441c`)

Independent CLI overrides for the persisted `WindowSettings`; non-positive or non-finite values exit 2 with a remediation message.  `periscope::screenshot_smoke` passes `--width 1516 --height 1052` so harness screenshots pin to reference geometry regardless of what's persisted on the host.

### Phase 7.4 — GPUI inspector + SIGUSR1 tree dump + periscope click-by-id (`5cd51756`)

Three coordinated additions so periscope can drive Tolaria's chrome by *name* instead of hand-picked pixel coordinates:

1. **`Cmd+Alt+I` → GPUI inspector.**  `actions::ToggleInspector` wired to `Window::toggle_inspector` on the active window.  Always on in debug builds.
2. **`ui::tree_dump` SIGUSR1 IPC.**  Debug builds spawn a `signal-hook` thread that writes `$TMPDIR/tolaria-ui-tree-<pid>.json` (atomic via tmp + rename) on each SIGUSR1.  Wire format embeds a monotonic `sequence` counter for race-free freshness detection.  `set_window_y_offset(NATIVE_TITLE_BAR_HEIGHT_PT)` keeps recorded `y` in frame-relative coordinates that match periscope's click contract.
3. **Periscope `click-id` + `dump-tree`.**  Resolve target → PID, send SIGUSR1, wait for sequence to strictly increase, then click the named element's centre or print the full registered set.

Design decisions after `idiomatic-rust-review`:

- Registry, y-offset, and sequence live in a single `Mutex<RegistryState>` — no separate atomic, so `register` always sees a coherent `(offset, map_slot)` pair.
- `register` is `pub(crate)`; external callers go through the `DumpAs` element wrapper.
- Mutex-poison recovery on both write and read paths.
- Periscope re-declares `NamedBounds` + `DumpFile` instead of taking a `ui` dep (keeps `gpui`/`gpui-component` out of the harness).
- `workspace::NATIVE_TITLE_BAR_HEIGHT_PT = 28.0` is a single `pub const` referenced by both the spacer `div` and the y-offset wiring.

5 new tests in `ui::tree_dump` + `periscope::tree_dump`.

### Phase 7.5–7.9 — Visual-fidelity sweep (`897091bf`)

Five tightly-coupled visual-parity tasks landed as one commit so the
periscope diff against `tolaria-demo-vault-v2-{light,dark}.png` could
be validated end-to-end:

1. **Dark-mode panel backgrounds (7.5).**  `NoteListPane`, `PaneGroup`
   and `Pane::render` now paint `theme.background` explicitly so dark
   mode tracks the rest of the chrome instead of bleeding the
   window's default white through wherever children left gaps.

2. **Sidebar typed glyphs (7.6).**  `sidebar_panel` rewrites its
   TYPES cluster: `type_label_for` derives the display name from the
   filename prefix (`area-` → Areas, `event-` → Events, etc.);
   `type_color` returns a fixed accent from the Tauri-era palette
   (violet / teal / blue / red / green / amber / pink); each row
   gains an 8-pt coloured leading dot.  Folder rows switch from
   `rsplit('/').next().unwrap_or_else(...)` to the `Path::file_name`
   path-aware leaf — the prior fallback silently kept the trailing
   separator on edge cases.

3. **Note-list metadata + active row (7.7).**  `NoteListPane` adds a
   `MMM D · Created MMM D` muted-text metadata line below each row's
   snippet, an `selected_id: Option<NoteId>` field rendering the
   active row with `theme.list_active` (pale-accent), and `open` /
   new `set_active` helpers so the highlight tracks the editor's
   mounted note immediately without waiting for the workspace round
   trip.  `visible_entries` returns `impl Iterator<Item = &NoteEntry>`
   instead of `Vec<&NoteEntry>` (S-2 of the idiomatic review).

4. **Custom title-bar strip (7.8).**  New `workspace::title_bar` view
   replaces the bare 28-pt spacer above the workspace main row.
   `TRAFFIC_LIGHTS_PADDING_PT = 72.0` reserves space for the macOS
   controls; the strip then draws the back / forward / new-note
   triplet (left cluster) and the search / star / lock / language /
   more / profile cluster (right).  Each cell is `id()`-tagged and
   `dump_as`-registered so periscope can target it by name.
   `TitlebarOptions { appears_transparent: true, .. }` lets GPUI
   draw under the macOS chrome.

5. **WKWebView dark-mode editor body (7.9).**  `editor-host/style.css`
   gains `--fg-muted`, `caret-color`, an italic placeholder, and a
   `color-mix(...)` selection so the embedded editor body reads
   cleanly in both themes.  `NoteItem::set_theme(mode, cx)` injects
   `document.documentElement.dataset.theme = "..."` via
   `wry::WebView::evaluate_script` — no `tolariaBridge` Ready
   dependency, so the theme applies the instant the document is
   parsed.  `tolaria/main.rs` registers an
   `observe_global::<gpui_component::theme::Theme>` callback that
   broadcasts each theme change to the active `NoteItem`, and
   `open_note.rs` propagates the initial mode immediately after the
   `WebView` is constructed.

Design decisions after `idiomatic-rust-review` (0 MUST, 5 SHOULD —
all applied):

- `Path::file_name` for folder-leaf extraction (S-1).
- `visible_entries` lazy iterator (S-2).
- `is_none_or` reverted to `map_or(true, …)` to respect the workspace
  MSRV of 1.77.2 (S-3 attempted but rejected by `clippy::incompatible_msrv`).
- Dropped dead `_ix: usize` parameters from `sidebar_row` and
  `sidebar_folder_row`, eliminating the
  `#[allow(clippy::too_many_arguments)]` (S-4).
- `set_theme` builds the JS literal inline instead of routing the
  known-safe `light` / `dark` token through `serde_json::to_string`
  (S-5) — also makes the no-injection invariant inspection-evident.

3 new tests in `note_list_pane` (`open_sets_active_id`,
`set_active_updates_without_emitting`, `metadata_line_format`) and
2 in `sidebar_panel` (`type_label_extracts_known_prefixes`,
`build_from_samples_groups_by_filename_prefix`) — total 219 → 222.

Periscope captures (`/tmp/phase7-light.png`,
`/tmp/phase7-final-dark.png`) confirm row-by-row parity against the
reference in both modes.

### Phase 7 follow-up — visual-issue QA wave

After the `897091bf` baseline, an interactive QA loop catalogued
each remaining visual delta in
[`visual-issues.md`](visual-issues.md); each entry was fixed in
its own commit using the `fix(<crate>): visual-issue #NNN — <one-liner>`
style.  See [`live-snapshots/`](live-snapshots/) for the before /
after captures referenced by individual entries.

| Issue(s) | Commit | Crate(s) | Summary |
|----------|--------|----------|---------|
| #001 #002 | `6b92a6ba` | `sidebar_panel` | Selection palette + folder indent |
| #003 #004 | `218fab16` | `sidebar_panel` | Type frontmatter + hover bg |
| #005 | `f7555520` | `workspace` | Title-bar height for symmetric padding |
| #006 | `0b3be620` | `sidebar_panel` | VIEWS / TYPES collapse carets |
| #007 | `4f6c6e07` | `tolaria` | Vertically centre traffic lights |
| #008 | `9cb25da7` | `workspace` | Align title cluster with traffic lights |
| #009 | `238121da` | `workspace` | Centre title-bar action cluster |
| #010 #011 #012 | `b8b8282a` | `note_list_pane` | Per-type accents, tighter row, native word-wrap |
| #013 | `29d8e5f4` | `note_list_pane` | Symmetric row padding |
| #014 #015 | `dad72e19` | `theme`, `note_list_pane` | Transparent scrollbar track + sidebar-style hover |
| #016 | `c1c1aaba` | `workspace` | Zed-matching native title bar dims |
| #017 | `b9fd4e91` | `status_bar` | Icons + left-aligned services + separators |
| #018 | `207da697` + `5b3e475d` | `embed_poc`, `workspace`, `note_item` | WKWebView resize artifact — remove obscuring opaque paint; port four Tauri-mirrored fixes to production |
| #019 | `951d5ea2` (+ `54748e81`, `382b6577`) | `note_item`, `workspace` | Top per-note toolbar row mirroring React's `BreadcrumbBar`; removed redundant note-list right border (double-line with resize handle); sync glyph switched to `IconName::Redo` |
| #020 | `09ecd907` (+ `94e94a32`, `eff7521d`, `66301216`, `c056bfef`, `bbf31abf`, `3c70b6b9`) | `workspace`, `theme` | Sidebar show/hide button; column collapses on toggle; sized siblings keep widths via `.flex_none()` + `.visible(false)` stable slots; resize-handle colour matches sidebar right border in every state |
| #021 | `738c8762` | `workspace`, `sidebar_panel`, `note_list_pane`, `status_bar` | Consistent `.dump_as(...)` element-ID hierarchy from `workspace` root through every chrome container; see [`tree-dump-ids.md`](tree-dump-ids.md) |

**Issue #018 — WKWebView resize artifact.**  WebKit's remote-layer
IPC lags AppKit geometry during resize; GPUI's Metal surface
painted opaque `theme.background` quads from
`crates/workspace/src/pane_group.rs:75` and
`crates/workspace/src/pane.rs:128` over the WebView region while
the layer caught up, producing a trailing strip.

Two design docs landed alongside the fix:

- [`docs/plans/wkwebview-seamless-resize.md`](../wkwebview-seamless-resize.md) —
  research on Tauri's seamless resize (autoresize mask,
  `drawsBackground=NO`, `setUnderPageBackgroundColor`, matched
  `NSWindow` background colour).  First implementation in
  `embed_poc` (`207da697`).
- [`docs/plans/wkwebview-seamless-resize-followup.md`](../wkwebview-seamless-resize-followup.md) —
  post-mortem after `207da697` failed to remove the artifact in
  the production runtime.  Identified the production tree's
  `pane_group` + `pane` ancestor paints, not the WebView itself,
  as the obscuring layer.  Listed Path A (transparent GPUI window
  + per-leaf `.bg`) as the next probe if Path B failed.

Final fix `5b3e475d`:

- Removed `.bg(theme.background)` from the active-pane branch in
  `pane_group.rs:75` and the active-item branch in `pane.rs:128`;
  empty-state fallbacks keep their paint.
- Ported all four WebView-side fixes from `embed_poc` to the
  production `note_item` path (`autoresizingMask`,
  `drawsBackground=false`, matching `NSWindow` background,
  `setUnderPageBackgroundColor`).
- `objc2` / `objc2-app-kit` / `objc2-foundation` added to
  `crates/note_item/Cargo.toml` macOS deps; `unsafe_code` policy
  remains `deny` crate-wide with `#[allow(unsafe_code)]` scoped
  to `mod macos` only; every `unsafe { … }` carries a `// SAFETY:`
  comment per the idiomatic-rust-review skill.
- Two `gpui::test` regression guards added to `workspace` so the
  ancestor paints can't silently return.

Runtime verified — live window resize and splitter drag no longer
expose the trailing `theme.background` strip.

---

### Phase 8 — Behavioral fidelity pass

All 30 rows landed across three parallel strands (Strand A — stub
completion; Strand B — missing surfaces; Strand C — editor-host body
parity).  Per-row entries below.  Visual-issue follow-ups live in
[`phase-8-issues.md`](phase-8-issues.md).

#### Bundle-size record (Phase 8 close-out)

The `editor-host/` single-file bundle is `include_str!()`-embedded by
`crates/note_item`; every byte ships in the macOS app and is parsed
on every fresh `WKWebView` instance.  Strand C lifts BlockNote +
React 19 + ProseMirror + emoji-mart + CodeMirror 6 + yaml/json/css
language packs into the bundle.

| Milestone | Bundle (uncompressed) | Notes |
|-----------|-----------------------|-------|
| Phase 4b baseline | **~3.95 kB** | `<textarea>` MVP, `src/bridge.ts` + `src/editor.ts` only |
| Phase 8.24 (BlockNote mount) | **1.79 MiB** | First real editor mount — past the ~20 kB heuristic from the [Strand C verification gate](roadmap.md#strand-c--editor-host-body-parity-blocknote--codemirror-carry-over); record per the roadmap rule |
| Phase 8.25 | **~1.86 MiB** | Slash / side / formatting menus (+~70 KiB) |
| Phase 8.26 | ~1.86 MiB | Wikilink suggestion + link activation (no measurable delta) |
| Phase 8.27 | ~1.87 MiB | IME composition + render-recovery + transform-error guard (+6,979 B) |
| Phase 8.28 | ~1.87 MiB | Byte-identical: regressions ship via pnpm `patchedDependencies` mirroring React-side BlockNote patches; no new runtime code |
| Phase 8.29 | **2.17 MiB** | CodeMirror raw-mode fallback (+373 KiB: markdown/frontmatter highlight, zoom cursor fix, find bar, raw editor utils) |
| Phase 8.30 | **2.26 MiB** | Editor lifecycle hooks (+88 KiB: mode/tab-swap/focus/save/memory-probe) |
| **Phase 8 close** | **2.26 MiB** (gzip ~675 kB) | **~580× growth** over Phase 4b baseline |

**Driver:** BlockNote core + React 19 + ProseMirror + emoji-mart +
CodeMirror 6 + yaml/json/css language packs.  Every Strand C row
records its bundle delta in the per-row entry below; future
editor-host work must keep recording the delta so startup-cost
regressions stay visible.

#### Strand A — stub completion (this-session rows)

Earlier-session Strand A rows (8.1–8.10, 8.12, 8.13 modal subset,
8.14 scaffold, 8.23) are listed in the status table.  This-session
ledger:

- **8.11.1 — `vault` frontmatter parser (`07c7ec7f`).**
  New `crates/vault/src/frontmatter.rs` (376 LOC) parses YAML-style
  fence (`---\n…\n---`) on `Note` load; survives malformed input
  without panic.  +13 tests on the parser contract (block detection,
  empty body, mixed line endings, BOM, escaped sequences, unicode,
  duplicate keys, trailing whitespace, missing close fence).
- **8.11.2 — `vault` folders + assets surfacing (`dbf8c00f`).**
  `Vault` now exposes `folders() -> Vec<FolderEntry>` and
  `assets() -> Vec<AssetEntry>` so `folder_tree` (8.17) and future
  attachment surfaces stop guessing at the on-disk shape.
  `mock_fixtures::MockVault` keeps the same shape.  +3 tests
  (folder enumeration, asset filter by extension, hidden-dir skip).
- **8.11.3 — `vault` background executor (`c65ac9de`).**
  Long-running reads / saves now route through
  `cx.background_executor().spawn(...)` instead of synchronous IO
  inside `Task::ready(...)`.  Public API unchanged — callers still
  see `Task<...>`.  +3 tests (concurrent read does not block save;
  save error propagates; cancellation drops the spawned future).
- **8.11.4 — `vault` notify-based fs-watcher with debounce (`aad8dbbb`).**
  New `crates/vault/src/watcher.rs` (241 LOC) using `notify` crate +
  `flume` channel + 200 ms debounce window collapses bursty editor
  saves into a single rescan.  Watcher runs on the background
  executor.  `mock_fixtures::MockVault` gains a no-op `watcher()` so
  TOLARIA_MOCK still boots.  +3 tests (single-file write triggers
  one event; rapid bursts collapse; rename triggers both old+new
  paths).
- **8.13 — `workspace` pane resize observer + tab close/reorder
  (`6470e304`).**  `crates/workspace/src/pane.rs` grows from a stub
  PaneGroup to a real resize observer (+422 LOC).  Tab close emits
  `Pane::TabClosed { id }`; drag-reorder emits `Pane::TabReordered
  { from, to }`.  Modal subset previously landed at `95b1ee4b`.
  +9 tests (pane resize event fires once per drag; tab close
  removes item + restores activation to neighbour; reorder preserves
  selection; close-last-tab keeps pane alive).  Workspace test
  count 27 → 36.

#### Strand B — missing surfaces (this-session rows)

Earlier-session Strand B rows (8.17 `folder_tree`, 8.18
`filter_builder`, 8.20 `note_retargeting`, 8.22 `onboarding_prompts`
scaffold) are listed in the status table.  This-session ledger:

- **8.15 — `frontmatter_panel` (`ef520117`).**  New crate (738 LOC)
  mirroring `DynamicPropertiesPanel.tsx` + `AddPropertyForm.tsx` +
  `EditableValue.tsx` + `PropertyValueCells.tsx` +
  `TypeSelector.tsx` + `TypeCustomizePopover.tsx` +
  `IconEditableValue.tsx` + `ColorInput.tsx` +
  `AccentColorPicker.tsx` + `NoteIcon.tsx` + `NoteTitleIcon.tsx`.
  `from_or_empty(cx)` + `from_mock(cx)` constructors preserved.
  +10 tests (property add/remove, type swap, icon edit, accent swap,
  empty-state, malformed value tolerated, ordering).
- **8.16 — `raw_editor` (`65d6ec71`).**  New crate (919 LOC) mirroring
  the GPUI-side chrome for `RawEditorView.tsx` + `RawEditorFindBar.tsx`
  — note that the CodeMirror surface itself lives in the embedded
  WKWebView (Phase 8.29 owns the editor-host pipeline; this crate
  owns the GPUI chrome around it).  +11 tests (find-bar visibility
  toggle, search-term echo, regex-mode flag, case-sensitive flag,
  result-count chip, empty-query state, prev/next handlers,
  shortcut dispatch).
- **8.19 — `workspace_switcher` (`af7d3e14`).**  New crate (534 LOC)
  mirroring `WorkspaceSelector.tsx` + `WorkspaceMoveButtons.tsx` +
  `WorkspaceInitialsBadge.tsx` + `status-bar/VaultMenu.tsx` +
  `WorkspaceSettingsRows.tsx`.  Vault list driven by mock fixtures
  for now; real multi-vault state lands in Phase 10
  `vault_registry`.  +8 tests (vault row click emits switch event,
  initials badge derivation, move-up / move-down preserve focus,
  empty list, single-vault hides reorder controls).
- **8.21 — `rendering_primitives` (`cfdfc5e4`).**  New crate (518 LOC)
  mirroring `MarkdownContent.tsx` + `SafeMarkup.tsx` +
  `MermaidDiagram.tsx` + `TldrawWhiteboard.tsx` + `FilePreview.tsx`.
  Non-editor rendering surfaces (preview tiles, embedded mermaid,
  attachment thumbnails).  +7 tests (markdown render, safe-markup
  drops `<script>`, mermaid placeholder, tldraw placeholder,
  file-preview dispatch by mime, empty-state, oversize bail-out).

#### Strand C — editor-host body parity

The BlockNote + CodeMirror carry-over from
`src/components/blockNote*.ts` / `src/extensions/*` /
`src/components/useEditor*.ts` lands in `editor-host/` over seven
commits.  All ship Vitest coverage inside `editor-host/`.  No new
bridge-envelope variants this phase — the `editor_bridge` snake_case
wire shape stays locked in by the Phase 4 `editor_bridge` tests.
Two bridge gaps stubbed locally and logged in
[`phase-8-issues.md`](phase-8-issues.md#bridge-gaps).

- **8.24 — BlockNote core mount (`4c7998e7`).**  Replaces the
  Phase-4b `<textarea>` with a real BlockNote editor bound to the
  `editor_bridge` envelope.  `NoteOpen` → `editor.replaceBlocks(...)`;
  content change → `Dirty`; `SaveRequest` → markdown serialization
  → `Save`.  New: `EditorApp.tsx`, `setupEditor.ts`,
  `richEditorMarkdown.ts`, `main.tsx` (React 19 mount), Vite config
  bumped to a multi-entry build, vitest configured.

  - **Bundle:** 4.18 kB → **1.79 MiB** (first BlockNote mount).
    Past the ~20 kB roadmap heuristic — recorded per [Strand C
    verification gate](roadmap.md#strand-c--editor-host-body-parity-blocknote--codemirror-carry-over).
  - **Tests:** 0 → 16 vitest (bridge encode/decode, markdown
    serialise round-trip, editor mount, NoteOpen replace, Dirty
    emission, SaveRequest flush).
  - **React tests not ported verbatim:** none for this row — the
    React-side scaffolding is structural and was rewritten against
    the new mount.
  - **Bridge-envelope churn:** zero new variants.

- **8.25 — Slash / side / formatting menus + hover guards
  (`fa1aae40`).**  Ports the suggestion / side / formatting menus
  plus the hover-guard fixes from
  `blockNoteSideMenuHoverGuard.{ts,test.ts}` +
  `blockNoteFormattingToolbarHoverGuard.{ts,test.ts,extra.test.ts}` +
  `tolariaBlockNoteSideMenu.test.tsx` +
  `blockNoteSideMenu.regression.test.ts`.

  - **Bundle:** ~1.79 MiB → ~1.86 MiB (+~70 KiB).
  - **Tests:** 16 → 49 vitest.
  - **React tests not ported verbatim:** none — every hover-guard
    test ported verbatim (the guards are pure DOM logic, no vault
    coupling).
  - **Bridge-envelope churn:** zero new variants.

- **8.26 — Wikilink suggestion + link-click + cursor target
  (`0d871de4`).**  Ports `blockNoteCursorTarget.ts` plus a thin
  wikilink suggestion provider seam and link-activation routing.
  Click on a `[[wikilink]]` routes through
  `editor_bridge::FromHost::LinkClick` (already wired in Phase 8.3).

  - **Bundle:** ~1.86 MiB (no measurable delta).
  - **Tests:** 49 → 65 vitest (cursor-target restoration, link
    activation, wikilink suggestion provider, link-click dispatch).
  - **React tests not ported verbatim:**
    - `blockNoteSuggestionMenu.regression.test.ts` +
      `blockNoteSuggestionWrapper.regression.test.tsx` — both lock
      in patches to BlockNote's internal `SuggestionMenu` plugin;
      editor-host runs unmodified `@blocknote/react@0.46.2`, so the
      patches do not apply.  Carry-over deferred — re-evaluate if
      the host ever needs to patch BlockNote.
    - `suggestionEnrichment.test.ts` — depends on `VaultEntry`,
      `getTypeColor`, and other vault-side coupling.  Replaced by a
      host-side `wikilinkSuggestion.test.ts` that pins the provider
      contract instead of the React enrichment shape.
    - `useEditorLinkActivation.test.tsx::it("opens relative
      attachment links through the active vault path")` — **dropped.**
      Editor host no longer resolves attachments locally; vault path
      resolution moves to the native side (Phase 10).
  - **Bridge-envelope churn:** zero new variants.  **Bridge gap
    stubbed:** wikilink suggestion needs
    `FromHost::WikilinkQuery { prefix }` /
    `ToHost::WikilinkSuggestions { items }` to populate the menu
    with real vault titles.  Stub: `wikilinkSuggestion.ts ::
    defaultWikilinkItemsProvider` returns `[]`.  Logged in
    [`phase-8-issues.md`](phase-8-issues.md#bridge-gaps); target
    row Phase 10 (`vault_search`) or focused Phase 9 follow-up.

- **8.27 — IME composition + render-recovery + transform-error
  guard (`7afa7072`).**  Ports `useEditorComposing.ts` +
  `imeCompositionKeyGuardExtension.ts` + `blockNoteRenderRecovery.ts`
  + `richEditorTransformErrorRecoveryExtension.ts` + new
  `editorBlockRepair.ts` + `telemetry.ts`.  macOS IME mid-composition
  handling (Phase 0 §6 trigger #2) + ProseMirror state-corruption
  recovery + transform-error guard.

  - **Bundle:** ~1.86 MiB → ~1.87 MiB (+6,979 B).
  - **Tests:** 65 → 88 vitest.
  - **React tests not ported verbatim:**
    - `richEditorTransformErrorRecoveryExtension.test.ts` — mock
      dispatch signature adjusted to `(_transaction?: unknown)`
      parameter due to the editor-host's strict tsconfig.  Behavior
      identical; signature change is mechanical only.
  - **Bridge-envelope churn:** zero new variants.

- **8.28 — Code-block / table / copy / checklist regressions
  (`48cddd2b`).**  Ports the four BlockNote behavior regressions
  (`blockNoteCodeBlockControl.regression.test.ts`,
  `blockNoteTableHandles.regression.test.ts`,
  `blockNoteCopyCompatibility.regression.test.ts`,
  `blockNoteChecklist.regression.test.ts`,
  `blockNotePopover.regression.test.ts`).

  - **Bundle:** byte-identical to 8.27.  Regressions ship via pnpm
    `patchedDependencies` mirroring the React-side BlockNote
    patches (`patches/@blocknote__core@0.46.2.patch` +
    `patches/@blocknote__react@0.46.2.patch`); no new runtime code
    in `editor-host/src/`.
  - **Tests:** 88 → 109 vitest.
  - **React tests not ported verbatim:** none — all 5 regression
    test files ported verbatim, since pnpm `patchedDependencies`
    makes the runtime equivalent.
  - **Bridge-envelope churn:** zero new variants.

- **8.29 — CodeMirror raw-mode fallback (`63c79224`).**  Ports
  `markdownHighlight.{ts,test.ts}` +
  `frontmatterHighlight.{ts,test.ts}` +
  `zoomCursorFix.{ts,behavior.test.ts,extra.test.ts}` +
  `rawEditorUtils.{ts,test.ts}` + `RawEditorView.{tsx,test.tsx}` +
  `RawEditorFindBar.{tsx,test.tsx}` + new `useCodeMirror.ts` +
  `editorFind.{ts,test.ts}` + `EditorApp.routing.test.tsx`.
  Coordinates with Strand B 8.16 — 8.29 owns the editor-host /
  WKWebView pipeline, 8.16 owns the GPUI-side chrome around it.

  - **Bundle:** ~1.87 MiB → **2.17 MiB** (+373 KiB: CodeMirror 6 +
    `@lezer/markdown` + frontmatter highlighter + zoom-cursor fix).
  - **Tests:** 109 → 209 vitest (largest single jump in the strand).
  - **React tests not ported verbatim:**
    - `RawEditorView.behavior.test.tsx` +
      `RawEditorView.coverage.test.tsx` — React mocks
      `useCodeMirror`, `rawEditorUtils`, `typeColors`, `telemetry`,
      `NoteSearchList`, `plainTextPaste` — all vault-side
      concerns.  Host-side tests re-shaped to run against the real
      CodeMirror plus the real `useCodeMirror` hook (no mocks).
    - `RawEditorFindBar.test.tsx` — React uses shadcn `Input` +
      `react-i18next` + `safe-regex2`.  Host uses native HTML
      `<input>` + literal English copy + direct `new RegExp(...)`.
      Same `data-testid` + `aria-label` selectors so the test
      assertions stayed near-identical.
    - The Cmd+F keymap-driven find-bar test was dropped:
      happy-dom can't drive a CodeMirror keymap from a synthetic
      `KeyboardEvent`.  Replaced by a test that exercises the
      `findRequest` prop path directly — same behavior pinned via
      a different seam.
  - **Bridge-envelope churn:** zero new variants.

- **8.30 — Editor lifecycle hooks (`1e1f77ac`).**  Ports the
  mode / tab-swap / focus / save / memory hooks:
  `useEditorModePositionSync.{ts,test.tsx}` +
  `useEditorTabSwap.{ts,test.ts,selection.test.ts,rename.test.ts,performance.test.ts}` +
  `useEditorFocus.{ts,test.ts}` + `useEditorSave.{ts,test.ts}` +
  `useEditorSaveWithLinks.{ts,test.ts}` +
  `useEditorMemoryProbeController.{ts,test.ts}` +
  `editorFocusUtils.ts` + `editorModePosition.ts`.

  - **Bundle:** 2.17 MiB → **2.26 MiB** (+88 KiB).  Phase 8 close.
  - **Tests:** 209 → 271 vitest.
  - **React tests not ported verbatim — synthesized instead:**
    - `useEditorTabSwap.{test,selection.test,rename.test,performance.test}.ts`
      — React versions depend on `VaultEntry`, `useSaveNote`,
      BlockNote markdown parsing, and frontmatter helpers.
      Synthesized tests pin the id-keyed snapshot LRU contract
      (insert / hit / evict / cap, selection round-trip,
      rename-keyed reseat, performance budget) without the React
      coupling.
    - `useEditorSave.test.ts` — React depends on
      `invoke('save_note_content')`, `setTabs`, and toast i18n.
      Synthesized tests cover debounce, dedup, immediate flush,
      error path, cleanup-on-unmount.
    - `useEditorSaveWithLinks.test.ts` — React depends on
      `extractOutgoingLinks` + vault `updateEntry`.  Synthesized
      tests pin the future rename-bridge seam (`onLinksChanged`
      fires when outgoing-link set diverges; doesn't propagate
      yet).
    - `useEditorMemoryProbeController.test.ts` — React reference
      orchestrates an N-note mount experiment.  Synthesized tests
      cover passive sampling + OOM-threshold telemetry +
      Safari/Firefox no-op.
  - **Bridge-envelope churn:** zero new variants.  **Bridge gap
    stubbed:** rename-ripple needs
    `FromHost::RenameRequest { id, new_title }` /
    `ToHost::RenameReady { id }` to propagate renames through
    outgoing wikilinks.  Stub: `TODO(rename-bridge)` marker in
    `editor-host/src/useEditorSaveWithLinks.ts` —
    `useEditorSaveWithLinks` ships as a thin `useEditorSave`
    wrapper whose `onLinksChanged` seam fires but doesn't
    propagate.  Logged in
    [`phase-8-issues.md`](phase-8-issues.md#bridge-gaps); target
    row Phase 10.1 (`git_provider` rename pipeline) or Phase 9.6
    (`vault_lifecycle`).

---

## Durable feedback memories applied throughout

- **cargo fmt after every Rust edit** — `~/.claude/projects/-Users-konstantin-tolaria/memory/feedback_rust_cargo_fmt.md`
- **idiomatic-rust-review subagent before commit** — `feedback_rust_reviewer.md` (auto-apply every MUST and SHOULD)
- **No prompt for grep bash commands** — `feedback_grep_no_prompt.md`
- **After periscope visual investigation, add a `gpui::test`** — `feedback_periscope_followup_test.md`
- **No `Co-Authored-By: Claude …` trailer** — `feedback_no_claude_coauthor.md`
- **check for process instrictions** - `process.md`
