---
type: ADR
id: "0089"
title: "Active vault filesystem watcher"
status: active
date: 2026-04-27
---

## Context

Tolaria treats the filesystem as the source of truth, but before this decision the running app only noticed external file changes after a manual Reload Vault, a Git pull, or an AI-agent-specific refresh callback. Edits from another editor, terminal commands, another Tolaria window, or a non-pull Git operation could leave React state and the editor surface stale.

ADR-0071 already defines the safe reconciliation policy for external vault mutations: reload vault-derived state, protect unsaved local edits, and reopen the clean active note from disk when needed. Filesystem watching needed to reuse that policy instead of adding another ad hoc reload path.

## Decision

**Tolaria watches the active desktop vault with a native filesystem watcher and routes external change batches through the shared external-refresh reconciler.**

The desktop backend exposes `start_vault_watcher` and `stop_vault_watcher` commands backed by Rust `notify`. It watches the active vault recursively, ignores known non-content churn such as `.git/`, `node_modules/`, temp files, and `.tolaria-rename-txn`, then emits `vault-changed` events with the active vault path and changed paths.

The renderer owns batching and reconciliation. `useVaultWatcher` starts the backend watcher for the active main-window vault, debounces native events into one refresh, filters out recent app-owned saves, and calls `refreshPulledVaultState()`. Manual Reload Vault still uses `reload_vault` directly, but now exposes visible reload feedback.

## Options considered

- **Native active-vault watcher plus shared reconciliation** (chosen): keeps external changes visible without polling and preserves ADR-0071 behavior for clean and unsaved tabs. Cons: adds one native dependency and a long-lived watcher state.
- **Frontend-only polling**: simpler backend surface, but wastes work on idle vaults and still needs careful active-note reconciliation.
- **Direct `reloadVault()` on every native event**: easy to implement, but bypasses clean-tab reopen handling and can clobber the user experience around unsaved edits.
- **Watch every configured vault**: could pre-warm state, but burns resources for inactive vaults and complicates event ownership across windows.

## Consequences

- External writes converge automatically into the visible vault state after a short debounce.
- Active clean notes are refreshed through the same path as pull and AI-agent updates; unsaved local edits remain protected.
- Tolaria app-owned saves are suppressed briefly so autosave does not trigger a full external refresh loop.
- The status bar can show reload progress for manual and automatic refreshes.
- The watcher is a desktop-only integration; mobile builds keep no-op command stubs until a mobile-specific filesystem strategy exists.
