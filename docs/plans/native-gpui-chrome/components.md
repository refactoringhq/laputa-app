# Per-component spec — visual + behavioural references

Authoritative source for every chrome surface's look and behaviour
during the native-GPUI migration.  Implementations target **minimum
visible delta** against the reference screenshots in **both** light
and dark themes; periscope's screenshot loop
([`e2e-harness.md`](e2e-harness.md)) is the verification.

`roadmap.md` schedules the work, `progress.md` tracks the ledger;
this file is what they both link to for "what should it look like
and how should it behave".

## Visual references

| Theme | File |
|-------|------|
| Light | [`tolaria-demo-vault-v2-light.png`](tolaria-demo-vault-v2-light.png) |
| Dark  | [`tolaria-demo-vault-v2-dark.png`](tolaria-demo-vault-v2-dark.png) |

Both capture the Tauri-era app rendering `demo-vault-v2/`; dark is
reached via the moon-icon theme switcher at the right end of the
status bar.  The legacy single-mode
[`tolaria-demo-vault-v2.png`](tolaria-demo-vault-v2.png) is kept for
backward links; the light/dark pair supersedes it.

To regenerate the references: launch the shipped Tauri build
(`/Applications/Tolaria.app/Contents/MacOS/tolaria`) on
`demo-vault-v2/`, capture with `periscope screenshot --pid <pid>`,
click the moon icon at the bottom-right of the status bar, capture
again.

## React source = behavioural reference

The screenshots lock the **look**; the existing React + TypeScript
components under `src/components/` (the Tauri-era frontend) lock
the **behaviour**: row interactions, hover/active states, count
derivation, keyboard handling, multi-select model, hide/show logic,
expand/collapse, sort/filter rules, copy text, and exact pill /
badge content.  When porting a chrome surface to Rust, **read the
React counterpart first** — including any colocated
`*.test.{ts,tsx}` files, which often double as a behavioural spec.

| Rust crate | React source(s) under `src/components/` |
|------------|-----------------------------------------|
| `sidebar_panel` | `Sidebar.tsx`, `sidebar/*.{tsx,ts}` (sections, group header, view item, type interactions) |
| `note_list_pane` | `NoteList.tsx`, `note-list/*.{tsx,ts}` (header, layout, pinned card, multi-select, filter pills, search) |
| `inspector_panel` | `Inspector.tsx`, `inspector/*.{tsx,ts}` |
| `ai_panel` | `AiPanel.tsx`, `AiPanelChrome.tsx`, `AiMessage.tsx`, `AiActionCard.tsx` |
| `status_bar` | `StatusBar.tsx`, `status-bar/*.{tsx,ts}` (badges, vault menu, AI agents badge) |
| `breadcrumb_bar` | `BreadcrumbBar.tsx`, `BreadcrumbBar.visibility.test.tsx` |
| `note_item` | The BlockNote + CodeMirror carry-overs in `src/components/blockNote*.ts` (the embedded editor body) |
| `command_palette` | `CommandPalette.tsx`, `CommandPaletteAiMode.tsx` |
| `quick_open` | `QuickOpenPalette.tsx` |
| `dialogs` | every `*Dialog.tsx` / `*Modal.tsx` under `src/components/` |
| `banners` | `ArchivedNoteBanner.tsx`, `TrashWarningBanner.tsx`, plus 4 other plan-locked banners |
| `toasts` | `Toast.tsx` |
| `wikilink_inputs` | `Wikilink{Chat,Suggestion,Inline}.tsx` |
| `emoji_picker` | `EmojiPicker.tsx`, `TagsDropdown.tsx` |
| `image_lightbox` | `ImageLightbox.tsx` |
| `startup` | `WelcomeScreen.tsx`, `StartupScreen.tsx` |
| `settings_panel` | `SettingsPanel.tsx` + the 6 section files |
| `diff_view` | `DiffView.tsx` |

When in doubt, sample the pixel off the reference image rather than
improvising.

## Visual anchors locked by the screenshots

- **Window chrome** — native macOS traffic lights flush-left;
  back / forward / new-note triplet immediately right of the
  controls; right-side action cluster (search, star, lock, language,
  …, app switcher).
- **Sidebar (Left Dock)** — three section headers (`VIEWS`, `TYPES`,
  `FOLDERS`) in small-caps muted-foreground.  Inbox / All Notes /
  Archive sit above the first section header.  Each row: 16-px
  colour glyph + label (Inter ~13) + right-aligned count chip in
  muted text.  Selected row paints `accent` background full-width
  with the row text in foreground/accent-fg.
- **Note list (centre column)** — fixed-width column (~280 pt)
  titled `Notes` with sort/filter glyphs on the right.  Each row:
  14-px bold title, 12-px muted snippet (2–3 lines), 11-px muted
  metadata pair (`May X, 2026 · Created May X, 2026`).  Selected
  row paints a pale `accent-light` background.  Some rows carry a
  14-px right-side status glyph (chart, blue circle).
- **Editor (right column)** — title rendered as H1 inside the
  editor body, large weight 600; body 14-px regular; placeholder
  `Enter text or type '/' for commands` in muted-foreground italic.
