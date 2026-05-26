---
id: "0126"
title: "Renderer action history for app-level undo and redo"
status: "active"
date: "2026-05-26"
supersedes:
  - "0106"
---

# ADR-0126: Renderer action history for app-level undo and redo

## Context

Tolaria already lets native text surfaces keep their own undo stacks, but app-level state changes such as frontmatter edits, archive toggles, favorite toggles, and organization toggles did not share a consistent undo/redo model. Routing all Undo and Redo through the native menu items left these app actions one-way while also making command-palette discoverability inconsistent.

## Decision

Introduce a renderer-owned `useActionHistory` stack for app-level actions. Supported actions record explicit undo and redo callbacks only after the write succeeds, clear redo after new user actions, and suppress nested recordings while a history entry is replaying.

The Edit menu and command manifest now route Undo and Redo to renderer commands. Focused text-editing controls still receive native text history first through `document.execCommand('undo' | 'redo')`, so editor/input undo behavior remains separate from the app action stack.

Destructive actions that are not safely reversible remain outside this stack and continue to rely on confirmation/destructive UX instead of pretending to be undoable.

## Consequences

- App-level history is scoped to the active renderer session and is not persisted across launches.
- Undo/redo labels can be surfaced in the command palette because the top stack entries expose labels.
- Menu accelerators and keyboard shortcuts use the shared command manifest instead of Tauri's native Undo/Redo menu builders.
- ADR-0106 remains valid for the broader menu ownership model, but its native Undo/Redo exception is superseded by this renderer action-history route.
