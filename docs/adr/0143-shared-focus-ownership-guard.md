---
type: ADR
id: "0143"
title: "Shared focus ownership guard"
status: active
date: 2026-06-23
---

## Context

Tolaria has multiple renderer surfaces that intentionally reject programmatic focus while another surface owns keyboard input. The rich editor must not steal focus back from the Properties panel, and the sheet editor must not let IronCalc autofocus reclaim keyboard capture after focus moves to app chrome or dialogs.

The editor and sheet implementations previously installed separate `HTMLElement.prototype.focus` patches and separate document focus listeners. That duplicated lifecycle made unmount order matter: removing one surface guard could restore the native focus method while another guard was still mounted.

## Decision

Use one shared focus ownership registry for global focus interception.

`src/hooks/focusOwnershipGuard.ts` owns the single `HTMLElement.prototype.focus` patch, document focus/pointer listeners, outside-target memory, blocked-focus restoration, and cleanup. Surface modules register scoped ownership policy:

- `src/hooks/editorFocusOwnership.ts` decides when rich-editor focus is suspended or resumed.
- `src/components/sheet-editor/useGuardedWorkbookFocus.ts` decides when workbook focus requires active sheet keyboard capture and no external focus surface.

## Alternatives considered

- **Shared global registry with surface-owned policy** (chosen): removes duplicate patch/listener lifecycle while preserving editor and sheet behavior locally.
- **Keep stacked surface-specific patches**: minimizes immediate movement but keeps cleanup-order bugs and duplicated outside-focus restoration.
- **Move all editor and sheet focus policy into one module**: centralizes more code, but mixes unrelated surface rules and makes future policy changes harder to review.

## Consequences

Only the shared guard may patch `HTMLElement.prototype.focus` or install document-level focus ownership listeners. New editor-like surfaces should register a scoped policy through the shared guard instead of adding another prototype patch.
