# ADR 0160: Editable Markdown-durable callout blocks

- Status: active
- Date: 2026-07-19

## Context

Tolaria shares plain Markdown vaults with tools that encode callouts as blockquotes beginning with `[!type]`. Rendering those markers as ordinary quotes exposes compatibility syntax instead of the intended note, tip, warning, or alert surface. Converting the entire callout to opaque block props would make the body read-only in rich mode and would discard inline marks and links during Markdown round trips.

## Decision

Tolaria converts marker-bearing quote blocks into a schema-backed `calloutBlock` after BlockNote parsing. Marker metadata (`type`, optional `+`/`-` fold state, and title) lives in props, while the body remains BlockNote inline content. Serialization isolates callout blocks, serializes their live inline content through the normal editor serializer, and restores the blockquote marker syntax before saving.

Known Obsidian aliases and GitHub alert types map to Tolaria semantic colors and icons. Unknown types keep their token and use neutral note styling. `-` callouts begin collapsed, `+` callouts begin expanded, and disclosure is presentation state only: toggling it never rewrites the vault file.

## Consequences

- Imported callouts render as native rich-editor surfaces without changing their portable Markdown representation.
- Callout bodies remain directly editable and keep supported inline formatting, links, wikilinks, and other inline schema content.
- Custom callout types round-trip safely even when Tolaria has no dedicated visual family.
- Editing marker type, title, or fold syntax remains a raw-mode operation for now; rich mode owns body editing and disclosure only.
- New block-level callout syntax must extend the centralized `richEditorMarkdown` import/export boundary rather than creating a parallel save path.
