---
type: ADR
id: "0123"
title: "Full vault graph for secondary note windows"
status: active
date: 2026-05-25
supersedes: "0118"
---

## Context

ADR-0118 made secondary note windows entry-scoped to avoid repeated full-vault scans. That reduced startup work, but it also removed the vault-index context that normal Tolaria capabilities depend on: properties, view actions, quick open/search, workspace-aware navigation, and other command surfaces no longer behaved like the main window.

The product expectation is that opening a note in a separate window creates another capable Tolaria window, not a reduced editor shell. Performance remains important, but capability parity is the stronger contract.

## Decision

**Secondary note windows load the same active vault/workspace graph as a normal Tolaria window.** They still start in editor-only view mode and auto-open the requested note from the URL parameters, but the app keeps the shared vault loader, mounted-workspace filtering, watcher scope, editor entry list, and workspace-aware note actions enabled.

`main.tsx` always mounts `App`; note-window mode is handled inside `App` through `getNoteWindowParams()` and `useNoteWindowLifecycle`.

## Alternatives considered

- **Entry-scoped note windows**: faster startup, but loses app-level features that require repository-wide context. Rejected because it breaks the secondary-window product contract.
- **Full app with full active graph** (chosen): keeps one window architecture and restores feature parity. Trade-off: each secondary window performs its own vault load.
- **Shared state from the main window over IPC**: could provide parity without duplicate scans, but adds synchronization complexity and failure modes. Deferred until profiling proves the duplicate load is a real bottleneck.

## Consequences

- Secondary windows can use normal Tolaria capabilities such as Properties, view actions, quick open/search, wikilink navigation, and workspace-aware note operations.
- Opening several note windows can repeat vault-loading work. This is acceptable for now because correctness and parity are more important than avoiding the scan.
- ADR-0118 is superseded. If secondary-window startup becomes too slow, optimize with shared state or incremental loading without removing app capabilities.
