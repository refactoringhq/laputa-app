# Tree-dump element ID naming convention

ADR-0115 Phase 7 / visual-issue #021.

All IDs registered via `.dump_as("…")` follow a `<area>-<region>-<element>-<variant>`
kebab-case scheme (lowercase ASCII, max 4 dash-separated segments).

---

## Convention

### Container vs. leaf

| Kind | Description | Example |
|---|---|---|
| **Container** | A region that groups child elements — used for `screenshot --id` crops and layout debugging. Not necessarily interactive. | `workspace-title-bar`, `sidebar` |
| **Leaf** | One interactive cell — a button, icon, or row. | `title-bar-back`, `status-bar-theme-toggle` |

A single element can be both (e.g. `note-toolbar` is a container, but it is also what you crop for a toolbar screenshot).

### Segment rules

| Segment | Meaning |
|---|---|
| `<area>` | Top-level named surface: `workspace`, `sidebar`, `note-list`, `note-toolbar`, `status-bar`, `title-bar` |
| `<region>` | Sub-surface within the area, e.g. `left-dock`, `center`, `title-bar`, `section-views` |
| `<element>` | Specific interactive cell or subgroup, e.g. `back`, `theme-toggle`, `sort`, `caret` |
| `<variant>` | Disambiguates when two elements in the same region differ only by state or role: `root`, `child` |

### Workspace containers (outermost → innermost)

```
workspace            outer div from TolariaWorkspace::render
workspace-title-bar       TitleBar view outer div
workspace-left-dock       left resizable panel wrapper
workspace-note-list       note-list column panel wrapper
workspace-center          center PaneGroup panel wrapper
workspace-right-dock      right resizable panel wrapper (when visible)
workspace-bottom-dock     bottom dock wrapper
workspace-status-bar      StatusBar view outer div
```

### Sidebar containers + leaves

```
sidebar              SidebarPanel outer div
  sidebar-inbox           Inbox row
  sidebar-all-notes       All Notes row
  sidebar-archive         Archive row
  sidebar-section-views   VIEWS section header+rows container
    sidebar-views-caret   VIEWS collapse caret
    sidebar-views-add     VIEWS add button
    sidebar-view-row      (dynamic) each saved-view row
  sidebar-section-types   TYPES section header+rows container
    sidebar-types-caret   TYPES collapse caret
    sidebar-types-sort    TYPES sort button
    sidebar-types-add     TYPES add button
    sidebar-type-row      (dynamic) each type row
  sidebar-section-folders FOLDERS section header+rows container
    sidebar-folders-caret FOLDERS collapse caret
    sidebar-folders-add   FOLDERS add button
    sidebar-folder   vault folder row
    sidebar-folder-child  nested folder row
```

### Note list containers + leaves

```
note-list            NoteListPane outer div
  note-list-header        header strip (title + actions)
    note-list-sort        sort indicator
    note-list-search      search action
    note-list-new         new-note action
```

### Title bar leaves (all inside `workspace-title-bar`)

```
title-bar-toggle-sidebar  sidebar toggle button
title-bar-back            back navigation
title-bar-forward         forward navigation
title-bar-search          search
title-bar-language        language/locale
title-bar-profile         user profile
```

### Note toolbar containers + leaves (inside `workspace-center` pane)

```
note-toolbar              entire toolbar row (container + primary crop target)
  note-toolbar-type       breadcrumb type label
  note-toolbar-filename   breadcrumb filename stem
  note-toolbar-sync       breadcrumb sync glyph
  note-toolbar-star       favourite toggle
  note-toolbar-organized  organised toggle
  note-toolbar-neighborhood neighbourhood view
  note-toolbar-raw        raw/source mode
  note-toolbar-width      note width toggle
  note-toolbar-ai         AI action
  note-toolbar-toc        table of contents
  note-toolbar-reveal     reveal in Finder
  note-toolbar-copy-path  copy path
  note-toolbar-more       overflow menu
  note-toolbar-inspector  toggle inspector panel
```

### Status bar leaves (all inside `workspace-status-bar`)

```
status-bar-theme-toggle   theme cycle button
status-bar-settings       settings button
status-bar-contribute     Contribute link
status-bar-docs           Docs link
```

---

## Rename table (old → new)

| Old ID | New ID | Notes |
|---|---|---|
| `Contribute` | `status-bar-contribute` | Was using raw label as ID |
| `Docs` | `status-bar-docs` | Was using raw label as ID |
| *(none)* | `workspace` | **New** container |
| *(none)* | `workspace-title-bar` | **New** container |
| *(none)* | `workspace-left-dock` | **New** container |
| *(none)* | `workspace-note-list` | **New** container |
| *(none)* | `workspace-center` | **New** container |
| *(none)* | `workspace-right-dock` | **New** container |
| *(none)* | `workspace-bottom-dock` | **New** container |
| *(none)* | `workspace-status-bar` | **New** container |
| *(none)* | `sidebar` | **New** container |
| *(none)* | `sidebar-section-views` | **New** container |
| *(none)* | `sidebar-section-types` | **New** container |
| *(none)* | `sidebar-section-folders` | **New** container |
| *(none)* | `note-list` | **New** container |
| *(none)* | `note-list-header` | **New** container |

All other existing IDs are **unchanged** — they already follow the convention.

---

## Extending this

1. Pick the deepest container from the table above that encloses your new element.
2. Use that container's prefix as your `<area>-<region>` stem.
3. Add an `<element>` segment that describes the specific cell.
4. Add a `<variant>` only if two cells in the same container would otherwise share a name.
5. Register exactly one `.dump_as("your-new-id")` on the element's outer `div`.
6. Add a row to the rename table in this file in the same commit.

IDs are `&'static str` literals — no generated enum, no runtime registry. Keep
them as string literals in the call site; the static check is the compiler refusing
to compile a mutable reference to a string literal.
