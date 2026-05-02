---
type: Spec
status: Draft
date: 2026-05-02
topic: vault-providers-icloud-desktop
---

# Vault Providers and iCloud Desktop Support Design

## Summary

Tolaria should introduce a vault-provider boundary so the app can support more than one storage backend without rewriting the note model or user workflow. The first scoped project is not mobile. It is limited to provider foundations plus desktop support for iCloud-backed vaults, with explicit verification that the existing Tolaria workflow still works when the vault lives in iCloud Drive.

This project preserves Tolaria's current architecture as much as possible: markdown files remain the source of truth, the existing desktop app remains the only shipping client, and git stays a desktop capability. The new work is to separate storage concerns from note logic so future Apple clients can open the same vault format later.

## Goals

- Preserve the current Tolaria note model and workflow on desktop.
- Add a storage-provider abstraction below existing vault logic.
- Support opening and using an iCloud-backed vault from the desktop app.
- Verify that the current Tolaria workflow still works over iCloud-backed files on desktop.
- Prepare clean boundaries for a later iPhone project without designing the iPhone client now.

## Non-Goals

- No iPhone, iPad, Android, or web client work in this project.
- No backend service, relay, or companion-host architecture.
- No cross-platform provider rollout beyond local folder and iCloud-backed vaults.
- No attempt to bring full git parity to future mobile clients in this spec.
- No redesign of Tolaria's primary user workflow.

## Context

Tolaria is currently a Tauri desktop app with a React frontend and a Rust backend. Its architecture assumes filesystem-backed vault access, local note writes, local git operations, and desktop-native integrations such as menus, file watching, and external process execution.

That architecture already encodes a useful long-term principle: content structure should follow the vault across future platforms, while machine-specific settings remain local. The current codebase therefore already leans toward a future where the same vault can be opened by more than one installation, but it does not yet model storage backends explicitly.

The current user workflow is also part of the product contract. The getting-started vault makes clear that Tolaria is not just a markdown editor. It is a workflow built around:

- files-first storage
- offline-first usage
- keyboard-first actions
- types as the main organizational lens
- sidebar -> note list -> editor -> properties navigation
- command palette as a universal fallback action surface
- wikilink navigation and frontmatter relationships
- H1/filename awareness
- views, sorting, filters, and neighborhood exploration
- git history and recovery on desktop

This project must preserve that workflow on desktop while changing only the storage boundary underneath it.

## Recommended Approach

Use an Apple-first provider architecture with two provider types in the first iteration:

- `local-folder`: the current desktop-native vault model
- `icloud-drive`: a vault stored in the user's iCloud Drive and accessed through a normal synced folder on macOS

The recommendation is intentionally narrower than a generic provider marketplace. The app should define interfaces broadly enough for future providers, but only implement the minimum abstraction needed to support the current local-folder path and a real iCloud-backed desktop vault.

This avoids two common mistakes:

- over-generalizing before the first second provider exists
- hardcoding iCloud-specific behavior directly into the existing local-folder code paths

## Alternatives Considered

### 1. Pure web or thin companion client

Rejected for this project. It would not preserve enough of the current working logic, and it changes the architectural problem from storage abstraction into service architecture.

### 2. Desktop-hosted API as the permanent architecture

Rejected as the main direction. It preserves logic, but it does not meet the long-term requirement for independent clients.

### 3. Provider-abstraction-first with many providers at once

Rejected for now. It is architecturally attractive but too broad for a first storage-boundary project.

## Architecture

### Core principle

Storage becomes a boundary below Tolaria's existing vault engine. The note model, parsing rules, mutation semantics, indexing behavior, search behavior, and UI workflow should continue to operate above that boundary.

### High-level split

The design introduces three layers:

1. `Vault engine`
- Owns note semantics.
- Parses markdown/frontmatter.
- Performs note mutations.
- Maintains derived state such as indexes, note metadata, and search inputs.
- Defines save correctness rules and conflict detection inputs.

