# Properties

Properties are frontmatter fields that Tolaria can display, filter, and edit.

## Suggested Properties

Suggested properties are the fields Tolaria knows how to create quickly from the Properties panel. When a suggested property is missing, the panel shows a shortcut to add it with the right editor.

| Field | Purpose |
| --- | --- |
| `type` | Groups the note into a type such as Project, Person, or Topic. |
| `status` | Tracks lifecycle state such as Active, Done, or Blocked. |
| `url` | Stores a canonical external link. |
| `date` | Represents a single date. |

## System Properties

Fields that start with `_` are system properties. They remain in plain text but are hidden from normal property editing.

Examples include `_icon`, `_color`, `_order`, `_sidebar_label`, `_width`, and `_pinned_properties` on type documents or notes.

## Property Editing

The Properties panel is the safest place to edit structured properties. Toggle it with `Cmd+Shift+I` on macOS or `Ctrl+Shift+I` on Windows and Linux.

Date fields use Tolaria's picker, relationship fields can use wikilinks, and raw Markdown mode is available when you need direct control over YAML.

## Referencing Properties

HTML blocks can reference properties from the current note or another note:

::: v-pre
```html
<p>{{status}}</p>
<p>{{formatDate(date, "long")}}</p>
<p>{{[[project-alpha]].status}}</p>
```
:::

Sheet formulas can also read scalar properties with the same note target form:

```txt
=[[project-alpha]].status
```

Use [Vault Expressions](/reference/vault-expressions) for HTML expression syntax and [Spreadsheet Formulas](/reference/spreadsheet-functions) for formula behavior.
