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

**Status:** fixed.  Both VIEWS and TYPES headers now call
`section_header_with_leading(...)` with a chevron-down leading
glyph (`sidebar-views-caret`, `sidebar-types-caret`).  Verified in
[after-006-section-carets.png](live-snapshots/after-006-section-carets.png).

### 007 — Traffic lights glued to the top of the title-bar strip

| Current |
|---------|
| [issue-007-current.png](live-snapshots/issue-007-current.png) |

**Reporter:** "The title bar system icons are misaligned.  Those
should be vertically centered over the title bar."

**Diagnosis** — macOS places the traffic lights at `(7, 6)` by
default.  After issue 005 bumped the strip to 38 pt the buttons
ended up flush against the top edge instead of centred.
`TitlebarOptions::traffic_light_position` accepts a custom point;
shifting the buttons down by `(height - 12) / 2 ≈ 13 pt` centres
the 12-pt-diameter buttons vertically on the new strip.

**Status:** superseded by issue 008.  `traffic_light_position`
only relocates the buttons *inside* the system titlebar region
(~28 pt regardless of `appears_transparent`), so the lights stayed
near the top of our 38-pt custom strip.  The follow-up fix moves
the action cluster up to match the lights instead.

### 008 — Title-bar action cluster still misaligned with traffic lights

| Current |
|---------|
| [issue-008-current.png](live-snapshots/issue-008-current.png) |

**Reporter:** "Is not properly vertically centred."

**Diagnosis** — macOS pins the traffic lights inside the system
titlebar region (~28 pt) regardless of `appears_transparent`, so
`TitlebarOptions::traffic_light_position` cannot push them into our
taller 38-pt custom strip.  Instead, anchor the action clusters to
the top of the strip with a 2-pt inset so the 16-pt Phosphor glyphs
share their vertical centre with the 12-pt traffic-light buttons
(both at y ≈ 12).  The bottom of the strip retains its visual
padding via the unchanged 38-pt height.

**Status:** superseded by issue 009.  Aligning the action cluster
with the traffic lights left a tall empty band below the cluster
and the user preferred the cluster centred within the strip.

### 009 — Title-bar action items not vertically centred in the strip

| Current |
|---------|
| [issue-009-current.png](live-snapshots/issue-009-current.png) |

**Reporter:** "Traffic lights are positioned correctly.  But title
bar items are not centred vertically."

**Diagnosis** — issue 008 top-anchored the action cluster to share
the traffic-light baseline, which left a noticeable empty band
below the icons.  Revert to `items_center` so the cluster sits in
the middle of the 38-pt strip; traffic lights remain at their OS-
default top position.

**Status:** fixed.  `title_bar` swaps `items_start` →
`items_center` and drops the `pt(2.0)` inset.  Verified in
[after-009-cluster-centered.png](live-snapshots/after-009-cluster-centered.png).

### 010 — Note-list row treatment misses type accent, layout, and dates

| Current | Reference |
|---------|-----------|
| [issue-010-current.png](live-snapshots/issue-010-current.png) | [issue-010-reference.png](live-snapshots/issue-010-reference.png) |

**Reporter:** "The note highlight needs to use the note type accent
colour similar to the sidebar.  The top-right corner has the note
type icon.  The title is bold text.  The description should be
wrapped, but have at most 2 lines.  Ellipsis if the description is
longer than two lines.  Last row with dates should use a smaller
font size.  Created date should be right-aligned."

**Diagnosis** — six independent gaps in `crates/note_list_pane`:

1. Each `NoteEntry` carries no type metadata; the renderer can't
   tint the row or pick a type icon.
2. Title is `font_medium`; reference uses `font_semibold` / bolder
   text.
3. Snippet is single-line truncated at 120 chars; reference wraps
   to two visual lines with an ellipsis.
4. Metadata `MMM D, YYYY · Created MMM D, YYYY` is one centred
   string; reference splits modified (left) / created (right) with
   `justify_between`, and shrinks the type slightly.
5. Selected row paints `theme.list_active` (pale blue); reference
   tints with the row's type accent colour.
6. Top-right per-row icon is currently a placeholder `File`
   glyph; reference draws the type's own icon in its accent
   colour.

**Status:** fixed.  `NoteEntry` now carries `type_icon: IconName` and
`type_color: Hsla`; `from_vault` walks `<root>/type/*.md` once via
`load_note_type_styles`, then looks each note up by filename-stem
prefix (`event-team-sync.md` → `event` → calendar / orange).  Render
changes: title `font_semibold`, snippet wrapped to two lines with
`line_clamp(2)` + 1.4 line-height, metadata row splits modified
(left) / created (right) with `justify_between`, selected-row bg
paints `light_tint(type_color, 0.14)`, top-right corner draws the
type's own icon in its full accent colour.  Verified in
[after-010-note-row-redesign.png](live-snapshots/after-010-note-row-redesign.png).

### 011 — Note row: oversized padding, Unicode ellipsis, icon-clipped snippet width, missing left accent bar

| Current | Reference |
|---------|-----------|
| [issue-011-current.png](live-snapshots/issue-011-current.png) | [issue-011-reference.png](live-snapshots/issue-011-reference.png) |

**Reporter:** "Decrease note text padding to match original React.
Trimmed description needs to end with `...`.  Text box should span to
the right edge minus padding (not to the icon edge).  The type icon
should be smaller.  The selected item should render a left border in
the note-type colour."

