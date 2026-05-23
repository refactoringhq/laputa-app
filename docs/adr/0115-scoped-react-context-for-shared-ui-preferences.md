---
type: ADR
id: "0115"
title: "Scoped React Context for shared UI preferences"
status: active
date: 2026-05-12
---

## Context

Laputa has relied on props-down callbacks-up state flow since ADR-0026 because most renderer state is orchestrated in `App.tsx` and the component tree stays understandable. Today's `date_display_format` refactor exposed a narrow exception: the same installation-local rendering preference now needs to reach note rows, property chips and cells, inspector surfaces, table-of-contents metadata, search subtitles, and date-editing controls across multiple branches of the tree. Continuing to thread that value through intermediate components would add noisy prop plumbing to components that do not conceptually own the preference.

## Decision

**Use a scoped React context for shared UI preferences that are read in many renderer leaves but still sourced from `App.tsx`. `AppPreferencesProvider` publishes the current installation-local preference values, and leaf components consume them through focused hooks such as `useDateDisplayFormat`; writes still flow through the existing settings/update path rather than through context mutations.**

## Alternatives considered
- **Scoped app-preferences context** (chosen): removes prop forwarding for cross-cutting rendering preferences while keeping the source of truth in `App.tsx` and avoiding a general-purpose global store.
- **Continue prop drilling from `App.tsx`**: preserves the old rule literally, but keeps widening component signatures and couples intermediate components to preferences they do not use.
- **Adopt a broader global state/store solution**: centralizes access, but introduces more indirection and policy surface than this renderer-only preference case needs.

## Consequences

Leaf components can read shared formatting preferences directly, so `date_display_format` stays consistent across note-list, inspector, search, and metadata surfaces without forwarding props through unrelated layers.

This narrows ADR-0026's blanket "no Context for data" rule. The replacement rule is: mutable application/domain state still lives in `App.tsx` plus focused hooks, while React context is allowed only for tightly scoped, cross-cutting UI preferences whose canonical value still originates from that same top-level state.

Future additions to `AppPreferencesProvider` should stay small, renderer-local, and read-focused. If Laputa starts moving writable domain state, async workflows, or large derived objects into context, that needs a new ADR rather than quietly expanding this pattern.
