---
type: ADR
id: "0086"
title: "In-app image previews for binary vault files"
status: active
date: 2026-04-26
supersedes: "0041"
---

## Context

ADR-0041 made the vault scanner index all visible files and introduced `fileKind` as `"markdown"`, `"text"`, or `"binary"`. Binary files were deliberately shown as inert entries until Tolaria had a dedicated preview model.

That made image references visible in folder views, but opening an image still felt outside the normal Tolaria workflow. Users need to inspect screenshots, diagrams, and other image assets while keeping their place in the vault.

## Decision

**Tolaria previews supported image files in the editor pane while keeping them as ordinary binary `VaultEntry` files.**

- The scanner keeps the existing `fileKind: "binary"` representation. Image previewability is inferred in the renderer from the file extension, not by introducing a proprietary image document type.
- Opening a binary entry creates the same single active-tab state used for notes, but with empty content and no `get_note_content` text read.
- `FilePreview` renders supported image extensions through Tauri's asset protocol (`convertFileSrc`) so the original file remains on disk.
- Broken images and unsupported binary files render an explicit fallback state with an intentional "Open in default app" action instead of launching another app automatically.
- Note-list rows use an image indicator for previewable image binaries. Unsupported binary rows remain muted and non-clickable in the normal list surface.
- The preview surface is keyboard focusable and `Escape` returns focus to the note list, matching the app's keyboard-first navigation model.

## Consequences

- The existing `VaultEntry` model and cache version do not need to change.
- Supported image files can participate in normal selection/navigation context without being converted into Markdown notes.
- Unsupported/broken binary files have a clear in-app state when reached through navigation paths that can select them.
- Any future PDF, audio, or video preview should extend the same file-preview renderer rather than adding new vault-owned document representations.
