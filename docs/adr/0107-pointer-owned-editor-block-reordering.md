---
type: ADR
id: "0107"
title: "Pointer-owned editor block reordering"
status: active
date: 2026-05-02
---

## Context

Tolaria uses BlockNote for rich Markdown editing, Tauri for native desktop file drops, and custom editor drop handlers for images and wikilinks. BlockNote's default block drag path depends on HTML5 drag events and `DataTransfer`. On macOS inside the Tauri webview, that makes block reordering fragile because the same browser-level drag system also carries native file/image drops into the editor.

Regressions tended to oscillate: fixes that restored block dragging could break image drops, and fixes that protected native drops could make block reordering fail or lose visual feedback. The drag handle also needs editor-specific affordances: a moving block preview, an insertion separator, stale-block protection, and typography-aware positioning for the side-menu controls.

## Decision

**Tolaria owns editor block reordering as a pointer gesture that directly moves BlockNote blocks, and leaves HTML5/native drag data paths for file, image, and external drops.** The drag side menu is responsible for resolving live BlockNote blocks, computing pointer hit targets, rendering drag affordances, and aligning the hover controls to the rendered text range of the hovered block.

## Options considered

- **Pointer-owned block reordering** (chosen): separates internal block moves from native drop payloads, works without `DataTransfer`, gives Tolaria deterministic visual affordances, and can be tested with Playwright pointer/mouse actions. Cons: Tolaria now owns a small amount of hit-testing, block-move, and affordance code around BlockNote.
- **Continue using BlockNote's HTML5 drag handler**: keeps less local code, but ties internal block moves to the same unstable drag channel used by native file drops in Tauri.
- **Patch native file drops around BlockNote drag events**: might repair individual regressions, but preserves the root coupling between editor-internal reordering and external drag payload handling.
- **Disable block dragging on macOS/Tauri**: avoids the conflict, but removes an important editing workflow.

## Consequences

- Internal block reordering must not depend on `DataTransfer` or `draggable=true`.
- File/image/wikilink drop behavior remains owned by the existing editor drop abstractions and native Tauri file-drop bridge.
- Block reordering tests should use pointer or mouse movement in Playwright, and should assert the moving preview and insertion separator while the drag is in progress.
- The side menu should align to measured rendered content rather than heading-specific pixel offsets, so future theme font-size and line-height changes do not need drag-control retuning.
- Changes to BlockNote DOM structure around `.bn-block-content`, `.bn-inline-content`, `.bn-side-menu`, or block container IDs require rechecking the pointer hit-testing and side-menu alignment tests.
