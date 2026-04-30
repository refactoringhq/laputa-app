---
type: ADR
id: "0101"
title: "Categorical product analytics events"
status: active
date: 2026-04-30
---

## Context

ADR-0016 established opt-in PostHog analytics and Sentry crash reporting, but new feature telemetry now spans file previews, inline image lightbox opens, AI agent session lifecycle events, and All Notes visibility toggles. Instrumenting those flows ad hoc would make it easy to leak vault-specific data such as note paths, filenames, prompt text, or image URLs.

Tolaria needs richer product telemetry for feature behavior while preserving the privacy bar expected from a local-first notes app.

## Decision

**Route product analytics through dedicated helper functions that emit only coarse categorical metadata.**

- Product events live behind `src/lib/productAnalytics.ts` instead of scattering raw `trackEvent()` payloads across feature code.
- Allowed payloads are constrained to categories and counts such as preview kind, action kind, AI agent id, permission mode, response/tool counts, status, and All Notes visibility category/enabled state.
- Product events must not include vault content, note titles, file paths, filenames, image URLs, prompt text, or other user-authored data.
- When a feature needs telemetry, it should add or extend a typed helper rather than sending free-form payloads inline.

## Options considered

- **Option A** (chosen): Typed categorical wrappers for product events — preserves useful product signals while keeping privacy constraints explicit and reviewable in one place.
- **Option B**: Let each feature call `trackEvent()` directly with whatever fields seem useful — faster short term, but inconsistent and too easy to let sensitive data leak into analytics.
- **Option C**: Avoid new product events entirely — safest from a privacy standpoint, but leaves the team blind to whether preview, AI, and list-visibility features are actually being used or failing.

## Consequences

- Telemetry reviews become easier because the allowed product-event surface is centralized.
- Future product analytics work should start by defining categorical event helpers, not by attaching raw note/file context.
- Some debugging detail is intentionally sacrificed; deep diagnosis should rely on consented crash reporting and local reproduction rather than richer analytics payloads.
- Re-evaluate if Tolaria ever needs a broader telemetry taxonomy or stronger compile-time guarantees around event schemas.
