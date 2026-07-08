# Contribute

Source: reference/contribute.md
URL: /reference/contribute

# Contribute

Tolaria is free and open source, and any kind of help is useful. Pick the path that matches what you want to do.

## Newsletter

[Refactoring](https://refactoring.fm/) is Luca's newsletter and community for engineers building better teams and software with AI. Subscribing is the best way to support Tolaria.

## Sponsors

Tolaria is supported by a panel of tools Luca uses every day to keep the project healthy, tested, and ready for AI-assisted development:

- [Codacy](https://www.codacy.com/)
- [CodeScene](https://codescene.com/)
- [CircleCI](https://circleci.com/)
- [Unblocked](https://getunblocked.com/)

## Feature Requests

Use the [product board](https://tolaria.canny.io/) for feature ideas. Search first, upvote existing ideas, and create a new post when the request is genuinely new.

## Discussions

Use [GitHub Discussions](https://github.com/refactoringhq/tolaria/discussions) for questions, conversations, show and tell, and broader community context.

## Contribute Code

Small, focused pull requests are welcome. Check the product board first so you build the right thing, then open a PR on [GitHub](https://github.com/refactoringhq/tolaria/pulls). The [contributing guide](https://github.com/refactoringhq/tolaria/blob/main/CONTRIBUTING.md) explains the local workflow.

## Report A Bug

Use [GitHub Issues](https://github.com/refactoringhq/tolaria/issues) for bugs. Include what happened, what you expected, and clear reproduction steps. If you are reporting from inside Tolaria, use the Contribute panel to copy sanitized diagnostics and attach them to the issue.

---

# Docs Maintenance

Source: reference/docs-maintenance.md
URL: /reference/docs-maintenance

# Docs Maintenance

The public docs live in the app repo so documentation changes can ship with behavior changes.

## Update Docs When You Change

- A Tauri command.
- A new component or hook that changes user behavior.
- A data model or frontmatter convention.
- Git, AI, onboarding, or release behavior.
- Public release pages, download metadata, or updater channels.
- Platform support.
- Keyboard shortcuts.

## Suggested Workflow

1. Make the code change.
2. Update the matching concept, guide, or reference page.
3. Add a troubleshooting page if the change creates a new failure mode.
4. Run `pnpm docs:build`.
5. Check the home page, search, release/download links, and changed docs pages in a browser.

## Page Types

| Type | Purpose |
| --- | --- |
| Start | Helps a new user get into the app. |
| Concepts | Explains mental models. |
| Guides | Teaches workflows. |
| Reference | Gives stable facts and tables. |
| Troubleshooting | Starts from a symptom and ends with recovery. |

## Review Checklist

- Does the page describe current behavior?
- Does it mention macOS primary and Windows/Linux supported-early status when platform support matters?
- Are links relative and VitePress-compatible?
- Can a user discover the page with local search?

---

# File Layout

Source: reference/file-layout.md
URL: /reference/file-layout

# File Layout

Tolaria is not opinionated about folder structure. It finds notes recursively across the whole vault, stores new notes in the root by default, and uses types and relationships for real organization.

```txt
my-vault/
  project-alpha.md
  weekly-review.md
  research/
    source-notes.md
  attachments/
    diagram.png
    source.pdf
  project.md
  person.md
  views/
    active-projects.yml
```

## Root Notes

Tolaria works well with a flat vault. Folders are optional and can be useful for compatibility with other tools, but they are not required for people, projects, topics, or any other note category.

Type is not inferred from folder location. It comes from frontmatter, and relationships are expressed with wikilinks in fields. That is what Tolaria uses for the sidebar, Properties panel, search, custom views, and neighborhood navigation.

## Special Folders

| Folder | Purpose |
| --- | --- |
| `views/` | Saved custom views. |
| `attachments/` | Images and other attached files. |

PDFs, images, and other non-Markdown files stay as normal files. Folder browsing can show them in place, and Settings controls whether PDFs, images, and unsupported files appear in All Notes.

Whiteboards are Markdown files with durable tldraw data, so they belong with notes rather than in `attachments/`.

Spreadsheets are also Markdown files. A note with `_display: sheet` stores ordinary frontmatter plus a CSV-like body and opens in the sheet editor.

Type definitions are Markdown notes with `type: Type` in frontmatter. New type documents are normal notes, and existing type documents in older folders still work.

## Git Files

If the vault is a Git repository, `.git/` belongs to Git. Tolaria reads Git state but does not treat `.git/` as notes.

---

# Frontmatter Fields

Source: reference/frontmatter-fields.md
URL: /reference/frontmatter-fields

# Frontmatter Fields

Tolaria uses conventions instead of a required schema.

| Field | Meaning |
| --- | --- |
| `type` | The note's entity type. |
| `status` | Lifecycle state. |
| `icon` | Per-note icon. |
| `url` | External URL. |
| `date` | Single date. |
| `belongs_to` | Parent relationship. |
| `related_to` | Lateral relationship. |
| `has` | Contained relationship. |
| `_width` | Per-note editor width override. |
| `_display` | Display mode. Omit for text notes; use `sheet` for spreadsheet notes. |
| `_icon`, `_color` | Type or note appearance metadata. `_icon` values use Phosphor icon names in kebab-case, emoji, or HTTP(S) image URLs. |
| `_sidebar_label`, `_order` | Type sidebar label and order. |
| `_pinned_properties` | Properties pinned for a type. |
| `_sheet` | Sheet-note presentation metadata such as grid settings, column widths, row heights, and cell formatting. |

## Custom Fields

You can add your own fields. If a field contains wikilinks, Tolaria can treat it as a relationship.

## System Fields

Fields starting with `_` are reserved for system behavior and hidden from standard property editing. They remain plain YAML, so they can still be inspected or changed in raw mode when needed.

Nested keys under a system field are also system-owned. For example, `_sheet.cells.B6.num_fmt` belongs to the sheet editor and should not appear as a normal user property.

---

# Keyboard Shortcuts

Source: reference/keyboard-shortcuts.md
URL: /reference/keyboard-shortcuts

# Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Open command palette. |
| `Cmd+P` / `Ctrl+P` | Quick open notes and files. |
| `Cmd+N` / `Ctrl+N` | Create a new note. |
| `Cmd+S` / `Ctrl+S` | Save current note. |
| `Cmd+F` / `Ctrl+F` | Find in the current note. |
| `Cmd+Shift+F` / `Ctrl+Shift+F` | Search the vault. |
| `Cmd+Shift+V` / `Ctrl+Shift+V` | Paste without formatting. |
| `Cmd+\` / `Ctrl+\` | Toggle raw Markdown mode. |
| `Cmd+Shift+T` / `Ctrl+Shift+T` | Toggle table of contents. |
| `Cmd+Shift+I` / `Ctrl+Shift+I` | Toggle Properties panel. |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Toggle AI panel. |
| `Cmd+[` / `Alt+Left` | Navigate back when available. |
| `Cmd+]` / `Alt+Right` | Navigate forward when available. |
| `Cmd+Shift+O` / `Ctrl+Shift+O` | Open current note in a new window. |
| `Cmd+D` / `Ctrl+D` | Toggle favorite for the current note. |
| `Cmd+E` / `Ctrl+E` | Mark the current Inbox note organized. |

Some shortcuts vary by platform because macOS, Linux, and Windows reserve different key combinations.

Use the command palette to discover the current command set.

---

# Release Channels

Source: reference/release-channels.md
URL: /reference/release-channels

# Release Channels

Tolaria publishes Stable and Alpha release metadata to GitHub Pages.

## Stable

Stable follows manually promoted releases. This is the right channel for normal use.

The stable updater metadata lives at:

```txt
/stable/latest.json
```

The public download page points at the latest stable release.

## Alpha

Alpha follows pushes to `main`. It receives fixes and features earlier, but it can be rougher than Stable.

The alpha updater metadata lives at:

```txt
/alpha/latest.json
```

Compatibility endpoints also point to the alpha metadata:

```txt
/latest.json
/latest-canary.json
```

## Before Switching

Commit or push important vault changes before changing release channel or installing an update. Your notes are local files, but a clean Git state makes recovery simpler.

---

# Spreadsheet File Format

Source: reference/spreadsheet-format.md
URL: /reference/spreadsheet-format

# Spreadsheet File Format

Sheet notes are Markdown files with YAML frontmatter and a CSV-like body. The note uses `_display: sheet` when it should open in the spreadsheet editor. The `type` field remains ordinary semantic metadata.

For editing workflows, see [Use Spreadsheets](/guides/use-spreadsheets). For formula syntax and function references, see [Spreadsheet Formulas](/reference/spreadsheet-functions).

## Structure

```md
---
type: Project
_display: sheet
tags:
  - planning
_sheet:
  show_grid_lines: true
  frozen_rows: 1
  frozen_columns: 1
  columns:
    A:
      width: 180
  rows:
    "1":
      height: 32
  cells:
    E6:
      num_fmt: "0.00%"
      bold: true
---
Metric,January,February,March,Q1 Total
Subscriptions,1200,1350,1500,=SUM(B2:D2)
Expenses,650,700,760,=SUM(B3:D3)
Net,=B2-B3,=C2-C3,=D2-D3,=SUM(B4:D4)
Growth,,=(C4-B4)/B4,=(D4-C4)/C4,=(E4-B4)/B4
```

The frontmatter stores note metadata. The body stores rows and cells. There is no Markdown table wrapper, fenced code block, or embedded workbook blob.

## Frontmatter

All ordinary Tolaria fields remain available:

- `type`
- `status`
- `date`
- `tags`
- `url`
- relationship fields such as `belongs_to`, `related_to`, and custom wikilink properties

The `_display: sheet` field is the display-as marker. Omit it for ordinary text notes.

The `_sheet` key is reserved for spreadsheet presentation metadata. It follows the same system-field convention as other underscore-prefixed Tolaria fields: hidden from normal property editing, but visible and editable in raw source.

## Body

The body is CSV-like text:

- rows are separated by line breaks
- cells are separated by commas
- cells containing commas, quotes, or line breaks are quoted
- quotes inside quoted cells are escaped by doubling them
- empty trailing rows and columns may be omitted on save

Any cell whose input starts with `=` is treated as a formula. Other cells are treated as literal values.

## `_sheet` Metadata

Tolaria stores spreadsheet presentation state in `_sheet` as plain YAML.

| Field | Meaning |
| --- | --- |
| `show_grid_lines` | Whether grid lines are shown. |
| `frozen_rows` | Number of frozen rows from the top. |
| `frozen_columns` | Number of frozen columns from the left. |
| `columns.<column>.width` | Custom column width, keyed by column letter such as `A` or `BC`. |
| `rows."<row>".height` | Custom row height, keyed by one-based row number. |
| `cells.<cell>.num_fmt` | Number format code for a cell. |
| `cells.<cell>.bold` | Bold text style. |
| `cells.<cell>.italic` | Italic text style. |
| `cells.<cell>.underline` | Underline text style. |
| `cells.<cell>.strike` | Strikethrough text style. |
| `cells.<cell>.font_size` | Font size. |
| `cells.<cell>.font_color` | Text color. |
| `cells.<cell>.fill_color` | Cell fill color. |
| `cells.<cell>.horizontal_align` | Horizontal alignment. |
| `cells.<cell>.vertical_align` | Vertical alignment. |
| `cells.<cell>.wrap_text` | Text wrapping. |
| `cells.<cell>.border_top` | Top border style. |
| `cells.<cell>.border_right` | Right border style. |
| `cells.<cell>.border_bottom` | Bottom border style. |
| `cells.<cell>.border_left` | Left border style. |

Cell metadata is keyed by A1-style cell addresses such as `A1`, `B12`, or `AA30`.

Border values are stored as a style name with an optional color, for example:

```yaml
border_bottom: "thin #d0d7de"
```

## Number Formats

Number formats are stored in `num_fmt` using spreadsheet-style format codes. Common examples:

| Format | Example output |
| --- | --- |
| `#,##0` | `1,250` |
| `#,##0.00` | `1,250.50` |
| `0.00%` | `12.35%` |
| `$#,##0.00` | `$1,250.50` |
| `yyyy-mm-dd` | `2026-06-15` |

These formats affect presentation, not the underlying cell input in the CSV body.

## Markdown Style Import

When Tolaria imports a non-formula CSV cell, simple Markdown wrappers can seed initial styles:

| Cell text | Stored value | Style |
| --- | --- | --- |
| `**Revenue**` | `Revenue` | bold |
| `_Estimate_` | `Estimate` | italic |
| `***Total***` | `Total` | bold and italic |
| `~~Removed~~` | `Removed` | strike |

After save, the style belongs in `_sheet` metadata and the body keeps the unwrapped text.

## Wikilinks

Non-formula cells can store normal Tolaria wikilinks:

```csv
Account,Source
Newsletter,[[newsletter-revenue]]
Sponsors,[[sponsorship-pipeline]]
```

Formula cells can reference another sheet note with Tolaria's cross-sheet syntax:

```txt
=[[newsletter-revenue]].B5
=ROUND([[business-plan]].$E$12, 2)
```

Cross-sheet references resolve another sheet note by wikilink target, then read a single A1-style cell. Circular references and very deep chains are treated as unresolved.

## Guidance For Agents And Scripts

When editing a sheet note programmatically:

- preserve the YAML frontmatter delimiter and ordinary Tolaria fields
- keep `_display: sheet` when the file should display as a spreadsheet
- keep spreadsheet presentation state under `_sheet`
- parse and serialize the body as CSV, not by splitting on every comma manually
- preserve formulas as formulas, including `[[sheet]].A1` references
- avoid converting formulas to their displayed values
- quote CSV cells when they contain commas, quotes, or line breaks
- do not add workbook tabs inside one note; create another note with `_display: sheet` instead
- do not store opaque binary workbook state in the Markdown file

If a script cannot safely preserve `_sheet`, it should leave that block untouched and edit only the CSV body cells it understands.

---

# Spreadsheet Formulas

Source: reference/spreadsheet-functions.md
URL: /reference/spreadsheet-functions

# Spreadsheet Formulas

Formula cells start with `=` and are evaluated by IronCalc through Tolaria's sheet editor.

Tolaria adds vault-aware sheet references on top of the normal spreadsheet formula model. Everything else should be treated as IronCalc formula behavior. IronCalc aims for Excel-compatible formulas, but the upstream project is still evolving, so verify advanced formulas against the IronCalc docs when precision matters.

## Basic Syntax

| Syntax | Meaning |
| --- | --- |
| `=B2+B3-B4` | Arithmetic over cells. |
| `=SUM(B2:D2)` | Function call over a range. |
| `=ROUND(E6, 2)` | Function call with arguments. |
| `=IF(E6>0, "Up", "Down")` | Conditional expression. |
| `=$B$2` | Absolute column and row reference. |
| `=B$2` | Relative column, absolute row. |
| `=$B2` | Absolute column, relative row. |
| `=B2:D10` | A range in the current sheet note. |
| `="Q" & 1` | Text concatenation. |

Use parentheses when a model depends on precedence:

```txt
=(B2+B3-B4)/B5
```

## Tolaria Cross-Sheet References

Tolaria supports wikilink cell references for values that live in another sheet note:

```txt
=[[newsletter-revenue]].B5
=SUM(B2:D2)+[[sponsorship-pipeline]].E12
=ROUND([[business-plan]].$E$12, 2)
```

The target inside `[[...]]` resolves like a normal Tolaria wikilink. The cell address after the dot uses A1 notation.

Absolute markers follow spreadsheet copy behavior:

| Reference | Copy behavior |
| --- | --- |
| `[[revenue]].B5` | row and column can shift |
| `[[revenue]].$B$5` | row and column stay fixed |
| `[[revenue]].B$5` | row fixed, column can shift |
| `[[revenue]].$B5` | column fixed, row can shift |

Cross-sheet references currently resolve single cells. Keep range formulas inside one sheet note until cross-note ranges are explicitly supported.

## Autocomplete Functions

Tolaria's formula autocomplete exposes the implemented function catalog from the bundled IronCalc engine. The current catalog has 195 functions.

The dropdown shows a small ranked set of matches while you type. Keep typing to narrow the result list. Function names with digits and dots, such as `BIN2DEC` and `ERFC.PRECISE`, are supported.

### Logical

`AND`, `FALSE`, `IF`, `IFERROR`, `IFNA`, `IFS`, `NOT`, `OR`, `SWITCH`, `TRUE`, `XOR`

### Math and trigonometry

`ABS`, `ACOS`, `ACOSH`, `ASIN`, `ASINH`, `ATAN`, `ATAN2`, `ATANH`, `COS`, `COSH`, `PI`, `POWER`, `PRODUCT`, `RAND`, `RANDBETWEEN`, `ROUND`, `ROUNDDOWN`, `ROUNDUP`, `SIN`, `SINH`, `SQRT`, `SQRTPI`, `SUM`, `SUMIF`, `SUMIFS`, `TAN`, `TANH`, `SUBTOTAL`

### Lookup and reference

`CHOOSE`, `COLUMN`, `COLUMNS`, `HLOOKUP`, `INDEX`, `INDIRECT`, `LOOKUP`, `MATCH`, `OFFSET`, `ROW`, `ROWS`, `VLOOKUP`, `XLOOKUP`

### Text

`CONCAT`, `CONCATENATE`, `EXACT`, `FIND`, `LEFT`, `LEN`, `LOWER`, `MID`, `REPT`, `RIGHT`, `SEARCH`, `SUBSTITUTE`, `T`, `TEXT`, `TEXTAFTER`, `TEXTBEFORE`, `TEXTJOIN`, `TRIM`, `UNICODE`, `UPPER`, `VALUE`, `VALUETOTEXT`

### Information

`ERROR.TYPE`, `FORMULATEXT`, `ISBLANK`, `ISERR`, `ISERROR`, `ISEVEN`, `ISFORMULA`, `ISLOGICAL`, `ISNA`, `ISNONTEXT`, `ISNUMBER`, `ISODD`, `ISREF`, `ISTEXT`, `NA`, `SHEET`, `TYPE`

### Statistical

`AVERAGE`, `AVERAGEA`, `AVERAGEIF`, `AVERAGEIFS`, `COUNT`, `COUNTA`, `COUNTBLANK`, `COUNTIF`, `COUNTIFS`, `GEOMEAN`, `MAX`, `MAXIFS`, `MIN`, `MINIFS`

### Date and time

`DATE`, `DAY`, `EDATE`, `EOMONTH`, `MONTH`, `NOW`, `TODAY`, `YEAR`

### Financial

`CUMIPMT`, `CUMPRINC`, `DB`, `DDB`, `DOLLARDE`, `DOLLARFR`, `EFFECT`, `FV`, `IPMT`, `IRR`, `ISPMT`, `MIRR`, `NOMINAL`, `NPER`, `NPV`, `PDURATION`, `PMT`, `PPMT`, `PV`, `RATE`, `RRI`, `SLN`, `SYD`, `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD`, `XIRR`, `XNPV`

### Engineering

`BESSELI`, `BESSELJ`, `BESSELK`, `BESSELY`, `BIN2DEC`, `BIN2HEX`, `BIN2OCT`, `BITAND`, `BITLSHIFT`, `BITOR`, `BITRSHIFT`, `BITXOR`, `COMPLEX`, `CONVERT`, `DEC2BIN`, `DEC2HEX`, `DEC2OCT`, `DELTA`, `ERF`, `ERF.PRECISE`, `ERFC`, `ERFC.PRECISE`, `GESTEP`, `HEX2BIN`, `HEX2DEC`, `HEX2OCT`, `IMABS`, `IMAGINARY`, `IMARGUMENT`, `IMCONJUGATE`, `IMCOS`, `IMCOSH`, `IMCOT`, `IMCSC`, `IMCSCH`, `IMDIV`, `IMEXP`, `IMLN`, `IMLOG10`, `IMLOG2`, `IMPOWER`, `IMPRODUCT`, `IMREAL`, `IMSEC`, `IMSECH`, `IMSIN`, `IMSINH`, `IMSQRT`, `IMSUB`, `IMSUM`, `IMTAN`, `OCT2BIN`, `OCT2DEC`, `OCT2HEX`

## Examples

### Totals

```txt
=SUM(B2:D2)
=B2+B3-B4
=SUM(B2:D2)-SUM(B4:D4)
```

### Growth And Percentages

```txt
=(C5-B5)/B5
=IF(B5=0, 0, (C5-B5)/B5)
=ROUND((C5-B5)/B5, 4)
```

Format the result as a percentage with a cell `num_fmt` such as `0.00%`.

### Conditional Logic

```txt
=IF(E5>10000, "On track", "Review")
=IFS(E5>10000, "High", E5>5000, "Medium", TRUE, "Low")
=IFERROR(B5/B4, 0)
```

### Dates

```txt
=TODAY()
=DATE(2026, 6, 15)
=YEAR(TODAY())
=MONTH(TODAY())
```

### Text

```txt
=CONCAT(A2, " - ", B2)
=UPPER(A2)
=TRIM(A2)
=TEXT(B2, "$#,##0.00")
```

### Lookup

```txt
=INDEX(B2:E10, 3, 2)
=MATCH("Revenue", A2:A20, 0)
=VLOOKUP("Revenue", A2:E20, 5, FALSE)
=XLOOKUP("Revenue", A2:A20, E2:E20)
```

### Cross-Sheet Model

```txt
=[[newsletter-revenue]].E5
=SUM(B2:D2)+[[sponsorship-pipeline]].E12
=IF([[business-plan]].$E$12>0, [[business-plan]].$E$12, 0)
```

## IronCalc Function Families

IronCalc documents formulas by category. Use these upstream pages for detailed syntax and examples. The upstream documentation may include newer functions that are not yet present in Tolaria's bundled IronCalc version.

| Family | Link |
| --- | --- |
| Lookup and reference | [IronCalc lookup and reference](https://docs.ironcalc.com/functions/lookup-and-reference.html) |
| Financial | [IronCalc financial](https://docs.ironcalc.com/functions/financial.html) |
| Engineering | [IronCalc engineering](https://docs.ironcalc.com/functions/engineering.html) |
| Database | [IronCalc database](https://docs.ironcalc.com/functions/database.html) |
| Statistical | [IronCalc statistical](https://docs.ironcalc.com/functions/statistical.html) |
| Text | [IronCalc text](https://docs.ironcalc.com/functions/text.html) |
| Math and trigonometry | [IronCalc math and trigonometry](https://docs.ironcalc.com/functions/math-and-trigonometry.html) |
| Logical | [IronCalc logical](https://docs.ironcalc.com/functions/logical.html) |
| Date and time | [IronCalc date and time](https://docs.ironcalc.com/functions/date-and-time.html) |
| Information | [IronCalc information](https://docs.ironcalc.com/functions/information.html) |

IronCalc also documents [value types](https://docs.ironcalc.com/features/value-types.html), [error types](https://docs.ironcalc.com/features/error-types.html), [optional arguments](https://docs.ironcalc.com/features/optional-arguments.html), and [formatting values](https://docs.ironcalc.com/features/formatting-values.html).

For current upstream gaps, see IronCalc's [unsupported features](https://docs.ironcalc.com/features/unsupported-features.html).

---

# Supported Platforms

Source: reference/supported-platforms.md
URL: /reference/supported-platforms

# Supported Platforms

Tolaria is a desktop app built with Tauri. Releases currently target macOS, Windows, and Linux.

| Platform | Current support | Notes |
| --- | --- | --- |
| macOS | Primary | Main development and QA target. Apple Silicon and Intel artifacts are published. |
| Windows | Supported, early | NSIS installers and signed updater bundles are published. Menu, shell-path, and credential-helper behavior receive platform-specific fixes as they appear. |
| Linux | Supported, early | AppImage, deb, and RPM artifacts are published. Behavior can depend on distro WebKitGTK packages, Wayland/X11 details, and input-method setup. |

## Support Policy

Primary support means the platform is part of normal development and release validation. Supported, early means release artifacts exist and the app is expected to work, but platform-specific bugs can take longer to diagnose than macOS issues.

## Reporting Platform Bugs

Include:

- Tolaria version.
- Operating system and version.
- CPU architecture.
- Whether the vault is local-only or connected to a remote.
- Steps to reproduce.

---

# View Filters

Source: reference/view-filters.md
URL: /reference/view-filters

# View Filters

View filters define saved lists of notes.

## Common Filter Ideas

| Goal | Filter direction |
| --- | --- |
| Active projects | `type` is Project and `status` is Active |
| Drafts | `type` is Article and `status` is Draft |
| People follow-up | `type` is Person and date is before today |
| Recent work | modified date is within a recent range |

## Sorting

Useful sorts include:

- Recently modified first.
- Title ascending.
- Status ascending.
- A custom property ascending or descending.

## Operators

Saved views can combine filters for text, dates, relationship fields, and frontmatter values. Relative date expressions are useful for views such as notes changed this week or people that need follow-up.

Regex filters are available for power-user cases. Keep them narrow and test them on a small view first.

## Keep Views Focused

A view should answer one recurring question. If it becomes too broad, split it into two views.

You can also customize view appearance with the same kind of icon and color controls used by types.
