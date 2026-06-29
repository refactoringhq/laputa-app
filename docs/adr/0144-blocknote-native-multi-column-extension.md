---
type: ADR
id: "0144"
title: "BlockNote native multi-column extension"
status: active
date: 2026-06-23
---

## Context

Tolaria's rich editor is BlockNote-backed and uses Markdown as the durable note format. Users need BlockNote's multi-column editing affordance so blocks can be arranged side by side without Tolaria inventing a separate editor surface or custom layout runtime.

BlockNote's core package includes column-aware internals, but the public schema extension, drop cursor, slash-menu commands, and localization bundle live in the `@blocknote/xl-multi-column` package. Recreating those pieces locally would duplicate upstream editor behavior and increase the risk of drift across future BlockNote updates.

## Decision

**Use `@blocknote/xl-multi-column` to enable native BlockNote column and column-list blocks inside Tolaria's existing rich editor schema.**

Tolaria wraps its existing schema with `withMultiColumn`, uses `multiColumnDropCursor` for side-aware block placement, and merges `getMultiColumnSlashMenuItems` into the existing slash menu. The editor supplies the multi-column dictionary alongside BlockNote's base dictionary, mapped from Tolaria's app locale with English fallback for locales BlockNote does not ship.

## Options considered

- **Use BlockNote's multi-column extension package** (chosen): keeps schema, commands, drop cursor, and localization aligned with upstream BlockNote while preserving Tolaria's single rich-editor surface.
- **Hand-build custom column blocks in Tolaria**: avoids a dependency, but duplicates ProseMirror schema/drop-cursor behavior and creates a higher maintenance burden.
- **Represent columns as Markdown tables or HTML-only blocks**: stays dependency-light, but changes editing semantics and would make side-by-side layout feel like data tables instead of document layout.

## Consequences

Multi-column blocks are first-class BlockNote document nodes and participate in existing editor selection, dragging, serialization, and recovery paths. The new package is GPL-3.0 OR proprietary, which is compatible with Tolaria's current AGPL-3.0-or-later distribution model but should be rechecked if the app's licensing changes.

Future BlockNote upgrades must include the matching `@blocknote/xl-multi-column` version and verify column serialization, drag/drop, and slash-menu behavior together with the base editor packages.