2. `Vault provider`
- Owns where the vault lives and how files are reached.
- Resolves the root path or backing handle.
- Exposes capabilities and sync-related state.
- Surfaces provider-specific errors in a normalized form.
- Supplies change-detection signals or polling hooks appropriate to the provider.

3. `Desktop shell`
- Owns Tauri-specific UI, menus, dialogs, and desktop capability presentation.
- Adapts the selected provider into the current Tolaria desktop flows.

### Provider interface boundaries

The provider boundary should be narrow. A provider is not responsible for note parsing or Tolaria semantics. It should only answer questions such as:

- How does the app identify and open this vault?
- What filesystem path or access boundary represents the vault on this platform?
- What capabilities does this vault support?
- How should the app interpret missing, delayed, or stale file states?
- What change-detection mechanism is available?
- What provider-specific status or error states should be surfaced?

The provider should not own:

- note type logic
- relationship detection
- view evaluation
- H1/filename semantics
- frontmatter mutation rules
- command palette behavior
- git behavior outside provider capability reporting

### Minimum provider contract

The first implementation should define a small, explicit contract so planning can assign work cleanly. The exact API shape may differ by language layer, but the provider boundary must cover these responsibilities and no more:

- `providerType()`
  - Returns the stable provider identifier such as `local-folder` or `icloud-drive`.
- `resolveVaultRoot()`
  - Returns the validated local root path the desktop app can operate on.
- `capabilities()`
  - Returns the capability profile for the current vault instance.
- `currentStatus()`
  - Returns current provider availability and sync-related status.
- `subscribeStatus(listener)`
  - Emits provider status changes when available, otherwise a no-op implementation is allowed.
- `validateSelection(input)`
  - Validates a user-selected location before the vault is opened or persisted.
- `watchStrategy()`
  - Declares whether the provider expects native watch only, watch plus periodic reconciliation, or periodic reconciliation only.

For this project, the contract should use these minimum shared shapes:

- `ProviderAvailability`
  - `available`
  - `degraded`
  - `unavailable`
- `ProviderSyncState`
  - `not_applicable`
  - `unknown`
  - `syncing_or_delayed`
  - `stable`
- `ProviderWatchStrategy`
  - `native-watch-only`
  - `native-watch-plus-reconcile`
  - `reconcile-only`
- `ProviderValidationResult`
  - `valid`
  - `invalid`
  - `warning`

`currentStatus()` should return at minimum:

- `availability`
- `syncState`
- `message` for human-readable UI presentation when not healthy

`subscribeStatus(listener)` should emit the same payload shape and may be implemented as best-effort updates. Missed events are acceptable as long as reconciliation paths exist.

`validateSelection(input)` should return:

- validation result enum
- resolved provider type
- resolved root path if valid
- user-facing message when warning or invalid

Minimum validation decision rules:

| Explicit selection | Canonical path classification | Result | Behavior |
|---|---|---|---|
| `local-folder` | outside iCloud Drive | `valid` | Open as local-folder |
| `local-folder` | inside iCloud Drive | `warning` | Allow open as local-folder, explain that the path appears to live in iCloud Drive and can be reclassified only by explicit user action |
| `icloud-drive` | inside iCloud Drive | `valid` | Open as iCloud provider |
| `icloud-drive` | outside iCloud Drive | `invalid` | Do not open; explain that the selected path is not inside the detected iCloud Drive root |
| no explicit selection | inside iCloud Drive | `valid` | Infer `icloud-drive` |
| no explicit selection | outside iCloud Drive | `valid` | Infer `local-folder` |

For `icloud-drive` on macOS, provider status may be inferred heuristically. Minimum status rules:

| Condition | availability | syncState | Notes |
|---|---|---|---|
| canonical root resolved and filesystem access succeeds | `available` | `unknown` or `stable` | default healthy state when no delay signal is known |
| canonical root resolved, filesystem access succeeds, but watch/reconcile detects delayed or inconsistent file visibility | `degraded` | `syncing_or_delayed` | non-blocking status; reads/writes may still proceed if safe |
| canonical root cannot be resolved, filesystem access fails consistently, or permissions prevent access | `unavailable` | `unknown` | blocking for writes |

