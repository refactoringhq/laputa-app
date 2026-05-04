---
type: ADR
id: "0109"
title: "Debounced worker-derived editor indexes"
status: active
date: 2026-05-04
---

## Context

Right side panels can need derived indexes of the active note, such as the Table of Contents hierarchy. These indexes are useful while editing, but rebuilding them synchronously during note opening or on every keystroke competes with the editor's main-thread work and violates ADR-0105's responsiveness contract.

The Table of Contents also needs live BlockNote block IDs for navigation, while the fastest and most stable source for the outline itself is the active note's Markdown content. Binding the outline rebuild directly to BlockNote document mutations makes typing and note swaps more expensive than necessary.

## Decision

**Derived editor indexes that are not required for the editor surface itself must be lazy, debounced, and built off the main thread when they can be derived from Markdown.** The Table of Contents does not build while its panel is closed; once opened, it uses a Web Worker to build its Markdown-derived H1/H2/H3 tree after a debounce, while live BlockNote block IDs are resolved only at click time for navigation.

## Options considered

- **Lazy debounced Web Worker for Markdown-derived indexes** (chosen): avoids any TOC work while the panel is closed, keeps outline parsing away from typing and note-opening work once opened, cancels stale panel updates, and lets the rendered editor remain the only editor surface. Cons: adds a small worker/client path and a title-only interim state.
- **Main-thread deferred rebuild with `setTimeout`**: avoids blocking the first render, but still runs on the UI thread and can still rebuild too often during active edits.
- **Synchronous rebuild from the BlockNote document**: simplest and gives immediate block IDs, but makes every BlockNote document update a potential side-panel rebuild.
- **Never update the TOC while editing**: safest for typing performance, but stale outlines make the panel misleading for active authoring.

## Consequences

- TOC tree state is driven by note identity plus debounced Markdown content, not by BlockNote document churn.
- Closing the TOC panel unmounts the panel and cancels pending debounce callbacks; no worker request is scheduled while the panel is closed.
- The TOC may briefly show only the note title after a note switch or edit burst; the full tree appears when the debounced worker result returns.
- Navigation remains tied to the live editor: block IDs are resolved from the current BlockNote document at click time and scrolled/focused then.
- Future derived side-panel indexes should follow the same pattern when they parse or scan note content and are not needed to render the editor itself.
