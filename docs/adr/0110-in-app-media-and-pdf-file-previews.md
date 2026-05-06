---
type: ADR
id: "0110"
title: "In-app media and PDF previews for binary vault files"
status: active
date: 2026-05-05
supersedes: "0098"
---

## Context

ADR-0098 extended Tolaria's file-first preview model from images to PDFs while keeping binary files as ordinary `VaultEntry` records. In practice, vaults also carry voice notes, interview recordings, screen captures, and short clips that users need to inspect in context without round-tripping through another app.

The existing binary preview architecture already had the important constraints in place:

- previewability should stay a renderer concern inferred from filename extension rather than a persisted schema field
- preview access should stay inside Tauri's scoped asset protocol instead of broad filesystem reads
- external-open actions must still re-enter the active-vault command boundary before delegating to the OS

Audio and video support should extend that same model rather than introducing a separate asset or media subsystem.

## Decision

**Tolaria previews supported image, audio, video, and PDF files in the editor pane while keeping them as ordinary binary vault files.**

- The scanner keeps the coarse `fileKind: "binary"` representation; `src/utils/filePreview.ts` infers preview support from safe extension allow-lists.
- `FilePreview` remains the single renderer-owned preview surface for supported binary files.
- Images continue to render through `<img>`, PDFs through the webview PDF object renderer, and audio/video through native HTML media controls, all backed by Tauri asset URLs from `convertFileSrc`.
- The Tauri CSP must allow scoped asset URLs in `media-src` for audio/video and in `object-src` for PDFs without broadening script or network permissions.
- Note-list rows for previewable media stay clickable and use file-specific affordances; unsupported binaries remain ordinary files with explicit fallback/open-external paths.

## Alternatives considered

- **Extend the existing FilePreview model to media** (chosen): keeps one binary-preview surface, reuses scoped asset access, and avoids new persisted file categories. Cons: native media controls are intentionally minimal.
- **Open audio and video only in the default app**: simpler implementation, but breaks in-context review for media-heavy vaults.
- **Introduce dedicated persisted media file kinds or a separate media library**: could support richer metadata later, but adds schema and scanner complexity for files that should remain normal vault entries.

## Consequences

- Audio and video do not become notes and do not get special persistence semantics.
- Tolaria's binary preview surface now covers the common safe media formats without changing cache shape, scanner output, or the filesystem-first model.
- Scoped runtime asset access and active-vault command validation remain the security boundary for binary previews and external-open actions.
- Re-evaluate this decision if Tolaria later needs editing, waveform/timeline tooling, subtitles, or transcoding, because those would justify a richer media-specific subsystem.
