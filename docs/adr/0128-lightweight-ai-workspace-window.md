---
type: ADR
id: "0128"
title: "Lightweight AI workspace window"
status: active
date: 2026-05-26
supersedes: "0127"
---

## Context

ADR-0127 moved the AI workspace into a native Tauri window, but the first version booted the full `App` shell and used macOS overlay traffic lights. That made pop-out feel slow, duplicated startup work, and left the chat route dependent on main-window vault loading before agent turns could run.

The AI workspace also needs installation-local chat metadata so user-facing chat titles and archive state survive dock/pop-out transitions without writing to a vault.

## Decision

**The AI workspace pop-out uses a lightweight renderer route backed by app settings metadata.**

`openAiWorkspaceWindow()` opens the `ai-workspace` Tauri webview with `?window=ai-workspace` plus active vault context in URL params. `App` routes that window directly to `AiWorkspaceWindowApp`, which loads settings, AI agent status, and vault guidance without mounting the full vault/editor shell. The window is undecorated and relies on `AiWorkspace` headers for drag regions and the workspace close/dock controls.

`settings.ai_workspace_conversations` stores only chat sidebar metadata: conversation id, title, archive state, and explicit target override. Prompt text, transcripts, note content, model credentials, and vault-local configuration stay out of app settings.

## Options considered

- **Lightweight AI route** (chosen): keeps pop-out startup focused on AI state and passes explicit vault context to the agent controller.
- **Full `App` route**: preserves maximum feature parity by default, but repeats vault/editor startup work and delays a window that should contain only the AI workspace.
- **Vault-stored chat metadata**: would travel with a vault, but chat labels and archive state are installation UI preferences rather than vault content.

## Consequences

- Pop-out startup avoids full note graph loading and should be close to instant after the Tauri webview is created.
- The dedicated AI window has no native traffic lights; users close or redock it through the workspace header controls.
- Chat titles, archived state, and target overrides persist at the installation level in `settings.json`.
- Future transcript persistence must use a separate storage decision; `ai_workspace_conversations` is intentionally metadata-only.
