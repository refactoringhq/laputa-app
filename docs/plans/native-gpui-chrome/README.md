# Ephemeral planning notes for ADR-0115

These files exist for the duration of the native-GPUI chrome
migration (branch `feat/native-gpui-chrome`).  They mirror the
conversation-level plans, todo lists, and phase-by-phase progress
that informed each commit, so the work is reviewable and resumable
across sessions.

**Delete this entire directory** before merging
`feat/native-gpui-chrome` into `main`.  Permanent context belongs in:

- `docs/adr/0115-native-gpui-chrome.md` — the ADR itself
- `docs/ARCHITECTURE.md` / `docs/ABSTRACTIONS.md` — long-lived shape docs

## Layout

| File | Purpose |
|------|---------|
| [`roadmap.md`](roadmap.md) | Single canonical phase order |
| [`progress.md`](progress.md) | Running ledger — per-phase commit refs, test counts, key API decisions.  Mirrors `roadmap.md`'s numbering. |
| [`components.md`](components.md) | Per-component visual + behavioural spec.  Reference screenshots, React-source mapping, per-crate visual contracts.  Authoritative for every chrome surface's look and behaviour in every phase. |
| [`process.md`](process.md) | Crate naming, branch policy, per-iteration verification loop, phase-boundary sweep, hard rules.  Workflow invariants applied throughout. |
| [`e2e-harness.md`](e2e-harness.md) | Periscope screenshot + click harness (`screenshot` / `watch` / `click` / `click-id` / `dump-tree` / `list`) plus the SIGUSR1 tree-dump IPC contract. |
| [`tolaria-demo-vault-v2-light.png`](tolaria-demo-vault-v2-light.png) / [`tolaria-demo-vault-v2-dark.png`](tolaria-demo-vault-v2-dark.png) | Reference captures of the Tauri-era app rendering `demo-vault-v2/` in both light and dark modes.  Single visual source of truth for every chrome component. |
| [`tolaria-demo-vault-v2.png`](tolaria-demo-vault-v2.png) | Legacy single-mode capture kept for backward links; superseded by the light/dark pair above. |

Add more files here only for future phase-specific planning that
won't fit in the live docs above.

## Why not Todoist / Linear / etc

This branch is dogfood-only per ADR-0021 (push-to-`main` workflow).
The actual project tracker carries production tasks; this directory
just persists the in-flight planning state so a fresh session can
resume mid-migration without re-deriving the topology.
