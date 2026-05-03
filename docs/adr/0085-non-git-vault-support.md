---
type: ADR
id: "0085"
title: "Non-git vaults open with explicit later Git initialization"
status: active
date: 2026-04-26
supersedes: "0034"
---

## Context

ADR-0034 made Git a hard prerequisite for opening a vault because Git-backed cache, history, change, and sync flows failed invisibly when users opened plain Markdown folders. That protected Git features, but it blocked the common adoption path of opening an existing folder from Obsidian, iCloud, Dropbox, or a manually maintained notes directory.

Tolaria now needs the opposite default: browsing and editing Markdown should work immediately, while Git remains an explicit capability users can enable when they want history, sync, commits, or collaboration.

## Decision

**Open existing Markdown folders even when they are not Git repositories.** A non-git vault is a supported state, not an error state. On open, Tolaria asks whether to initialize Git; if the user dismisses the prompt, the app keeps working and the status bar permanently shows a `Git disabled` warning. Clicking that warning, or running `Initialize Git for Current Vault` from the command palette, reopens the setup action.

While a vault is not Git-backed:

- Git history, change, commit, sync, conflict, and remote actions are hidden or disabled.
- Background auto-sync and AutoGit checkpoints do not run.
- Markdown scanning, note browsing, note editing, search, and non-Git vault features continue normally.

`init_git_repo` remains the single backend command for enabling Git later. It creates the repository, writes Tolaria's default `.gitignore`, stages the vault, and creates the unsigned setup commit.

## Options considered

- **Option A (chosen): Supported non-git mode with explicit later initialization.** Best adoption path; keeps Git capabilities visible without blocking the basic notes workflow.
- **Option B: Keep the ADR-0034 blocking modal.** Prevents Git feature ambiguity, but rejects valid plain-folder workflows.
- **Option C: Auto-initialize Git when opening a plain folder.** Low friction, but surprising for users who do not want Tolaria to mutate folder metadata.

## Consequences

- Existing Git-backed vaults keep the same history, commit, sync, and remote behavior.
- UI surfaces must treat Git capability as stateful per vault, not as an app-wide invariant.
- Tests need to cover both Git-backed and non-git vaults in browser mocks and native QA.
- Future Git-dependent features must check the current vault's Git state before registering commands or running background work.
