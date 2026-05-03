---
type: ADR
id: "0105"
title: "Editor correctness and responsiveness contract"
status: active
date: 2026-05-01
---

## Context

Tolaria notes are durable Markdown files on disk, but the rich editor renders them through BlockNote blocks. Large notes exposed a tempting optimization: show a fast Markdown preview first, then hydrate BlockNote later. In practice, that creates two renderers for the same document, visible flicker, delayed click-time lag, and more places for stale async work to race with the currently selected note.

The editor must optimize for the product priorities in this order:

1. no crashes
2. no stale content, race-condition overwrites, or lost edits
3. responsive typing and cursor movement
4. fast note-list-to-editor loading

## Decision

**Tolaria keeps a single direct editor surface for Markdown notes and treats editor content swaps as generation-checked, source-content-checked operations.** Fast loading may use raw file-content prefetching and a bounded parsed-block cache, but it must not show a separate preview that later swaps into the editor. Parsed BlockNote blocks are reusable only when their source Markdown exactly matches the content being opened, and background parsing must run only after recent typing/navigation has gone idle.

## Options considered

- **Single direct editor surface with guarded swaps plus bounded caches** (chosen): preserves one visual representation of the document, rejects stale async parse results, validates or identity-checks cached disk content before opening, and keeps typing work debounced. Cons: very large notes can still wait on BlockNote conversion when they were not warmed.
- **Fast Markdown preview followed by hidden BlockNote hydration**: improves first paint but creates flicker, delayed edit-time stalls, and duplicated rendering semantics.
- **Unbounded or eager background BlockNote parsing for likely next notes**: can make some opens faster, but competes with typing/navigation and introduces stale parse-result hazards unless heavily scheduled, bounded, and invalidated.
- **Always raw mode for large notes**: strongest responsiveness for huge files, but changes the editing experience abruptly and should be an explicit fallback rather than the default.

## Consequences

- Async editor work must prove it still matches both the latest swap generation and the latest tab source content before touching BlockNote.
- Cached raw note content must be validated against disk before it is shown unless it carries the same `modifiedAt` and `fileSize` identity as the current `VaultEntry`, or the content was just authored by Tolaria in the current process.
- Cached parsed BlockNote blocks must be keyed by vault, path, and exact source content, cloned on read/write, and bounded by entry count plus source byte budget.
- Background parsed-block warming is allowed only for likely next large Markdown notes after a foreground idle window; active typing, raw mode, and editor mount state must defer it.
- Dirty local editor content remains authoritative. External filesystem refreshes may replace clean notes, but must not overwrite unsaved local edits.
- Per-keystroke editor work must stay minimal. Serialization, metadata derivation, autosave, and cache updates should be debounced, coalesced, or scheduled away from active typing.
- Future large-note optimizations should target true progressive/chunked conversion or explicit raw/read-only fallback states, not a visually different preview that morphs into BlockNote.
