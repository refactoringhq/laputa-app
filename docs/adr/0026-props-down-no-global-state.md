---
type: ADR
id: "0026"
title: "Props-down callbacks-up (no global state management)"
status: superseded
date: 2026-02-15
superseded_by: "0115"
---

## Context

React apps commonly adopt global state management libraries (Redux, Zustand, Jotai, Context) to share state across components. For Laputa, the component tree is relatively shallow (App → panels → sub-components), and the data flow is predictable. Adding a state management library would increase complexity without proportional benefit.

## Decision

**No global state management (no Redux, no Context for data). `App.tsx` owns the state and passes it down as props. Child-to-parent communication uses callback props (`onSelectNote`, `onCloseTab`, etc.). Local state uses `useState`/`useReducer`.**

## Options considered

- **Option A** (chosen): Props-down, callbacks-up — simple, predictable data flow, easy to trace state changes, no library dependency. Downside: prop drilling through deep trees, verbose parent components.
- **Option B**: Redux/Zustand global store — centralized state, easy cross-component access. Downside: boilerplate, indirection, harder to trace state changes, over-engineering for a single-window app.
- **Option C**: React Context for shared state — built-in, no library. Downside: re-renders on any context value change, performance issues with large state objects.

## Consequences

- `App.tsx` is the state orchestrator — it holds vault entries, active note, sidebar selection, and all top-level state.
- Components receive data and callbacks as props — no `useContext` for data access.
- Hooks (`useVaultLoader`, `useNoteActions`, `useTabManagement`, etc.) encapsulate state logic but return values consumed by `App.tsx`.
- Prop drilling is mitigated by composing hooks and keeping the component tree shallow.
- Components are easy to test in isolation (just pass props).
- Re-evaluation trigger: if the component tree deepens significantly or cross-cutting state becomes unmanageable with props.
