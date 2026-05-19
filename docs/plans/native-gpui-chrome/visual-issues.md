# Visual-fidelity issue catalog

Per-issue notes captured during the Phase 7 redo QA pass.  Each entry
pairs a user-supplied UI crop (saved under
[`live-snapshots/`](live-snapshots/)) with a short description of what
is wrong, what the intended behaviour / appearance is, and the
implementation status.

## Workflow

1. User pastes a UI crop + description into the conversation.
2. The crop is saved as
   `live-snapshots/issue-NNN.png` (zero-padded incrementing index).
3. A new section is appended to this file with:
   - Image link
   - Reporter description
   - Hypothesised root cause
   - Status (`open` / `in-progress` / `fixed in <sha>`)

Issues are appended in arrival order, not severity order; reorder by
re-reading this file before fix passes.

## Open issues

### 001 — Sidebar selection treatment uses deep-blue flood instead of pale-blue + accent text

| Current | Reference |
|---------|-----------|
| [issue-001-current.png](live-snapshots/issue-001-current.png) | [issue-001-reference.png](live-snapshots/issue-001-reference.png) |

**Reporter:** "The selection background is incorrect.  The item
background is light blue.  Icon is coloured.  The number pill has
dark-blue background."

**Diagnosis** — the redo painted the selected row with
`theme.primary` (deep `#155DFF` blue) and `theme.primary_foreground`
(white) text.  The reference uses the *subtle* highlight instead:

- Row bg: `theme.list_active` (= `--state-selected` `#E8F4FE`).
- Row text + icon: `theme.primary` (= `--accent-blue` `#155DFF`).
- Count pill bg: `theme.primary`; pill text: `theme.primary_foreground`.

I.e. the colour pair we used for the row fill *belongs on the pill*,
and the row fill should be the pale `list_active` tone.  Fix touches
`Palette` in `crates/sidebar_panel/src/lib.rs` plus the `count_pill`
selected branch.

**Status:** fixed.  Verified in
[after-001-002-light.png](live-snapshots/after-001-002-light.png) —
Inbox row paints pale-blue with blue text/icon and the count chip is
inverted (dark-blue bg, white text).

### 002 — FOLDERS section: deep indent, wrong root icon, missing section caret

| Current | Reference |
|---------|-----------|
| [issue-002-current.png](live-snapshots/issue-002-current.png) | [issue-002-reference.png](live-snapshots/issue-002-reference.png) |

**Reporter:** "Folders list is misaligned.  The first-level icon is
wrong.  Selection background is incorrect."

**Diagnosis** — three independent problems:

1. **Deep indent.**  `Vault::Note::path` carries the *absolute* on-disk
   path (`/Users/konstantin/tolaria/demo-vault-v2/area-building.md`).
   `SidebarPanel::build_from_samples` records `parent.to_string_lossy()`
   verbatim, then derives `depth` by counting `/` in the absolute
   string — yielding depth 5 for the vault root.  Need to strip the
   vault-root prefix before storing the folder, so the root sits at
   depth 0 and children at depth 1.
2. **Wrong root icon.**  Current renderer draws
   `ChevronDown + FolderClosed` on the root row.  Reference: the
   chevron belongs to the `FOLDERS` section header (collapse toggle
   for the whole group), not the row.  Root row gets just the closed-
   folder glyph.
3. **Selection background.**  Same root cause as #001 — the
   `attachments` row in the reference is pale-blue + accent-blue text;
   ours flooded with primary.  Already addressed in #001.

**Status:** fixed.  Verified in
[after-001-002-light.png](live-snapshots/after-001-002-light.png) —
`demo-vault-v2` sits at depth 0 (flush left), `type` at depth 1, and
the FOLDERS section header carries the chevron-down on the left.
Outstanding polish: thin vertical connector line under nested
folders, deferred until a real folder dataset surfaces in Phase 9.

### 003 — TYPES rows ignore each type's frontmatter icon / colour / label

| Current | Reference |
|---------|-----------|
| [issue-003-current.png](live-snapshots/issue-003-current.png) | [issue-003-reference.png](live-snapshots/issue-003-reference.png) |

**Reporter:** "The note type icon / accent is defined by frontmatter
e.g. `type: Type, icon: calendar, color: orange, sidebar label:
Events`.  The selection background is light accent of note-type
colour."

**Diagnosis** — every type document under `demo-vault-v2/type/`
carries the visual contract for its row:

