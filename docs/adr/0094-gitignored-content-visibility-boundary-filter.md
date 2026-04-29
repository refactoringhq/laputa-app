---
type: ADR
id: "0094"
title: "Gitignored content visibility as a command-boundary filter"
status: active
date: 2026-04-29
---

## Context

Tolaria's vault scanner now indexes more of the real filesystem so Folder views, search, and reload flows can reflect what is actually in the vault. In Git-backed vaults, that includes generated, local-only, or machine-specific content that users intentionally hide through `.gitignore`.

Always showing Gitignored files makes Folder lists and search noisy, especially in vaults that contain exports, build artifacts, or personal local scratch files. But removing those files during scanning would make visibility dependent on cache shape, complicate toggling, and blur the distinction between "what exists in the vault" and "what this installation chooses to surface."

## Decision

**Tolaria keeps the vault scan and cache complete, then applies Gitignored-content visibility at the command boundary before entries, folders, or search results reach React.**

- `hide_gitignored_files` is an installation-local app setting and defaults to `true`.
- Visibility checks use batched `git check-ignore --no-index --stdin` so Tolaria follows normal Git ignore and negation semantics as closely as practical.
- `list_vault`, `reload_vault`, `list_vault_folders`, and keyword search all apply the same filter when the setting is enabled.
- Toggling the setting reloads the current vault surfaces instead of rebuilding a different cache format.
- If a vault has no `.gitignore`, or Gitignored visibility is turned off, Tolaria shows the full scanned result.

## Options considered

- **Complete scan/cache + boundary filter** (chosen): keeps the filesystem model authoritative, makes toggling cheap and consistent, and avoids cache divergence.
- **Skip Gitignored content during scan/cache**: reduces later filtering work, but makes visibility part of the persisted cache shape and complicates instant toggling.
- **Always show Gitignored content**: simplest implementation, but too noisy for real Git-backed vaults and undermines users' existing ignore rules.

## Consequences

- Gitignored visibility is a per-installation comfort preference, not vault-authored shared metadata.
- Search, folder lists, and note reloads stay aligned because they all consult the same boundary filter.
- The cache can still support future visibility changes without a data migration.
- Users can reveal ignored content again immediately by disabling the setting.
- Future features that expose vault file lists should apply the same boundary filter unless they intentionally need raw filesystem output.
