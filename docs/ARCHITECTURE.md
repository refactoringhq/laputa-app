# Architecture

Tolaria is a personal knowledge and life management desktop app. It reads a vault of markdown files with YAML frontmatter and presents them in a four-panel UI inspired by Bear Notes.

## Design Principles

### Filesystem as the single source of truth

The vault is a folder of plain markdown files. The app never owns the data — it only reads and writes files. The cache, React state, and any in-memory representation are always derived from the filesystem and must be reconstructible by deleting them. When in doubt, the file on disk wins.

### Convention over configuration

Tolaria is opinionated. Standard field names (`type:`, `status:`, `url:`, `Workspace:`, `belongs_to:`, `related_to:`, `has:`, `start_date:`, `end_date:`) have well-defined meanings and trigger specific UI behavior — without any setup. Relationship defaults are stored in snake_case on disk and humanized in the UI. This is not convention *instead of* configuration: users can override defaults via config files in their vault (e.g. `config/relations.md`, `config/semantic-properties.md`). But the defaults work out of the box, and most users never need to touch them.

This principle directly serves AI-readability: the more structure comes from shared conventions rather than per-user custom configurations, the easier it is for an AI agent to understand and navigate the vault correctly — without needing bespoke instructions for every setup.

### Where to store state: vault vs. app settings

When deciding where to persist a piece of data, ask: **"Would the user want this to follow them across all their Tolaria installations — other devices, future platforms (tablet, web)?"**

| Follows the vault | Stays with the installation |
|-------------------|-----------------------------|
| Type icon, type color | Editor zoom level |
| Pinned properties per type | API keys (OpenAI, Google) |
| Sidebar label overrides | Auto-sync interval |
| Property display order | Window size / position |
| Per-note `_width` rich-editor width override | Default rich-editor note width |
| Vault-authored `.gitignore` patterns | Whether this installation hides Gitignored files |
| Per-vault All Notes note-list column overrides | All Notes PDF/image/unsupported file visibility |
| Any user-visible customization of how content is organized or displayed | Any machine-specific or credential-type setting |

**Rule:** If the information is about *how the content is structured or presented* and the user would expect it to be consistent wherever they open their vault, store it in the vault (frontmatter of the relevant note, using the `_field` underscore convention for system properties). If it's about *this specific installation of the app*, store it in `~/.config/com.tolaria.app/settings.json` or localStorage.

