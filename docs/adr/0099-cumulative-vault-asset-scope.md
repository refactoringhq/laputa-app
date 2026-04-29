---
type: ADR
id: "0099"
title: "Cumulative vault asset scope for previews"
status: active
date: 2026-04-29
supersedes: "0074 asset-protocol runtime scoping"
---

## Context

ADR-0074 moved the desktop asset protocol away from broad filesystem access and toward runtime vault scoping. The implementation tried to keep only the active vault in scope by calling Tauri's `forbid_directory` for vault roots that were no longer active.

Tauri's filesystem scope treats forbidden paths as permanent precedence rules: a forbidden path is denied even if it is later allowed again. After a user switched away from a vault and back, image and PDF previews could keep producing `403 Forbidden` responses for valid vault files until the app restarted.

## Decision

**Tolaria accumulates Tauri asset protocol access for vault roots loaded during the current app session and never forbids a previously loaded vault root at runtime.**

- `sync_vault_asset_scope` adds the canonical vault root and requested vault root when they are missing from the runtime asset scope.
- The runtime asset scope remains narrower than global filesystem access because only vault roots that Tolaria has loaded are added.
- Command paths still enforce the active vault boundary through the Rust command layer before reads, writes, external opens, and attachment imports.
- Asset scope revocation is deferred to process exit, because Tauri does not expose a safe runtime unallow operation for directories.

## Options considered

- **Cumulative runtime vault scope** (chosen): keeps previews reliable after vault switches while preserving vault-only access in the current process.
- **Continue forbidding previous vaults**: appears stricter, but Tauri forbids are not reversible and valid previews fail after switching back.
- **Allow all filesystem paths**: avoids preview failures but returns to the broad asset protocol access that ADR-0074 intentionally removed.
- **Replace `convertFileSrc` with a custom protocol**: could support exact active-vault revocation, but it would be a larger cross-cutting migration for editor images, file previews, and PDF rendering.

## Consequences

- Images and PDFs from any vault loaded in the current session can keep rendering after vault switches.
- The app process, not each vault switch, is the revocation boundary for asset URL access.
- Active-vault command validation remains the primary guard for mutations and default-app opens.
- Re-evaluate this if Tauri adds a public runtime unallow operation for asset protocol directories.
