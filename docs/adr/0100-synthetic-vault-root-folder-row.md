---
type: ADR
id: "0100"
title: "Synthetic vault-root row in folder navigation"
status: active
date: 2026-04-30
---

## Context

ADR-0033 introduced subfolder scanning and a collapsible folder tree backed by `list_vault_folders`, but the sidebar still had no first-class way to select the vault root itself. That left root-level files outside the folder-navigation model and pushed the UI toward one-off handling for the opened vault path.

The new sidebar behavior needs to show root-level files when the user clicks the vault name, while preserving the existing folder rename/delete model for real folders only.

## Decision

**Represent the vault root in the sidebar as a synthetic frontend-owned folder row rather than as a mutable backend folder.**

- `FolderTree` wraps backend folder nodes in a root row with `path: ""` and `rootPath` set to the opened vault path.
- `SidebarSelection` keeps using `kind: 'folder'`, but root selection is encoded as the empty folder path plus `rootPath` metadata.
- Root-level file filtering is handled in note-list helpers as a dedicated root case instead of pretending the vault root is an ordinary folder.
- Rename/delete remain available only for real folders; the vault root row is navigable, not mutable.

## Options considered

- **Option A** (chosen): Synthetic vault-root row in the renderer — keeps `list_vault_folders` focused on real folders, avoids backend schema churn, and reuses the existing folder-selection mental model.
- **Option B**: Add a pseudo-folder to backend folder results — would couple presentation-only root behavior to command data and blur the distinction between the vault itself and mutable folders.
- **Option C**: Keep root files outside folder navigation entirely — simpler, but leaves the sidebar with an incomplete navigation model and special cases elsewhere in the UI.

## Consequences

- Folder navigation now has a single model for root and nested folder browsing.
- Backend folder APIs stay unchanged: they describe actual folders, not UI-only rows.
- Selection handling must treat `path: ""` as the vault-root case and use `rootPath` when computing direct-root file membership.
- Re-evaluate if folder actions ever need to operate on the vault root itself, because that would likely require a separate command model instead of extending the synthetic row.