Examples:
- ✅ Vault: `_pinned_properties` in a Type note (every device should show the same pinned properties)
- ✅ Vault: `_icon: shapes` in a Type note (icon is part of the type's identity)
- ✅ Vault: `_width: wide` in a note that already has frontmatter (per-note reading/editing preference)
- ✅ App settings: `zoom: 1.3` (machine-specific preference)
- ✅ App settings: `ui_language: "zh-CN"` (installation-specific UI language)
- ✅ App settings: `note_width_mode: "wide"` (installation-specific default for notes without an override)
- ✅ App settings: `all_notes_show_images: true` (installation-specific All Notes file-category visibility)

### No hardcoded exceptions

No field names, folder paths, or vault-specific values should be hardcoded in the application source code. What can be a convention should be a convention. What needs to be configurable should live in a file. Relationship fields are detected dynamically by checking whether values contain `[[wikilinks]]` — no hardcoded field name lists.

### AI-first knowledge graph

Notes are not just documents — they are nodes in a structured graph of people, projects, events, responsibilities, and ideas. Every design decision should ask: "Does this make the knowledge graph easier for a human *and* an AI to navigate?" Conventions that are legible to both are better than conventions that are legible only to one.

### Three representations, one authority

Vault data exists in three forms simultaneously:
1. **Filesystem** — the `.md` files on disk. This is the single source of truth.
2. **Cache** — `~/.laputa/cache/<hash>.json`, an index for fast startup. Always reconstructible from the filesystem.
3. **React state** — the in-memory `VaultEntry[]` during a session. Always derived from the cache or filesystem.

These must never diverge permanently. If they do, the filesystem wins and the cache/state are rebuilt.

```mermaid
flowchart LR
    FS["🗂️ Filesystem\n.md files on disk\n(source of truth)"]
    Cache["⚡ Cache\n~/.laputa/cache/\n(fast startup index)"]
    RS["⚛️ React State\nVaultEntry[]\n(in-memory session)"]

    FS -->|"scan_vault_cached()"| Cache
    Cache -->|"useVaultLoader on load"| RS
    FS -->|"reload_vault (full rescan)"| RS
    RS -.->|"write via Tauri IPC first"| FS

    style FS fill:#d4edda,stroke:#28a745,color:#000
    style Cache fill:#fff3cd,stroke:#ffc107,color:#000
    style RS fill:#cce5ff,stroke:#004085,color:#000
```

#### Ownership rules

| Layer | Owner | Writes to | Reads from |
|-------|-------|-----------|------------|
| Filesystem | Tauri Rust commands (`save_note_content`, `update_frontmatter`, etc.) | Disk | — |
| Cache | `scan_vault_cached()` in `vault/cache.rs` | `~/.laputa/cache/` | Filesystem + git diff |
| React state | `useVaultLoader` + `useEntryActions` + `useNoteActions` | In-memory `entries` | Cache (on load), filesystem (on reload) |

#### Invariants

1. **Disk-first writes**: All functions that change vault data must write to disk (via Tauri IPC) *before* updating React state. This ensures that if the disk write fails, React state remains consistent with what's actually on disk.
2. **Optimistic UI with rollback**: Where responsiveness matters (e.g. `persistOptimistic` in `useNoteCreation`), state may update before disk confirmation — but a failure callback must revert the optimistic state.
3. **No orphan state updates**: Never call `updateEntry()` before the corresponding `handleUpdateFrontmatter()` or `handleDeleteProperty()` has resolved. The three functions in `useEntryActions` (`handleCustomizeType`, `handleRenameSection`, `handleToggleTypeVisibility`) follow this rule — disk write first, then state update.
4. **Recovery via reload**: If state ever diverges from disk (crash, external edit, race condition), `Reload Vault` (Cmd+K → "Reload Vault") invalidates the cache and does a full filesystem rescan via the `reload_vault` Tauri command, replacing all React state. The `reload_vault_entry` command can re-read a single file.
5. **Cache is disposable**: The `reload_vault` command deletes the cache file before rescanning, guaranteeing fresh data. The cache never contains data that doesn't exist on the filesystem.
6. **Visibility filters are command-boundary concerns**: Gitignored-content visibility is applied after scanning/caching, before entries, folders, or search results reach React. The cache remains complete so toggling the setting can show ignored content again without rebuilding a different cache shape. Large folder filtering runs on the blocking Tokio pool and drains `git check-ignore` output while feeding stdin so broad ignore matches cannot freeze the native UI thread.

#### External Change Detection

The main window starts a native watcher for the active vault through `start_vault_watcher` / `stop_vault_watcher` (`src-tauri/src/vault_watcher.rs`, backed by Rust `notify`). The watcher emits `vault-changed` events for content paths and ignores churn from `.git/`, `node_modules/`, temp files, and `.tolaria-rename-txn`. `useVaultWatcher` batches those events, suppresses recent app-owned saves, and sends the remaining external paths through `refreshPulledVaultState()` so folders, saved views, note-list state, and the clean active editor all refresh under the ADR-0071 unsaved-edit rules. `useVaultLoader.isReloading` drives the status-bar reload spinner for both manual and watcher-triggered reloads.

#### Progressive Vault Loading

Vault opening is allowed to render the main app shell while the full entry scan is still in flight. `useVaultLoader` keeps `isLoading` true until entries are ready, but folders and saved views load independently so the sidebar can become useful before the note index completes. The status bar uses the vault activity badge during this initial indexing state, while command-palette and editor-shell interactions remain mounted instead of being hidden behind the full app skeleton. The full skeleton is reserved for app-level capability checks such as the initial Git-state probe.

Large-vault reproduction and keyboard QA steps live in [LARGE-VAULT-LOADING-QA.md](./LARGE-VAULT-LOADING-QA.md).

#### Note Opening Fast Path

Note opening uses bounded in-memory fast paths for raw content and parsed editor blocks. `useTabManagement` owns the markdown/text prefetch cache and treats every cached value as a performance hint only: identity-matched entries (`modifiedAt` + `fileSize`) can be reused immediately, while identity-missing or identity-mismatched cached text is checked with `validate_note_content`, which compares the cached text with the current file bytes inside the validated vault boundary. If validation fails, Tolaria discards the cached entry and reads fresh disk content before swapping the editor.

The note list opportunistically preloads visible and adjacent markdown/text entries after a short delay. When a large warmed Markdown note resolves, `useEditorTabSwap` may parse it into a bounded parsed-block cache only after foreground editor work has been idle and the rich editor is mounted. Parsed blocks are keyed by vault, path, and exact source content; every async swap carries a generation/source-content token so stale conversion results cannot overwrite newer file content or dirty editor state. The editor never renders a preview surface that later morphs into BlockNote. See [ADR-0105](./adr/0105-editor-correctness-and-responsiveness-contract.md).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Tauri v2 | 2.10.0 |
| Frontend | React + TypeScript | React 19, TS 5.9 |
| Editor | BlockNote | 0.46.2 |
| Code block highlighting | @blocknote/code-block | 0.46.2 |
| Diagram rendering | Mermaid | 11.14.0 |
| Whiteboard rendering | tldraw | 4.5.10 |
| Raw editor | CodeMirror 6 | - |
| Styling | Tailwind CSS v4 + CSS variables | 4.1.18 |
| UI primitives | Radix UI + shadcn/ui | - |
| Icons | Phosphor Icons + Lucide | - |
| Build | Vite | 7.3.1 |
| Backend language | Rust (edition 2021) | 1.77.2 |
| Frontmatter parsing | gray_matter | 0.2 |
| Filesystem watcher | notify | 6.1 |
| AI (agent panel) | CLI agent adapters (Claude Code + Codex + OpenCode + Pi + Gemini) | - |
| Search | Keyword (walkdir-based file scan) | - |
| Localization | App-owned runtime + JSON catalogs (`src/lib/i18n.ts`, `src/lib/locales/*.json`, `lara.yaml`) | English fallback + Lara CLI sync |
| MCP | @modelcontextprotocol/sdk | 1.0 |
| Tests | Vitest (unit), Playwright (E2E/smoke), cargo test (Rust) | - |
| Package manager | pnpm | - |

## System Overview

```mermaid
flowchart TD
    subgraph TW["Tauri v2 Window"]
        subgraph FE["React Frontend"]
            App["App.tsx (orchestrator)"]
            WS["WelcomeScreen\n(onboarding)"]
            SB["Sidebar\n(navigation + filters + types)"]
            NL["NoteList / PulseView\n(filtered list / activity)"]
            ED["Editor\n(BlockNote + diff + raw)"]
            IN["Right Panel\n(Inspector + TOC)"]
            AIP["AiPanel\n(selected CLI agent + tools)"]
            SP["SearchPanel\n(keyword search)"]
            ST["StatusBar\n(vault picker + sync + version)"]
            CP["CommandPalette\n(Cmd+K launcher)"]

            App --> WS & SB & NL & ED & SP & ST & CP
            ED --> IN & AIP
        end

        subgraph RB["Rust Backend"]
            LIB["lib.rs → Tauri commands"]
            VAULT["vault/"]
            FM["frontmatter/"]
            GIT["git/\n(commit, sync, clone)"]
            SETTINGS["settings.rs"]
            SEARCH["search.rs"]
            CLI["ai_agents.rs\n+ CLI adapters"]
        end

        subgraph EXT["External Services"]
            CCLI["Claude / Codex / OpenCode / Pi / Gemini CLI\n(agent subprocesses)"]
            MCP["MCP Server\n(ws://9710, 9711)"]
            GCLI["git CLI\n(system executable)"]
            REMOTE["Git remotes\n(GitHub/GitLab/Gitea/etc.)"]
        end

        FE -->|"Tauri IPC"| RB
        CLI -->|"spawn subprocess"| CCLI
        LIB -->|"register / monitor"| MCP
        GIT -->|"clone / fetch / push / pull"| GCLI
        GCLI -->|"network auth via user config"| REMOTE
    end

    style FE fill:#e8f4fd,stroke:#2196f3,color:#000
    style RB fill:#fff8e1,stroke:#ff9800,color:#000
    style EXT fill:#f3e5f5,stroke:#9c27b0,color:#000
```

## Four-Panel Layout

```
┌────────┬─────────────┬─────────────────────────┬────────────┐
│Sidebar │ Note List   │ Editor                  │ Right Panel│
│(250px) │ (300px)     │ (flex-1)                │ (280px)    │
│        │ OR          │                         │ OR         │
│ All    │ Pulse View  │ [Breadcrumb Bar]        │ TOC        │
│ Changes│             │                         │ OR         │
│ Pulse  │ [Search]    │ # My Note               │ AI Agent   │
│ Inbox  │ [Sort/Filt] │                         │            │
│        │             │                         │ Context    │
│Projects│ Note 1      │ Content here...         │ Messages   │
│Experim.│ Note 2      │ (BlockNote or Raw)      │ Actions    │
│Respons.│ Note 3      │                         │ Input      │
│People  │ ...         │                         │            │
│Events  │             │                         │            │
│Topics  │             │                         │            │
├────────┴─────────────┴─────────────────────────┴────────────┤
│ StatusBar: v0.4.2 │ main │ Synced 2m ago │ Vault: ~/Laputa │
└──────────────────────────────────────────────────────────────┘
```

- **Sidebar** (220-400px, resizable): Top-level filters (All Notes, Changes, Pulse), saved Views, collapsible type-based section groups, and a dedicated folder tree. The folder tree starts with a vault-root row labeled from the opened vault path, shows root-level files when selected, and nests user-created folders plus default vault folders such as `attachments/` and `views/` underneath it; only the dedicated `type/` directory stays hidden because note types already have their own sidebar section. Saved Views persist a top-level YAML `order` field in each view file and use the same ordered-list mental model as Types: pointer users can drag the existing view row, double-click to rename it, or right-click for edit/rename/appearance/delete actions, while keyboard users can use the row context key for the same menu and command-palette move actions for ordering. The folder tree supports inline folder creation and rename, exposes a right-click menu for rename/delete plus filesystem reveal/copy-path actions on mutable folders, and auto-expands ancestor folders when the current selection or rename target is nested. Type sections and folder rows also act as note drop targets: dropping a note on a type updates its `type:` frontmatter, while dropping it on a folder runs the same crash-safe move path as the command palette flow. Each type can have a custom icon, color, sort, and visibility set via its `type: Type` document; new type documents created by Tolaria are written at the vault root.
- **Note List / Pulse View** (220-500px, resizable): When a section group, filter, or saved view is selected, shows filtered notes with snippets, modified dates, status indicators, and per-context note-list controls. When `selection.kind === 'entity'`, the same pane enters **Neighborhood** mode: the source note is pinned at the top as a normal active row, outgoing relationship groups render first, inverse/backlink groups follow, empty groups stay visible with `0`, and duplicates across groups are allowed when multiple relationships are true. Plain click / `Enter` open the focused note without replacing the current Neighborhood, while Cmd/Ctrl-click and Cmd/Ctrl-`Enter` pivot the pane into the clicked note's Neighborhood. Folder-backed lists also show non-Markdown files: previewable image and PDF binaries get file indicators and open in the editor pane, while unsupported binaries remain muted instead of auto-launching an external app. Saved views reuse the same sort and visible-column controls as the built-in lists, and those changes persist back into the view `.yml` definition (`sort`, `listPropertiesDisplay`). When Pulse filter is active, shows `PulseView` — a chronological git activity feed grouped by day.
- **Editor** (flex, fills remaining space): Single note open at a time (no tabs — see ADR-0003). Breadcrumb bar with word count, rich-editor width toggle, and the secondary-overflow Table of Contents action, BlockNote rich text editor with wikilink support, Markdown-compatible inline/display math rendering, first-class Mermaid diagram blocks, markdown-safe formatting controls, and schema-backed fenced code block highlighting via `@blocknote/code-block`. Can toggle to diff view (modified files), raw CodeMirror view, or a wide rich-editor reading surface with preserved side margins; raw CodeMirror remains full-width and unaffected by note width mode. Inline rich-editor images open in a localized shadcn lightbox on double-click while normal single-click BlockNote selection remains untouched, and tiny tracking-style images are ignored. Binary image and PDF files render through `FilePreview` as ordinary vault files using Tauri asset URLs; external-open actions call `open_vault_file_external` so the target is validated against the active vault before the native default app opens it. Unsupported/broken binaries show explicit fallback states and keyboard focus returns to the note list on `Escape`. Decomposed into `Editor` (orchestrator), `EditorContent`, `FilePreview`, `EditorRightPanel`, `TableOfContentsPanel`, `SingleEditorView`, with hooks `useDiffMode`, `useEditorFocus`, and `useEditorSave`, plus the `useRawMode`/`RawEditorView` pair for markdown source editing. Rich BlockNote input and raw CodeMirror input both route typed `->`, `<-`, and `<->` through the shared `src/utils/arrowLigatures.ts` resolver so arrow ligatures stay consistent across mode switches while escaped ASCII sequences remain literal. Navigation history (Cmd+[/]) replaces tabs.
- **Right side panels** (200-500px or hidden): Properties, Table of Contents, and AI Agent are mutually exclusive panels mounted by `EditorRightPanel` and coordinated by `useRightPanelExclusion`. Properties shows frontmatter, relationships, instances, backlinks, and git history; Table of Contents is lazy-mounted only while open, derives a title-rooted H1/H2/H3 hierarchy through a debounced Web Worker per ADR-0109, and reuses folder-tree indentation/guide geometry with heading icons while resolving live BlockNote block IDs at click time for navigation; AI Agent keeps the selected CLI/API target controller mounted for tool execution and chat state. The breadcrumb bar toggles Table of Contents, AI, and Properties actions, and opening one replaces the others. Per-note `icon` is a suggested Properties field and the command palette's "Set Note Icon" action opens that field directly. When viewing a Type note, Properties shows an **Instances** section listing all notes of that type (sorted by modified_at desc, capped at 50).

Panels are separated by `ResizeHandle` components that support drag-to-resize. `useLayoutPanels` clamps the sidebar, note-list, and inspector widths before applying them, keeps the side panes from flex-shrinking below their protected widths, and persists the last chosen widths in installation-local localStorage under `tolaria:layout-panels`.

The main Tauri window derives its minimum width from the visible panes instead of a single fixed floor. `useMainWindowSizeConstraints` treats the editor-only shell as the 480px baseline, adds the current sidebar / note-list / expanded-inspector widths on top with minimum floors, and calls the native `update_current_window_min_size` command whenever view mode, inspector visibility, or restored pane widths change. That same native command also grows the current window back out when a wider pane combination is restored, while note windows skip this path and keep their dedicated 800×700 initial sizing.

The main Tauri window also persists its last normal size and screen position in the app config directory as `window-state.json`. The state stores logical window points, while `window_state.rs` migrates older physical-pixel state on read so Retina and non-Retina launches restore the same user-facing bounds. On startup, the restored frame applies only to the main window and clamps to the currently available monitor work areas, so stale coordinates from a disconnected display fall back to a visible placement. Maximized, fullscreen, minimized, and detached note-window frames are not written as the restore baseline.

Tauri setup keeps launch-time filesystem and subprocess work off the window creation critical path. Legacy `~/Laputa` housekeeping and the initial persisted-vault MCP bridge sync run on named background threads, so large legacy vaults, stale active-vault paths, or slow process startup cannot beachball the macOS app before React mounts. React still resyncs the bridge from `useVaultSwitcher` after the persisted selection loads, and no selected vault stops the bridge. The HTML bootstrap also installs a Tauri-only one-shot watchdog: React reports readiness from an effect after the root commits, and if that readiness signal never arrives the WebView reloads once instead of leaving macOS users in an inert rendered shell.

Linux uses custom React-rendered window chrome instead of the native Tauri menu bar. `setup_linux_window_chrome()` drops server-side decorations on the main window, `openNoteInNewWindow()` does the same for detached note windows, and `LinuxTitlebar`/`LinuxMenuButton` route both window controls and menu actions back through the same shared command pipeline that the desktop native menus use. The native app menu keeps macOS-only Services/Hide entries off Windows and Linux, registers a window-scoped menu event handler on Windows where Tauri delivers menu clicks through the main `WebviewWindow`, and cross-platform custom items such as Check for Updates emit Tolaria command IDs with visible updater feedback.
When Tolaria is launched from a Linux AppImage, `run()` also applies AppImage-only WebKitGTK startup safeguards without changing native package installs. It injects `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` independently unless the user already set either variable, and on Wayland sessions it re-execs once with the first architecture-matching system `libwayland-client.so` in `LD_PRELOAD` when the user has not provided their own preload. The candidate order prefers Fedora-style `lib64` and Debian-style `x86_64-linux-gnu` paths before generic `/usr/lib`, and the ELF header is checked so a 64-bit Tolaria process does not retry with a 32-bit Wayland client library. The same AppImage path checks whether `fc-match` resolves the default emoji font to `Noto-COLRv1.ttf`; when the user has not provided `FONTCONFIG_FILE` or `FONTCONFIG_PATH`, Tolaria writes a cache-local fontconfig file that rejects only that matched font file and exports it before WebKit starts. The rendering overrides keep AppImage WebViews from blanking after accelerated compositing/DMA-BUF failures, the re-exec addresses AppImage library-order failures that can surface as `Could not create default EGL display: EGL_BAD_PARAMETER`, and the fontconfig guard avoids known WebKit crashes in COLRv1 emoji font rendering while leaving other emoji fonts available.

## Multi-Window (Note Windows)

Notes can be opened in separate Tauri windows for focused editing. Secondary windows show only the editor panel (no sidebar, no note list).

**Triggers:**
- `Cmd+Shift+Click` on any note in the note list or sidebar
- `Cmd+K` → "Open in New Window" (command palette, requires active note)
- `Cmd+Shift+O` keyboard shortcut
- Note → "Open in New Window" menu bar item

**Architecture:**
- `openNoteInNewWindow()` (`src/utils/openNoteWindow.ts`) creates a new `WebviewWindow` via the Tauri v2 JS API with URL query params (`?window=note&path=...&vault=...&title=...`)
- `main.tsx` checks `isNoteWindow()` at boot to route between `App` (main window) and `NoteWindow` (secondary window)
- `NoteWindow` (`src/NoteWindow.tsx`) is a minimal shell that loads vault entries, fetches note content, applies the theme, and renders a single `Editor` instance
- Each window has its own auto-save via `useEditorSaveWithLinks` (same 1.5s low-end-safe idle debounce, same Rust `save_note_content` command), and raw-editor typing also derives frontmatter-backed `VaultEntry` state in the renderer so Inspector and note-list surfaces react immediately without waiting for a full reload
- Secondary windows are sized 800×700; macOS keeps the overlay title bar, while Linux mounts the shared React titlebar on undecorated windows
- Capabilities config (`src-tauri/capabilities/default.json`) grants permissions to both `main` and `note-*` window labels

## AI System

### AI Agent (AiPanel)

Full agent mode — spawns the selected local CLI agent as a subprocess with tool access and MCP vault integration.

1. **Frontend** (`AiPanel` + `useCliAiAgent` + `aiAgentSession.ts` + `aiAgents.ts` + `aiTargets.ts`) — one normalized session lifecycle for message state, reasoning blocks, tool action cards, response display, onboarding, default-target selection, and the per-vault Safe / Power User permission mode shown in the panel header for coding agents
2. **Backend orchestration** (`ai_agents.rs`) — normalizes agent availability, streaming, and the request permission mode before dispatching to per-agent adapters
3. **Shared runtime scaffold** (`cli_agent_runtime.rs`) — owns the common request shape, prompt wrapping, JSON-line subprocess lifecycle, normalized error/done handling, version probing, and Tolaria MCP server path resolution used by app-managed CLI agents
4. **Agent adapters** — Shared prompts are mode-aware on every turn, including turns with note context snapshots: Vault Safe tells agents not to use or advertise shell, while Power User tells shell-capable agents to keep local commands scoped to the active vault. Claude Code still uses `claude_cli.rs` with `acceptEdits`, strict Tolaria MCP config, and a scoped tool list: Safe enables file/search/edit tools only, while Power User adds Bash to the available tools and pre-approves Bash with `--allowedTools` without using dangerous bypass flags. Codex runtime specifics live in `codex_cli.rs`; Safe runs `codex --sandbox read-only --ask-for-approval untrusted exec --json`, while Power User runs `codex --sandbox workspace-write --ask-for-approval never exec --json` so shell execution stays enabled across repeated turns. OpenCode runs through `opencode run --format json` with transient permissions: Safe denies bash and external directories, while Power User allows bash but still denies external directories. Pi runs through `pi --mode json --no-session` with `npm:pi-mcp-adapter`; both modes currently share the same transient MCP config and the prompt does not promise shell for Pi Power User. Gemini runs through `gemini --output-format stream-json --prompt` so assistant message chunks, tool calls, and final errors are mapped from the CLI event stream instead of relying on a buffered `response` field. Gemini Safe uses `auto_edit` plus `tools.exclude=["run_shell_command"]`; Power User intentionally uses `yolo` against a trusted transient Tolaria MCP entry. Codex, OpenCode, Pi, and Gemini all launch from the active vault cwd with closed stdin and transient MCP config. All app-launched paths use hidden Windows launches and avoid dangerous permission-bypass flags.
5. **MCP Integration** — Claude receives the generated MCP config file path, Codex receives the same Tolaria MCP server via transient `-c mcp_servers.tolaria.*` config overrides using Tolaria's resolved Node path plus `VAULT_PATH` and `WS_UI_PORT`, OpenCode receives it through `OPENCODE_CONFIG_CONTENT`, Pi receives it through a temporary `PI_CODING_AGENT_DIR/mcp.json` consumed by `pi-mcp-adapter`, and Gemini receives it through a temporary settings file pointed at by `GEMINI_CLI_SYSTEM_SETTINGS_PATH`

CLI-agent availability intentionally does not depend only on the desktop app's inherited `PATH`. The detectors check the current process path, the user's login shell, and supported local/toolchain install locations such as native `~/.local/bin`, local `~/.claude/local`, Mise/asdf shims, nvm-managed Node installs, npm-global, Homebrew, Windows `%APPDATA%\npm`/pnpm/Scoop shims, Windows `.exe` launchers, and the macOS Codex app resource path so first-run onboarding works on fresh macOS and Windows installs. App-managed CLI spawns also expand the active vault path before using it as the subprocess working directory, then extend the child process `PATH` with the resolved binary directory plus those common toolchain directories, which lets GUI-launched macOS sessions run Homebrew/npm shims and their `node`-backed MCP subprocesses even when Finder/Dock did not inherit a terminal shell path.

#### Agent Event Flow

```mermaid
sequenceDiagram
    participant U as User (AiPanel)
    participant FE as useCliAiAgent (Frontend)
    participant R as ai_agents.rs (Rust)
    participant C as Selected CLI Agent
    participant V as Vault (MCP)

    U->>FE: sendMessage(text, references)
    FE->>FE: buildContextSnapshot(activeNote, linkedNotes, openTabs)
    FE->>R: invoke('stream_ai_agent', {agent, message, systemPrompt, vaultPath, permissionMode})
    R->>R: pick adapter for claude_code, codex, opencode, or pi
    R->>C: spawn agent with MCP-enabled config

    loop Normalized stream
        C-->>R: Claude NDJSON, Codex JSONL, OpenCode JSON, Pi JSON, or Gemini JSONL events
        R-->>FE: emit("ai-agent-stream", event)
        alt TextDelta
            FE->>FE: accumulate response (revealed on Done)
        else ThinkingDelta
            FE->>FE: show reasoning block (collapses on first text)
        else ToolStart
            FE->>FE: add AiActionCard with spinner
        else ToolDone
            FE->>FE: update card with output
        else Done
            FE->>FE: reveal full response
            FE->>FE: detect file operations → reload vault if needed
        end
    end

    C->>V: MCP tool calls (search_notes, read_note, edit_note…)
    V-->>C: tool results
```

#### File Operation Detection

When the agent writes or edits vault files, `aiAgentFileOperations.ts` detects this from normalized tool inputs and calls `onFileCreated` or `onFileModified` callbacks to trigger vault reload. Unrecognized write-like operations fall back to a full vault refresh.

### Context Building

The agent panel (`ai-context.ts`) builds a structured JSON snapshot from the active note and linked entries:

```json
{
  "activeNote": { "path", "title", "type", "frontmatter", "body", "wordCount", "bodyTruncated?" },
  "openTabs": [{ "path", "title", "type", "frontmatter" }],
  "noteList": [{ "path", "title", "type" }],
  "vault": { "types", "totalNotes" },
  "referencedNotes": [{ "title", "path", "type" }]
}
```

Large active notes are compacted into a head/tail body snapshot before they enter the CLI prompt. The snapshot records `bodyTruncated` metadata and instructs agents to call `get_note(path)` before content-sensitive edits or summaries, keeping lower-context OpenCode providers from failing on oversized active-note context while preserving access to the full note through MCP.

### Direct Model Targets

Tolaria also supports direct model targets for local servers and API providers. These targets are stored as app-level provider metadata and can be selected in Settings or the status bar alongside coding agents. `src/shared/aiModelProviderCatalog.json` is the shared source for provider defaults, local/API grouping, API-key environment placeholders, and runtime fallback base URLs; the renderer imports it through `aiTargets.ts`, and Tauri includes the same JSON in `ai_models.rs`. Direct model targets run in Chat mode: they receive the same note-context snapshot and conversation history, but they do not receive vault-write tools or shell access. The backend `stream_ai_model` command supports OpenAI-compatible chat completions and Anthropic Messages-compatible calls, including Ollama, LM Studio, OpenRouter, OpenAI, Anthropic, Gemini, and custom compatible endpoints.

Provider secrets are not written to `settings.json`. Hosted API targets can use Tolaria's local app-data secrets file (`ai-provider-secrets.json`, outside vaults/worktrees and owner-only on Unix) or reference an environment variable name. Local endpoints can omit authentication.

### Authentication

Each CLI agent authenticates itself outside Tolaria. Claude Code uses its existing CLI login; Codex surfaces a friendly prompt to run `codex login` when needed; OpenCode surfaces a friendly prompt to run `opencode auth login` or configure a provider when needed; Pi surfaces a friendly prompt to run `pi /login` or configure a provider API key when needed. Tolaria does not store model-provider API keys in app settings; direct provider secrets stay in local app data or user-managed environment variables.

## MCP Server

The MCP server (`mcp-server/`) exposes vault operations as tools for AI assistants (Claude Code, Gemini CLI, Cursor, or any MCP-compatible client).

### Tool Surface (14 tools)

| Tool | Params | Description |
|------|--------|-------------|
| `open_note` | `path` | Open and read a note by relative path |
| `read_note` | `path` | Read note content (alias for `open_note`) |
| `create_note` | `path, title, [type]` | Create new note with title and optional type frontmatter |
| `search_notes` | `query, [limit]` | Search notes by title or content substring |
| `append_to_note` | `path, text` | Append text to end of existing note |
| `edit_note_frontmatter` | `path, patch` | Merge key-value patch into YAML frontmatter |
| `delete_note` | `path` | Delete a note file from the vault |
| `link_notes` | `source_path, property, target_title` | Add a target to an array property in frontmatter |
| `list_notes` | `[type_filter], [sort]` | List all notes, optionally filtered by type |
| `vault_context` | — | Get vault summary: entity types + 20 recent notes + configFiles |
| `ui_open_note` | `path` | Open a note in the Tolaria UI editor |
| `ui_open_tab` | `path` | Open a note in a new UI tab |
| `ui_highlight` | `element, [path]` | Highlight a UI element (editor, tab, properties, notelist) |
| `ui_set_filter` | `type` | Set the sidebar filter to a specific type |

### Transports

- **stdio** — standard MCP transport for Claude Code / Cursor (`node mcp-server/index.js`)
- **WebSocket** — live bridge for Tolaria app integration:
  - Port **9710**: Tool bridge — AI/Claude clients call vault tools here
  - Port **9711**: UI bridge — Frontend listens for UI action broadcasts from MCP tools

### Explicit External Tool Setup

Tolaria can register itself as an MCP server in:
- `~/.claude.json` and `~/.claude/mcp.json` (Claude Code compatibility across current CLI and legacy MCP-file setups)
- `~/.gemini/settings.json` (Gemini CLI)
- `~/.cursor/mcp.json` (Cursor)
- `~/.config/mcp/mcp.json` (generic MCP-compatible clients)

That setup is user-initiated through the status bar / command palette flow, not a startup side effect. Registration is non-destructive (additive, preserves other servers and Gemini settings), uses `upsert` semantics, and can be reversed by removing Tolaria's entry again. Tolaria verifies Node.js is available before writing config, writes an explicit `type: "stdio"` entry, pins `VAULT_PATH` to the active vault, and sets `WS_UI_PORT=9711` so UI actions route back to the desktop app. The same generated entry is exposed as a manual JSON snippet in the MCP setup dialog and through the AI panel copy action, giving users a transparent fallback for MCP-compatible tools Tolaria does not auto-configure. In the desktop app, `useMcpStatus` copies that snippet through the native `copy_text_to_clipboard` command instead of the Web Clipboard API so macOS WKWebView permission policy cannot block setup. Packaged builds resolve `mcp-server/` from the installed resource directory next to the executable before falling back to macOS `Resources`, Linux package roots such as `/usr/local/Tolaria`, `/usr/lib/tolaria`, and `/usr/lib/tolaria/resources`, and AppImage paths. The `useMcpStatus` hook tracks whether the active vault is explicitly connected (`checking | installed | not_installed`) and owns connect, disconnect, exact-snippet load, and copy-to-clipboard actions. Gemini CLI still owns its own install and sign-in; Tolaria writes the durable external MCP entry only on explicit setup, while app-managed Gemini sessions use transient settings and optional vault guidance. The desktop WebSocket bridge is started only when a persisted active vault exists and is resynced from React state on vault changes; no selected vault stops the bridge instead of falling back to `~/Laputa`. Stdio MCP server processes are owned by the external client that launched them: when that client closes stdin, Tolaria cancels UI-bridge reconnect timers, closes any UI WebSocket, and exits the Node process instead of keeping it alive in the background.

### Architecture

```mermaid
flowchart TD
    subgraph MCP["MCP Server (Node.js) — selected-vault scoped"]
        IDX["index.js"]
        VAULT["vault.js\n(findMarkdownFiles, readNote, createNote,\nsearchNotes, appendToNote, editNoteFrontmatter,\ndeleteNote, linkNotes, listNotes, vaultContext)"]
        WSB["ws-bridge.js"]

        IDX -->|"stdio transport"| STDIO["Claude Code / Cursor"]
        IDX --> VAULT
        IDX --> WSB
        WSB -->|"port 9710 — tool bridge"| AI["AI Clients\n(Claude Code, external)"]
        WSB -->|"port 9711 — UI bridge"| FE["Frontend\n(useAiActivity)"]
    end

    TAURI["Tauri bridge lifecycle"] -->|"start/stop/restart with active VAULT_PATH"| MCP
    UI["Status bar / Command Palette"] -->|"explicit setup or disconnect"| CFG["~/.claude.json\n~/.claude/mcp.json\n~/.cursor/mcp.json\n~/.config/mcp/mcp.json"]
```

### WebSocket Bridge

```mermaid
flowchart LR
    FE["Frontend\n(useMcpBridge)"] <-->|"ws://localhost:9710"| WSB["ws-bridge.js"]
    WSB <--> VAULT["vault.js"]
    STDIO["MCP stdio tools"] <-->|"ws://localhost:9711"| FE2["Frontend UI actions\n(useAiActivity)"]
```

**Tool bridge protocol** (port 9710):
- Request: `{ "id": "req-1", "tool": "search_notes", "args": { "query": "test" } }`
- Response: `{ "id": "req-1", "result": { ... } }`

**UI bridge protocol** (port 9711):
- Broadcast: `{ "type": "ui_action", "action": "open_note", "path": "..." }`
- `useAiActivity` hook receives these and applies them (highlight with 800ms feedback, open note, set filter, etc.)

### Rust MCP Module

`src-tauri/src/mcp.rs` manages the MCP server lifecycle:

| Function | Purpose |
|----------|---------|
| `spawn_ws_bridge(vault_path)` | Spawns `ws-bridge.js` as child process with VAULT_PATH env |
| `sync_mcp_bridge_vault(vault_path?)` | Starts, restarts, or stops the desktop WebSocket bridge as the selected vault changes |
| `register_mcp(vault_path)` | Verifies Node.js, resolves the packaged `mcp-server/`, and writes Tolaria's explicit stdio entry to Claude Code, Gemini CLI, Cursor, and generic MCP configs on user request |
| `mcp_config_snippet(vault_path)` | Builds the exact `mcpServers.tolaria` JSON users can copy into any compatible client without writing third-party config files |
| `remove_mcp()` | Removes Tolaria's MCP entry from Claude Code, Gemini CLI, Cursor, and generic MCP configs |
| `upsert_mcp_config(path, entry)` | Atomic config file update (create/merge, preserves others) |

The `WsBridgeChild` state wrapper in `lib.rs` ensures the bridge process is replaced on vault switches, stopped when no active vault is selected, and killed plus waited on app exit via the `RunEvent::Exit` handler. The same desktop layer keeps Tauri asset protocol access limited to vault roots loaded during the current app session; command calls remain active-vault scoped for reads, writes, and external opens.

## Search

Search is keyword-based, using `walkdir` to scan all `.md` files in the vault directory. No external binary or indexing step required.

- Matches query against file titles and content (case-insensitive)
- Scores results: title matches ranked higher than content-only matches
- Extracts contextual snippets around the first match
- Skips hidden files

The `search_vault` Tauri command runs the scan in a blocking Tokio task and returns results sorted by relevance score.

## Vault Cache System

The vault cache (`src-tauri/src/vault/cache.rs`) accelerates vault scanning using git-based incremental updates.

### Cache File

`~/.laputa/cache/<vault-hash>.json` — stored outside the vault directory so it never pollutes the user's git repo. The vault path is normalized through `vault/path_identity.rs` before hashing, so macOS `/tmp` aliases and separator variants share the same cache identity. Stores: vault path, git HEAD commit hash, all VaultEntry objects. Version: v13 (bumped on VaultEntry field changes to force full rescan). Cache replacement is best-effort: Tolaria writes a temp file, fsyncs it, and renames it into place only after a short-lived writer lock plus an on-disk fingerprint check confirm another window/process has not already refreshed the cache. Failures are logged and the app falls back to rebuilding from the filesystem.

`<vault>/.tolaria-rename-txn/` — hidden, scan-ignored staging directory for crash-safe note renames. Tolaria stores temporary backup files plus one manifest per in-flight rename here. On the next vault scan, unfinished transactions are recovered before entries are listed so users do not see a missing note or a visible duplicate after a crash.

### Three Cache Strategies

```mermaid
flowchart TD
    A([scan_vault_cached]) --> B{Cache exists\nand valid?}
    B -->|No / Corrupt| C["🔴 Full Scan\nwalkdir all .md files\n→ full parse"]
    B -->|Yes| D{Git HEAD\nmatches cache?}
    D -->|Same commit| E["🟢 Cache Hit\ngit status --porcelain\n→ re-parse only uncommitted changes"]
    D -->|Different commit| F["🟡 Incremental Update\ngit diff old..new --name-only\n→ selective re-parse of changed files"]

    C --> G[Replace cache if unchanged\nwriter lock + temp file → rename]
    E --> G
    F --> G
    G --> H([VaultEntry list ready])
```

## Styling

The app uses internal app-owned light and dark themes (see [ADR-0081](adr/0081-internal-light-dark-theme-runtime.md)). This is not the old vault-authored theming system from ADR-0013: users choose a mode, but themes are owned by the app.

1. **Global CSS variables** (`src/index.css`): Semantic app colors, borders, surfaces, and interaction states. Bridged to Tailwind v4 via `@theme inline`.
2. **Editor theme** (`src/theme.json`): BlockNote-specific typography. Flattened to CSS vars by `useEditorTheme`; editor colors resolve through the same semantic app variables.
3. **Theme runtime**: Applies `data-theme` and the shadcn-compatible `.dark` class before React consumers render, with a localStorage mirror to avoid startup flash when dark mode is selected. Settings and command-palette theme actions both write the same installation-local `settings.theme_mode` value.

## Localization

Tolaria's app chrome uses an app-owned localization runtime in `src/lib/i18n.ts`, backed by flat JSON catalogs in `src/lib/locales/` and Lara CLI synchronization through `lara.yaml` (see [ADR-0087](adr/0087-json-catalogs-and-lara-cli-localization.md)). `en.json` is the canonical source catalog, locale files are one file per locale, and English remains the fallback for any missing locale file or key. The installation-local `ui_language` setting stores an explicit locale when the user chooses one; `null` means "follow the system language when Tolaria supports it, otherwise English." Legacy stored values such as `zh-Hans` are normalized to canonical locale codes like `zh-CN`.

`App.tsx` derives the effective locale from settings and browser/system language hints, then passes it down to localized surfaces. Settings exposes a keyboard-accessible shadcn `Select`, and the command palette includes actions to open language settings or switch directly to a supported language.

## Vault Management

### Vault List

Persisted at `~/.config/com.tolaria.app/vaults.json` (reads legacy `com.laputa.app` on upgrade):
```json
{
  "vaults": [{ "label": "My Vault", "path": "/path/to/vault" }],
  "active_vault": "/path/to/vault",
  "hidden_defaults": []
}
```

Managed by `useVaultSwitcher` hook. Switching vaults resets sidebar and clears the active note.

### Vault Config

Per-vault UI settings stored locally per vault path (currently in browser/Tauri localStorage, not synced via git):
- `zoom`: Float zoom level (0.8–1.5)
- `view_mode`: "all" | "editor-list" | "editor-only"
- `editor_mode`: "raw" | "preview" (persists across note switches and sessions)
- `note_layout`: "centered" | "left" (wide-screen note column alignment for rich and raw editors)
- `tag_colors`, `status_colors`: Custom color overrides
- `property_display_modes`: Property display preferences
- `inbox.noteListProperties`: Optional Inbox-only property chip override for the note list
- `allNotes.noteListProperties`: Optional All Notes-only property chip override for the note list
- `inbox.explicitOrganization`: When `false`, hide Inbox and the organized toggle so the vault behaves like a plain note collection

### Getting Started Vault

On first launch, `useOnboarding` checks if the default vault exists. If not, it shows `WelcomeScreen` with three options:
- **Create a new vault** → creates an empty git repo in a folder the user chooses
- **Open an existing folder** → system file picker; plain Markdown folders without `.git` open immediately in supported non-git mode
- **Get started with a template** → pick a parent folder, then call `create_getting_started_vault()` with the derived `.../Getting Started` child path so the cloned vault opens into the populated repo root immediately

If the selected vault disappears after startup, `useVaultLoader` re-checks `check_vault_exists` when reloads or vault-derived surfaces fail. A confirmed missing path clears cached entries, folders, views, modified-file state, and prefetched note content, then `App` reuses the `vault-missing` `WelcomeScreen` state so note and view actions cannot keep targeting the stale active vault.

When an opened folder is not yet a git repo, Tolaria shows a dismissible Git setup dialog and a persistent `Git disabled` status-bar warning. Markdown scanning, note browsing, note editing, and search continue normally. Git-dependent surfaces (history, changes, commit, sync, conflict resolution, remotes, AutoGit, and auto-sync) stay unavailable until the user explicitly initializes Git from the dialog, the status-bar warning, or the `Initialize Git for Current Vault` command-palette action.

When the user enables Git later, `init_git_repo` runs `git init`, ensures Tolaria's default `.gitignore`, stages the vault, and writes the initial `Initial vault setup` commit. Before app-managed setup and remote-connection commits, Tolaria ensures the vault has local `user.name` / `user.email` values, falling back to `Tolaria <vault@tolaria.md>` when the vault has no local Git identity yet. That app-managed setup commit explicitly disables commit signing for the single command so inherited global or local `commit.gpgsign` preferences cannot strand onboarding when GPG is missing or misconfigured. Later `git_commit` calls honor the user's signing configuration first, then retry the same app-managed commit once with `commit.gpgsign=false` only when Git reports a signing-helper failure, so working GPG/SSH signing setups continue to sign while broken GPG setups do not create repeated opaque commit failures.

Once a vault is ready, `useAiAgentsOnboarding` can show a one-time `AiAgentsOnboardingPrompt`. That prompt reads `useAiAgentsStatus` so first launch surfaces whether Claude Code, Codex, OpenCode, Pi, and Gemini CLI are installed, offers per-agent install links when they are missing, and stores local dismissal so the prompt does not repeat on every launch.

`useGettingStartedClone` reuses the same parent-folder semantics for the status-bar / command-palette clone action, and `Toast` is rendered through the AI-agents onboarding gate so the resolved destination path stays visible right after a successful clone.

The starter content no longer lives in the app repo. `src-tauri/src/vault/getting_started.rs` holds the public starter repo URL (`refactoringhq/tolaria-getting-started`), delegates the clone to the git backend, then normalizes Tolaria-managed root guidance and type scaffolding (`AGENTS.md`, `CLAUDE.md`, `type.md`, `note.md`) so fresh starter vaults pick up the current defaults even when the remote starter repo still carries a legacy copy or an older pre-`type:` `is_a`-era template. `AGENTS.md` stays the canonical vault guidance file; `CLAUDE.md` is a compatibility shim that imports it for Claude Code without duplicating the instructions, and Tolaria seeds it as an organized `Note` so it stays out of the way in a fresh vault. Optional `GEMINI.md` guidance is created only by the explicit AI guidance restore action. The clone helper still accepts the legacy `LAPUTA_GETTING_STARTED_REPO_URL` environment override so older automation can continue to redirect the starter source during the transition.

After the clone completes, Tolaria removes every configured git remote from the new starter vault. Getting Started vaults therefore open as local-only by default, and users opt into a remote later with the explicit Add Remote flow.

### Remote Clone & Auth Model

Tolaria no longer implements provider-specific OAuth or remote-repository APIs. All remote git work goes through the user's existing system git configuration.

**Flow:**
1. User opens `CloneVaultModal` from onboarding or the vault menu
2. User pastes any git URL and chooses a local destination
3. The `clone_git_repo()` Tauri command runs `git clone` inside a blocking Tokio task so the Tauri window stays responsive during slow or failing clones
4. Linux AppImage builds strip AppImage loader variables from system-git subprocesses before spawning `git`, keeping `git-remote-https` on the host git/library stack
5. `git_push()` / `git_pull()` continue to use the same system git path
6. Clone commands disable interactive terminal / askpass prompts and surface the git failure back to the UI instead of freezing the app waiting for input

**Auth model:**
- SSH keys, Git Credential Manager, macOS Keychain helpers, `gh auth`, and other git helpers all work without app-specific setup
- No provider tokens are stored in Tolaria settings
- The same flow works for GitHub, GitLab, Bitbucket, Gitea, and self-hosted remotes

## Pulse View

`PulseView` is a git activity feed that replaces the NoteList when the Pulse filter is selected.

- Groups commits by day ("Today", "Yesterday", or full date)
- Shows commit message, short hash, timestamp, and changed files
- Files have status icons (added/modified/deleted) and are clickable to open in editor
- Links to GitHub commits when `githubUrl` is available
- Infinite scroll pagination (20 commits per page) via Intersection Observer

Backend: `get_vault_pulse` Tauri command parses `git log` with `--name-status`.

## Data Flow

### Startup Sequence

```mermaid
sequenceDiagram
    participant T as Tauri (Rust)
    participant A as App.tsx
    participant VL as useVaultLoader
    participant MCP as MCP Server
    participant U as User

    T->>T: apply Linux AppImage WebKit env/preload safeguards<br/>(AppImage only)
    T->>T: start background legacy vault housekeeping<br/>(does not block setup)
    T->>MCP: start background initial ws-bridge sync<br/>(if active vault exists)
    T->>A: App mounts

    A->>A: useOnboarding — vault exists?
    alt Vault missing
        A-->>U: WelcomeScreen
    else Vault found
        A->>VL: useVaultLoader fires
        VL->>T: invoke('reload_vault') → allow requested vault roots in asset scope + scan_vault_cached()
        T-->>VL: VaultEntry[]
        VL->>T: invoke('get_modified_files')
        alt Runtime vault path disappears
            VL->>T: invoke('check_vault_exists')
            VL-->>A: unavailable vault path + cleared stale state
            A-->>U: WelcomeScreen (vault missing)
        end
        A->>T: useMcpStatus — check explicit MCP setup state
        A->>T: sync_mcp_bridge_vault(selected path)
        VL-->>A: entries ready
    end

    U->>A: clicks note in NoteList
    A->>T: invoke('get_note_content')
    T-->>A: raw markdown
    A->>A: splitFrontmatter → [yaml, body]
    A->>A: preProcessDurableEditorMarkdown(body)
    A->>A: preProcessWikilinks(body)
    A->>A: tryParseMarkdownToBlocks()
    A->>A: injectWikilinks + injectDurableEditorMarkdownBlocks(blocks)
    A-->>U: Editor renders note
```

### Auto-Save Flow

```mermaid
flowchart LR
    A["✏️ Editor content changes"] --> B["useEditorSave\n(debounced)"]
    B --> C["blocksToMarkdownLossy()"]
    C --> D["postProcessWikilinks()\n→ restore [[target]] syntax"]
    D --> E["invoke('save_note_content')"]
    E --> F["💾 Disk write"]
    F --> G["Update tab status indicator"]
```

### Git Sync Flow

```mermaid
flowchart TD
    AS["useAutoSync\n(configurable interval)"] --> PULL["invoke('git_pull')"]
    PULL --> PC{Result?}
    PC -->|Conflicts| CM["ConflictResolverModal\nor ConflictNoteBanner"]
    PC -->|Fast-forward| RV["reload vault + folders/views"]
    RV --> TAB{"clean active tab?"}
    TAB -->|Yes| RT["replace active tab\nwith fresh disk content"]
    TAB -->|No| DONE["idle"]
    RT --> DONE
    PC -->|Up to date| DONE["idle"]

    MAN["Manual commit\n(CommitDialog)"] --> RS["useGitRemoteStatus\n(commit-time check)"]
    RS --> RCHK["invoke('git_remote_status')"]
    RCHK --> RMODE{Remote configured?}
    RMODE -->|No| GC["invoke('git_commit', message)"]
    GC --> LOCAL["Local commit only\nNo remote chip + local toast"]
    RMODE -->|Yes| GC2["invoke('git_commit', message)"]
    GC2 --> GP["invoke('git_push')"]
    GP --> PR{Push result?}
    PR -->|ok| RM["Reload modified files"]
    PR -->|rejected| DIV["syncStatus = pull_required"]
    DIV -->|User clicks badge| PAP["pullAndPush()"]
    PAP --> PULL2["invoke('git_pull')"]
    PULL2 --> GP2["invoke('git_push')"]
    GP2 --> RM

    CMD["Cmd+K → Pull\nor Menu → Pull"] --> PULL
    STATUS["Click sync badge"] --> POPUP["GitStatusPopup\n(branch, ahead/behind)"]
```

`useGitRemoteStatus` re-checks `git_remote_status` when the commit dialog opens and again right before submit. If `hasRemote` is false, Tolaria keeps the flow local-only: the status bar shows a neutral `No remote` chip, the dialog copy switches from "Commit & Push" to "Commit", and no `git_push` call is attempted.

If the current vault is not a Git repository, Tolaria treats Git as disabled instead of degraded. The status bar replaces changes, commit, sync, remote, conflict, and history controls with a `Git disabled` warning that reopens Git setup. Command registration follows the same state: only `Initialize Git for Current Vault` is available in the Git group, while pull, commit, changes, conflict, and remote commands are hidden. `useAutoSync` is disabled for non-git vaults so the app does not run background Git commands against plain folders.

The same local-only state enables the explicit Add Remote flow. `AddRemoteModal` is reachable from the `No remote` chip and the command palette. The backend `git_add_remote` command ensures the local author identity, adds `origin`, fetches it, refuses incompatible histories, and only enables tracking after a safe push or fast-forward-compatible check succeeds.

`useCommitFlow` also exposes `runAutomaticCheckpoint()`, a dialog-free commit path shared by AutoGit and the bottom-bar Commit button. `useAutoGit` watches the last editor activity plus app focus/visibility state, and when the vault is git-backed, all saves are flushed, and no unsaved edits remain, it triggers the same deterministic `Updated N note(s)` / `Updated N file(s)` commit message path after the configured idle or inactive thresholds. The bottom-bar quick action reuses that checkpoint flow after forcing a save first, so manual quick commits and scheduled AutoGit commits stay aligned on message generation and push behavior.

#### Sync States

| State | Indicator | Color | Trigger |
|-------|-----------|-------|---------|
| `idle` | Synced / Synced Xm ago | green | Successful sync |
| `syncing` | Syncing... | blue | Pull/push in progress |
| `pull_required` | Pull required | orange | Push rejected (divergence) |
| `conflict` | Conflict | orange | Merge conflicts detected |
| `error` | Sync failed | grey | Network/auth error |

## Vault Module Structure

The vault backend (`src-tauri/src/vault/`) is split into focused submodules:

| File | Purpose |
|------|---------|
| `mod.rs` | Core types (`VaultEntry`, `Frontmatter`), `parse_md_file`, `scan_vault`, relationship/link extraction |
| `parsing.rs` | Text processing: snippet extraction, markdown stripping, ISO date parsing, `extract_title` (H1 → legacy frontmatter → filename), `slug_to_title` |
| `title_sync.rs` | Legacy filename → `title` frontmatter sync helper; no longer used by the normal note-open flow |
| `cache.rs` | Git-based incremental vault caching (`scan_vault_cached`), git helpers |
| `ignored.rs` | Gitignored-content visibility filtering via batched, pipe-safe `git check-ignore` |
| `filename_rules.rs` | Cross-platform validation for note filenames, folder names, and custom view filenames |
| `rename.rs` | `rename_note` / `rename_note_filename` / `move_note_to_folder` — stage crash-safe file moves, update `title` frontmatter when needed, recover unfinished rename transactions, and report backlink rewrite failures |
| `image.rs` | `save_image` / `copy_image_to_vault` — save editor image attachments with sanitized filenames |
| `migration.rs` | `flatten_vault`, `vault_health_check`, `migrate_is_a_to_type` |
| `config_seed.rs` | Maintains vault AI guidance (`AGENTS.md`, `CLAUDE.md`, and optional `GEMINI.md` shims), migrates legacy `config/agents.md`, and repairs missing root type scaffolding such as `type.md` and `note.md` |
| `getting_started.rs` | Clones and normalizes the public Getting Started starter vault |

## Rust Backend Modules

| Module | Purpose |
|--------|---------|
| `vault/` | Vault scanning, caching, parsing, rename, image, migration |
| `frontmatter/` | YAML frontmatter read/write (`mod.rs`, `yaml.rs`, `ops.rs`) |
| `git/` | Git operations (`commit.rs`, `status.rs`, `history.rs`, `conflict.rs`, `remote.rs`, `pulse.rs`, `clone.rs`, `connect.rs`) |
| `search.rs` | Keyword search — walkdir-based vault file scan with Gitignored-content visibility filtering |
| `ai_agents.rs` | CLI-agent request normalization and adapter dispatch |
| `cli_agent_runtime.rs` | Shared CLI-agent request, prompt, subprocess, version, and MCP path helpers |
| `claude_cli.rs`, `codex_cli.rs`, `opencode_cli.rs`, `pi_cli.rs`, `gemini_cli.rs` | CLI-agent command/config/event adapters |
| `pi_cli.rs`, `pi_config.rs`, `pi_discovery.rs`, `pi_events.rs` | Pi subprocess launch, transient MCP adapter config, discovery, and JSON stream parsing |
| `mcp.rs` | MCP server spawning + explicit config registration/removal |
| `commands/` | Tauri command handlers (split into submodules) |
| `settings.rs` | App settings persistence |
| `vault_config.rs` | Per-vault UI config |
| `vault_list.rs` | Vault list persistence |
| `menu.rs` | Native desktop menu definitions and command IDs (not mounted on Linux) |

## Tauri IPC Commands

### Vault Operations

| Command | Description |
|---------|-------------|
| `list_vault` | Scan vault (cached), then apply Gitignored-content visibility → `Vec<VaultEntry>` |
| `get_note_content` | Read note file content |
| `save_note_content` | Write note content to disk |
| `delete_note` | Permanently delete note from disk (with confirm dialog) |
| `rename_note` | Crash-safe note rename + `title` frontmatter update + cross-vault wikilinks + failed backlink counts |
| `move_note_to_folder` | Crash-safe folder move that preserves the filename, reloads the moved note, and rewrites path-based wikilinks |
| `create_vault_folder` | Create a folder relative to the active vault root |
| `list_vault_folders` | Build the folder tree on the blocking Tokio pool, then apply Gitignored-content visibility → `Vec<FolderNode>` |
| `rename_vault_folder` | Rename a folder relative to the active vault root and return old/new relative paths |
| `delete_vault_folder` | Permanently delete a folder subtree relative to the active vault root |
| `sync_note_title` | Legacy helper: rewrite `title` frontmatter from filename → `bool` (modified); not used by the normal note-open flow |
| `batch_archive_notes` | Archive multiple notes |
| `batch_delete_notes` | Permanently delete notes from disk |
| `reload_vault` | Allow the requested vault roots in the runtime asset scope, invalidate cache, full rescan from filesystem, then apply Gitignored-content visibility → `Vec<VaultEntry>` |
| `reload_vault_entry` | Re-read a single file from disk → `VaultEntry` |
| `open_vault_file_external` | Validate an existing file against the active vault boundary, then open it with the system default app |
| `start_vault_watcher` / `stop_vault_watcher` | Start or stop native active-vault filesystem change events |
| `check_vault_exists` | Check if vault path exists |
| `create_empty_vault` | Create a git-backed vault, then seed root `AGENTS.md`, `CLAUDE.md`, `type.md`, and `note.md` defaults |
| `create_getting_started_vault` | Clone the public Getting Started vault, refresh Tolaria-managed guidance/config defaults, and keep the cloned repo clean |
| `get_vault_ai_guidance_status` | Report whether `AGENTS.md`, `CLAUDE.md`, and optional `GEMINI.md` guidance are managed, missing, broken, or custom |
| `restore_vault_ai_guidance` | Restore any missing/broken Tolaria-managed guidance files without overwriting custom ones |

### Frontmatter

| Command | Description |
|---------|-------------|
| `update_frontmatter` | Update a frontmatter property |
| `delete_frontmatter_property` | Remove a frontmatter property |

### Git

| Command | Description |
|---------|-------------|
| `init_git_repo` | Initialize a local repo, add default `.gitignore`, and create the unsigned setup commit |
| `git_commit` | Stage all + commit |
| `git_pull` | Pull from remote |
| `git_push` | Push to remote |
| `git_remote_status` | Get branch name + ahead/behind counts |
| `git_add_remote` | Connect a local-only vault to a compatible remote and start tracking it |
| `git_resolve_conflict` | Resolve a merge conflict |
| `git_commit_conflict_resolution` | Commit conflict resolution |
| `get_file_history` | Last N commits for a file |
| `get_modified_files` | `git status` filtered to .md |
| `get_file_diff` | Unified diff for a file |
| `get_file_diff_at_commit` | Diff at a specific commit |
| `get_conflict_files` | List conflicted files |
| `get_conflict_mode` | Get conflict resolution mode |
| `get_vault_pulse` | Git activity feed (paginated) |
| `get_last_commit_info` | Latest commit metadata |
| `clone_repo` | Clone a remote repository into a local folder using system git |

### Search

| Command | Description |
|---------|-------------|
| `search_vault` | Keyword search across vault files |

### Vault Maintenance

| Command | Description |
|---------|-------------|
| `get_vault_settings` | Read `.laputa/settings.json` |
| `save_vault_settings` | Write vault settings |
| `repair_vault` | Flatten vault structure, migrate legacy frontmatter, restore root config/type defaults including `note.md` |

### AI & MCP

| Command | Description |
|---------|-------------|
| `stream_claude_chat` | Claude CLI chat mode (streaming) |
| `check_claude_cli` | Check if Claude CLI is available |
| `get_ai_agents_status` | Check Claude Code + Codex + OpenCode + Pi + Gemini availability |
| `stream_ai_agent` | Stream Claude Code, Codex, OpenCode, Pi, or Gemini through the normalized agent event layer |
| `register_mcp_tools` | Register MCP in Claude/Gemini/Cursor/generic config for the active vault |
| `remove_mcp_tools` | Remove Tolaria's MCP entry from Claude/Gemini/Cursor/generic config |
| `check_mcp_status` | Check whether the active vault is explicitly registered in Claude/Gemini/Cursor/generic config |
| `get_mcp_config_snippet` | Return the exact manual MCP JSON snippet for the active vault |
| `copy_text_to_clipboard` | Copy setup snippets through the native desktop clipboard command path |
| `read_text_from_clipboard` | Read current desktop clipboard text for command-driven plain-text paste |
| `sync_mcp_bridge_vault` | Sync the desktop WebSocket bridge process to the selected vault, or stop it when no vault is selected |

The desktop MCP WebSocket bridge is intentionally local-only. `mcp-server/ws-bridge.js` binds both bridge ports to loopback, rejects non-loopback clients, accepts browser/Tauri origins only on the UI bridge, and rejects browser-origin requests on the tool bridge so remote pages cannot drive vault tools directly.

### Settings & Config

| Command | Description |
|---------|-------------|
| `get_settings` | Load app settings |
| `save_settings` | Save app settings |
| `load_vault_list` | Load vault list |
| `save_vault_list` | Save vault list |
| `get_vault_config` | Load per-vault UI config |
| `save_vault_config` | Save per-vault UI config |
| `get_default_vault_path` | Get default vault path |
| `get_build_number` | Get app build number |
| `save_image` | Save base64 image to `attachments/` and ensure the vault root is in the runtime asset scope |
| `copy_image_to_vault` | Copy image file to `attachments/` and ensure the vault root is in the runtime asset scope |
| `update_menu_state` | Update native menu checkmarks and enabled/disabled state for selection-dependent actions |
| `trigger_menu_command` | Emit a native menu command ID for deterministic shortcut QA |
| `update_current_window_min_size` | Update the active Tauri window's minimum size and optionally grow it to fit restored panes |

`get_build_number` feeds the bottom status bar label. It preserves legacy `bNNN` date-build labels, renders local `0.1.0` / `0.0.0` builds as `dev`, formats calendar alpha builds as `Alpha YYYY.M.D.N`, strips any calendar `-stable.N` suffix back to `YYYY.M.D`, and keeps legacy semver releases readable instead of falling back to `?`.

## Mock Layer

When running outside Tauri (browser at `localhost:5173`), `src/mock-tauri.ts` provides a transparent mock layer:

```typescript
if (isTauri()) {
  result = await invoke<T>('command_name', { args })
} else {
  result = await mockInvoke<T>('command_name', { args })
}
```

The mock layer includes sample entries across all entity types, full markdown content with realistic frontmatter, mock git history, mock AI responses, and mock pulse commits. It also tracks per-vault remote state so browser-mode Getting Started and empty-vault flows now behave like the desktop app: local-only until `git_add_remote` succeeds.

Browser smoke tests can also override `window.__mockHandlers` before the app boots. The AutoGit smoke bridge uses that path directly for seeded saves so the mocked git dirty-state stays synchronized even when the optional browser vault API is serving note content.

## State Management

No Redux or global context. State lives in the root `App.tsx` and custom hooks:

| State owner | State | Purpose |
|-------------|-------|---------|
| `App.tsx` | `selection`, panel widths, dialog visibility, toast, view mode | UI state |
| `useVaultLoader` | `entries`, `allContent`, `modifiedFiles` | Vault data |
| `useNoteActions` | `tabs`, `activeTabPath` | Composes `useNoteCreation` + `useNoteRename` + `frontmatterOps` |
| `useNoteCreation` | — | Note/type creation with optimistic persistence |
| `useNoteRename` | — | Note renaming and folder moves with wikilink update |
| `useNoteRetargeting` | — | Shared note retargeting logic for drag/drop and command-palette actions |
| `useTauriDragDropEvent` | — | Shared native window drag/drop event subscription and cleanup |
| `useNativePathDrop` | — | Tauri-native file/folder path drops for AI and command text inputs |
| `frontmatterOps` | — (pure functions) | Frontmatter CRUD: key→VaultEntry mapping, mock/Tauri dispatch |
| `useTabManagement` | Navigation history, note switching | Note navigation lifecycle |
| `useVaultSwitcher` | `vaultPath`, `extraVaults` | Vault switching |
| `useTheme` | Editor theme CSS vars and theme-mode bridge | Editor typography and app theme runtime |
| `useCliAiAgent` | `messages`, `status`, tool actions | Selected AI agent conversation backed by the shared session pipeline and vault permission mode |
| `useAutoSync` | Sync interval, pull/push state | Git auto-sync |
| `useAutoGit` | Last activity timestamp, idle/inactive checkpoint triggers | Automatic commit/push checkpoints |
| `useCommitFlow` | Commit dialog state, shared manual/automatic checkpoint runner | Git commit/push orchestration |
| `useGitRemoteStatus` | `remoteStatus`, `refreshRemoteStatus()` | On-demand remote detection for commit UI |
| `useUnifiedSearch` | Query, results, loading state | Keyword search |
| `useSettings` | App settings (telemetry, release channel, theme mode, UI language, auto-sync interval, AutoGit thresholds, default AI agent, Gitignored-content visibility, All Notes file visibility) | Persistent settings |
| `useVaultConfig` | Per-vault UI preferences, AI permission mode | Vault-specific config |
| `appCommandDispatcher` | Manifest-backed shortcut/menu command IDs | Shared execution path for renderer and native menu commands |

Data flows unidirectionally: `App` passes data and callbacks as props to child components. No child-to-child communication — everything goes through `App`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| Cmd+P / Cmd+O | Open quick open palette |
| Cmd+N | Create new note |
| Cmd+S | Save current note |
| Cmd+F | Find in current note when the editor is focused; otherwise note-list search can claim it |
| Cmd+Shift+F | Find in vault |
| Cmd+Shift+V | Paste without Formatting into the active supported editing surface |
| Cmd+[ / Cmd+] | Navigate back / forward (replaces tabs) |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo |
| Cmd+1–9 | Switch to tab N |
| Cmd+[ / Cmd+] | Navigate back / forward |
| `[[` in editor | Open wikilink suggestion menu |

Selection-dependent actions are wired through the command palette and the native menus. For example, a deleted file opened from Changes view becomes a read-only diff preview, and that state enables the "Restore Deleted Note" menu/command while normal note mutation actions stay disabled. Folder selection follows the same pattern: when `selection.kind === 'folder'`, the command palette exposes "Reveal Folder in Finder", "Copy Folder Path", "Rename Folder", and "Delete Folder", and the sidebar row can launch the same flows directly through inline rename or the folder context menu. Active files also expose "Reveal in Finder" and "Copy File Path" through the command palette; non-Markdown file tabs additionally expose "Open in Default App", matching the `FilePreview` header controls. Active notes now follow the same shared-action model for retargeting: Cmd+K can open "Change Note Type…" and "Move Note to Folder…", and the sidebar drop targets call the same hook-backed implementations instead of maintaining separate mutation paths.

Shortcut routing is explicit:

- `src/shared/appCommandManifest.json` is the shared command/menu metadata source for command IDs, menu labels, accelerators, native-menu enablement groups, and deterministic QA flags
- `appCommandCatalog.ts` derives renderer command IDs, shortcut lookup maps, Linux menu sections, and QA metadata from that manifest
- `formatShortcutDisplay()` derives platform-accurate visible shortcut labels (`⌘` on macOS, `Ctrl` on Windows/Linux) from that same manifest so menus, tooltips, and command-palette copy stay aligned with real accelerators
- `useAppKeyboard` is the primary execution path for real shortcut keypresses, including Tauri runs
- macOS browser-reserved chords such as `Cmd+O`, `Cmd+F`, and `Cmd+Shift+L` are unblocked at webview init via `tauri-plugin-prevent-default`, then continue through the same renderer-first command path
- `Cmd+Shift+V` uses the same command path for "Paste without Formatting"; `plainTextPaste.ts` reads text through the native clipboard command in Tauri and inserts it through the active rich/raw editor target or the focused browser text control
- `Cmd+F` is surface-aware: editor focus opens current-note find/replace in raw CodeMirror, note-list focus preserves note-list search, and native menu enablement follows focus availability events so only one `Cmd+F` menu item is active
- `menu.rs`, `useMenuEvents`, and Linux's `LinuxMenuButton` emit the same manifest-derived command IDs for native menu clicks, accelerators, and custom titlebar menu actions; on Windows, `menu.rs` also listens to main-window menu events because Tauri attaches the native menu to the `WebviewWindow`
- `appCommandDispatcher.ts` suppresses the paired native-menu/renderer echo from a single shortcut so the command runs once
- Deterministic QA uses two explicit proof paths from the shared manifest:
  - renderer shortcut-event proof through `window.__laputaTest.triggerShortcutCommand()`
  - native menu-command proof through `trigger_menu_command`
- The browser harness is only a deterministic desktop command bridge; exact native accelerator delivery still requires real Tauri QA for commands flagged as manual-native-critical

## Auto-Release & In-App Updates

### Release Pipeline

Every push to `main` triggers `.github/workflows/release.yml`:

```
push to main
  → version job: compute calendar alpha version YYYY.M.D-alpha.N
    and a GitHub-sorted tag alpha-vYYYY.M.D-alpha.NNNN
      → use today's UTC date unless the latest stable-vYYYY.M.D tag already uses today
      → if stable already uses today, advance alpha to the next calendar day so semver still increases
  → build job:
      → pnpm install, stamp version, pnpm build, tauri build --target aarch64-apple-darwin --bundles app
      → pnpm install, stamp version, pnpm build, tauri build --target x86_64-apple-darwin --bundles app
      → upload signed Apple Silicon and Intel .app.tar.gz + .sig updater artifacts named Tolaria_<version>_macOS_Silicon and Tolaria_<version>_macOS_Intel
  → build-windows job:
      → pnpm install, stamp version, tauri build --target x86_64-pc-windows-msvc --bundles nsis
      → upload NSIS installer, optional MSI artifacts, and signed Windows updater bundles
  → release job:
      → generate alpha-latest.json with darwin-aarch64, darwin-x86_64, Linux, and Windows updater URLs
      → publish GitHub prerelease alpha-vYYYY.M.D-alpha.NNNN named Tolaria Alpha YYYY.M.D.N
  → pages job:
      → build static HTML release history page
      → publish alpha/latest.json
      → refresh latest.json + latest-canary.json as compatibility aliases to alpha
      → preserve stable/latest.json
      → deploy to gh-pages
```

Stable promotions trigger `.github/workflows/release-stable.yml`:

```
push stable-vYYYY.M.D tag
  → version job: validate YYYY.M.D from the tag
  → build job:
      → pnpm install, stamp version, pnpm build, tauri build --target aarch64-apple-darwin
      → pnpm install, stamp version, pnpm build, tauri build --target x86_64-apple-darwin
      → upload signed Apple Silicon and Intel .app.tar.gz + .sig and .dmg artifacts named Tolaria_<version>_macOS_Silicon and Tolaria_<version>_macOS_Intel
  → build-linux job:
      → pnpm install, stamp version, tauri build --target x86_64-unknown-linux-gnu --bundles deb,appimage
      → upload .deb, .AppImage, and signed Linux updater bundles
  → build-windows job:
      → pnpm install, stamp version, tauri build --target x86_64-pc-windows-msvc --bundles nsis
      → upload NSIS installer, optional MSI artifacts, and signed Windows updater bundles
  → release job:
      → generate stable-latest.json with macOS Apple Silicon, macOS Intel, Linux, and Windows updater URLs plus platform-specific manual download URLs
      → publish GitHub release Tolaria YYYY.M.D
  → pages job:
      → publish stable/latest.json
      → publish stable/download/ and download/ as permanent redirect URLs for the latest stable platform installer
      → preserve alpha/latest.json
      → deploy to gh-pages
```

### Versioning

- Stable promotions use git tags in the form `stable-vYYYY.M.D` and stamp the technical version `YYYY.M.D`.
- Alpha builds stamp the technical version `YYYY.M.D-alpha.N` and display it as `Alpha YYYY.M.D.N`. The GitHub release tag zero-pads the sequence as `alpha-vYYYY.M.D-alpha.NNNN` so GitHub release ordering remains chronological.
- If the latest stable tag already uses today's date, alpha advances to the next calendar day before assigning `-alpha.N` so Alpha remains semver-newer than Stable across channel switches.
- The workflows stamp the computed version into `tauri.conf.json` and `Cargo.toml` at build time.
- This keeps display strings clean while preserving semver monotonicity when a user switches between Stable and Alpha.

### In-App Updates

```
App startup (3s delay)
  → useUpdater.check()
    → idle (no update) → no UI
    → available → UpdateBanner with release notes + "Update Now"
      → downloading → progress bar
        → ready → "Restart to apply" + Restart Now
    → network error → fail silently
```

### Telemetry (Opt-in)

Anonymous crash reporting (Sentry) and usage analytics (PostHog), both **opt-in only**.

```mermaid
sequenceDiagram
    participant User
    participant App
    participant Settings
    participant Sentry
    participant PostHog

    Note over App: First launch or upgrade
    App->>User: TelemetryConsentDialog
    alt Accept
        User->>Settings: telemetry_consent=true, anonymous_id=UUID
        Settings->>Sentry: init(DSN, release, anonymous_id)
        Settings->>PostHog: init(key, anonymous_id)
    else Decline
        User->>Settings: telemetry_consent=false
        Note over Sentry,PostHog: Zero network requests
    end

    Note over App: Settings panel toggle change
    User->>Settings: crash_reporting_enabled=false
    Settings->>Sentry: teardown()
    Settings->>App: reinit_telemetry (Tauri cmd)
```

**Privacy guarantees:**
- No vault content, note titles, or file paths in payloads (regex scrubber in `beforeSend`)
- `anonymous_id` is a locally-generated UUID, never tied to identity
- `send_default_pii: false` on both SDKs
- PostHog: `autocapture: false`, `persistence: 'memory'`, no cookies
- Product events use categorical metadata only: file preview kind/action, AI agent id/permission mode/counts/status, and All Notes visibility category/enabled state.

**Architecture:**
- **Rust:** `sentry` crate initialized in `lib.rs::setup()` via `telemetry::init_sentry_from_settings()`
- **JS:** `@sentry/react` + `posthog-js` initialized lazily by `useTelemetry` hook; the React root also wires `onCaughtError`, `onUncaughtError`, and `onRecoverableError` through `Sentry.reactErrorHandler()` so production React invariants include component stack context when crash reporting is enabled.
- **Release grouping:** packaged release workflows pass `VITE_SENTRY_RELEASE` from the computed build version, but the app only assigns Sentry's `release` field for stable calendar builds (`YYYY.M.D`). Alpha/prerelease/internal builds omit `release` so they do not create normal Sentry Releases entries, while both frontend and Rust Sentry scopes tag `tolaria.build_version` and `tolaria.release_kind` for diagnostics.
- **Settings:** `telemetry_consent`, `crash_reporting_enabled`, `analytics_enabled`, `anonymous_id` in `Settings` struct
- **Consent:** `TelemetryConsentDialog` shown when `telemetry_consent === null`

### Updates

Tolaria uses the Tauri updater plugin for automatic updates:

- `src-tauri/tauri.conf.json` points the default desktop feed at `stable/latest.json`
- `useUpdater(releaseChannel)` waits 3 seconds after launch, then calls Rust commands instead of hard-coding one updater endpoint in the frontend
- `src-tauri/src/app_updater.rs` maps the selected channel to `alpha/latest.json` or `stable/latest.json`
- `download_and_install_app_update` streams progress events back into `UpdateBanner`

### Feature Flags (PostHog + Release Channels)

Feature flags are backed by PostHog and evaluated per release channel:

- **Alpha**: all features always enabled (no PostHog lookup)
- **Stable** (default): PostHog rules decide which features are enabled
- **Beta cohorts**: modeled in PostHog as tags or person-property targeting, not as a separate updater build or Settings option

```typescript
import { useFeatureFlag } from './hooks/useFeatureFlag'

const enabled = useFeatureFlag('example_flag') // boolean
```

**Resolution order:**
1. `localStorage` override: key `ff_<name>` with value `"true"` or `"false"`
2. `isFeatureEnabled(flag)` in `telemetry.ts` → Alpha short-circuit, then PostHog, then hardcoded defaults

**How to add a new flag:**
1. Add the flag name to the `FeatureFlagName` union type in `src/hooks/useFeatureFlag.ts`
2. Create the flag on PostHog with Stable rollout rules and any optional beta-cohort targeting
3. Use `useFeatureFlag('your_flag')` in components

Release channel is selectable in Settings as `alpha` or `stable` and passed to PostHog as a person property via `identify()`. Beta targeting is managed in PostHog, not in the updater settings. See ADR-0057.

## Platform Support — iOS / iPadOS (Prototype)

Tauri v2 supports iOS as a beta target. The Rust backend cross-compiles to `aarch64-apple-ios-sim` (simulator) and `aarch64-apple-ios` (device) with zero code changes to vault/frontmatter/search logic.

**Conditional compilation strategy:**

```
#[cfg(desktop)]  — git CLI, menu bar, MCP server, CLI AI agents, updater
#[cfg(mobile)]   — stub commands returning graceful errors or empty results
```

Desktop-only modules gated at the crate level:
- `pub mod menu` — macOS menu bar (entire module)

Desktop-only features gated at the function level in `commands/`:
- Git operations (commit, pull, push, status, history, diff, conflicts)
- Clone-by-URL via system git (`clone_repo`)
- CLI AI agent streaming (Claude, Codex, OpenCode, Pi, Gemini)
- MCP registration and status
- Menu state updates

Features that work on both platforms without changes:
- Vault scan, note read/write, rename, delete, archive
- Frontmatter read/write/delete
- AI chat (Anthropic API via `reqwest`)
- Search (pure Rust in-memory)
- Settings persistence
- Vault list management

**Capabilities:** `src-tauri/capabilities/default.json` targets desktop; `mobile.json` targets iOS/Android with a minimal permission set.

**Detailed feasibility report:** `docs/IPAD-PROTOTYPE.md`
