---
type: ADR
id: "0107"
title: "Markdown-durable tldraw whiteboards in notes"
status: active
date: 2026-05-03
---

## Context

Tolaria notes are durable Markdown files, while whiteboard editing needs an interactive canvas with structured shape data. tldraw provides a mature React whiteboard runtime and exposes snapshot APIs that can persist the document without using browser-local `persistenceKey` storage.

The storage decision needs to preserve Tolaria's filesystem source-of-truth rule: deleting local caches must not lose a board, raw mode must expose the canonical source, and Git should track the board together with the surrounding note.

## Decision

**Tolaria will support whiteboards as Markdown-durable fenced `tldraw` blocks backed by tldraw document snapshots.**

The implementation:

- Converts fenced `tldraw` blocks into temporary placeholders before BlockNote parses Markdown.
- Replaces those placeholders with `tldrawBlock` schema blocks that store a stable board id and tldraw document snapshot JSON.
- Renders each block with the `tldraw` package inside the rich editor.
- Debounces tldraw document changes into BlockNote block props so Tolaria's normal autosave writes the snapshot into the `.md` file.
- Serializes `tldrawBlock` nodes back to fenced Markdown before save, raw-mode entry, and editor-position snapshots.
- Adds a `/whiteboard` slash command that inserts the same block format.

Session state such as camera position, selected shapes, and selected tools is not persisted into the note. Preview images are intentionally omitted from the initial design; they may be introduced later as derived cache artifacts for note lists, search results, or graph cards.

## Options considered

- **Markdown fenced block with tldraw document snapshot** (chosen): keeps the board in the note file, matches Tolaria's Mermaid/math round-trip model, and works for both full whiteboard notes and embedded boards inside larger notes.
- **tldraw `persistenceKey` / IndexedDB**: simplest app integration, but violates the vault-as-source-of-truth rule and would lose boards when browser storage is cleared.
- **Separate `.tldr` files embedded from Markdown**: keeps JSON out of prose notes, but fragments note ownership, makes embedded boards harder to move with their parent note, and complicates Git history for small board edits.
- **Preview-image-first storage**: useful for thumbnails, but not editable source. It would make the PNG an attractive but stale source of truth.

## Consequences

- `src/utils/tldrawMarkdown.ts` is the canonical parser/serializer bridge for whiteboard blocks.
- `src/components/TldrawWhiteboard.tsx` owns the tldraw runtime integration and only persists document snapshots.
- Raw mode remains a direct source editor for the fenced JSON.
- Embedded whiteboards and future full-note whiteboard templates share the same storage format.
- Asset support is deferred; when added, asset bytes should live in vault-relative attachment paths referenced from the tldraw asset records.
