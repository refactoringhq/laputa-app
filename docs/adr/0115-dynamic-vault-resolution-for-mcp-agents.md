---
type: ADR
id: "0115"
title: "Dynamic vault resolution for MCP agents"
status: active
date: 2026-05-08
---

## Context

When Tolaria registers its MCP server in external AI tools (Claude Code, OpenCode, Cursor, Gemini CLI), it bakes the current `VAULT_PATH` into each tool's config file (`.claude.json`, `opencode.json`, etc.). This creates a static binding between the agent and a single vault.

Tolaria already supports multi-vault: users can add, remove, and switch vaults via the status bar picker. When a vault switch happens, the app restarts the WebSocket bridge (`ws-bridge.js`) with the new `VAULT_PATH` — so agents connected through the bridge seamlessly point to the new vault. The problem is on the registration side: the config files still reference the old vault path, causing `check_mcp_status` to report `NotInstalled` after a switch, and standalone MCP sessions (without Tolaria running) start with a stale vault.

The existing vault list is already persisted as structured JSON at `~/.config/com.tolaria.app/vaults.json`, maintained by the app through `vault_list::save_vault_list()`. This file contains every configured vault, which one is active, and metadata (labels, aliases, colors). It updates immediately when the user switches vaults in the UI.

## Decision

**Tolaria's MCP server resolves the active vault dynamically at tool-call time instead of reading a baked environment variable at startup. Two new MCP tools (`list_vaults`, `switch_vault`) give agents the ability to discover and switch between configured vaults within a session.**

The resolution chain, evaluated on every tool call:

1. **Session override** — if the agent previously called `switch_vault` in this stdio session, use that path. This is a process-local variable, cleared when the MCP server exits.
2. **`VAULT_PATH` env** — if set by the ws-bridge spawn or a legacy registration, use it. This preserves backward compatibility with existing config files.
3. **`vaults.json`** — read Tolaria's persisted vault list. Use `active_vault` if set, or auto-select if exactly one vault is configured. If multiple vaults exist with no active selection, return an error directing the agent to `list_vaults` and `switch_vault`.
4. **Error** — no resolution source available. Tell the agent to open a vault in Tolaria.

Key constraints:

- **Automatic vault switching**: when the user switches vaults in Tolaria, `vaults.json` updates immediately. The agent's next MCP tool call reads the updated `active_vault` — no re-registration, no restart needed. This is the primary use case.
- **Agent-driven vault selection**: an agent can call `list_vaults` to see all configured vaults, then `switch_vault` to target a specific one. This enables cross-vault workflows (e.g., search vault A, write to vault B).
- **Session-local only**: `switch_vault` sets an in-process variable in the stdio MCP server. It never modifies `vaults.json`, `last-vault.txt`, the ws-bridge, or the Tolaria UI. When the process exits, the override is gone.
- **`switch_vault` is stdio-only**: the ws-bridge (`ws-bridge.js`) is a shared process serving multiple WebSocket clients. A process-level override would affect all clients, so `switch_vault` is not exposed there. `list_vaults` (read-only) is available in both.
- **Registration drops `VAULT_PATH`**: new registrations no longer bake `VAULT_PATH` into config files. Old configs with baked paths continue working via the env fallback (step 2).
- **`check_mcp_status` simplified**: stops checking vault-path match in config files. Answers "is Tolaria's MCP registered?" not "is it registered for this specific vault?"

## Options considered

- **Dynamic resolution via `vaults.json` + `list_vaults`/`switch_vault`** (chosen): uses existing infrastructure (`vaults.json` already maintained by the app), enables both automatic switching and agent-driven cross-vault workflows, fully backward compatible.
- **Expose `sync_mcp_bridge_vault` as an MCP tool**: would let agents trigger app-wide vault switches, but violates the principle that agents should not change the Tolaria UI state without user consent. The user controls the app; the agent controls its own session.
- **Re-register on every vault switch**: the app could rewrite all config files on each switch. Works but is fragile (race conditions with concurrent editors), requires write access to all config locations, and doesn't solve the standalone case.
- **Remove `VAULT_PATH` from env, use only `vaults.json`**: cleaner but breaks backward compatibility for users with existing registrations. The env fallback costs nothing to keep.

## Consequences

- Agents automatically follow vault switches made in the Tolaria UI — no user action needed after the initial MCP setup.
- Agents can operate on multiple vaults in a single session via `list_vaults` + `switch_vault`, enabling cross-vault workflows.
- The Tolaria UI is never affected by agent vault operations — `switch_vault` is session-local and read-only from the app's perspective.
- Existing registrations with baked `VAULT_PATH` continue working without re-registration.
- `check_mcp_status` becomes less precise (doesn't verify vault match), but the tradeoff is correct: vault correctness is now a runtime concern, not a registration concern.
- The stdio MCP server can start without `VAULT_PATH` set, enabling simpler config files and reducing the coupling between registration and runtime.
- Re-evaluation trigger: if Tolaria adds a server-side vault context (e.g., cloud sync, remote vaults), the resolution chain may need a network-aware source.
