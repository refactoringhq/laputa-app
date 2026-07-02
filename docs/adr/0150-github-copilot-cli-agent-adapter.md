---
type: ADR
id: "0150"
title: "GitHub Copilot CLI agent adapter"
status: active
date: 2026-07-02
supersedes:
---

## Context

Tolaria already exposes several app-managed local AI agent adapters through one normalized AI panel contract. GitHub Copilot CLI is a mainstream local agent with programmatic `copilot -p ...` execution, per-session tool permissions, current-directory path scoping, custom instructions support including `AGENTS.md`, and MCP server support.

Users who prefer Copilot should not have to leave Tolaria or manually configure a generic/custom agent to get vault-aware assistance.

## Decision

Tolaria adds GitHub Copilot as a first-class local agent with product-facing id `copilot`.

The desktop backend:

- discovers `copilot` through PATH, login-shell lookup, and common local install locations including npm, pnpm, Bun, Mise, asdf, nvm-managed Node versions, Homebrew, and Windows npm/pnpm/Scoop shims
- runs `copilot -p <prompt> -s --no-ask-user` from the active vault directory
- passes Tolaria MCP as a per-session `--additional-mcp-config` JSON payload instead of mutating `~/.copilot/mcp-config.json`
- uses Safe mode with `--available-tools=write,tolaria`, `--allow-tool=write,tolaria`, and `--deny-tool=shell`
- maps Power User mode to `--allow-all-tools`
- intentionally avoids `--allow-all`, `--yolo`, `--allow-all-paths`, and `--allow-all-urls`
- streams line-oriented stdout through the shared agent event contract and registers the child process under the request-scoped stream id for cancellation
- maps authentication, organization policy, subscription, and directory-trust stderr into Copilot-specific setup guidance

The renderer adds Copilot to the shared AI-agent registry so the onboarding prompt, Settings target picker, command palette switch command, AI workspace target groups, and persisted `agent:copilot` target all use the same definition.

## Consequences

- Users can select GitHub Copilot anywhere Tolaria lists local/app-managed AI agents.
- App-managed Copilot sessions stay vault-scoped by current working directory and Copilot's default path verification unless the user chooses Tolaria Power User, which still does not bypass all paths or URLs.
- Tolaria does not persist Copilot credentials, model-provider secrets, or durable third-party MCP files.
- Native end-to-end QA requires a local Copilot CLI install and authentication; automated tests use fake executables for deterministic streaming and error coverage.
- Future Copilot CLI permission or MCP flag changes must update this adapter and ADR rather than falling back to broad `--allow-all` / `--yolo` behavior.
