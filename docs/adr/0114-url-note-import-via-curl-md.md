---
type: ADR
id: "0114"
title: "URL note import via curl.md"
status: active
date: 2026-05-07
---

## Context

Tolaria needs a user-facing way to turn a web page into a durable vault note. The hard parts are not the menu item or dialog. The hard parts are preserving Tolaria's note conventions, avoiding a fragile local HTML-to-Markdown parser, and making downloaded media portable inside the vault.

## Decision

Tolaria imports a URL through the `import_note_from_url` Tauri command. The command uses `curl.md` for Markdown conversion in v0.1, then Tolaria owns the on-disk result:

- It writes a root-level Markdown note with Tolaria frontmatter.
- It never stores the `curl.md` URL in `url:`.
- It uses the selected Type section as `type:` when the import starts from a Type section, otherwise `type: Note`.
- It applies Type frontmatter defaults, but does not append the Type body template.
- It writes imported media flat under `attachments/` with collision-safe names and rewrites Markdown media references to `attachments/<filename>`.
- It may set `icon:` to a supported HTTPS favicon URL, relying on the existing note icon resolver that accepts emoji, Phosphor names, and HTTP(S) image URLs.

## Consequences

- The frontend stays simple: File menu, command palette, and `Cmd/Ctrl-U` all dispatch the same app command and open the same URL dialog.
- The backend is responsible for network fetches, attachment writes, path boundaries, cache invalidation, and parsing the created file back into a `VaultEntry`.
- Tolaria can replace `curl.md` later without changing the public command, created note shape, or attachment storage contract.
- Imported attachments remain ordinary vault files. They are not nested by import and they are not tracked in a separate manifest.
