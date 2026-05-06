---
type: ADR
id: "0112"
title: "System theme mode"
status: active
date: 2026-05-05
---

## Context

ADR-0081 introduced Tolaria's internal app-owned light and dark theme runtime and deliberately deferred system-follow mode. That kept the first dark-mode release small, but users now need Tolaria to match the operating system appearance automatically, including scheduled macOS light/dark changes.

The previous constraints still apply: themes are app-owned, not vault-authored; the renderer must avoid startup flashes; shadcn/ui, Tailwind variables, editor chrome, and secondary windows must keep sharing the same resolved light/dark contract.

## Decision

**Tolaria now treats `system` as a persisted theme preference that resolves to the current OS light/dark appearance at runtime.**

The selected preference can be `light`, `dark`, or `system`:

1. `settings.theme_mode` remains the source of truth for the installation-local preference.
2. The localStorage mirror stores the selected preference, including `system`, so the `index.html` prepaint script can resolve the correct appearance before React mounts.
3. `data-theme` and the shadcn `.dark` class always receive the resolved app theme, `light` or `dark`; they never receive `system`.
4. When `system` is selected, the renderer subscribes to `prefers-color-scheme` changes and reapplies the resolved theme without reopening the app.
5. Explicit `light` and `dark` choices remain overrides and do not follow OS changes.

Command-palette theme actions and the Settings panel both save the same preference path. Product analytics record preference changes with the selected mode only, without sending vault or note content.

## Alternatives considered

- **Persist `system` and resolve it into the existing light/dark runtime** (chosen): keeps ADR-0081's small app-owned theme surface while adding OS-follow behavior.
- **Store the resolved OS theme in settings**: avoids a third stored value, but silently converts System users into explicit Light/Dark users after every save.
- **Set `data-theme="system"` and branch in CSS**: would require every theme consumer to understand a third state and would break existing Tailwind/shadcn dark-mode assumptions.
- **Rely only on CSS `prefers-color-scheme` media queries**: helps static CSS, but does not update JavaScript consumers, command state, editor integrations, or the localStorage startup mirror consistently.

## Consequences

- Startup still avoids a light flash when the stored preference is `system` and the OS is dark.
- Secondary windows that mount the shared theme hook receive the same resolved appearance and update on OS changes.
- Code that reads `document.documentElement.dataset.theme` must treat it as a resolved `light` or `dark` value, not as the stored user preference.
- Future theme variants should preserve this split between selected preference and resolved app theme rather than widening `data-theme` to non-renderable preference values.
