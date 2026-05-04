---
type: ADR
id: "0085"
title: "Per-type default folder and configurable media folders"
status: active
date: 2026-05-03
---

## Context

Two related needs surfaced together:

1. Users want pasted images and dropped videos to land in folders they control (e.g. `Media/Images/`, `Media/Videos/`) instead of the hardcoded `attachments/` directory.
2. Users want certain note types (e.g. `Journal`, `Recipe`) to default to a specific subfolder when a new note of that type is created, so the vault stays organized without manual moves.

The first is a per-installation preference (the user may organize different machines differently). The second describes the *structure of the vault itself* and should follow the vault across machines (per [ADR-0004](0004-vault-vs-app-settings-storage.md)).

The per-type folder feature interacts with [ADR-0006](0006-flat-vault-structure.md), which states all user notes live as flat `.md` files at the vault root. ADR-0006 also lists the re-evaluation trigger: "if users need nested folder hierarchies for non-type organization."

## Decision

**Two new settings live in app settings (`~/.config/com.tolaria.app/settings.json`):**

- `default_image_folder` — vault-relative folder for pasted/dropped images. Falls back to `attachments` when null.
- `default_video_folder` — vault-relative folder for pasted/dropped videos. Falls back to `attachments` when null.

**One new field lives in type-note frontmatter:**

- `_default_folder` — vault-relative folder where new notes of this type are created. Opt-in. When unset, new notes of this type go to the vault root (current behavior).

**Opt-in subfolders for *new note creation only* are now allowed.** ADR-0006 (flat vault) remains active as the *default*. Per-type folders are a deliberate opt-in escape hatch:

- Existing notes are **not** moved when a type's `_default_folder` is set or changed.
- Changing a note's type later does **not** relocate the file. Wikilinks remain title-based.
- The vault scanner already walks subdirectories — no scanner change required.
- `vault_health_check` continues to surface stray subfolder placement; folders explicitly created by a type's default are intentional and should not be flagged.

## Validation

A shared normalizer (`crate::settings::normalize_vault_relative_folder`) gatekeeps every folder string at the boundary:

- Trim whitespace
- Reject absolute paths (leading `/`)
- Reject `..` and `.` segments (path traversal)
- Normalize `\` to `/`, collapse repeated slashes, strip leading/trailing slashes
- Reject empty results

The same normalizer is applied when:

- Settings are loaded or saved (`normalize_settings` in [src-tauri/src/settings.rs](../../src-tauri/src/settings.rs))
- A type's `_default_folder` frontmatter is parsed ([src-tauri/src/vault/mod.rs](../../src-tauri/src/vault/mod.rs))
- A media file is written (`save_image`, `copy_image_to_vault`, `save_video`, `copy_video_to_vault` in [src-tauri/src/vault/image.rs](../../src-tauri/src/vault/image.rs))
- A folder is pre-created (`ensure_vault_folder` Tauri command)

Invalid values silently fall back to defaults rather than erroring.

## Consequences

- A new ADR consumer ([src/components/FolderPicker.tsx](../../src/components/FolderPicker.tsx)) is shared between the Settings panel "Media" section and the per-type Customize popover.
- Per [ADR-0008](0008-underscore-system-properties.md), the new frontmatter field uses the `_default_folder` underscore convention so it is hidden from the Properties panel.
- Asset-protocol scope (see `vault_asset_scope_roots` in [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs)) already covers the entire vault, so configurable media folders need no separate scope grant.
- Note creation paths now consult the type's `defaultFolder` via `resolveTypeTargetDir` ([src/hooks/useNoteCreation.ts](../../src/hooks/useNoteCreation.ts)). When `entries` are not available to the caller, the previous flat-root behavior is preserved.
- `save_note_content` and `create_note_content` already create parent directories via `fs::create_dir_all`, so target folders are created on demand at first save.
- **Re-evaluation trigger**: if changing a note's type ends up needing to relocate the file, the next ADR should supersede this one and ADR-0006 together with explicit move semantics. As shipped, opt-in folders affect only *new* notes.

## Alternatives considered

- **Supersede ADR-0006 entirely.** Allow nested folders everywhere with type-change auto-moves. Rejected: bigger architectural change, more migration work, and the user's request is satisfied by the opt-in scope.
- **Store default media folders in vault frontmatter.** Would follow the vault across machines via git/Syncthing. Rejected for this iteration: app settings are per-installation, which matches how other organization-style settings (release channel, theme, language) are stored. The user can re-set on each machine. Easy to revisit if users complain.
- **Skip the per-type default folder.** Ship only the media folders. Rejected: the user explicitly asked for this and the cost (one frontmatter field, one folder picker reuse) is small.
