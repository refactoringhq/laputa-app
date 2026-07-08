# Build Custom Views

Source: guides/build-custom-views.md
URL: /guides/build-custom-views

# Build Custom Views

Custom views are saved filters for recurring questions.

## Good View Candidates

- Active projects.
- People without a recent follow-up.
- Drafts ready for review.
- Notes changed this week.
- Events in a date range.

## View Definition

Saved views live as files in the vault. They describe filters, sorting, and visible columns using structured data.

## Filters

Custom views can use nested conditions, similar to Notion or Airtable filter groups. Combine `all` and `any` logic when a view needs to answer a more precise question than a single field filter can express.

Date filters support dynamic natural-language values such as `today`, `yesterday`, or `one week ago`. Use these for views that should keep moving over time, such as recent work, stale follow-ups, or upcoming events.

## Design The Question First

Before creating a view, write the question it answers. A good view is not "all fields with all filters"; it is a focused lens.

---

# Capture A Note

Source: guides/capture-a-note.md
URL: /guides/capture-a-note

# Capture A Note

Use capture when you need to get an idea into the vault before you know where it belongs.

## Steps

1. Press `Cmd+N` on macOS or `Ctrl+N` on Windows and Linux.
2. Write a clear H1.
3. Add the rough content.
4. Leave structure for later if you are still thinking.

## Capture Well

Prefer a useful title over a perfect taxonomy. You can add type, status, and relationships during inbox review.

## When To Add Structure Immediately

Add structure while capturing when the note's type or relationships are already obvious. Otherwise, capture the idea first and organize it later.

---

# Manage Git Manually Or With AutoGit

Source: guides/commit-and-push.md
URL: /guides/commit-and-push

# Manage Git Manually Or With AutoGit

Tolaria can act as a lightweight Git client for a Git-enabled vault. You can manage commits and pushes yourself, or enable AutoGit to create conservative checkpoints after editing pauses or when the app is no longer active.

## Manual Git

1. Open the Git or changes surface.
2. Review changed files.
3. Write a short commit message.
4. Commit locally.
5. Push when a remote is configured.

If the remote has changed, pull first and resolve any conflicts. If the vault has no remote, manual commits still give you local history, diffs, and rollback.

## AutoGit

AutoGit is available in Settings for Git-enabled vaults. When enabled, Tolaria automatically commits and pushes saved local changes after an idle pause or after the app becomes inactive.

Use AutoGit when you want the safety of regular checkpoints without interrupting capture or editing. You can still inspect each note's current diff, review note history, and browse the whole-vault history before making larger manual commits.

## Use Small Commits

Small commits make it easier to understand what changed, roll back safely, and review AI-generated edits.

---

# Configure AI Models

Source: guides/configure-ai-models.md
URL: /guides/configure-ai-models

# Configure AI Models

Use model providers when you want chat over note context without giving an agent vault-write tools.

## Local Models

Local model targets are for tools such as Ollama and LM Studio. They usually need a base URL and model ID, and they usually do not need an API key.

## API Models

API model targets are for hosted providers such as OpenAI, Anthropic, Gemini, OpenRouter, or another OpenAI-compatible endpoint.

Tolaria does not store provider API keys in vault settings. Choose one of the supported key paths:

- Save the key locally on this device.
- Read the key from an environment variable.
- Use no key for local providers that do not require one.

## Test The Connection

After adding a provider, use the test action in Settings. A successful test means Tolaria reached the endpoint and the model replied.

## Select The Target

Once configured, choose the model from the AI target selector or set it as the default AI target in Settings.

---

# Connect A Git Remote

Source: guides/connect-a-git-remote.md
URL: /guides/connect-a-git-remote

# Connect A Git Remote

Connect a remote when you want backup or sync beyond the current machine.

## Before You Start

Make sure the remote repository exists and your system Git can authenticate to it. Tolaria uses system Git rather than storing provider-specific credentials.

## Steps

1. Open the bottom status bar remote chip, or run `Add Remote` from the command palette.
2. Paste the remote URL.
3. Confirm the remote name.
4. Fetch or push according to the app prompt.

## Recommended Auth

