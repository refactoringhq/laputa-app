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
=[[device]].power.watts
=[[launch-brief]].2
```

Cross-sheet cell references resolve another sheet note by wikilink target, then read a single A1-style cell. Frontmatter references resolve one note by wikilink target, then read a scalar property path after the dot. Numeric line references such as `[[launch-brief]].2` read one frontmatter-stripped raw body line and preserve commas as text. Missing, ambiguous, circular, very deep, or non-scalar references are treated as unresolved and surface as spreadsheet errors.

## Guidance For Agents And Scripts

When editing a sheet note programmatically:

- preserve the YAML frontmatter delimiter and ordinary Tolaria fields
- keep `_display: sheet` when the file should display as a spreadsheet
- keep spreadsheet presentation state under `_sheet`
- parse and serialize the body as CSV, not by splitting on every comma manually
- preserve formulas as formulas, including `[[sheet]].A1`, `[[note]].property.path`, and `[[note]].1` references
- avoid converting formulas to their displayed values
- quote CSV cells when they contain commas, quotes, or line breaks
- do not add workbook tabs inside one note; create another note with `_display: sheet` instead
- do not store opaque binary workbook state in the Markdown file

If a script cannot safely preserve `_sheet`, it should leave that block untouched and edit only the CSV body cells it understands.