The provider is not required to detect true iCloud sync internals. For this first project, status may remain `unknown` indefinitely when macOS offers no trustworthy signal. In that case the UI should treat the vault as usable unless correctness checks or filesystem access indicate otherwise.

The provider contract does not replace the existing file command surface. Desktop file operations should continue using normal local filesystem paths through the vault engine and command boundary after `resolveVaultRoot()` succeeds. That keeps provider scope narrow and avoids duplicating note/file semantics at the provider layer.

### Vault identity and persistence

Every opened vault should persist two pieces of information together:

- `providerType`
- `providerRoot`

`providerRoot` is the canonical desktop path that Tolaria reopens later. For this project, `icloud-drive` does not introduce a remote vault identifier. It still resolves to a local synced folder path on macOS.

The product should support both of these onboarding flows:

- explicit provider selection before choosing a folder
- safe inference when the chosen path is inside the user's iCloud Drive location

If inference and explicit selection disagree, explicit selection wins and validation should explain why. This keeps the UI predictable while still allowing a convenient “choose folder and Tolaria detects iCloud” path.

This project only requires provider-aware behavior when opening an existing vault. It does not require a provider-specific create-vault flow.

For this first project, persisted vault metadata should live in the same existing vault-selection storage that currently remembers opened vaults and the active vault. Existing stored vault entries should be migrated on read by assigning them:

- `providerType: local-folder`
- `providerRoot: <existing persisted vault path>`

If a persisted `providerRoot` no longer exists on reopen:

- the vault should not auto-open silently as healthy
- the shell should surface a vault-missing state and let the user reselect or remove it
- no background mutation attempt should run against a missing path

If a stored local-folder path now resolves inside iCloud Drive, migration should still preserve its stored provider type unless the user explicitly re-saves or switches the provider. This avoids surprising silent provider flips.

Provider detection and persistence should use the canonical resolved filesystem path on macOS after symlink resolution. Tolaria should classify a path as `icloud-drive` only when that canonical path is inside the user's current iCloud Drive root. Alias or symlink inputs may be accepted, but persisted provider classification must be based on the resolved canonical path so reopen behavior is stable.

For this project, the app should discover the user's iCloud Drive root through macOS-visible filesystem conventions already available to the desktop app. If no iCloud root can be discovered, or iCloud Drive is disabled/unavailable, then:

- explicit `icloud-drive` selection is `invalid`
- implicit inference to `icloud-drive` must not occur
- the same path may still be opened as `local-folder` if it otherwise validates

### Initial provider capability model

The provider layer should expose a capability profile, not implicit assumptions. For this project the relevant capabilities are:

- local readable/writable file access
- attachment access
- file watching quality level
- desktop git suitability
- provider sync visibility state
- provider availability state

The first two providers likely map like this:

The capability payload should use explicit enum-style values so the UI and tests do not infer meaning from prose. Minimum fields:

- `fileAccess`
  - `read_write`
  - `read_only`
  - `unavailable`
- `attachmentAccess`
  - `full`
  - `unavailable`
- `watchReliability`
  - `high`
  - `variable`
  - `none`
- `gitMode`
  - `supported`
  - `allowed_but_secondary`
  - `unsupported`
- `syncVisibility`
  - `not_applicable`
  - `limited`
  - `explicit`

Capabilities describe vault-level support only. Dynamic conditions belong elsewhere:

- `capabilities()`
  - stable vault/provider abilities
- `currentStatus()`
  - provider-wide runtime state such as unavailable or delayed sync
- note/file runtime handling
  - per-file conditions such as one attachment not yet materialized locally

`local-folder`
- full local read/write
- normal watcher behavior
- git-capable on desktop
- no cloud sync state