| File | icon | color | sidebar label |
|------|------|-------|---------------|
| `area.md` | folders | amber | Areas |
| `event.md` | calendar | orange | Events |
| `measure.md` | chart-line-up | cyan | Measures |
| `note.md` | note | slate | Notes |
| `person.md` | user | rose | People |
| `project.md` | rocket | blue | Projects |
| `quarter.md` | clock-countdown | emerald | Quarters |
| `responsibility.md` | (read for shape) | … | Responsibilities |
| `topic.md` | books | indigo | Topics |

The current renderer hard-codes a colour-dot palette from the type
display name (`type_color` fn).  Need to:

1. Load each `type/*.md` file from the vault.
2. Parse YAML frontmatter to extract `icon`, `color`,
   `sidebar label`.
3. Replace the colour-dot with a Phosphor-style icon in the type's
   colour.
4. When a TYPES row is selected, paint the row bg with a *light tint*
   of the type's colour (orange → orange-light), text + icon in the
   type's full colour, count chip filled with the type's colour and
   white text.

Icon-name mapping is best-effort: `gpui-component-assets` exposes
`calendar`, `chart-pie`, `book-open`, `file`, `folder`, `rocket`-like
glyphs at the closest match; missing icons fall back to `file`.

**Status:** fixed.  `load_type_styles` scans `<root>/type/*.md`,
`parse_frontmatter` lifts `icon` / `color` / `sidebar label`,
`icon_for_frontmatter_name` and `color_for_frontmatter_name` map the
tokens to `IconName::*` and 24-bit hex.  Each TYPES row builds with
`palette_tinted_with(type.color)` so selection paints the row bg
with the type's light tint and the count pill with its full colour
(white text).  Verified in
[after-003-events-selected.png](live-snapshots/after-003-events-selected.png) —
clicking the Measures row paints a cyan accent on the row + cyan
count pill.

### 004 — Sidebar / note-list rows hover with a light-green tint

| Current |
|---------|
| [issue-004-current.png](live-snapshots/issue-004-current.png) |

**Reporter:** "Sidebar items and note list items have light-green
hover background."

**Diagnosis** — `Palette` provides no explicit hover state for rows,
so the cursor-pointer style appears to surface a default macOS
highlight tint that reads as greenish on the warm sidebar palette.
Need to attach `.hover(|this| this.bg(theme.list_hover))` to every
clickable row so the hover paint is the neutral
`--state-hover-subtle` (`#F0F0EF`) rather than the OS default.

**Status:** fixed.  `Palette::hover_bg` exposes `theme.list_hover`
(`#F0F0EF`); every unselected row in `build_row` /
`sidebar_folder_row` paints it via
`.hover(|this| this.bg(hover_bg))`.  Selected rows skip the
hover paint so the selection fill stays stable.

### 005 — Title-bar strip is cramped against the top edge

| Current |
|---------|
| [issue-005-current.png](live-snapshots/issue-005-current.png) |

**Reporter:** "The title area is a bit cramped.  Make sure there is
the same padding from the top edge of the window as from the bottom
of the title elements."

**Diagnosis** — `NATIVE_TITLE_BAR_HEIGHT_PT = 28.0` and the action
cells are 20-pt tall, leaving 4 pt above and below.  macOS places
the traffic lights at `(7, 6)` with a 12-pt diameter so their
visible top edge starts at 6 pt and bottom at 18 pt — fine in
isolation, but combined with the small surrounding strip the cluster
reads as glued to the window edge.  Bumping the strip's height to
38 pt gives 9 pt top / 9 pt bottom around the cells and lets the
traffic lights breathe symmetrically.

**Status:** fixed.  `NATIVE_TITLE_BAR_HEIGHT_PT` bumped from `28.0`
to `38.0`; the change cascades into the
`ui::tree_dump::set_window_y_offset` initialisation in `main.rs` so
periscope's click coordinates stay aligned with the new strip
height.  Verified in
[after-005-title-bar.png](live-snapshots/after-005-title-bar.png).

### 006 — VIEWS / TYPES section headers missing collapse caret

| Current |
|---------|
| [issue-006-current.png](live-snapshots/issue-006-current.png) |

**Reporter:** "Types and Views section should have collapsible
arrows.  Similar to the folders section."

**Diagnosis** — FOLDERS already renders a chevron-down to the left
of its label (issue 002).  VIEWS and TYPES used the base
`section_header(...)` builder which only emits a label and trailing
actions; switching them to `section_header_with_leading(...)` with a
`ChevronDown` glyph in the leading slot makes the collapse
affordance uniform across all three groups.

**Status:** open.
