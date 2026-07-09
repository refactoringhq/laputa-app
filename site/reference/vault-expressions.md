# Vault Expressions

::: v-pre
Vault expressions let rendered content read values from Tolaria notes. The `{{...}}` template form currently runs in HTML blocks. Sheet formulas use the same `[[note]].field` reference forms inside `=` formulas, but spreadsheet calculations still use IronCalc functions.

## Reference Syntax

| Expression | Result |
| --- | --- |
| `{{status}}` | Current note property. |
| `{{this.status}}` | Current note property with explicit `this`. |
| `{{[[project-alpha]].status}}` | Scalar property from another note. |
| `{{[[device]].power.watts}}` | Nested scalar frontmatter path. |
| `{{[[essay]].has_notes}}` | Relationship or array property as comma-separated text. |
| `{{[[essay]].title}}` | Referenced note title. |
| `{{[[budget]].B5}}` | Single cell from a sheet note. |
| `{{[[brief]].2}}` | Second raw body line from another note. |

Wikilink targets resolve like normal Tolaria links, so they can use filenames, paths, or note titles when those targets are unambiguous.

Line references are 1-based and exclude YAML frontmatter. `[[note]].A1` means grid or cell access and may split comma-separated content. `[[note]].1` means the whole first body line, preserving commas as text.

## Values

Properties can resolve to strings, numbers, booleans, `null`, or arrays of strings, numbers, and booleans. Arrays render as comma-separated text unless you pass them to `json(...)`.

Unresolved expressions remain visible as escaped placeholders, such as `{{missing_property}}`, so broken dashboards fail visibly instead of silently showing the wrong value.

Expression output is escaped as text by default. A property value such as `<strong>Draft</strong>` displays as text, not as live HTML.

## Formatting Helpers

| Helper | Example |
| --- | --- |
| `upper(value)` | `{{upper(status)}}` |
| `lower(value)` | `{{lower(status)}}` |
| `title(value)` | `{{title(status)}}` |
| `trim(value)` | `{{trim(name)}}` |
| `truncate(value, length, suffix?)` | `{{truncate(summary, 120)}}` |
| `replace(value, from, to)` | `{{replace(status, "_", " ")}}` |
| `round(value, digits?)` | `{{round(score, 1)}}` |
| `formatNumber(value, digits?)` | `{{formatNumber(revenue, 0)}}` |
| `formatPercent(value, digits?)` | `{{formatPercent(conversion_rate, 1)}}` |
| `formatCurrency(value, currency, digits?)` | `{{formatCurrency(amount, "USD", 0)}}` |
| `formatDate(value, format?)` | `{{formatDate(publish_date, "long")}}` |
| `default(value, fallback)` | `{{default(status, "Draft")}}` |
| `isEmpty(value)` | `{{isEmpty(owner)}}` |
| `json(value)` | `{{json([[essay]].has_notes)}}` |

`formatDate` supports `short`, `medium`, `long`, and `YYYY-MM-DD`. Formatting uses the app locale when available.

The only operator is `+`, which concatenates text:

```html
<p>{{first_name + " " + last_name}}</p>
```

Vault expressions do not run arbitrary JavaScript. They do not support loops, mutation, user-defined functions, raw HTML interpolation, or remote data access.

## Structured JSON

Use `json(...)` when an HTML block script needs data instead of already-rendered text:

```html
<script type="application/json" id="notes-data">
{{json([[essay]].has_notes)}}
</script>
```

For scalar values, `json(...)` returns the JSON representation of that value. For a wikilink or a relationship array made of wikilinks, it returns note summary objects:

```json
{
  "title": "Acceleration whiplash",
  "target": "acceleration-whiplash",
  "path": "/vault/acceleration-whiplash.md",
  "status": "Evergreened",
  "raw": "[[acceleration-whiplash]]",
  "deepLink": "tolaria://refactoring-vault/acceleration-whiplash.md"
}
```

The JSON is escaped so it cannot close the surrounding script tag. Put it in a non-executable script tag, then parse it from a `scripts="sandboxed"` HTML block when you need to build markup with standard DOM APIs.

## Sheet Formula Parity

The same note target forms work in sheet formulas:

```txt
=[[newsletter-revenue]].B5
=[[project-alpha]].status
=[[launch-brief]].2
```

Use [Spreadsheet Formulas](/reference/spreadsheet-functions) for spreadsheet-specific syntax and IronCalc function behavior.
:::
