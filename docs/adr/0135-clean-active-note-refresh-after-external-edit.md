---
type: ADR
id: "0135"
title: "Clean active notes refresh immediately after external edits"
status: active
date: 2026-05-30
supersedes: "0111"
---

## Context

ADR-0111 made external vault refreshes path-aware and preserved focused editor mounts so unrelated watcher events would not disrupt cursor state. That avoided needless remount churn, but it also meant a clean active note edited by Codex or another external process could remain visibly stale while the editor stayed focused. Because no later safe-remount trigger was guaranteed, users could see the old content until a full app restart.

Tolaria's filesystem-first model requires clean in-memory editor state to converge to the file on disk during the current session. Unsaved local editor buffers still need protection, but editor focus alone is not enough reason to keep showing stale content when the changed-path batch identifies the active file.

## Decision

**External vault refreshes now remount a clean active note immediately when the external changed-path batch includes that note, regardless of editor focus.**

The shared `refreshPulledVaultState()` path applies these rules:

1. Reload vault entries, folders, and saved views together for every external change batch.
2. If there is no active note, stop after the shared reload.
3. If the active note changed during the async reload, stop rather than reopening stale context.
4. If the active note has unsaved local edits, keep the current editor buffer mounted.
5. If the active file disappeared, close the tab instead of leaving a stale editor behind.
6. If the changed-path batch includes the clean active file, close and reopen the active tab from disk even when focus is inside the rich or raw editor.
7. Unknown or unrelated change batches refresh vault-derived state without remounting the active editor.

Git pulls, AI-agent refresh callbacks, and filesystem-watcher batches continue to converge through this single reconciliation helper instead of adding separate reload policies.

## Alternatives considered

- **Immediate clean active-note remount** (chosen): restores filesystem convergence for Codex and other external note edits while preserving unsaved local edits. Cons: a focused clean editor can lose cursor state when its own file changes externally.
- **Keep focused-editor preservation from ADR-0111**: avoids cursor disruption, but can leave the active editor stale indefinitely.
- **Defer active-note reload until blur**: reduces focus disruption, but adds another pending-refresh state machine and still allows the active editor to show stale disk content for an unbounded editing session.

## Consequences

- External edits to the currently open clean note become visible without restarting Tolaria.
- Unsaved local content remains authoritative and is not replaced by watcher, pull, or agent refreshes.
- The changed-path batch remains part of the external-refresh contract; callers should pass specific file paths whenever available.
- Unrelated watcher events still avoid active-editor remounts, so broad vault churn does not disturb the editor unless the active file itself changed.
- ADR-0111 is superseded by this stronger filesystem-convergence rule.
