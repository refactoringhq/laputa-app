---
type: ADR
id: "0158"
title: "Vault-write MCP tools: update_note and append_to_note"
status: active
date: 2026-07-11
---

## Context

ADR-0011 shipped the Tolaria MCP server with one writable vault tool: `create_note`. It deliberately uses `O_CREAT|O_EXCL` (`open(..., 'wx')`) so an agent can only add a new Markdown file and never overwrite an existing one. That made the tool safe to expose alongside each app-managed agent's Safe / Power User permission profile.

Issue #895 points out the gap this leaves: agents can create notes but cannot maintain living documents. An `Agent` note tracking an assistant's status, a `Project` note accumulating decisions, or frontmatter properties such as `status` / `schedule` / `related_to` all evolve over time. Today the user has to edit those notes by hand even when the agent already knows the new state, which fragments the knowledge graph and forces supplementary notes instead of in-place updates.

The MCP layer already has the building blocks for safe writes: vault-path resolution with `realpath` traversal guards (`vault.js`), a tool-service that emits `vault_changed` UI actions, and `LOCAL_CREATE_TOOL_ANNOTATIONS` (writable, non-destructive, vault-scoped) for the annotation profile. What is missing is a write primitive for existing files plus a conflict-guard primitive so a stale agent does not clobber a user's concurrent edit.

## Decision

Add two writable, non-destructive MCP tools that operate on **existing** notes inside an active vault:

- **`update_note`** — replace the full content (frontmatter + body) of an existing note. The note must already exist; use `create_note` for new notes. Accepts an optional `expectedMtime` (the `mtimeMs` returned by `get_note`). When supplied, the update fails fast with a clear `expectedMtime ... but on-disk mtimeMs is ...` error if the note changed between read and write, leaving the on-disk note untouched.
- **`append_to_note`** — append markdown verbatim to the end of an existing note body. Lower-risk than `update_note` for agents that only need to log, journal, or extend a section. Append never rewrites existing content and carries no conflict guard because it cannot lose data on its own.

Both tools are implemented in three layers, matching the existing `create_note` shape:

- `vault.js`: `getNote` returns `mtimeMs`, while `updateNote(vaultPath, notePath, content, { expectedMtime })` and `appendToNote(vaultPath, notePath, content)` both reuse `resolveVaultNotePath` for the same traversal guard as reads. `updateNote` writes atomically (temp file alongside the target, then `rename`) so a crashed write never leaves a truncated note; `appendToNote` uses `open(..., 'a')` for a single in-place append. Both write paths return the resulting `mtimeMs`.
- `tool-service.js`: `updateNote` / `appendToNote` resolve the writable vault + note path (same `writableVaultPath` / `writableNotePath` helpers as `create_note`), delegate to `vault.js`, then emit `vault_changed` so the in-memory vault index and the UI refresh. `update_note` does not auto-open a tab — it edits the note in place, and the user is usually already viewing it.
- `index.js` (stdio transport) and `ws-bridge.js` (WebSocket transport): both register the new tools. The tools reuse the existing writable annotation profile (`readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: false`) so MCP clients still treat them as non-destructive local writes that need at most the same approval as `create_note`.

`expectedMtime` is **opt-in**. Agents that want last-writer-wins semantics (the common case for chat-driven note edits) can omit it. Agents that want to fail-safe against concurrent user edits read `get_note` first and pass the returned `mtimeMs`. We intentionally compare on `mtimeMs` rather than a hash or etag because `get_note` already surfaces that field, the file system mtime is good enough for interactive editing windows, and a stricter mechanism would add complexity without covering the iCloud-sync race any better.

## Alternatives considered

- **Make `expectedMtime` mandatory** (require every `update_note` to read first): safest against lost updates, but doubles every write to a read+write and adds friction for the common single-editor agent flow. Rejected — opt-in keeps the happy path simple while leaving the safety net available.
- **Ship only `append_to_note`** (the issue's "could ship first" suggestion): lowest risk and covers changelogs/journals, but does not unblock the primary use case in #895 — updating frontmatter properties (`status`, `schedule`, `related_to`) on existing notes. We ship both so the agent can both edit and extend.
- **Add `update_note_frontmatter` (patch frontmatter, keep body)**: tempting because it would let an agent flip `status: Active → Done` without touching prose, but a targeted patch tool needs a frontmatter-merge policy (overwrite vs. union, list semantics, type coercion) that belongs in the editor, not the MCP write layer. Agents that need it today can `get_note` then `update_note` with the merged content. Re-evaluate when we see a clear agent pattern that needs atomic frontmatter patches.
- **Native file-edit tools from the app-managed agent**: the issue notes that app-managed agents already have their own file-edit permission profile, so a raw FS edit is sometimes enough. But the raw path bypasses vault-path resolution, the `vault_changed` refresh, and the conflict guard. The MCP tools keep writes inside the vault and visible to the UI.
- **In-place write (`open('w')`) instead of atomic swap**: simpler one-liner, but a crash mid-write truncates the note on disk. The atomic temp+`rename` path costs one extra syscall and removes that failure mode, which matters for a vault that is iCloud-synced.

## Consequences

Agents can now maintain evolving notes in place instead of creating supplementary notes or asking the user to edit by hand. The `get_note` → `update_note` loop with `expectedMtime` gives agents a safe read-modify-write cycle, and `append_to_note` covers the log/journal pattern without any overwrite risk.

Both writes stay inside an active vault via the existing `realpath` traversal guard, are non-destructive at the annotation level so MCP clients do not flag them for extra approval beyond `create_note`, and emit `vault_changed` so the in-memory index and the UI refresh after each write. Atomic swap means a crashed `update_note` never corrupts a note, and failed temp writes or renames attempt to remove their temporary file before returning the error.

`mcp-server/index.js` now ships 10 vault tools (was 8). The bundled `src-tauri/resources/mcp-server/{index.js,ws-bridge.js}` must be regenerated with `pnpm bundle-mcp` whenever the MCP source changes; this change regenerates both. Re-evaluate this decision if the conflict guard proves too loose for multi-agent vaults, or if a frontmatter-patch tool becomes the dominant agent pattern.