- **Status bar** — left cluster: workspace name (`demo-vault-v2`)
  with chevron + version (`2026.5.18`).  Right cluster: `Git
  disabled` (warning amber), `MCP` (warning amber), `Claude`
  (warning amber), `Contribute` (megaphone glyph) / `Docs` (book
  glyph) links, **theme switcher** (sun in light mode / moon in
  dark mode), and a trailing **settings** gear icon.  The theme
  switcher is wired (Phase 7.2) — clicking it toggles the chrome
  between the two reference variants.

## Per-crate visual contract

Every crate's exit criterion is "the panel matches its region in
the reference screenshots with the minimum visual delta achievable
in pure GPUI".  When implementation shortcuts the visual
(placeholder styling, missing icons, wrong weights), it must carry
a `TODO(visual-parity)` comment so a periscope diff pass can find
it later.

### `sidebar_panel`

- Implements `workspace::Panel` (position=Left, default_size=240px, starts_open=true).
- Five clusters matching the column in the reference:
  1. **Top-level rows** (no header): `Inbox` (count badge), `All
     Notes` (selected → accent background, count badge), `Archive`.
  2. **`VIEWS`** (small-caps muted header, `+` trailing button):
     saved-view rows — demo set of 1+ with count badge
     (`Active Projects 6`).
  3. **`TYPES`** (header + `+`): one row per distinct
     `NoteKind` / type from MockVault, with a 16-px colour-coded
     leading glyph and a trailing count badge.  Colours come from
     each type's accent-colour token (Areas=violet, Events=teal,
     Measures=blue, …).
  4. **`FOLDERS`** (header + `+`): vault root as a collapsible row
     (`demo-vault-v2` ▾) with nested folder rows (`attachments`,
     `views`).
- Row treatment: 28-px row height, 16-px leading glyph, label
  (Inter 13), right-aligned count chip (12-px muted).  Selected
  row paints `theme.accent` full-width.
- Selecting an item emits an event the workspace can subscribe to.

### `note_list_pane`

- Implements `workspace::Panel` (custom or center).
- Header bar (44 px tall, bottom-border 1 px): title `Notes` left,
  4 trailing glyph buttons (sort, filter, etc.) — match the
  screenshot's middle-column top strip.
- Card-style rows (shipped in `crates/note_list_pane/src/lib.rs`
  per `component/NoteListItem` in `ui-design.pen`).  Visual deltas
  still to close from the screenshot:
  - Metadata line: `May X · Created May X` in 11-px muted text
    below the snippet (currently dropped).
  - Trailing status glyph for note types that carry one (chart
    icon, blue circle).
  - Selected row paints `theme.accent_subtle` (pale-accent bg)
    full width — see the `Q2 2025` row in the reference.
- Filter / bulk action bar wired (in place); visual sweep to match
  toolbar treatment in the screenshot.
- Virtualised list (defer real virtualization — eager render).

### `inspector_panel`

- Implements `workspace::Panel` (position=Right, default_size=320px,
  starts_open=true).
- 7 sub-panels via `gpui_component::Accordion`:
  1. Properties (key/value table from MockNote.properties)
  2. Outline (extracted headings from content)
  3. Backlinks (synthetic — 2-3 fake links)
  4. Instances (count of NoteKind matches)
  5. Referenced-by (inverse of backlinks)
  6. Relationships (synthetic graph)
  7. Git history (last 5 MockCommits)
- Section headers + row treatment mirror sidebar (small-caps muted
  header, 28-px row, count chip on the right).  Reference
  screenshot captures the right dock collapsed — use the
  sidebar's row geometry as the visual contract until a later
  capture exposes it.

### `ai_panel`

- Implements `workspace::Panel` (Right Dock companion — alternate
  visibility with inspector).
- Renders MockAi thread (4 turns) using gpui-component's
  chat-style layout.
- Send-message input at bottom; on enter, calls
  `MockAi::send_message`.

### `search_panel`

- Implements `workspace::Panel` (position=Bottom,
  default_size=200px, starts_open=false — toggle via action).
- Search input + result list with snippet excerpts from
  MockSearch.
- Result rows reuse `note_list_pane`'s card geometry (title /
  snippet / metadata) so the visual language stays consistent
  with the reference.

### `settings_panel`

- `ModalView` (matches the React `Dialog`-based pattern).
- Multi-tab settings UI: General, Editor, Git, AI, Vault.
- Each tab reads from MockSettings; Phase 10.12 wires to real
  `settings_store`.

### `diff_view`

- `ModalView` (full-screen).
- Renders MockGit diff (synthetic — two side-by-side text panes).
- Body typography matches the editor's monospace settings so diff
  blocks feel native to the rest of the chrome.

### `status_bar`

Shipped Phase 2b; visual contract from the reference:

- Left cluster: workspace name (`demo-vault-v2`) + chevron,
  version label (`2026.5.18`).
- Right cluster: amber-warning service chips (`Git disabled`,
  `MCP`, `Claude`), then plain links (`Contribute`, `Docs`),
  theme-switcher (sun/moon — wired Phase 7.2), settings gear.
- 30-px tall, 1-px top border, sidebar-palette background.

### Window chrome (`tolaria` binary)

Open work — Phase 7.8.  The custom title-bar strip seen in the
reference is a Tolaria-owned NSView region above the workspace.
Native traffic-lights stay on the left; the action triplet
(back / forward / new-note) and the right-side action cluster
(search, star, lock, language, more, profile) sit in this region.
Decisions on icon source, exact spacing, and whether to draw the
strip in GPUI or rely on `TitlebarOptions::traffic_light_position`
are deferred; the screenshot is the target.
