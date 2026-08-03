---
type: ADR
id: "0173"
title: "Future calendar version rejection and recovery"
status: active
date: 2026-08-02
supersedes: "0066"
---

## Context

ADR-0066 made Tolaria releases calendar-semver versions and advanced alpha by one day after a
same-day stable promotion. A manually created `v2027-07-31` tag passed the stable workflow in
2026. Alpha then treated that future stable version as authoritative and correctly advanced to
`2027.8.1-alpha.N`. Rejecting future tags prevents recurrence, but immediately returning to a
`2026` technical version would strand installations whose semver comparator already considers the
published `2027` builds newer.

## Decision

Calendar release computation lives in the tested `scripts/release-version.mjs` module. Stable tags
whose embedded date is later than the current UTC date fail before any release build starts. Alpha
ignores future stable dates when computing its normal calendar series.

When existing tags prove that a future stable date already poisoned alpha ordering, the workflow
publishes one recovery bridge with a technical version one day above the poisoned alpha core. Its
display label uses the real UTC date with sequence zero. The bridge contains two narrowly scoped
updater changes: alpha metadata selection follows GitHub publication time, and a future calendar
build may accept a lower technical version only when the candidate date is today or tomorrow. Once
the bridge tag exists, the next alpha build returns to the real calendar series.

## Consequences

- A mistyped future stable tag fails closed instead of changing release metadata.
- The one-day monotonicity safeguard after a valid same-day stable promotion remains unchanged.
- Recovery requires two alpha publications: the technical bridge, then the corrected calendar
  release. Existing poisoned alpha clients can traverse both without disabling normal semver
  ordering.
- The downgrade exception cannot install an arbitrary historical build; it only applies when the
  installed calendar date is beyond tomorrow and the candidate is dated today or tomorrow.
- Stable-channel installations already on a poisoned future stable build need an operator-published
  stable bridge or a temporary switch to Alpha; future stable tags are prevented at source.
