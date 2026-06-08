---
type: ADR
id: "0138"
title: "Excalidraw support across .excalidraw files and embedded markdown diagrams"
status: active
date: 2026-05-29
---

## Context

Tolaria already supports two diagram surfaces inside notes — Mermaid (ADR-0088) and tldraw whiteboards (ADR-0107) — both authored as markdown-durable fenced blocks via the shared `DurableBlockCodec` pattern in `src/utils/durableMarkdownBlocks.ts`. Users frequently keep `.excalidraw` files in their vaults today (created in the standalone Excalidraw web app or Obsidian) and want to preview and edit them in place, plus they want a hand-drawn diagram option that lives next to the prose, not in a separate file.

`@excalidraw/excalidraw@0.18.x` declares `react: ^17 || ^18.2 || ^19` peer dependency — compatible with Tolaria's React 19.2 runtime.

## Decision

**Tolaria will support Excalidraw as a first-class diagram surface on two routes, sharing one editable canvas component.**

The implementation:

- **Embedded:** A fenced `excalidraw` block in `.md` notes, round-tripped via the existing `DurableBlockCodec` pattern (cloned from `tldrawMarkdown.ts`). Block props: `boardId`, `height`, `width`, `snapshot` (Excalidraw scene JSON as a string). Fence header: ` ```excalidraw id="…" height="…" width="…" `. Slash command `/excalidraw` inserts an empty block.
- **Standalone files:** `.excalidraw` is added to `TEXT_EXTENSIONS` in `src-tauri/src/vault/mod.rs` so the vault scanner indexes it as `file_kind: "text"`. The frontend Editor branches on the `.excalidraw` extension and mounts `ExcalidrawFileEditor` instead of the raw-text editor for non-md text files.
- **Shared component:** `ExcalidrawCanvas` is lazy-loaded with React Suspense, used by both the embedded block and the file editor. Props: `boardId`, `snapshot`, `onSnapshotChange`, `height`, `width`, `readOnly`, `fillParent` (file editor opts in to fill its container). The component consumes `initialData` only on mount; callers must remount via React `key` to load a different scene (`ExcalidrawFileEditor` keys on `path`).
- **Persistence:** Edits debounce at 350 ms (matching tldraw) and flow through the existing `save_note_content` IPC — no new commands. Autosave is gated behind a first-user-interaction flag inside `ExcalidrawCanvas` so simply opening a `.excalidraw` file never rewrites it; pending debounced edits flush synchronously on canvas unmount. Storage is fully in the source file (markdown fence or `.excalidraw` JSON file).
- **Malformed input:** Both surfaces fall back to a read-only raw-JSON view with an error banner; no autosave overwrites a bad state until the canvas re-emits a valid snapshot.

Session state (camera position, selection, active tool) is not persisted. Embedded image assets in the Excalidraw scene's `files` field are explicitly deferred — same deferral as ADR-0107 made for tldraw assets — and would land in vault-relative attachment paths when introduced.

## Options considered

- **Markdown-durable fenced block + plain `.excalidraw` JSON file** (chosen): keeps both surfaces in the filesystem, reuses the existing codec pattern with zero new IPC, and matches the precedent set by Mermaid and tldraw.
- **Excalidraw built-in IndexedDB persistence**: simplest library integration, but violates the vault-as-source-of-truth rule and would lose work when browser storage is cleared. Same reason ADR-0107 rejected it for tldraw.
- **Sidecar `.excalidraw` files referenced from markdown**: separates ownership and complicates git history for small edits embedded in a note.

## Consequences

- New dependency: `@excalidraw/excalidraw`, lazy-loaded; bundle impact monitored at merge time.
- `src/utils/excalidrawMarkdown.ts` is the canonical parser/serializer bridge.
- `src/components/ExcalidrawCanvas.tsx` is the only file importing the Excalidraw runtime.
- `src/components/ExcalidrawFileEditor.tsx` owns the standalone-file route.
- `src/components/editorSchema.tsx` registers `excalidrawBlock` alongside `tldrawBlock` and `mermaidBlock`.
- Raw mode remains the direct source editor for the fenced JSON inside `.md`, and shows the raw JSON for `.excalidraw` files when the user explicitly toggles raw mode.
- Asset support is deferred per the same path ADR-0107 outlined for tldraw.
