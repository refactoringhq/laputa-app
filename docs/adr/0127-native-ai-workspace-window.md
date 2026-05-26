---
type: ADR
id: "0127"
title: "Native AI workspace window"
status: active
date: 2026-05-26
---

## Context

The AI panel used to behave like another right-side editor panel. That kept the agent UI inside the main Tolaria window even when the user undocked it, so the "floating" surface could not be moved to another macOS space or placed beside Tolaria as a real window.

The AI surface also needed to support multiple chat sessions, per-chat target selection, and a single header that does not duplicate the old panel title and permission controls.

## Decision

**The AI surface is a renderer-owned `AiWorkspace` that can run either docked in the main app or in a dedicated native Tauri webview window labeled `ai-workspace`.**

The docked and native-window modes share the same React workspace component. The native window boots the normal `App` path with `?window=ai-workspace`, skips main-window size constraints, and uses macOS overlay traffic lights. Close and minimize requests from that window emit a dock request back to the main window before destroying the pop-out window.

## Options considered

- **Native Tauri window** (chosen): gives macOS users real window movement, traffic lights, and normal desktop window management; requires route/window-mode plumbing and explicit dock events.
- **CSS floating panel inside the main window**: simple and preserves component state in one renderer, but it cannot leave the main window bounds and fails the expected macOS behavior.
- **Separate full AI app shell**: isolates the workspace, but would duplicate vault loading and settings flows more than necessary.

## Consequences

- The status-bar AI affordance opens the workspace; target selection now belongs in the workspace header.
- `AiWorkspace` owns multi-chat sidebar state and filters target choices to installed local agents plus configured local/API model providers.
- The old `AiPanel` remains the reusable transcript/composer surface, but its header and prompt/focus effects can be disabled when mounted inside workspace sessions.
- Pop-out/dock currently transfers the workspace at the window level; future persistence can promote active conversations into a shared store if users need exact in-flight chat reparenting across renderer instances.
