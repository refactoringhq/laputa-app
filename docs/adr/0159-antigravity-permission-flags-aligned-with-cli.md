---
type: ADR
id: "0159"
title: "Antigravity permission flags aligned with CLI"
status: active
date: 2026-07-12
supersedes: "0151"
---

## Context

ADR-0151 aligned Antigravity workspace selection with `agy --add-dir`, but kept
the earlier permission flags:

```text
--sandbox=true --toolPermission=proceed-in-sandbox
--sandbox=false --toolPermission=always-proceed
```

Current Antigravity CLI builds do not define `--toolPermission` and treat
`--sandbox` as a boolean toggle, not a `--sandbox=<value>` option. Passing the
old permission flags can therefore fail app-managed Antigravity launches even
after the workspace flag moved from `--cwd` to `--add-dir`.

## Decision

Tolaria launches app-managed Antigravity sessions with:

```text
agy -p <prompt> --add-dir <vault>
```

The permission mode mapping is:

- Safe: pass `--sandbox`
- Power User: pass `--dangerously-skip-permissions`

The subprocess `current_dir` remains the active vault path, and Tolaria still
writes the transient MCP config to `<vault>/.agents/mcp_config.json` before
launch.

## Consequences

- Antigravity CLI versions that reject `--cwd`, `--toolPermission*`, or
  `--sandbox=<value>` can start from the Tolaria AI panel.
- Safe mode keeps Antigravity sandboxing enabled through the CLI-supported
  boolean flag.
- Power User uses the CLI-supported bypass flag because Antigravity no longer
  exposes the earlier `toolPermission` mapping.
- Adapter tests must reject regressions that reintroduce unsupported
  Antigravity flags.