- SSH keys.
- GitHub CLI authentication.
- Existing Git credential helpers.
- macOS Keychain credentials for HTTPS remotes on macOS.

If authentication fails, see [Git Authentication](/troubleshooting/git-auth).

---

# Create Types

Source: guides/create-types.md
URL: /guides/create-types

# Create Types

Create a type when several notes share the same role in your system.

## Steps

1. Run `New Type` from the command palette, or click `+` in the Types header in the sidebar.
2. Give the type a clear name.
3. Add optional icon, color, sidebar order, sidebar label, pinned properties, suggested fields, default values, or a new-note template.

You can also right-click a type in the sidebar to change its icon and color.
Type icons use Phosphor icon names in kebab-case, such as `briefcase` or `folder`.

```yaml
---
type: Type
_icon: briefcase
_color: blue
_sidebar_label: Projects
_order: 10
---

# Project
```

## Use Types Sparingly

A type should represent a recurring category, not a one-off label. If you only need a temporary grouping, use a saved view or property instead.

## Templates

Type documents can include a Markdown template for new notes of that type. Keep templates small and useful: a heading, a few expected fields, and the first checklist are usually enough.

You can store the template in the Type document's `template` frontmatter field. When hand-editing the Type document body, content after the Type note's own `# TypeName` heading is also used as the new-note template if it looks like template structure such as field labels, secondary headings, or checklist starters. Plain descriptive body text is ignored.

Type documents can also define fields for new notes. Empty properties and relationships become placeholders in new notes of that type. Properties with values become defaults for new notes of that type.

---

# Manage Display Preferences

Source: guides/manage-display-preferences.md
URL: /guides/manage-display-preferences

# Manage Display Preferences

Display preferences live in local app settings unless a setting is intentionally stored in the note or vault.

## Theme

Choose Light, Dark, or System in Settings. System follows the operating system appearance at runtime.

You can also switch theme mode from the command palette.

## Note Width

Set the default rich-editor width in Settings:

- **Normal** for focused writing.
- **Wide** for tables, diagrams, dense notes, and generated documents.

An individual note can override the default width from the editor toolbar. That override is stored as `_width` in the note frontmatter.

## Sidebar Labels

Tolaria can pluralize type names in the sidebar. Turn this off in Settings if your type names should be shown exactly as written, or use `_sidebar_label` on a type document for an explicit label.

## Vault Content

Settings also control whether Gitignored files and non-Markdown file categories are visible in the app. Use these controls to keep generated or local-only files out of regular note workflows.

---

# Organize The Inbox

Source: guides/organize-inbox.md
URL: /guides/organize-inbox

# Organize The Inbox

Inbox review turns quick captures into usable knowledge.

## Remove A Note From Inbox

When a note is organized enough, mark it as organized. Use `Cmd+E` on macOS or `Ctrl+E` on Windows and Linux, or click the organize action in the breadcrumb bar.

That action is what removes the note from Inbox. If auto-advance is enabled in Settings > Workflow, Tolaria opens the next Inbox item immediately after you mark the current note organized.

## Review Checklist

- Rename unclear notes.
- Add or correct the first H1.
- Set `type`.
- Add `status` for actionable notes.
- Add `belongs_to`, `related_to`, or other relationship fields when useful.
- Archive or delete notes that no longer matter.

## Make Notes Navigable

A note is organized when you can answer:

- What kind of thing is this?
- What is it connected to?
- What is this useful for?
- What will I do with it?

## Avoid Over-Structuring

Do not add fields just because they exist. Add the structure that will help future navigation, review, or automation.

---

# Use The AI

Source: guides/use-ai-panel.md
URL: /guides/use-ai-panel

# Use The AI

Tolaria gives you two ways to ask for AI help: open the AI panel for an ongoing conversation, or prompt directly from the editor with `Cmd+K` followed by a space.

## Choose How To Prompt

- **AI panel** is best for longer conversations, agent work, and requests that need visible back-and-forth.
- **Inline prompt** is best when you are already writing. Press `Cmd+K`, type a space, then write the prompt you want the AI to handle from the current note context.

## Choose A Target

Open Settings and choose the default AI target:

