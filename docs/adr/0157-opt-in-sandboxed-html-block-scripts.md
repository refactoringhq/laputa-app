---
type: ADR
id: "0157"
title: "Opt-in sandboxed scripts for HTML block dashboards"
status: active
date: 2026-07-06
---

## Context

ADR-0156 added renderer-owned vault expressions to sandboxed HTML blocks and explicitly avoided iframe scripting. That keeps simple scalar interpolation safe, but it leaves richer dashboards with two bad options: add Tolaria-specific template directives such as `data-repeat`, or add expression functions that generate markup directly.

Relationship-backed dashboards need a more general way to transform structured resolved data into DOM without expanding Tolaria's custom template language.

## Decision

**HTML block scripts are blocked by default and may run only when the fence explicitly opts into `scripts="sandboxed"`.**

In sandboxed-script mode, Tolaria grants iframe `allow-scripts` but not `allow-same-origin`, forms, top navigation, or parent access. The iframe CSP keeps `default-src`, `connect-src`, `worker-src`, `frame-src`, and `form-action` locked to `'none'`; only inline scripts in the authored block may execute. Remote script URLs and non-data script attributes are stripped.

Vault expressions still do not evaluate JavaScript. Instead, the expression layer adds `json(...)`, which serializes resolved values as safely escaped JSON for `<script type="application/json">`. Wikilink values and wikilink relationship arrays serialize to structured note objects containing title, target, path, status, raw value, and Tolaria deep link when available. Authored sandboxed JavaScript can then use standard DOM APIs to render the data.

## Consequences

- Static HTML blocks keep the previous no-script security posture.
- Dynamic dashboards can use ordinary web-platform JavaScript instead of Tolaria-only template directives or markup-generating expression helpers.
- Sandboxed scripts remain isolated from the app origin and Tauri IPC because the iframe keeps an opaque origin.
- Network fetches, workers, nested frames, forms, remote scripts, and remote loading attributes remain blocked by CSP and sanitization.
- User-authored scripts can still spend CPU inside their own iframe; performance-sensitive dashboards should keep data payloads small and DOM updates incremental.
- ADR-0156's reference syntax, line-reference semantics, deterministic formatting functions, and dependency model remain in force. This ADR only amends its "no iframe scripting" consequence for the explicit sandboxed opt-in.
