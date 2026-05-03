---
type: ADR
id: "0090"
title: "Pi CLI agent adapter"
status: active
date: 2026-04-28
---

## Context

Tolaria already supports Claude Code, Codex, and OpenCode as local CLI agents in the AI panel. The next provider request is Pi Coding Agent support with the same first-class availability, settings, status, streaming, and MCP vault access.

Pi exposes non-interactive JSON events through `pi --mode json`, but Pi core intentionally does not include built-in MCP. Its supported MCP path is the `pi-mcp-adapter` extension, which reads MCP server definitions from Pi-compatible config files.

## Decision

Tolaria adds Pi as a supported CLI agent id (`pi`) and launches app-managed Pi sessions through a dedicated adapter module.

The adapter runs `pi --mode json --no-session` from the active vault cwd, closes stdin, and points `PI_CODING_AGENT_DIR` at a temporary directory containing Tolaria's `mcp.json`. That config loads the Tolaria MCP server through `pi-mcp-adapter`, pins `VAULT_PATH` to the selected vault, sets `WS_UI_PORT=9711`, uses lazy server lifecycle, and exposes the small Tolaria tool set directly.

Pi availability follows the existing desktop pattern: check the inherited `PATH`, the user's login shell, and common local/toolchain install locations. Pi authentication remains owned by the Pi CLI; Tolaria only surfaces setup errors and does not store provider API keys.

## Options Considered

- **Transient Pi adapter config** (chosen): gives app-launched Pi sessions Tolaria MCP access without mutating user or vault config files. Cons: requires the Pi MCP adapter extension path to be available to Pi.
- **Write `.mcp.json` into the active vault**: simple for Pi discovery, but creates project files as a side effect of a chat session and can dirty user vaults.
- **Rely on global `~/.pi/agent/mcp.json`**: matches Pi documentation, but silently retargets or depends on user-global state and conflicts with Tolaria's explicit integration boundary.
- **Skip MCP for Pi**: easier to implement, but creates a weaker agent than the existing providers and violates the requirement for first-class MCP support.

## Consequences

- The AI panel, settings, command palette, status bar, onboarding, and stream normalization now treat Pi as a first-class supported agent.
- App-launched Pi sessions can use Tolaria vault MCP tools while remaining scoped to the selected vault.
- Pi support stays isolated in Pi-specific modules instead of expanding the shared `ai_agents.rs` hotspot.
- Users still need Pi itself, a configured Pi model/provider, and the Pi MCP adapter extension path available to the Pi CLI.
