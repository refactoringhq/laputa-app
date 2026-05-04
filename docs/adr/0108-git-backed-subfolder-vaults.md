---
type: ADR
id: "0108"
title: "Git-backed subfolder vaults use scoped parent repositories"
status: active
date: 2026-05-03
supersedes: "0085"
---

## Context

Tolaria originally treated a vault as Git-backed only when the opened folder itself contained `.git`. That blocked using a subfolder of a larger repository as a vault, which is useful when one repository contains multiple vaults or when another system owns the repository root.

## Decision

Tolaria treats a vault as Git-backed when the opened folder is inside a Git worktree. Git remotes, branch state, pull, and push remain repository-level operations, while file-facing Tolaria actions are scoped to the opened vault subtree.

Concretely, Changes, diffs, note history, Pulse, conflict file lists, discard, conflict resolution, and app-created commits only include paths under the active vault folder. Commit staging uses the vault subtree pathspec, so unrelated repository files are not staged by Tolaria.

## Consequences

- Opening a subfolder inside a Git repository enables Git features without creating nested `.git` metadata.
- Multiple vault folders can coexist in one repository without Tolaria committing unrelated sibling changes.
- Plain folders outside Git remain supported non-git vaults.
- Future Git features must resolve the repository worktree and the vault-relative prefix instead of checking for `vault/.git`.
