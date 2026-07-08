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
