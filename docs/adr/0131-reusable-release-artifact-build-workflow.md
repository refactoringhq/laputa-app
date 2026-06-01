---
type: ADR
id: "0131"
title: "Reusable release artifact build workflow"
status: active
date: 2026-05-28
---

## Context

Tolaria's alpha and stable release workflows both need to build the same platform artifact set: dual-architecture macOS updater bundles, optional stable macOS DMGs, Linux bundles, and signed Windows installers/updater bundles. Keeping those build jobs copied into both release workflows made platform fixes and validation changes easy to apply in one channel while accidentally leaving the other channel behind.

The release workflows still differ in how they compute versions, create releases, and publish alpha vs. stable metadata, but the artifact build contract is shared.

## Decision

**Tolaria centralizes release artifact production in `.github/workflows/release-build-artifacts.yml`, invoked by alpha and stable release workflows through `workflow_call`.** Channel-specific workflows own versioning and publishing; the shared workflow owns platform build, signing, validation, and artifact upload behavior.

## Alternatives considered

- **Reusable artifact workflow** (chosen): keeps alpha and stable artifact behavior aligned while preserving separate channel-specific release orchestration. Cons: release behavior is split across one caller workflow and one called workflow, so debugging requires following both files.
- **Keep duplicated jobs in each release workflow**: makes each workflow self-contained, but every platform build fix must be applied twice and drift is likely.
- **Merge alpha and stable releases into one workflow**: reduces workflow count, but couples different trigger/version/publishing semantics and makes the release pipeline harder to reason about.

## Consequences

Alpha and stable releases now share one platform artifact contract, including macOS, Linux, and Windows validation. Changes to signing, cache keys, bundle validation, or platform matrices should happen in the reusable artifact workflow unless they are genuinely channel-specific.

The architecture documentation should describe the release pipeline as channel orchestration plus shared artifact production, not as independent duplicated build job sets.
