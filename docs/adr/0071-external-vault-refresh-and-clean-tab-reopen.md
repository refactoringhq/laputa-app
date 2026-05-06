---
type: ADR
id: "0071"
title: "External vault updates reload derived state and reopen the clean active note"
status: superseded
date: 2026-04-21
superseded_by: "0111"
---

## Context

ADR-0002 makes the filesystem the source of truth, and ADR-0043 keeps locally edited frontmatter reactive inside the running UI. But external vault mutations still had a gap. A `git pull` or an AI agent edit could change notes on disk while the app kept showing stale note-list state, stale derived relationships, or an editor surface that still rendered the pre-refresh BlockNote document.

The fix needed to satisfy a few constraints at once:

- refresh all vault-derived UI, not just the main note list
- preserve unsaved local edits instead of clobbering them with disk state
- reopen the active note from disk when it is safe, even if another file changed, because backlinks, inverse relationships, and other derived surfaces can depend on the whole vault
- handle the native editor case where an in-place file update requires a full tab reopen to show the fresh document reliably

## Decision

**All external vault mutations now reconcile through one shared refresh path that reloads vault-derived state and then conditionally reopens the active note from disk.**

Tolaria now routes post-pull refreshes and AI-agent file modifications through the same `refreshPulledVaultState()` helper.

That shared path does the following:

1. Reload `vault.entries`, folders, and saved views together.
2. If there is no active note, stop after the reload.
3. If the active note has unsaved local edits, keep the current editor buffer and do not replace it from disk.
4. Otherwise, find the refreshed `VaultEntry` for the active note and replace the active tab with freshly loaded disk content.
5. If the active file itself changed in place during the external update, close the tab before reopening it so BlockNote fully remounts onto the new document.
6. If the active file no longer exists after the reload, close the open tab state instead of leaving a stale editor behind.

## Options considered

- **Shared external-refresh reconciler** (chosen): one policy for pulls and agent edits, consistent vault-derived UI, and explicit protection for unsaved local edits. Cons: more coupling between sync flows and tab management.
- **Patch only the changed surfaces ad hoc**: smaller individual fixes, but high risk of drift between pull handling, agent handling, and future external-write paths.
- **Always force a full app-level reload**: simplest correctness story, but too disruptive and more likely to throw away user context unnecessarily.

## Consequences

- Any workflow that mutates the vault externally, such as git pulls or agent writes, should go through the shared refresh reconciler rather than reloading a single surface in isolation.
- Clean active notes now converge back to on-disk truth automatically after external updates.
- Unsaved local edits remain protected from external refreshes, even when the rest of the vault reloads.
- Folder, saved-view, backlink, and inverse-relationship surfaces stay aligned with the refreshed vault, not just the editor tab.
- Tolaria now treats "refresh after external mutation" as a first-class synchronization concern rather than a per-feature fix.
- Re-evaluate if the editor gains a reliable in-place document reset API, because that could remove the need for the close-and-reopen step when the active file itself changed.
