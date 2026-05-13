---
type: ADR
id: "0115"
title: "macOS custom URL scheme release QA"
status: active
date: 2026-05-13
---

## Context

Tolaria accepts external capture handoffs through `tolaria://clip/new` desktop deep links. The source code can configure the Tauri deep-link plugin, but macOS only treats Tolaria as the handler after an installed app bundle advertises the scheme in `Contents/Info.plist` and LaunchServices registers that bundle.

A stale `/Applications/Tolaria.app` without `CFBundleURLTypes` will still make Firefox, `open`, and other clients report `tolaria://` as an unknown protocol even when the repository and a local build already contain the new deep-link code. That makes URL-scheme support both a product behavior and a release-artifact QA requirement.

## Decision

**macOS release validation for any custom Tolaria URL scheme includes both bundle metadata inspection and an installed-app LaunchServices smoke test.**

- The app bundle must declare every supported custom scheme through `CFBundleURLTypes` in `Contents/Info.plist`.
- The Tauri app must initialize the matching deep-link plugin at startup so delivered URLs reach the renderer/runtime handler.
- Release QA must inspect the built macOS `.app` artifact, not only the source `tauri.conf.json`.
- Release QA must install or stage the built app bundle, register it with LaunchServices when needed, and verify `open 'tolaria://...'` is accepted by the OS.
- Existing installed builds are not considered valid evidence for a new scheme unless their own bundle metadata contains that scheme.

## Options considered

- **Validate the packaged app bundle and LaunchServices registration** (chosen): proves the exact artifact users install can be discovered by macOS and launched through the scheme. Cons: adds macOS-specific release QA steps.
- **Rely on source-level tests only**: keeps CI fast and catches config regressions, but can miss packaging or stale-installed-app failures.
- **Move the handoff to Universal Links**: would use `https://` association instead of a custom scheme, but requires Associated Domains and an `apple-app-site-association` deployment while still not replacing the local clipboard handoff contract.

## Consequences

- Deep-link changes must update both focused parser/handler tests and release documentation.
- macOS alpha and stable artifact checks include `Info.plist` verification for `CFBundleURLSchemes = tolaria`.
- Manual QA should run the smoke against the app bundle being released or installed, not a different local build.
- Users who still run an older installed bundle may need to install/update Tolaria before browser extensions can open `tolaria://` links.
- Future schemes must be added to the same artifact-level checklist before being treated as supported.
