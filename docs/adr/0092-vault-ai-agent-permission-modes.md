---
type: ADR
id: "0092"
title: "Vault-scoped AI agent permission modes"
status: active
date: 2026-04-28
---

## Context

ADR-0074 established explicit setup and least-privilege defaults for desktop AI tools. The in-app AI panel now supports multiple local CLI agents, and users need a clear per-vault way to choose whether an agent should stay in the narrow vault-safe profile or use broader local-work tools for that vault.

The mode must be visible at the point of use, must not mutate global CLI settings, and must not silently restore dangerous bypass flags. Existing transcripts should remain intact when the mode changes because a change applies to the next agent run, not to a process that is already streaming.

## Decision

**Tolaria stores an `ai_agent_permission_mode` per vault with values `safe` and `power_user`, defaulting missing or null values to `safe`, and passes that normalized mode through the AI panel stream request into each CLI adapter.**

The AI panel header displays the current mode and offers a compact Vault Safe / Power User control that is disabled while an agent run is active. Changing the mode preserves the transcript and inserts a local transcript marker.

Adapter mappings remain conservative:
- Claude Code Safe keeps `acceptEdits`, strict Tolaria MCP config, and file/search/edit tools only; Power User adds Bash to the allowed tool list without using `--dangerously-skip-permissions`.
- Codex keeps the active-vault `workspace-write` sandbox and `--ask-for-approval never` in both modes.
- OpenCode uses transient `OPENCODE_CONFIG_CONTENT`; Safe denies bash and external directories, while Power User allows bash but still denies external directories.
- Pi receives the mode on the adapter request path; both modes currently use the same transient MCP adapter config.

## Options Considered

- **Per-vault Safe / Power User modes** (chosen): makes the permission surface explicit where the agent is used and preserves least-privilege defaults for each vault.
- **Global app setting**: simpler storage, but a single toggle can over-apply a power-user profile to unrelated vaults.
- **Dangerous bypass mode**: maximizes CLI freedom, but violates ADR-0074's least-privilege boundary and needs a separate explicit security decision.
- **Adapter-specific UI switches**: exposes too much implementation detail and makes cross-agent behavior harder to reason about.

## Consequences

- Vault config normalization owns the safe default for old vaults and malformed values.
- Agent requests now carry a permission mode through frontend and Rust boundaries, so new adapters must choose an explicit mapping.
- Power User is intentionally not equivalent across agents; where an adapter lacks a safe broader local-work switch, both modes may map to the same conservative behavior and must document that with tests.
- Any future dangerous mode requires a new ADR and separate UI language.
