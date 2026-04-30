---
type: ADR
id: "0102"
title: "Low-end-safe autosave idle window"
status: active
date: 2026-04-30
supersedes: "0015"
---

## Context

ADR-0015 chose a 500ms autosave debounce so normal edits would persist quickly without writing on every keystroke. GitHub issue #443 showed that this window is too aggressive on very weak Windows CPUs: if typing intervals exceed 500ms or a save takes long enough to overlap continued typing, Tolaria can start disk and derived-state work while the user is still entering text.

## Decision

**Tolaria autosaves after a 1.5s idle window and treats stale in-flight autosaves as obsolete when newer content arrives before they resolve.** Manual saves, note switches, raw-mode entry, and destructive actions still flush pending editor content immediately.

## Options Considered

- **Option A — 1.5s idle window plus stale-save protection** (chosen): reduces mid-typing saves on slow CPUs while keeping ordinary autosave behavior fast enough for reliability. It also prevents an older slow save from clearing or repainting over newer pending text.
- **Option B — Keep 500ms and only fix stale saves**: preserves the previous timing but still triggers repeated saves for slower typists and weaker machines.
- **Option C — Save only on blur or navigation**: minimizes background work but increases crash-loss risk during longer writing sessions.

## Consequences

- Autosave is less likely to compete with active typing on low-end Windows hardware.
- The unsaved window grows from roughly 500ms to roughly 1.5s after Tolaria receives the latest content change.
- Explicit flush paths remain immediate, so navigation, manual save, raw-mode transitions, and destructive actions still preserve pending edits before proceeding.
- Future changes to autosave timing should keep weak-CPU responsiveness and stale in-flight save behavior in the same test surface.
