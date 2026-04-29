---
type: ADR
id: "0095"
title: "Saved views use an explicit YAML order field"
status: active
date: 2026-04-29
---

## Context

Saved Views already persist as user-editable YAML files in the vault and sync through Git. Filename ordering was stable, but it forced users to rename files just to change sidebar order and gave Tolaria no durable way to support drag reordering, move actions, or keyboard-first ordering controls.

The ordering choice also needs to travel with the view definition itself. Saved Views are part of the vault's shared information architecture, not a machine-local preference.

## Decision

**Each Saved View may store an optional top-level `order` number in its YAML definition, and Tolaria sorts views by that value before falling back to filename.**

- Lower `order` values render earlier in the sidebar and other Saved View lists.
- Views without `order` sort after ordered views and then fall back to filename ordering for stability.
- Reordering actions rewrite affected view files with a dense sequence of order values instead of encoding position in filenames.
- The same persisted order supports drag handles, explicit move buttons, and command-palette ordering actions.

## Options considered

- **Explicit `order` field in the view YAML** (chosen): portable, Git-syncable, easy to inspect by hand, and consistent with the existing file-first view model.
- **Filename-based ordering only**: no schema change, but makes reordering clumsy and couples user-visible structure to file naming.
- **App-local ordering state**: easy to prototype, but breaks cross-device consistency and separates ordering from the view artifact users already version.

## Consequences

- Saved View ordering becomes part of the vault and syncs naturally through Git.
- Existing views remain valid; unordered files keep a stable fallback sort until reordered.
- Reordering can touch multiple view files in one action because Tolaria normalizes the sequence.
- Future Saved View features should treat `order` as part of the shared YAML schema rather than introducing a parallel ordering store.