Suggested capability mapping:
- `fileAccess: read_write`
- `attachmentAccess: full`
- `watchReliability: high`
- `gitMode: supported`
- `syncVisibility: not_applicable`

`icloud-drive`
- local read/write through the synced iCloud folder on macOS
- watcher behavior may be noisier or delayed
- desktop git may be allowed only if the vault itself is also git-backed, but git is not the source of cross-device sync
- provider sync state may be delayed or temporarily unavailable

Suggested capability mapping:
- `fileAccess: read_write`
- `attachmentAccess: full`
- `watchReliability: variable`
- `gitMode: allowed_but_secondary`
- `syncVisibility: limited`

Git enablement rule for `icloud-drive` on desktop:

- enable git actions only when the resolved vault root is a valid git repository and provider availability is not `unavailable`
- present git as a desktop capability of that vault, not as the mechanism that makes the iCloud vault shared across devices
- when the vault is not a valid repo, do not imply that iCloud-backed vaults must become git-backed to remain supported

### Change-detection strategy

The desktop app must not assume that provider watch fidelity is always equal to a plain local folder. The provider contract therefore needs a declared refresh strategy:

- `native-watch-only`
  - Existing watcher-driven behavior is sufficient.
- `native-watch-plus-reconcile`
  - Use normal file watching, but also run lightweight reconciliation after important lifecycle points such as vault open, app foreground, and completed writes.
- `reconcile-only`
  - Skip trust in continuous watch events and rely on periodic or triggered rescans.

For the first iCloud desktop project, the default assumption should be `native-watch-plus-reconcile`. That is conservative enough for delayed or noisy sync while still reusing current watcher infrastructure.

Reconciliation does not mean full reload after every event. It means a bounded refresh path that re-checks relevant files or vault state when provider reliability is lower than a normal local folder.

The integration point should be explicit: the provider declares watch strategy and status, while the vault engine owns refresh orchestration. The engine decides when to perform bounded reconciliation in response to provider state, app lifecycle transitions, and save completion.

## Workflow Preservation Requirements

Desktop support for iCloud-backed vaults is only successful if the existing Tolaria workflow still works. That means the design must preserve these user-visible invariants:

### Must remain functionally intact

- Opening a vault and deriving the same note graph from the files on disk.
- Navigating by sidebar sections and types.
- Filtering, sorting, and searching within note lists.
- Opening notes and editing them through the existing editor modes.
- Viewing and editing properties and relationships.
- Creating notes from type-aware contexts.
- Maintaining wikilink navigation and relationship behavior.
- Preserving H1-driven note identity behavior, including rename-sensitive workflows.
- Keeping views and view definitions working over the same vault files.
- Keeping command-palette actions available where they work today.

### May degrade slightly but must stay understandable

- File change detection timing may be slower or noisier than a purely local folder.
- Attachment appearance may lag during provider sync events.
- Some git-oriented status assumptions may need clearer UI states when the vault is iCloud-backed.

### Explicitly out of scope for this project

- Reimagining the workflow for touch-first UI.
- Mobile-specific command surfaces.
- Platform-specific redesign of the four-panel layout.

## Data Flow and Save Correctness

The vault remains the source of truth. For this project, the difference is that the source of truth may live under a provider-managed synced folder rather than only an ordinary local folder.

Each desktop session still maintains derived state:

- active vault selection
- parsed note index
- cached metadata
- UI state
- search state

### Save flow

The save flow should preserve Tolaria's current disk-first philosophy:

1. Read current file identity and content.
2. Apply the intended mutation.
3. Write the file to the provider-backed filesystem path.
4. Refresh derived state.
5. Validate whether the file changed unexpectedly around the save window.

### File identity definition

This project needs a concrete definition of `file identity` because stale-write protection depends on it. For desktop vault providers, file identity should be a composite of:

- canonical path
- last known modified timestamp
- file size

