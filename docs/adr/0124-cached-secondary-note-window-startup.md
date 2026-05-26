---
type: ADR
id: "0124"
title: "Cached secondary note window startup"
status: active
date: 2026-05-26
supersedes: "0123"
---

## Context

ADR-0123 restored secondary note windows to the normal `App` path so they retain the full vault/workspace graph required by Properties, quick open/search, wikilinks, and workspace-aware note actions.

That parity is still the product contract, but forcing a fresh Tauri `reload_vault` during every secondary-window mount invalidates the backend cache. Opening several note windows can therefore repeat expensive full-vault scans even when the main window has already warmed the cache.

## Decision

**Secondary note windows keep the full vault graph, but their initial vault load uses the cached/incremental `list_vault` path instead of the forced `reload_vault` path.**

Normal main-window startup continues to force a fresh initial reload. Explicit refresh paths, watcher-driven refreshes, and user-initiated reloads still use reload commands where they need disk freshness.

## Consequences

- Secondary note windows remain capable full app windows rather than reduced editor shells.
- Repeated note-window opens can reuse the backend vault cache instead of invalidating it on every startup.
- First open after a cold cache still scans the vault, then warms the shared backend cache for later windows.
- If the cached scan path is stale, the existing backend cache update logic remains responsible for incremental freshness.
