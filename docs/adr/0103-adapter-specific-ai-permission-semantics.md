---
type: ADR
id: "0103"
title: "Adapter-specific AI permission semantics"
status: active
date: 2026-04-30
supersedes: "0092"
---

## Context

ADR-0092 introduced per-vault Vault Safe / Power User modes, but the first implementation left too much room for adapter drift. Some agents can directly deny or allow Bash, some expose only a sandbox/approval profile, and Pi currently has no narrower app-managed switch beyond Tolaria's transient MCP configuration. The shared UI still needs a consistent product contract: Vault Safe must not encourage shell execution, while Power User should keep shell execution available across repeated agent turns where the selected adapter supports it.

## Decision

**Tolaria treats the permission mode as a product contract first and maps it conservatively per adapter.**

- Shared AI system prompts are mode-aware on every turn, including turns with note context snapshots.
- Vault Safe tells agents not to use or advertise shell, terminal, Bash, script execution, git, or command-line tools.
- Power User tells shell-capable agents that local shell commands are available for the active vault and should remain scoped to that vault.
- Claude Code Safe excludes Bash; Power User includes and pre-approves Bash without dangerous bypass flags.
- Codex Safe uses the CLI's read-only sandbox plus untrusted approval policy; Power User uses workspace-write plus never-ask approval so shell-capable Codex turns remain low-friction across the session.
- OpenCode Safe denies bash and external directories; Power User allows bash while still denying external directories.
- Pi keeps the same conservative transient MCP config in both modes until the Pi CLI exposes a reliable app-managed shell permission switch. The prompt must not promise shell for Pi Power User.
- Gemini Safe excludes `run_shell_command`; Gemini Power User intentionally uses `yolo` with trusted transient Tolaria MCP settings.

## Consequences

- Mode behavior is no longer described solely by generic UI copy; adapter docs and tests define the exact mapping.
- Codex Vault Safe remains a best-effort safe profile rather than a true built-in-tools-off mode, because Codex CLI currently exposes sandbox and approval controls but not a dedicated switch to remove shell tooling while preserving MCP.
- Future adapters must either implement both modes explicitly or document that Power User maps to the same conservative behavior.
- If Tolaria adds a stronger warning or dangerous mode later, it needs a separate ADR and UI language.
