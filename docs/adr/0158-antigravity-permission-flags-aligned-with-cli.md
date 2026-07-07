---
type: ADR
id: "0158"
title: "Antigravity permission flags aligned with CLI"
status: active
date: 2026-07-07
supersedes: "0151"
---

## Context

ADR-0151 aligned the workspace directory flag from `--cwd` to `--add-dir` but preserved the permission mapping with `--sandbox=true/false` and `--toolPermission=proceed-in-sandbox|always-proceed`. The Antigravity CLI binary does not define a `--toolPermission` flag and treats `--sandbox` as a boolean toggle (present = enabled) rather than a key-value pair. Users see `flags provided but not defined: -toolPermission` when launching the AI panel.

## Decision

Tolaria maps AI agent permission modes to the flags the Antigravity CLI actually accepts:

- **Safe mode** → `--sandbox` (boolean flag, no value)
- **Power User mode** → `--dangerously-skip-permissions` (auto-approves all tool permission requests)

The `--toolPermission` argument and the `--sandbox=true/false` key-value form are removed entirely. The `build_command` function delegates permission flag assembly to an `apply_permission_flags` helper that matches on `AiAgentPermissionMode`.

## Consequences

- The AI panel launches Antigravity successfully on CLI versions that reject `--toolPermission`.
- Safe mode sessions run in a sandbox, matching the CLI's built-in sandbox behaviour.
- Power User mode auto-approves permissions, matching the pre-existing Tolaria semantics for unrestricted agent interaction.
- Integration tests reject `--toolPermission*` and `--sandbox=*` to prevent future regressions.
- Future Antigravity CLI permission-flag changes should supersede this ADR.