Where an operation already has the current full file content in memory, content comparison may be used as a stronger confirmation step before treating a write as stale or conflicted. The initial implementation does not need a provider-specific remote revision token because `icloud-drive` is still surfaced as a local synced folder on macOS.

This keeps the first project aligned with the current architecture while leaving room for stronger identity tokens in later mobile-oriented provider work.

### Conflict policy

Because iCloud sync is asynchronous, desktop support should no longer rely on an assumption that local writes are the only source of change. The design should adopt a provider-aware stale-file policy:

- save only when the expected file identity still matches the opened editor version
- if the identity no longer matches, surface a conflict or stale-file state instead of silently overwriting
- preserve unsaved local editor content long enough for recovery or manual resolution
- prefer explicit recovery actions such as reload, compare, or duplicate draft over hidden merge behavior

This project does not require a fully polished conflict-resolution UI. The minimum required v1 recovery behavior is:

- block the unsafe overwrite
- preserve the unsaved local content in memory until the user chooses a recovery action
- provide at least `reload from disk` and `duplicate local draft` actions

Diff or compare UI is optional in this first project. Preventing silent data loss is mandatory.

`duplicate local draft` must mean:

- create a new markdown note inside the current vault root
- persist it immediately as a normal note file, not just a temporary UI object
- use a conflict-recovery filename pattern derived from the current note, such as `<original-stem>-recovered-<timestamp>.md`
- preserve the unsaved editor content in that new file
- treat the recovered draft as a normal indexed note after creation

This keeps recovery compatible with Tolaria's files-first model and avoids hidden out-of-band draft storage.

### External file lifecycle while open

Provider-backed vaults must also handle these filesystem cases while a note is open:

- `external rename`
  - the engine should attempt reconciliation only when exactly one candidate file can be matched by prior path history plus unchanged file identity signals such as recent modified time, file size, or validated content
  - if zero or multiple plausible candidates exist, safe reconciliation is not possible
  - when safe reconciliation is not possible, the shell must surface that the open note moved and block unsafe writes until the user reloads or recovers
- `external delete`
  - the shell must surface that the file no longer exists
  - the editor must not silently recreate the file on the next save without an explicit recovery action
  - local unsaved content should remain recoverable in memory for the current session where possible
- `external delete then recreate`
  - treat the recreated file as a new on-disk identity
  - block unsafe overwrite if the open editor version no longer matches

These rules belong to the vault engine for correctness and to the shell for user-visible recovery.

## Error Handling

The design should normalize provider errors into three practical classes:

### 1. Recoverable local state errors

- temporarily missing file
- delayed provider sync
- stale editor version
- attachment not yet locally available

Expected behavior:
- keep the current UI stable where possible
- preserve user edits where safe
- offer reload/retry/recover actions

### 2. Provider/session errors

- iCloud unavailable
- provider path moved or disconnected
- permission loss
- quota or provider-side unavailability

Expected behavior:
- surface clear vault-level status
- block unsafe writes when necessary
- avoid leaving the UI in a fake healthy state

### 3. Unsupported capability errors

- provider does not guarantee a capability the current feature expects
- git workflow assumed where provider state is not appropriate

Expected behavior:
- gate or disable the feature at the UI boundary
- do not fail deep in the stack after the user starts an action

### Ownership of degraded-state behavior

Responsibility should be split clearly:

- `provider layer`
  - detect provider status
  - classify provider-specific errors
  - expose capabilities and status changes
- `vault engine`
  - enforce stale-write and correctness checks
  - decide when an operation is unsafe to proceed
  - preserve recoverable editor state where possible
- `desktop shell`
  - translate provider and engine state into visible UI gating, banners, retry actions, and disabled commands

### Required degraded-state decisions

The first implementation plan should assume these behaviors:

- `provider unavailable`
  - block writes
  - allow already-loaded read-only UI where safe
  - surface reconnect/retry state at vault level
- `delayed sync suspected`
  - allow local reads and writes
  - surface non-blocking provider status
  - prefer refresh/reconcile after key transitions
