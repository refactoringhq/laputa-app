---
type: ADR
id: "0139"
title: "Temporary Windows Authenticode soft gate"
status: active
date: 2026-06-09
supersedes: "0138"
amends: "0130"
---

## Context

ADR 0138 made Authenticode mandatory for every Windows release artifact. That is the desired end state, but the repository still does not have a trusted Windows code-signing certificate or signing service configured. Enforcing Authenticode before provisioning is complete blocks the alpha and stable release pipelines even though the Tauri updater signatures are available and still protect updater integrity.

## Decision

**Windows Authenticode signing is temporarily optional for both alpha and stable release builds.**

- Windows builds still require `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_KEY_PASSWORD`, so updater artifacts remain signed.
- When `WINDOWS_CODE_SIGNING_CERTIFICATE`/`WINDOWS_CERTIFICATE` and the matching password secret are present, CI imports the certificate, builds with the generated Authenticode config, and verifies executable and installer signatures with `Get-AuthenticodeSignature`.
- When both Windows Authenticode certificate and password secrets are absent, CI emits a warning and builds Windows artifacts without Authenticode.
- Partial Authenticode configuration remains a hard error because it is ambiguous and easy to misread as a signed release.

## Consequences

Windows releases can continue while certificate provisioning is pending. This does not provide the Windows publisher identity needed by SmartScreen, Smart App Control, Defender, or WDAC-managed environments; those policies can still block the installer until a trusted Authenticode certificate or signing service is configured. Reinstating a hard gate should be a small workflow change once the certificate path exists.
