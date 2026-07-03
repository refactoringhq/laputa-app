---
type: ADR
id: "0154"
title: "Sandboxed fenced HTML blocks"
status: active
date: 2026-07-03
---

## Context

Tolaria notes are local Markdown files, and users need a deliberate way to place small static HTML surfaces inside a note without giving that markup Tolaria, Tauri, filesystem, or vault privileges. Plain fenced `html` code blocks are portable and familiar, but rendering them directly in the editor DOM would create XSS, navigation, and credential-exposure risks.

The feature needs to feel block-native: insertable from the slash menu, editable from the rich editor, vertically resizable, and still saved as readable Markdown.

## Decision

**Tolaria treats fenced `html` blocks as Markdown-durable `htmlBlock` nodes rendered inside sanitized, opaque-origin sandboxed iframes.** The portable storage format is a fenced `html` block with an explicit optional `height` attribute, and scripts/forms/same-origin/top-navigation privileges are not granted to the iframe.

## Options considered

- **Sandboxed iframe with durable fenced Markdown** (chosen): keeps the vault format readable, preserves local-first portability, blocks parent DOM and Tauri access by construction, and lets CSS-only/static HTML interactions work in a contained surface.
- **Render sanitized HTML directly in the editor DOM**: simpler and easier to style, but still shares origin and DOM with Tolaria and is too easy to regress into app-privileged execution.
- **Treat HTML only as syntax-highlighted code**: safest, but fails the product goal of an interactive embed-like local HTML block.
- **Support arbitrary JavaScript with opt-in permissions**: powerful, but would require a separate capability model, user prompts, and abuse-resistant API boundaries that are outside this decision.

## Consequences

- Existing fenced `html` blocks render as interactive HTML blocks in rich mode without migration.
- Resizing persists by serializing `height="..."` on the `html` fence; if the metadata is missing or invalid, Tolaria uses the default block height.
- The renderer sanitizes dangerous tags, event handlers, `javascript:` URLs, nested browsing contexts, and remote-loading attributes before producing iframe `srcdoc`.
- The iframe uses a restrictive Content Security Policy and omits `allow-scripts`, `allow-forms`, `allow-same-origin`, and top-navigation sandbox tokens.
- External links are rewritten for a new browsing context with `noreferrer noopener`; future native-open integration can supersede this if Tolaria needs stricter system-browser routing from inside iframe content.
- Code that needs full web-app hosting, script execution, vault-file access, Tauri IPC, or app credentials must use a separate future product decision rather than extending this block implicitly.
