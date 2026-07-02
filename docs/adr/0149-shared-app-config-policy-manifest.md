---
type: ADR
id: "0149"
title: "Shared app config policy manifest"
status: active
date: 2026-07-02
---

## Context

Tolaria resolves app-owned configuration such as settings, vault registries, window state, AI workspace sessions, and local AI provider secrets outside vault content. ADR 0145 established the XDG-backed app config location and a Rust helper for app-owned config paths, while the external Node MCP server also needs to resolve durable mounted workspace state from the same app config files when launched vault-neutrally.

Keeping the namespace names, readable files, migration fallback order, and write target duplicated in Rust and Node makes the durable MCP registration path fragile. A new config file such as `settings.json` or `vaults.json` can silently diverge between the app and the external MCP server, especially across the current `com.tolaria.app` namespace, legacy `com.laputa.app` namespace, and previous platform config directory fallback.

## Decision

**Tolaria declares app config path policy once in `mcp-server/app-config-policy.json`, and both the Rust app helper and Node MCP server consume that manifest for namespace and file resolution.**

The policy manifest names the current and legacy app namespaces, lists shared app config files, defines the read order across preferred and platform config roots, and keeps writes targeting the current Tolaria namespace in the preferred config root. The Rust helper still owns platform/XDG root discovery, but it reads the manifest for namespace order. The MCP server uses the same manifest for settings and vault registry lookup, so durable external agent registrations resolve mounted workspaces the same way the app resolves installation-local settings.

## Alternatives considered

- **Shared JSON policy manifest consumed by Rust and Node** (chosen): keeps the cross-runtime app config contract explicit and testable while preserving the existing XDG and legacy fallback behavior.
- **Keep separate Rust and Node constants**: avoids introducing a manifest, but invites drift between the app and MCP server whenever a namespace, file name, or fallback rule changes.
- **Move all MCP path resolution behind a Rust command**: centralizes logic in the app process, but external MCP clients must work when launched outside the running desktop app.
- **Expose only environment variables to external MCP servers**: preserves static launch configuration, but reintroduces stale vault/workspace state after mounted workspace changes.

## Consequences

The app and external MCP server now share one durable source for app config namespace and file naming policy. Mounted workspace resolution, settings resolution, and future app-owned config files are less likely to drift across runtimes.

Changes to app config namespace or fallback order must update the manifest and keep both Rust and Node tests passing. The manifest remains a policy contract, not a replacement for platform root discovery: Rust still determines the preferred and platform config roots, and Node still resolves files from its runtime environment when launched externally.
