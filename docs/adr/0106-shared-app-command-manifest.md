---
type: ADR
id: "0106"
title: "Shared app command manifest"
status: active
date: 2026-05-02
---

## Context

Tolaria command metadata was split across several runtime surfaces: TypeScript owned shortcut lookup and command-palette shortcut display, Rust owned native menu IDs, labels, accelerators, aliases, and enablement groups, and the Linux titlebar fallback menu duplicated another command list. Adding or changing a command required carefully editing multiple files that could drift while still compiling.

The existing renderer-first shortcut model and native-menu dedupe remain correct, but they need a single source for metadata that must be identical across those surfaces.

## Decision

**Tolaria stores cross-runtime app command metadata in `src/shared/appCommandManifest.json`, and both the renderer and Tauri native menu derive their command/menu IDs, accelerators, menu labels, menu aliases, enablement groups, and deterministic QA metadata from it.** Context-sensitive command-palette builders still own availability and execution callbacks, and OS-native menu entries remain local to the native menu implementation.

## Options considered

- **Shared JSON manifest included by TypeScript and Rust** (chosen): works in both runtimes without code generation, keeps menu metadata reviewable, and lets tests validate drift directly.
- **Generate TypeScript and Rust constants from a schema**: gives stronger compile-time types but adds a build step and a generated-file maintenance burden for a small manifest.
- **Keep duplicated constants with more tests**: reduces immediate refactor scope, but still forces every command change through parallel manual edits.

## Consequences

- New app commands that appear in native menus or shortcut QA must be added to `src/shared/appCommandManifest.json`.
- `appCommandCatalog.ts` is responsible for turning the manifest into typed renderer helpers such as `APP_COMMAND_IDS`, shortcut lookup maps, Linux menu sections, and deterministic QA definitions.
- `src-tauri/src/menu.rs` includes the same manifest JSON, builds custom menu items from it, maps overridden menu item IDs such as `file-quick-open-alias` back to their primary command IDs, and resolves state-dependent enablement groups from manifest entries.
- Platform-native menu items such as Undo, Redo, Copy, Paste, Select All, Services, Quit, and Window controls stay in Rust because they are OS affordances, not Tolaria app commands.
- Command-palette builders continue to own dynamic labels, filtering, enabled state, and callbacks where those depend on current app state.
