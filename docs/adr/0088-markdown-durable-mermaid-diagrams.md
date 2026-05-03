---
type: ADR
id: "0088"
title: "Markdown-durable Mermaid diagrams in notes"
status: active
date: 2026-04-27
---

## Context

Tolaria notes are plain Markdown files, while the rich editor uses BlockNote and raw mode uses CodeMirror. Users need fenced `mermaid` blocks to render as diagrams in the note surface without changing the canonical file format or hiding the source from raw editing.

BlockNote can parse fenced code blocks, but a generic highlighted code block does not provide diagram rendering. Rendering Mermaid directly from the Markdown fence also has to preserve the original fence source when notes are saved, copied through raw mode, closed, and reopened.

## Decision

**Tolaria will support Mermaid diagrams through a Markdown placeholder round-trip owned by the editor pipeline and rendered with the `mermaid` package.**

The implementation:

- Converts fenced `mermaid` blocks to temporary placeholders before BlockNote parses Markdown.
- Replaces placeholders with a `mermaidBlock` schema block that stores both the original fenced source and the diagram body.
- Renders the block through Mermaid in the rich editor.
- Serializes `mermaidBlock` nodes back to their stored fenced Markdown before save, raw-mode entry, and editor-position snapshots.
- Shows the original source as an inline fallback when Mermaid cannot render a diagram.

## Options considered

- **Tolaria-owned placeholder round-trip with Mermaid rendering** (chosen): matches the existing wikilink and math architecture, keeps Markdown as the source of truth, and gives Tolaria explicit control over serialization.
- **Render all `mermaid` code blocks by overriding the generic code-block renderer**: smaller surface, but it couples diagram behavior to the code-highlighting package and makes exact source preservation harder.
- **Raw-mode-only Mermaid support**: preserves source but fails the enhanced note reading experience users expect.
- **Store parsed diagram metadata outside the Markdown body**: enables richer future editing, but violates the files-first model.

## Consequences

- `src/utils/mermaidMarkdown.ts` is the canonical parser/serializer bridge for note diagrams.
- Rich mode renders diagrams as schema-backed blocks; raw mode remains the direct source editor.
- Invalid Mermaid source remains visible instead of breaking the editor surface.
- `mermaid` is now a runtime dependency and should be upgraded deliberately with rendering regression coverage.
- Future diagram controls, such as copy source or expand, can attach to the same `mermaidBlock` without changing storage.
