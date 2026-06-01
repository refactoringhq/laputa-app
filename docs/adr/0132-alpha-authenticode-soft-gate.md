---
type: ADR
id: "0132"
title: "Alpha Authenticode soft gate"
status: active
date: 2026-05-28
amends: "0130"
---

## Context

ADR 0130 made Windows Authenticode signing mandatory for release installers. That is still the right requirement for stable promotions, but the repository does not yet have the Windows code-signing certificate secrets needed by CI. Because alpha releases run on every push to `main`, requiring those secrets there broke the continuous alpha channel before the certificate provisioning work was complete.

## Decision

**Alpha Windows artifacts keep building when Authenticode certificate secrets are absent; stable Windows artifacts still require Authenticode signing.**

- The shared release artifact workflow accepts `require_windows_authenticode`.
- Alpha passes `false`, emits a workflow warning when certificate secrets are absent, and still requires Tauri updater signatures.
- Stable passes `true` and fails before building Windows artifacts unless certificate and password secrets are configured.
- When certificate secrets are present, both channels use the generated Tauri Authenticode config and verify Windows executable/installer signatures before upload.

## Consequences

The alpha updater channel remains live while Windows certificate provisioning is underway. Stable releases continue to enforce the Windows trust policy from ADR 0130 before public promotion. Once the certificate secrets are configured, alpha builds automatically regain Authenticode signing without another workflow change.
