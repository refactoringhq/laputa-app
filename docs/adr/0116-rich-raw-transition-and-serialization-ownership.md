---
type: ADR
id: "0116"
title: "Rich/raw transition and serialization ownership"
status: active
date: 2026-05-13
---

## Context

Tolaria already relies on BlockNote as the rich editor and on a Markdown-first save path, but the rich/raw boundary had started to split that contract across multiple local helpers. Autosave and tab-swap logic serialized rich-editor content in one place, raw-mode entry rebuilt Markdown in another, and raw-mode toggles carried pending content and pending cursor/scroll restore state through separate refs.

That fragmentation created two drift risks in one of the most correctness-sensitive parts of the app:

- rich-editor Markdown output could diverge across autosave, tab switches, and raw-mode entry, especially around wikilink restoration, durable schema-node serialization, frontmatter preservation, and portable attachment paths
- raw/rich mode switches could desynchronize pending content from pending position restoration, making stale transition state harder to reason about and harder to harden

Tolaria's editor contract already prioritizes no crashes, no stale overwrites, and minimal per-keystroke work. The rich/raw boundary needs the same single-owner discipline.

## Decision

**Tolaria centralizes BlockNote-to-Markdown serialization for editor flows in one shared owner and treats raw/rich mode handoff as explicit transition state with a single owner per concern.**

Specifically:

1. `src/utils/richEditorMarkdown.ts` is the canonical owner for rich-editor body/document serialization used by autosave, tab-swap, and raw-mode entry.
2. Raw-mode content handoff is modeled as one content transition object, so pending raw-exit content and raw-mode overrides move together.
3. Cursor/scroll restoration across rich/raw toggles is modeled as one restore-transition ref consumed by the editor-mode position sync path.
4. Editor surfaces should not keep independent ad hoc pending-content or pending-position refs outside those shared owners.

## Options considered

- **Shared serialization owner plus explicit transition owners** (chosen): keeps the Markdown contract and mode-switch lifecycle consistent across editor flows, while still allowing debounced work and focused testing.
- **Per-flow local serializers and pending refs**: simpler inside each hook, but lets autosave, tab-swap, and raw-mode entry drift apart over time.
- **Separate raw-mode-specific serialization and restore logic**: would preserve local autonomy, but duplicates correctness-sensitive rules at the exact boundary where stale state bugs are hardest to diagnose.
- **Always rebuild all content/position state synchronously on every toggle**: reduces retained transition state, but increases work at toggle time and does not solve ownership drift in shared serialization logic.

## Consequences

- Autosave, tab-switch flushing, and raw-mode entry now share one Markdown serialization contract.
- Wikilink restoration, durable editor-node serialization, frontmatter preservation, and portable attachment-path rewriting have one place to evolve.
- Rich/raw mode toggles become easier to reason about because content transition state and restore transition state each have a single owner.
- Future editor features that need rich-editor Markdown output or mode-transition bookkeeping should extend these shared owners rather than introducing local one-off refs or serializers.
- Re-evaluation is warranted if Tolaria adopts a different editor runtime or if rich/raw mode stops being a first-class bidirectional workflow.
