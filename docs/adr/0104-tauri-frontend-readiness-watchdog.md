---
type: ADR
id: "0104"
title: "Tauri frontend readiness watchdog"
status: active
date: 2026-05-01
---

## Context

Tolaria already keeps heavy filesystem and subprocess work off the Tauri window-creation path, but that alone does not protect against a different startup failure mode: the desktop WebView can render the static HTML shell while the React app never becomes interactive.

On macOS this showed up as an inert window that looked launched but never finished mounting the real app. The failure boundary is cross-layer:

- `index.html` can paint before React commits
- React root errors can happen before the app reports itself ready
- a plain reload is acceptable as a one-time recovery, but an automatic reload loop is not
- browser/mock runs should not inherit desktop-only recovery behavior

Tolaria needs a startup contract that distinguishes “HTML painted” from “frontend actually became interactive”, and a bounded recovery path when that contract is not satisfied.

## Decision

**Tolaria uses a Tauri-only frontend-readiness watchdog that reloads the WebView at most once if React never reports startup readiness.**

Concretely:

- `index.html` installs a Tauri-only startup timer before React loads
- React dispatches a readiness signal from a mounted effect after the app shell commits
- if readiness never arrives before the timeout, the WebView reloads once
- the same one-shot reload path is available to React root error handling before readiness is marked
- `sessionStorage` tracks whether the startup reload was already attempted so Tolaria does not loop forever
- browser/mock environments keep using ordinary browser clipboard/storage behavior and do not enable this desktop startup recovery path

## Options considered

- **Tauri-only readiness watchdog with one-shot reload** (chosen): directly addresses the inert-startup failure mode, keeps recovery local to the frontend, and avoids permanent reload loops. Cost: startup now depends on a small cross-layer contract between HTML bootstrap and React.
- **Do nothing and rely on manual relaunch**: simplest implementation, but leaves users stranded in a broken-looking app state with no automatic recovery.
- **Reload on any React root error without a readiness gate**: more aggressive, but too noisy; post-startup runtime errors should not trigger surprise reloads.
- **Move recovery entirely into native Rust window/bootstrap logic**: possible, but the failure signal lives in the frontend lifecycle, so native code would still need a readiness handshake.

## Consequences

- Tolaria now distinguishes successful frontend startup from merely rendering the HTML shell.
- Desktop startup recovery is bounded to a single retry per session, reducing the chance of trapping users in reload loops.
- `index.html`, `src/main.tsx`, and `src/utils/frontendReady.ts` form a shared startup contract that future bootstrap refactors must preserve.
- Any future change that delays app-shell mount beyond the watchdog timeout must re-evaluate the timeout and readiness trigger.
- If a startup failure persists after one retry, Tolaria still surfaces the broken state instead of hiding a deeper bug behind repeated reloads.
