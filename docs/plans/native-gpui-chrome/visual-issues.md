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
