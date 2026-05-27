---
type: ADR
id: "0129"
title: "Tolaria vault item deep links"
status: active
date: 2026-05-27
---

# ADR-0129: Tolaria vault item deep links

## Context

Users need durable links they can paste into calendars, task managers, chats, and other apps to return to a Tolaria vault item. The link needs to identify a registered vault, preserve the file extension so non-Markdown files can be opened, and fail clearly when the vault or item is unavailable. Links must not create or import files implicitly.

Mounted workspaces make vault naming non-trivial. A readable slug is useful, but two vaults can share a label, alias, or folder name. URL parsing also cannot rely only on the browser URL implementation because dot-segment normalization can hide path traversal attempts before validation runs.

## Decision

Tolaria deep links use this shape:

```text
tolaria://<vault-slug>/<relative-path-with-extension>
```

The vault slug is generated from the registered workspace alias, then label, then path basename. When two vaults would share the same base slug, generated links append a stable short hash derived from the normalized vault path. A handwritten ambiguous base slug is rejected instead of picking an arbitrary vault.

The path component is encoded per segment with `encodeURIComponent`, so spaces, Unicode, and reserved characters are preserved while `/` remains the path separator. Parsing rejects empty path segments, `.`, `..`, decoded separators inside a segment, unsafe Windows separators, and resolved paths outside the selected vault root.

`src/utils/deepLinks.ts` owns URL building, parsing, and vault resolution. `src/hooks/useDeepLinks.ts` owns renderer integration: it receives Tauri deep-link events, validates them against the registered vault list, switches vaults when needed, reloads once if the target file is not in the current index yet, opens existing Markdown/text/binary entries, reports localized errors, and emits safe PostHog outcomes. Deep links are navigation-only; they never create missing files, import external content, or infer a fallback vault.

The desktop shell registers the `tolaria` scheme through `tauri-plugin-deep-link` and keeps second launches focused through `tauri-plugin-single-instance`. Windows and Linux also call runtime `register_all()` as a repair step. macOS uses bundle scheme registration. Linux runtime registration is best-effort and is not part of the verified v1 support target.

Copy surfaces are shared actions:

- Breadcrumb overflow: `Copy note deeplink`
- Command palette: `Copy deep link to current item`
- File preview header: copy action for non-Markdown vault files

## Consequences

Path-based links are understandable and support every vault file kind, but a file rename changes the old link. A future stable item-id layer could supersede this URL shape while preserving path links as a readable fallback.

Collision handling keeps generated links deterministic without exposing full local paths. Ambiguous handwritten slugs fail clearly, which is safer than opening the wrong vault.

Renderer-owned resolution keeps the navigation logic close to mounted-workspace state and note selection. Native plugins stay responsible only for scheme registration, event delivery, and focusing the existing app instance.