- `stale editor version`
  - block direct overwrite
  - keep unsaved editor content recoverable
  - offer reload/duplicate/compare-oriented recovery path
- `attachment missing locally`
  - keep note usable
  - show placeholder or unavailable state for that attachment only
- `git unsupported or inappropriate for current provider state`
  - hide or disable the git action before execution

### Required UI surfaces

The desktop shell should present provider/engine state through a small fixed set of surfaces:

- `vault picker / vault management UI`
  - shows provider type
  - handles provider selection, validation warnings, and missing-vault recovery
- `non-blocking vault status surface`
  - for degraded sync or delayed provider states
  - should appear in an existing low-friction status area such as vault/status UI, not as a modal
- `blocking action feedback`
  - used for writes that must not proceed, invalid provider selection, or stale-save prevention
- `feature gating at action entry`
  - commands, buttons, and menus should disable or hide unsupported actions before execution

Banner vs dialog vs disabled action exact component choices can follow existing Tolaria UI patterns, but the above four surfaces are mandatory acceptance points.

Minimum state-to-surface mapping:

| State | Required surface | Acceptance behavior |
|---|---|---|
| vault missing on reopen | vault picker / vault management UI | Vault is shown as unavailable and requires reselect or removal before it is treated as healthy |
| permission loss or provider unavailable after open | blocking action feedback + non-blocking vault status surface | Existing read state may remain visible, writes are blocked, status clearly explains why |
| stale editor version | blocking action feedback | Unsafe save is blocked and recovery actions are shown |
| attachment missing locally | note/file runtime handling + non-blocking status where helpful | Only the attachment surface degrades; the rest of the note remains usable |
| git unsupported/inappropriate | feature gating at action entry | Git actions are disabled or hidden before invocation |

## Desktop UX Implications

This project is not a workflow redesign, but desktop UI will likely need targeted affordances so the app stays honest when a vault is iCloud-backed.

Likely additions or adjustments:

- show the selected provider in vault metadata or settings
- show provider availability/sync state when relevant
- gate git-oriented messaging so iCloud-backed vaults are not treated as if git is their only safety model
- keep unsupported states explicit instead of hidden

Minimum UX acceptance criteria:

- a user can choose or confirm a provider when opening an existing vault
- an already-opened vault clearly retains provider identity across app relaunch
- a missing or unavailable provider-backed vault is shown as broken/unavailable, not silently healthy
- stale-save prevention results in a clear blocking recovery flow
- degraded sync/provider states are visible without interrupting routine reading/navigation
- git actions are not presented as the only safety model when the vault is iCloud-backed

These changes should stay small and functional. The goal is not a new navigation model; it is preserving trust while storage semantics become more variable.

## Testing Strategy

This project should be tested as a workflow-preservation project, not only a storage-adapter project.

### Unit and integration focus

- provider capability reporting
- provider error normalization
- save-path stale-file detection
- derived-state refresh after provider-backed writes
- watcher or refresh behavior under delayed file updates

### Desktop workflow verification focus

The following existing workflows should be validated specifically against an iCloud-backed vault:

- open vault
- load sidebar sections and type groupings
- browse and search note lists
- open note
- edit and save note
- create note from context
- edit properties/frontmatter-backed values
- navigate via wikilinks
- maintain views and filters
- handle attachment rendering when files are present

### Failure-mode checks

- note file changes outside the app while open
- same note content changes between editor open and save
- attachment exists in metadata path but is not locally materialized yet
- provider path temporarily unavailable
- app restart rebuilds correct derived state from the iCloud-backed vault

### Test environment shape

The plan should treat testing as three lanes:

1. `automated unit/integration tests`
- use provider fakes or harnesses that simulate capability differences, degraded status, and delayed reconciliation triggers
- verify provider contract handling without requiring real iCloud infrastructure

