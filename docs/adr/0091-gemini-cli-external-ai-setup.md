---
type: ADR
id: "0091"
title: "Gemini CLI external AI setup"
status: active
date: 2026-04-28
---

## Context

Tolaria already supports explicit MCP setup for external desktop AI tools. Users asked for Gemini CLI support so the same active-vault MCP server can be registered where Gemini reads tool configuration, with optional Gemini-specific vault guidance.

Gemini CLI reads MCP server definitions from `~/.gemini/settings.json` and can load project guidance from `GEMINI.md`. Tolaria must support those conventions without silently rewriting global user settings or overwriting user-authored vault instructions.

## Decision

Tolaria adds `~/.gemini/settings.json` to the explicit external AI setup path list. The existing MCP entry shape is reused: `mcpServers.tolaria` runs the packaged stdio server through Node.js, pins `VAULT_PATH` to the selected vault, and sets `WS_UI_PORT=9711`.

Vault guidance keeps `AGENTS.md` as the canonical shared source. `restore_vault_ai_guidance` can create or repair a managed `GEMINI.md` shim that imports `AGENTS.md`, while bootstrap and repair flows continue to seed only required Tolaria guidance (`AGENTS.md` and `CLAUDE.md`) plus type scaffolding. Custom `GEMINI.md` files are classified as custom and are not overwritten.

The setup dialog documents that Gemini CLI still needs its own install and sign-in. Tolaria does not store Gemini credentials or model-provider API keys.

## Options Considered

- **Add Gemini to explicit MCP setup and optional guidance restore** (chosen): matches the existing consent boundary, preserves user settings, and gives Gemini the shared vault context.
- **Generate `GEMINI.md` automatically for every vault**: simpler discovery, but turns an optional third-party compatibility file into startup side effect and dirties vaults for users who do not use Gemini.
- **Document manual Gemini setup only**: avoids code changes, but leaves users to transpose paths and loses the active-vault safety already available for other MCP clients.
- **Create a Gemini-specific MCP entry shape**: unnecessary because Gemini accepts the same `mcpServers` entry structure used by the existing Tolaria MCP server.

## Consequences

- External AI setup now writes/removes Tolaria's MCP entry in Claude, Gemini, Cursor, and generic MCP config files.
- Gemini users can create a managed `GEMINI.md` shim without duplicating the canonical `AGENTS.md` guidance.
- Existing vault bootstrap and repair remain non-invasive for users who do not use Gemini.
- Native QA requires a local Gemini CLI install and authentication for an end-to-end Gemini prompt; otherwise the app can still verify the generated config and documentation paths.
