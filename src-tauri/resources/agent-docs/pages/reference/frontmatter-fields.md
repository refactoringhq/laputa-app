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