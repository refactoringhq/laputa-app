---
type: ADR
id: "0152"
title: "WSL2 Git provider"
status: active
date: 2026-07-03
supersedes:
---

## Context

Windows users may keep their vaults and Git credentials inside WSL2 even when running Tolaria as a native desktop app. Requiring native Windows Git blocks that setup, but silently switching to WSL based on detection would make Git operations difficult to reason about and could send the wrong filesystem paths to the selected executable.

Tolaria already treats Git as a per-vault capability and app settings as installation-local. The executable provider is also machine-specific: one Windows installation may use native Git while another uses Git from an Ubuntu WSL distribution for the same vault content.

## Decision

Tolaria adds an explicit Git provider setting with native Git as the default and WSL2 Git as an opt-in provider on Windows.

The Rust Git module resolves a `GitLaunchConfig` for each Git command from app settings. Native launches keep the existing `git`/configured path behavior. WSL launches use `wsl.exe`, optional `--distribution <name>`, and `--exec git`, while repository and clone destination paths are translated to Linux-style paths before they cross into WSL. Provider probes and tests run on blocking worker threads with timeouts so unavailable WSL distributions cannot freeze the renderer.

The Settings Git section shows the provider, WSL distribution, and a test action before save. Detection populates available WSL distributions, but selection remains explicit; Tolaria does not automatically switch from native Git to WSL2 Git.

## Consequences

- Windows users can run Tolaria with Git from WSL2 without installing or configuring native Windows Git.
- Native Git remains supported and remains the default provider.
- Git command paths must go through the Git provider abstraction rather than passing Windows repository paths directly to subprocess arguments.
- WSL-specific QA requires a Windows host with WSL2 and at least one distribution containing Git; non-Windows automated coverage verifies path translation, distro parsing, settings persistence, and renderer controls.
