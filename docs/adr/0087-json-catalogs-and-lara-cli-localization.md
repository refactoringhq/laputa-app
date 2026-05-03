---
type: ADR
id: "0087"
title: "JSON locale catalogs with Lara CLI synchronization"
status: active
date: 2026-04-27
supersedes:
  - "0084"
---

## Context

ADR-0084 established an app-owned localization layer in `src/lib/i18n.ts` with English fallback and hand-maintained TypeScript dictionaries. That was enough for the first localized UI surface, but it does not scale well to a broader locale matrix or machine-assisted translation workflows.

We now want Tolaria to support a wider set of locales and to automate translation updates with Lara CLI while keeping the runtime dependency-light and preserving the existing English fallback behavior.

## Decision

Tolaria will keep its app-owned runtime localization layer, but the translation source-of-truth moves to flat JSON catalogs in `src/lib/locales/`.

- `src/lib/locales/en.json` is the canonical source catalog.
- Additional locale files use one JSON file per locale code (for example `zh-CN.json`, `fr-FR.json`).
- `src/lib/i18n.ts` keeps fallback, interpolation, locale resolution, and props-down locale wiring, but it now loads locale catalogs from JSON files instead of TypeScript objects.
- Lara CLI configuration lives in `lara.yaml`, and translation runs happen through repo scripts (`pnpm l10n:translate`, `pnpm l10n:translate:force`).
- `scripts/validate-locales.mjs` verifies that every locale catalog present in the repo matches the English keyset and only contains flat string values.
- Legacy stored preferences such as `zh-Hans` are normalized to the canonical `zh-CN` locale.

## Alternatives considered

- **Keep TypeScript dictionaries and point Lara at `.ts` files**: possible, but JSON is the more standard interchange format for translation tooling and keeps diffs simpler for translators and reviewers.
- **Adopt a full frontend i18n framework now**: rejected because Tolaria already has working locale propagation and fallback behavior, and the immediate need is better content management plus translation automation.
- **Store translated strings outside the app repo**: rejected because Tolaria's chrome localization should stay versioned with the app code that consumes it.

## Consequences

- Translators and automation tools now work against plain JSON catalogs instead of editing source code.
- The runtime keeps English fallback behavior, so a missing locale file or missing key does not break app chrome.
- Locale additions become a data/config change first: add the locale metadata, run Lara, review JSON output, then ship.
- Localization work now has a dedicated validation step that can run in CI or before commit.
