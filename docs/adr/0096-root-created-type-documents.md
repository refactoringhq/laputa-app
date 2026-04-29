---
type: ADR
id: "0096"
title: "Root-created type documents"
status: active
date: 2026-04-29
---

## Context

Tolaria identifies type definitions by markdown frontmatter (`type: Type`), not by filesystem location. Older documentation and UI creation flows still treated `type/` as the canonical destination for new type documents, with a compatibility fallback for vaults that already used `types/`.

That folder-based creation policy conflicted with the broader vault model: notes are scanned from all non-hidden folders, type identity comes from metadata, and root `type.md` / `note.md` definitions are already used by repair and bootstrap flows.

## Decision

**Tolaria creates new type documents at the vault root.**

- A type document is any markdown note with `type: Type` in frontmatter.
- New UI-created type documents use `{vault}/{slug}.md`.
- Existing type documents in `type/`, `types/`, or other scanned folders remain valid and continue to drive templates, icons, colors, visibility, sorting, and sidebar grouping.
- Creation does not silently migrate or move existing type documents.
- Root filename collisions are handled as file collisions; Tolaria must not overwrite an existing note when creating a type document.

## Options considered

- **Root-created type documents** (chosen): matches the metadata-first model, removes special casing from creation, and aligns new types with root-managed default type scaffolding.
- **Canonical `type/` folder**: avoids root filename collisions, but makes path special even though type identity is already defined by frontmatter.
- **Preserve existing folder convention dynamically**: minimizes change for plural `types/` vaults, but creates inconsistent behavior across vaults and leaves `types/` only partially supported.

## Consequences

- Users can inspect and edit type documents as ordinary root notes by default.
- Existing vaults with `type/` or `types/` type documents remain readable because vault scanning already includes non-hidden subdirectories.
- If a root note with the same slug already exists, type creation fails with a collision message instead of writing into a fallback folder.
- Legacy `type/` may remain hidden from the folder tree so old type documents do not duplicate the Types sidebar section.
- Re-evaluate if users need a guided migration from folder-based type documents to root type documents.
