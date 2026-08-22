---
type: ADR
id: "0179"
title: "Codex approval policy aligned with current CLI"
status: active
date: 2026-08-23
supersedes: "0103"
---

## Context

ADR-0103 mapped Codex Vault Safe to the CLI's read-only sandbox plus an
`--ask-for-approval untrusted` approval policy. Current Codex CLI builds
(e.g. `0.149.x`) no longer accept `untrusted` as an `--ask-for-approval`
value; the valid values are now `on-request` and `never`. Passing the old
value makes the CLI reject the argument outright, so app-managed Codex Vault
Safe launches fail before the session starts:

```text
error: invalid value 'untrusted' for '--ask-for-approval <APPROVAL_POLICY>'
[possible values: on-request, never]
```

## Decision

Tolaria launches app-managed Codex sessions with:

```text
codex --sandbox <sandbox> --ask-for-approval <approval> exec --json ...
```

The permission mode mapping is now:

- Safe: `--sandbox read-only --ask-for-approval on-request`
- Power User: `--sandbox workspace-write --ask-for-approval never`

`on-request` preserves the intent of the retired `untrusted` value: the model
still decides when to ask for approval before executing a command, within a
read-only sandbox. The `--sandbox` values are unchanged.

## Consequences

- Codex CLI versions that reject `untrusted` can start from the Tolaria AI
  panel under Vault Safe.
- Vault Safe remains a best-effort safe profile rather than a true
  built-in-tools-off mode, unchanged from ADR-0103: Codex still exposes
  sandbox and approval controls but not a dedicated switch to remove shell
  tooling while preserving MCP.
- Adapter tests must reject regressions that reintroduce the retired
  `untrusted` approval value.
