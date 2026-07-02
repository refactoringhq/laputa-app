---
type: ADR
id: "0151"
title: "Antigravity add-dir workspace flag"
status: active
date: 2026-07-02
supersedes: "0147"
---

## Context

ADR-0147 introduced the Antigravity CLI adapter with `agy -p <prompt> --cwd <vault>`.
Newer Antigravity CLI builds reject that workspace flag with `flags provided but not defined: -cwd` and list `--add-dir` as the supported workspace-directory argument.

Tolaria still needs app-managed Antigravity runs to start in the active vault, expose that vault as the only intended workspace, and preserve the Safe / Power User permission mapping from ADR-0103.

## Decision

Tolaria launches app-managed Antigravity sessions with:

```text
agy -p <prompt> --add-dir <vault>
```

The subprocess `current_dir` remains the active vault path, and Tolaria still writes the transient MCP config to `<vault>/.agents/mcp_config.json` before launch.

Safe mode continues to pass `--sandbox=true --toolPermission=proceed-in-sandbox`.
Power User continues to pass `--sandbox=false --toolPermission=always-proceed`.
Tolaria still avoids `--dangerously-skip-permissions`.

## Consequences

- Antigravity CLI versions that reject `--cwd` can start from the Tolaria AI panel.
- The active vault remains both the process working directory and the explicit Antigravity workspace directory.
- Adapter tests must reject regressions that reintroduce `--cwd` or drop `--add-dir`.
- Future Antigravity CLI workspace flag changes should supersede this ADR with a new adapter decision and test update.