- **Coding agent** for tool-backed vault editing through Claude Code, Codex, OpenCode, Pi, or Antigravity CLI.
- **Local model** for Ollama or LM Studio chat over note context.
- **API model** for OpenAI, Anthropic, Gemini, OpenRouter, or an OpenAI-compatible endpoint.

If a coding agent is missing, install it and reopen Tolaria or switch to another target.

## Permission Mode

Coding agents support per-vault permission modes:

- **Vault Safe** keeps agents limited to file, search, and edit tools.
- **Power User** can allow shell commands for agents that support them.

Direct model targets always stay in chat mode. They can use note context, but they cannot edit vault files through tools.

## Good Requests

- "Find notes related to this project."
- "Summarize what changed in this note."
- "Draft a weekly review from these linked notes."
- "Update this checklist based on the current project status."

## Review Changes

AI edits are file edits. Review them with Tolaria's diff and Git history before committing.

---

# Use The Command Palette

Source: guides/use-command-palette.md
URL: /guides/use-command-palette

# Use The Command Palette

The command palette is the fastest way to move around Tolaria.

Open it with:

- `Cmd+K` on macOS.
- `Ctrl+K` on Linux and Windows.

## Common Commands

- New Note.
- Search.
- Open Settings.
- Reload Vault.
- Add Remote.
- Open Getting Started Vault.
- Toggle Raw Mode.
- Toggle Table of Contents.
- Toggle AI Panel.
- Use Light, Dark, or System theme.
- Open in New Window.

## Keyboard-First Workflow

Use the palette when you know what you want to do but do not want to hunt through panels. It is also the best place to discover commands as the app grows.

---

# Use Media Previews

Source: guides/use-media-previews.md
URL: /guides/use-media-previews

# Use Media Previews

Media previews let you inspect vault files without leaving Tolaria.

## Open A File

Select an image, PDF, media file, or unsupported file from a folder or file list. Tolaria opens supported files in the app and offers an external-open action for files that should use the system default app.

## All Notes Visibility

Open Settings to choose whether non-Markdown files appear in All Notes:

- PDFs.
- Images.
- Unsupported files.

Folder browsing still shows files in their folders even when a category is hidden from All Notes.

## Attachments

When you paste or drop an image into a note, Tolaria copies it into the vault and references the copied file from Markdown.

## Troubleshooting

If a preview does not render, open the file in the default app to confirm the file is valid, then check whether the file is inside the active vault and not blocked by operating-system permissions.

---

# Use Spreadsheets

Source: guides/use-spreadsheets.md
URL: /guides/use-spreadsheets

# Use Spreadsheets

Tolaria spreadsheets are sheet notes: Markdown files with frontmatter and a CSV-like body that open in a spreadsheet editor when their `Display as` value is `Sheet`.

Use a sheet note when a model needs rows, columns, calculations, or repeated numeric editing. Use a normal note when the main artifact is prose.

## Create A Sheet

Use the command palette action `New Sheet`, or create/open a note and set its `Display as` to `Sheet` from the Properties panel. `Type` remains separate and can still be `Note`, `Project`, `Responsibility`, or any other Tolaria type.

When a note is a sheet:

- the YAML frontmatter remains available for type, status, relationships, wikilinks, and custom properties
- `_display: sheet` tells Tolaria to display the note with the spreadsheet editor
- the body is the sheet itself
- there is no rich-text body around the table
- the editor switches from the text editor to the spreadsheet editor

## Enter Values

Click a cell and type a value. Non-formula values can be text, numbers, dates, or wikilinks.

Press `Enter` on a selected cell to edit the cell. Press `Escape` while editing to leave cell editing and keep focus in the sheet.

Use `Delete` or `Backspace` to clear the selected cell or range.

## Enter Formulas

Formulas start with `=`.

```txt
=B2+B3-B4
=SUM(B2:D2)
=ROUND(E6, 2)
=IF(E6>0, "Up", "Down")
```

Tolaria shows inline formula autocomplete while you type. The autocomplete list is built from the implemented function catalog in the bundled IronCalc engine; formula evaluation is still handled by IronCalc.

See [Spreadsheet Formulas](/reference/spreadsheet-functions) for syntax, supported examples, and links to the full IronCalc formula reference.

## Select And Edit Ranges

