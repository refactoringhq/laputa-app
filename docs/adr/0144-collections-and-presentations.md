---
type: ADR
id: "0144"
title: "Collections carry presentation configuration"
status: active
date: 2026-06-24
---

## Context

Tolaria already has several ways to select a group of notes: built-in sidebar filters such as All Notes and Inbox, type sections, folder rows, saved Views, and Neighborhood mode around one note. Product-wise, these are all collections of notes. The current implementation still routes most of them through a component named `NoteList`, which makes the list presentation look like the domain model.

Spreadsheets also introduced a parallel single-note concern: a note can keep the same durable identity while choosing a different display mode through `_display`. Collections need the same separation between the notes being selected and how those notes are presented. Future presentations such as boards, calendars, tables, timelines, and graphs need presentation-specific field mappings, such as board column field, calendar start/end fields, or table columns, without inventing a parallel data model.

## Decision

**Tolaria treats a Collection as the internal representation of a selected group of notes plus its presentation configuration.** A collection can be built from a saved View YAML file, a type section, a built-in sidebar filter, a folder, or Neighborhood mode. The first supported presentation is `list`, preserving current behavior.

Saved Views remain the most configurable persisted collection artifact. Existing top-level saved-view fields (`sort`, `listPropertiesDisplay`, `filters`, `order`, `name`, `icon`, `color`) remain valid. The renderer normalizes them into an in-memory collection presentation:

```yaml
presentation:
  type: list
  sort: modified:desc
  properties:
    - status
    - owner
```

Future saved-view YAML may store nested `presentation` configuration. For compatibility, Tolaria reads legacy top-level list fields and lets nested `presentation.type: list` override them in memory. The current implementation does not rewrite existing YAML into the nested shape.

`SidebarSelection` remains the navigation input for now. Renderer code adapts it to `CollectionDefinition` through `src/collections/collectionFromSelection.ts`, and resolves visible entries through `src/collections/resolveCollectionEntries.ts`. This is an implementation bridge, not a new user-visible concept.

## Options considered

- **Use one Collection concept with nested presentation config** (chosen): keeps the product model small, matches saved-view YAML, and lets built-in sections and type sections behave like generated collections without exposing separate "source" terminology.
- **Separate CollectionSource and CollectionPresentation concepts everywhere**: precise internally, but adds vocabulary and wiring before Tolaria has multiple presentations. It remains a possible implementation detail later, not a product concept now.
- **Keep adding one-off branches to NoteList/App.tsx**: fastest for the next feature, but makes boards, calendars, and graph-like surfaces compete with list-specific assumptions.
- **Use `kind` on saved views**: already explored in prior Kanban work, but `kind` is vague and "view" is overloaded across saved Views, app view mode, and note display. `presentation.type` is clearer and leaves room for presentation-specific config.

## Consequences

- Current UI behavior remains unchanged: every existing collection still renders as the list presentation.
- New collection presentations should consume resolved notes and presentation config instead of reimplementing sidebar filtering.
- Presentation config maps existing note properties; it must not create a separate data store. A board groups notes by a property, a calendar maps notes to date properties, and a table chooses visible property columns.
- Saved-view YAML remains portable and Git-syncable. Nested presentation config should be added compatibly and only written when a user edits presentation settings.
- Note display modes remain a separate per-note concern owned by `_display` and ADR-0134. Collection presentations operate across notes; note display modes interpret one note.
- Community plugin surfaces should wait until at least two internal collection presentations exist, so the host API can be based on proven capabilities rather than speculative extension points.
