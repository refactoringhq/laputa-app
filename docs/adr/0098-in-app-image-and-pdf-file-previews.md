---
type: ADR
id: "0098"
title: "In-app image and PDF previews for binary vault files"
status: superseded
date: 2026-04-29
supersedes: "0086"
superseded_by: "0110"
---

## Context

ADR-0086 introduced the `FilePreview` path for image binaries while keeping binary files as ordinary `VaultEntry` records. The same file-first model should now cover PDFs, because asset-heavy vaults often mix screenshots, diagrams, and document exports that users need to inspect without leaving Tolaria.

## Decision

**Tolaria previews supported image and PDF files in the editor pane while keeping them as ordinary binary vault files.**

- The scanner keeps the coarse `fileKind: "binary"` representation. Previewability stays a renderer concern inferred from the file extension in `src/utils/filePreview.ts`.
- Supported images render with `<img>` and supported PDFs render with the webview PDF object renderer, both using Tauri asset URLs from `convertFileSrc`.
- The Tauri CSP permits scoped asset URLs in `object-src` so PDF objects can load vault-backed files without broadening script, connect, or image policy.
- PDF preview fallback content lives inside the PDF object so unsupported or failed renderers still expose an explicit "Open in default app" escape hatch.
- Note-list rows for previewable images and PDFs remain clickable and carry file-specific indicators; unsupported binary rows stay muted and non-clickable.
- `Escape` on the preview surface returns keyboard focus to the note list, matching the existing image-preview keyboard behavior.

## Consequences

- PDFs do not become notes and do not get Markdown editor semantics.
- The asset preview surface can keep growing to additional safe binary formats without changing the vault scanner or persisted cache shape.
- Broken PDFs may rely on the webview's own renderer failure state, but the surrounding Tolaria preview chrome still provides reveal, copy path, and default-app actions.
