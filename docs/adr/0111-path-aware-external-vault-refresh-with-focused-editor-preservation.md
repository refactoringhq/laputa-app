---
type: ADR
id: "0111"
title: "Path-aware external vault refresh with focused-editor preservation"
status: active
date: 2026-05-05
supersedes: "0071"
---

## Context

ADR-0071 established a shared reconciliation path for external vault mutations so git pulls, AI-agent writes, and other non-local edits would reload vault-derived state and protect unsaved local changes. That policy was directionally right, but the original "reopen the clean active note" rule was too broad once Tolaria added a native filesystem watcher and more editor-mounted integrations.

Two problems emerged:

- unrelated external updates could remount a clean active editor even when the active file itself did not change
- remounting while focus was inside the rich or raw editor surface could drop cursor/focus state and disrupt native input flows even when the vault refresh itself was otherwise safe

Tolaria still needs refreshed entries, folders, views, backlinks, and other derived state after external writes. But it should only pay the cost of an active-editor remount when the changed-path batch actually requires one and the user is not actively focused inside the editor.

## Decision

**External vault refreshes now reload shared vault-derived state eagerly, but only remount the active editor when the active file itself changed and the editor is clean and unfocused.**

The shared `refreshPulledVaultState()` path now applies these rules:

1. Reload vault entries, folders, and saved views together for every external change batch.
2. If there is no active note, stop after the shared reload.
3. If the active note changed during the async reload, stop rather than reopening stale context.
4. If the active note has unsaved local edits, keep the current editor buffer mounted.
5. If focus is currently inside the rich or raw editor surface, keep that editor mounted even for otherwise clean notes.
6. If the active file disappeared, close the tab instead of leaving a stale editor behind.
7. Only close and reopen the active tab when the changed-path batch includes that active file and the previous guards did not apply.

Git pulls, AI-agent refresh callbacks, and filesystem-watcher batches should continue to converge through this single reconciliation helper instead of inventing separate reload policies.

## Alternatives considered

- **Path-aware refresh with focused-editor preservation** (chosen): keeps derived vault state fresh while avoiding unnecessary remounts and focus loss. Cons: a focused clean editor can temporarily lag on-disk content until a later safe remount.
- **Always reopen the clean active note after every external refresh**: strongest immediate convergence, but causes visible churn and drops editor focus for unrelated changes.
- **Skip shared reloads whenever the editor is focused**: preserves focus, but leaves folders, views, backlinks, and other derived state stale.

## Consequences

- Unrelated external vault updates no longer remount the active editor just because the note is clean.
- Focused rich/raw editor sessions preserve cursor and native input state across watcher- or agent-driven vault refreshes.
- The changed-path batch is now part of the external-refresh contract; callers should pass the best available file list instead of treating all refreshes as full active-note invalidations.
- A focused clean editor may intentionally continue showing pre-refresh content until a later safe reopen, trading immediate active-note convergence for editing continuity.
- `refreshPulledVaultState()` remains the single place to evolve external-refresh policy; future features should extend that helper rather than layering ad hoc editor reload behavior.