The sheet editor follows spreadsheet conventions:

- arrow keys move the active cell
- `Shift` plus arrow keys extends the selection
- drag to select a range
- copy and paste preserves formulas where possible
- cut and paste moves formulas and shifts relative references
- right-click a selected cell or range to apply formatting

Right-click actions apply to the current selection. Keep a multi-cell selection active before opening the context menu when you want to format several cells together.

## Format Cells

Use the context menu for common formatting:

- number formats such as plain numbers, currency, and percentages
- decimal precision
- bold and italic text
- alignment and clearing formatting when available

Formatting is stored as plain YAML under `_sheet`, not in an opaque workbook blob. For example, percentage formatting for `E6` is stored as:

```yaml
_sheet:
  cells:
    E6:
      num_fmt: "0.00%"
```

See [Spreadsheet File Format](/reference/spreadsheet-format) for the full storage model.

## Add Wikilinks

Type `[[` in a cell to open note autocomplete.

```csv
Project,Owner,Status
[[website-redesign]],[[person/alice]],Active
[[sponsorship-pipeline]],[[person/matteo]],Review
```

When the cell is not being edited, Tolaria renders the wikilink like other note links. When you edit the cell, the raw `[[wikilink]]` syntax is shown again.

Command-click a wikilink in a sheet cell to open the linked note.

## Reference Another Sheet Note

Formulas can read a cell from another sheet note with Tolaria's wikilink cell syntax:

```txt
=[[newsletter-revenue]].B5
=SUM(B2:D2)+[[sponsorship-pipeline]].E12
=ROUND([[business-plan]].$E$12, 2)
```

The part inside `[[...]]` resolves like a normal Tolaria wikilink. The part after the dot is an A1-style cell reference.

Use absolute markers when copying formulas:

| Reference | Copy behavior |
| --- | --- |
| `[[revenue]].B5` | row and column can shift |
| `[[revenue]].$B$5` | row and column stay fixed |
| `[[revenue]].B$5` | row fixed, column can shift |
| `[[revenue]].$B5` | column fixed, row can shift |

Cross-sheet references currently resolve single cells. Keep range formulas inside one sheet note.

## Work With The Raw File

A sheet file remains readable text:

```md
---
type: Project
_display: sheet
status: Draft
belongs_to:
  - "[[business-plan]]"
_sheet:
  frozen_rows: 1
  columns:
    A:
      width: 180
---
Metric,January,February,March,Q1 Total
Subscriptions,1200,1350,1500,=SUM(B2:D2)
Services,800,900,750,=SUM(B3:D3)
Expenses,650,700,760,=SUM(B4:D4)
Net,=B2+B3-B4,=C2+C3-C4,=D2+D3-D4,=SUM(B5:D5)
```

When editing this file with scripts or AI agents, parse the body as CSV and preserve formulas as formulas. Do not replace formulas with displayed values.

---

# Use The Table Of Contents

Source: guides/use-table-of-contents.md
URL: /guides/use-table-of-contents

# Use The Table Of Contents

The table of contents panel helps you navigate long notes by heading.

## Open It

Use the editor toolbar, the command palette, or the shortcut:

- `Cmd+Shift+T` on macOS.
- `Ctrl+Shift+T` on Windows and Linux.

## How It Works

Tolaria builds the outline from the current note's headings. The panel updates as the note changes and can jump to sections in the editor.

## Good Uses

- Long procedures.
- Meeting notes with many sections.
- Research notes.
- Generated documents that need review.

If a note has no useful headings, add clear H2 and H3 sections rather than relying on a long uninterrupted document.

---

# Use Wikilinks

Source: guides/use-wikilinks.md
URL: /guides/use-wikilinks

# Use Wikilinks

Wikilinks connect notes by name.

```md
This project belongs to [[content-systems]] and is related to [[git-workflows]].
```

## Link From The Body

Use body links when the connection is part of the sentence you are writing.

## Link From Frontmatter

Use frontmatter links when the relationship should become structured metadata.

```yaml
related_to:
  - "[[git-workflows]]"
```

## Keep Links Stable

Prefer clear note titles and filenames. Tolaria's wikilink autocomplete helps you pick the right target while you type.