**Diagnosis** — five independent regressions on top of the issue 010
shape:

1. Row padding `px(16) / py(14)` is too generous; the React
   `NoteListItem` uses ~12 / 10 and the reference shows a tighter
   card stack.
2. `extract_snippet` appends a Unicode `…` glyph; the React build
   uses three ASCII dots.
3. The trailing type icon sits as a sibling of the content column,
   so the snippet / metadata wrap to **content width minus icon
   width** even on lines that never collide with the icon — the
   reference flows the snippet to the row's right edge and only the
   title row sacrifices width for the icon.
4. The type icon container is 20 × 20 pt; reference renders ~14 pt.
5. Selected rows highlight with a light tint only — no left accent
   strip in the type's colour.  GPUI's `Styled` exposes a single
   per-element `border_color`, so the accent has to render as a
   leading flex-sibling rather than a CSS-style `border-left-color`.

**Status:** fixed.  `extract_snippet` now appends `...`; the type
icon moves inside the title row (so snippet / metadata get the full
content width); icon container shrinks to 14 × 14 pt; row padding
drops to `px(12) / py(10)`; selected rows render a 2-pt leading
accent strip in `type_color` via an outer `items_stretch` h_flex.
The truncation test asserts `chars().count() == 123` (120 graphemes
+ 3 dots) and `ends_with("...")`.  Verified in
[after-011-row-layout.png](live-snapshots/after-011-row-layout.png) —
selected Sponsorship MRR row shows the cyan accent bar + tinted bg,
icons are visible at the title-row right edge, and `Created May 3,
2026` is no longer clipped.

### 012 — Snippet hard-truncates at 120 chars instead of native word-boundary wrap; horizontal padding too generous

**Reporter:** "The note text snippet should NOT rely on
`SNIPPET_MAX_CHARS`.  The text should be trimmed to the closest word
boundary that fits the two-line box.  The note list width is
resizable.  Investigate how Zed does that." …followed by: "The note
list items' horizontal text padding needs to be reduced in half.
Check React component layout values."

**Diagnosis** — two regressions on top of issue 011:

1. `extract_snippet` cuts at 120 graphemes then appends a literal
   `...` (issue 011's MVP).  That ignores the resizable column
   width — a wide column wastes vertical space (text fits on one
   line then ends mid-word with `...`), and a narrow column still
   shows two visible lines but with redundant trailing dots.  Zed's
   `gpui/examples/text_wrapper.rs:73-94` is the canonical multi-line
   wrap+ellipsis pattern: pair `.line_clamp(n)` with
   `.overflow_hidden().text_overflow(TextOverflow::Truncate("...".into()))`
   so the layout engine picks the word-boundary cut at paint time.
   `gpui/src/styled.rs:131-145` confirms the API:
   `truncate()` = single-line, `line_clamp(n)` + `text_overflow(...)`
   = multi-line.
2. After the `px(12)` row padding from issue 011 the content still
   reads as over-padded against the React reference
   (`src/components/NoteItem.tsx:334` uses `'14px 16px'` but the
   chrome target sits visually tighter than that).

**Status:** fixed.

- `extract_snippet` returns the first non-empty, non-heading line
  verbatim (modulo a `SNIPPET_SOFT_MAX_CHARS = 2000` guard against
  pathological mega-lines that would otherwise force GPUI's word-
  wrap pass through every codepoint).  No manual `...` appended.
- The snippet `div` now carries
  `.overflow_hidden().text_overflow(TextOverflow::Truncate("...".into())).line_clamp(2)`
  so GPUI word-wraps to the column width and inserts the ASCII
  ellipsis at the last fitting boundary on overflow.
- Inner row horizontal padding halved: `px(12)` → `px(6)` (vertical
  unchanged at `py(10)`).  Combined with the 2-pt leading accent
  strip the visible text inset is 8 pt from the row's left edge.
- Tests updated: `extract_snippet_truncates_long_lines` replaced
  with `extract_snippet_returns_full_line` (200-char input passes
  through verbatim with no trailing `...`) and
  `extract_snippet_caps_pathological_lines` (input
  > `SNIPPET_SOFT_MAX_CHARS` gets cut at the cap).  22/22 tests
  pass.

Verified in
[after-012-native-wrap-tighter-padding.png](live-snapshots/after-012-native-wrap-tighter-padding.png) —
each visible snippet wraps at a word boundary ("Areas are ongoing
domains of responsibility / with no fixed end date.", "Owns sponsor
outreach and makes the / responsibility/procedure relationships feel
like r…") and the row text starts closer to the left edge.

### 013 — Note row right padding clips trailing icons and date label

**Reporter:** "Update note item right padding to match the left
padding."

**Diagnosis** — the issue 012 `px(6)` row padding is symmetric *inside*
the inner h_flex, but the 2-pt leading accent strip sits *outside*
it.  So the visible insets came out asymmetric: left = 2 + 6 = 8 pt,
right = 6 pt.  The 2-pt deficit on the right clipped the last
character of "Created May 3, 2026" and chopped the trailing 14-pt
type icon on every row.

**Status:** fixed.  Inner row padding split into `pl(6)` / `pr(8)`
so the visible text inset is symmetric 8 / 8 across the row.
Verified in
[after-013-symmetric-padding.png](live-snapshots/after-013-symmetric-padding.png) —
"Created May 3, 2026" renders fully, trailing per-type icons are
flush with the right inset, and the selected Sponsorships row's
green accent strip + tint reads cleanly.
