---
type: ADR
id: "0142"
title: "Rich editor ProseMirror decoration dependency"
status: active
date: 2026-06-22
---

## Context

Tolaria's rich editor needs per-node RTL rendering for quote blocks whose Markdown begins with an Obsidian callout marker such as `[!note]`. Browser `dir="auto"` sees the Latin marker first and resolves the quote as LTR, leaving the quote rail on the left even when the title/body are Hebrew or Arabic.

External DOM patching is not reliable here because BlockNote/ProseMirror owns those nodes and can replace them after mutations. The styling decision must be expressed through the editor render pipeline.

## Decision

Add `@tiptap/pm` as a direct dependency and use ProseMirror decorations from a BlockNote extension for rich-editor text-direction overrides.

The extension decorates RTL quote nodes with Tolaria-specific direction attributes/classes. CSS then uses those stable decoration attributes to move quote rails to the logical start side.

## Alternatives considered

- **ProseMirror decorations via `@tiptap/pm`** (chosen): uses the editor's supported render layer and avoids DOM reconciliation fights. Cons: makes a transitive ProseMirror facade dependency direct.
- **MutationObserver DOM patching**: avoids a direct dependency, but ProseMirror strips or replaces externally mutated editor nodes.
- **Pure CSS logical properties only**: works when the element's direction is already correct, but cannot ignore leading callout marker syntax when computing direction.

## Consequences

Rich-editor RTL quote and callout-marker rendering can be tested deterministically through the existing BlockNote render path. Future per-node editor presentation rules should prefer ProseMirror decorations over post-render DOM mutation when the target node is owned by BlockNote.