2. `desktop integration tests against a normal filesystem path`
- verify the local-folder provider continues to behave identically after the abstraction is introduced
- catch regressions caused by routing existing flows through the provider boundary

3. `manual QA against a real iCloud Drive vault on macOS`
- verify actual folder selection, provider identification, write/read behavior, attachment visibility, reload behavior, and workflow preservation on a real iCloud-backed vault

This split keeps automated coverage realistic while reserving true provider-specific sync behavior for a manual QA lane in the first project.

### Acceptance criteria by lane

`automated unit/integration`
- local-folder persisted entries migrate to provider-backed metadata without behavior change
- provider validation returns stable shapes for valid, warning, and invalid selections
- stale-save protection blocks overwrite when file identity changes
- provider status transitions drive the expected engine and shell state mappings
- bounded reconciliation can be triggered from provider watch strategy without a full vault rewrite

`desktop integration against normal filesystem`
- existing local-folder workflow remains intact after provider abstraction
- open, search, edit, create, property edit, wikilink navigation, and view loading continue to work

`manual QA on real iCloud Drive vault`
- user can open an iCloud-backed vault and see provider identity retained after relaunch
- note edits save successfully under normal conditions
- if external file changes occur before save, overwrite is blocked and `reload from disk` plus `duplicate local draft` recovery paths are available
- delayed or missing attachment materialization does not break the rest of the note UI
- temporary provider unavailability surfaces visible degraded or blocking state instead of silent failure
- the existing desktop Tolaria workflow remains usable across sidebar, note list, editor, properties, and command-driven actions

## Delivery Plan

This project should be implemented in phases:

1. `Persisted vault metadata migration`
- Upgrade existing remembered vault entries to `{ providerType, providerRoot }`.
- Preserve existing behavior for local-folder users.
- Acceptance: existing vault reopen behavior still works after migration.

2. `Provider selection and validation flow`
- Add explicit provider selection plus safe inference on open.
- Canonicalize macOS paths before classification and persistence.
- Acceptance: valid, warning, and invalid selection outcomes are stable and testable.

3. `Provider contract and local-folder adapter`
- Introduce the provider contract and route the existing local-folder flow through it.
- Acceptance: no regression in current desktop vault workflows.

4. `Provider status and reconciliation adapter`
- Connect provider watch strategy and runtime status to vault-engine refresh orchestration.
- Acceptance: delayed or degraded provider states can trigger bounded reconciliation without a full reload-by-default model.

5. `iCloud desktop provider`
- Add iCloud path detection, persistence, capability reporting, and open/reopen support for iCloud-backed vaults.
- Acceptance: desktop can open and operate on a real iCloud-backed vault.

6. `Stale-save enforcement and recovery`
- Enforce file-identity checks before unsafe overwrites.
- Provide `reload from disk` and `duplicate local draft` as the minimum recovery actions.
- Acceptance: no silent overwrite when underlying file identity changes.

7. `UI gating and workflow verification`
- Surface provider identity/status, missing-vault handling, and git gating.
- Verify sidebar, note list, editor, properties, views, search, and command-driven actions still work on desktop over iCloud-backed files.
- Acceptance: core Tolaria workflow remains usable and truthful on desktop.

The project is complete when desktop users can open and use an iCloud-backed vault without breaking Tolaria's core workflow and without introducing silent correctness regressions.

## Future Follow-Up, Explicitly Deferred

If this project succeeds, the next spec can target iPhone support. That later project should build on the provider boundary and desktop workflow verification completed here. It should not reopen the storage architecture unless this project exposes a fundamental flaw.

Deferred until later:

- iPhone-specific UI and interaction model
- mobile capability gating
- mobile conflict resolution UX
- additional providers such as Google Drive or Dropbox
- web client strategy

## Approval Statement

This spec intentionally narrows scope to the smallest architectural step that preserves Tolaria's current logic while enabling a future Apple-first expansion: implement vault providers, add desktop support for iCloud-backed vaults, and verify the existing desktop workflow continues to work over that storage model.
