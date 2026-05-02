# Vault Providers and iCloud Desktop Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider boundary for desktop vaults, support iCloud-backed vault selection/opening on macOS desktop, and preserve the existing Tolaria workflow while adding provider-aware status, gating, and stale-save safety.

**Architecture:** Keep Tolaria's note semantics above the new provider boundary. Persist `{ providerType, providerRoot }` alongside remembered vaults, route existing desktop vault flows through a small provider contract, and treat iCloud as a macOS filesystem-backed provider with weaker watch/sync guarantees than a plain local folder. Provider status drives shell gating and bounded reconciliation; note correctness remains enforced by the vault engine and save paths.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri v2, Rust, existing vault list persistence, existing vault watcher/reload pipeline.

---

Scope note: this chunk does not include a provider-specific create-vault flow. It covers provider-aware opening of existing vaults only.

## Chunk 1: Provider Foundation and Desktop iCloud Support

### File Structure

**Create:**
- `src/lib/vaultProviders.ts` - shared provider enums, capability/status/validation types, canonical provider helpers used by frontend.
- `src/lib/vaultProviders.test.ts` - unit tests for provider classification and serialization helpers.
- `src/lib/vaultProviderRuntime.ts` - frontend adapter for provider status subscription, watch strategy access, and normalized runtime payload handling.
- `src/lib/vaultProviderRuntime.test.ts` - unit tests for `subscribeStatus(listener)` behavior and runtime payload normalization.
- `src-tauri/src/vault_provider.rs` - Rust provider metadata types, canonicalization helpers, iCloud root detection, selection validation, and provider status scaffolding.
- `src/components/editor/StaleSaveDialog.tsx` - blocking stale-save recovery UI with `reload from disk` and `duplicate local draft` actions.
- `src/components/editor/StaleSaveDialog.test.tsx` - UI tests for the blocking recovery flow.
- `src/hooks/useVaultProviderState.ts` - provider-specific runtime state, validation result handling, and status/reconciliation glue extracted out of `useVaultSwitcher.ts`.
- `src/hooks/useVaultProviderState.test.ts` - tests for provider-state transitions and reconciliation triggers.

**Modify:**
- `src/components/status-bar/types.ts` - extend `VaultOption` with provider metadata and provider/runtime availability fields.
- `src/components/status-bar/OpenVaultProviderDialog.tsx` - explicit provider selection/confirmation UI for opening an existing vault.
- `src/components/status-bar/OpenVaultProviderDialog.test.tsx` - component tests for explicit local-folder vs iCloud selection/confirmation.
- `src/utils/vaultListStore.ts` - load/save provider-backed vault entries, keep legacy entries readable, normalize provider fields.
- `src/hooks/useVaultSwitcher.ts` - route persisted vault selection through provider-aware metadata, validation, status, and open-flow logic.
- `src/hooks/useVaultSwitcher.test.ts` - regression and new tests for migration, provider inference, invalid iCloud selection, and missing-provider reopen behavior.
- `src/components/status-bar/VaultMenu.tsx` - display provider identity and unavailable/degraded state in the existing vault picker.
- `src/components/StatusBar.tsx` - pass provider-open and provider-state props through the status bar shell.
- `src/components/StatusBar.test.tsx` - regression tests for open-vault actions and provider/gating affordances.
- `src/components/status-bar/StatusBarSections.tsx` - wire provider-open dialog and provider-aware git gating into the existing sections.
- `src/components/FilePreview.tsx` - preserve graceful attachment behavior when provider-backed files are delayed or missing.
- `src/components/FilePreview.test.tsx` - explicit attachment rendering and missing-materialization regression coverage.
- `src/mock-tauri/mock-handlers.ts` - mock new provider-aware commands and persisted vault payloads.
- `src/mock-tauri/mock-handlers.coverage.test.ts` - keep mock persistence tests aligned with the new schema.
- `src-tauri/src/vault_list.rs` - persist provider metadata, migrate legacy `path`-only entries on load, keep write format stable.
- `src-tauri/src/commands/system.rs` - expose provider validation / detection commands to the frontend.
- `src-tauri/src/lib.rs` - register new provider commands and keep startup vault loading compatible with migrated metadata.
- `src/App.tsx` - app foreground hook for provider reconciliation and the concrete owner for top-level stale-save dialog presentation.
- `src/App.test.tsx` - regression coverage for provider status surfaces and top-level recovery wiring.
- `src/hooks/useVaultWatcher.ts` - provider-aware watch/reconcile integration on the frontend.
- `src/hooks/useVaultWatcher.test.ts` - watch/reconcile regression coverage.
- `src/utils/pulledVaultRefresh.ts` - bounded refresh logic after provider-triggered reloads.
- `src/utils/pulledVaultRefresh.test.ts` - bounded refresh regression coverage.
- `src/lib/locales/en.json` - new user-facing copy for provider selection, warnings, unavailable states, and stale-save recovery.
- `src/lib/locales/*.json` - translated locale catalogs updated by `pnpm l10n:translate`.
- `docs/ARCHITECTURE.md` - document the vault-provider boundary after implementation.
- `docs/ABSTRACTIONS.md` - document persisted vault provider metadata and provider capability concepts after implementation.

**Stale-save implementation files (known now):**
- `src/hooks/useAppSave.ts` - app-level save orchestration and reload behavior after note writes.
- `src/hooks/useAppSave.test.ts` - save-path regression coverage.
- `src/hooks/useEditorSave.ts` - editor save trigger behavior.
- `src/hooks/useEditorSave.test.ts` - editor save regression coverage.
- `src/hooks/useSaveNote.ts` - low-level frontend note save helper.
- `src/hooks/useSaveNote.test.ts` - low-level save helper tests.
- `src-tauri/src/commands/vault/file_cmds.rs` - command boundary for `get_note_content`, `validate_note_content`, and `save_note_content`.
- `src-tauri/src/vault/file.rs` - disk content and note write helpers used below the command boundary.

### Repo Execution Rules

- Before Task 1, run `mcp__codescene__code_health_score` and stop for refactoring first if the project is already below the repo threshold.
- Before editing any existing scorable code file in a task, capture its current CodeScene file score.
- After editing each touched scorable code file, re-run the same file-level CodeScene review and confirm the score improves, or stays `10.0` if it started at `10.0`.
- Before each commit in this plan, run CodeScene file-level review for every touched/new scorable code file in that task.
- If any CodeScene or hook gate fails, fix the code rather than lowering thresholds.

### Task 1: Persisted Vault Metadata Migration

**Files:**
- Create: `src/lib/vaultProviders.ts`
- Modify: `src/components/status-bar/types.ts`
- Modify: `src/utils/vaultListStore.ts`
- Modify: `src/hooks/useVaultSwitcher.ts`
- Modify: `src-tauri/src/vault_list.rs`
- Test: `src/lib/vaultProviders.test.ts`
- Test: `src/hooks/useVaultSwitcher.test.ts`

- [ ] **Step 1: Write the failing TypeScript tests for provider metadata defaults and legacy entry migration**

Add tests covering:
- legacy persisted entries with only `{ label, path }` load as `providerType: 'local-folder'` and `providerRoot: path`
- serialization writes provider metadata and still preserves label/path compatibility expected by the rest of the app
- invalid provider fields fall back safely instead of crashing

- [ ] **Step 2: Run the targeted TypeScript tests to verify they fail**

Run: `pnpm vitest run src/lib/vaultProviders.test.ts src/hooks/useVaultSwitcher.test.ts`
Expected: FAIL with missing provider helpers / mismatched persisted vault shape assertions.

- [ ] **Step 3: Write the failing Rust tests for `VaultList` migration/defaulting**

Add tests in `src-tauri/src/vault_list.rs` covering:
- legacy JSON without provider fields loads as `local-folder`
- new JSON round-trips `provider_type` and `provider_root`
- malformed provider values default safely to `local-folder` plus the legacy `path` value rather than failing vault-list load

- [ ] **Step 4: Run the targeted Rust tests to verify they fail**

Run: `cargo test vault_list --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because provider fields and migration behavior are not implemented.

- [ ] **Step 5: Implement minimal shared provider metadata types**

Implement:
- stable provider identifiers (`local-folder`, `icloud-drive`)
- persisted vault entry shape with `{ label, path, providerType, providerRoot }`
- helpers that default legacy entries to `local-folder`

- [ ] **Step 6: Implement Rust-side persisted vault migration**

Implement:
- serde-compatible new fields on persisted entries
- `#[serde(default)]`-style migration for legacy data
- save path still writing the new canonical structure

- [ ] **Step 7: Update `vaultListStore` and `VaultOption` to use provider-aware metadata**

Keep changes minimal:
- load provider-aware entries
- surface `providerType` and `providerRoot`
- keep `path` available for existing consumers while the rest of the refactor lands

- [ ] **Step 8: Re-run the targeted TypeScript and Rust tests**

Run:
- `pnpm vitest run src/lib/vaultProviders.test.ts src/hooks/useVaultSwitcher.test.ts`
- `cargo test vault_list --manifest-path src-tauri/Cargo.toml`
Expected: PASS for the new migration/defaulting coverage.

- [ ] **Step 9: Commit**

```bash
git add src/lib/vaultProviders.ts src/lib/vaultProviders.test.ts src/components/status-bar/types.ts src/utils/vaultListStore.ts src/hooks/useVaultSwitcher.ts src/hooks/useVaultSwitcher.test.ts src-tauri/src/vault_list.rs
git commit -m "refactor: persist provider-backed vault metadata"
```

### Task 2: Provider Validation, Canonicalization, and iCloud Root Detection

**Files:**
- Create: `src-tauri/src/vault_provider.rs`
- Modify: `src-tauri/src/commands/system.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/vaultProviders.ts`
- Modify: `src/lib/locales/en.json`
- Test: `src/lib/vaultProviders.test.ts`
- Test: `src/hooks/useVaultSwitcher.test.ts`
- Test: `src-tauri/src/vault_provider.rs`

- [ ] **Step 1: Write the failing Rust tests for canonical path classification and validation outcomes**

Cover the spec matrix:
- `resolveVaultRoot()` returns the canonical runtime path for a valid provider selection
- symlink/alias input canonicalizes to the persisted `providerRoot` and reopens through the resolved canonical path
- explicit `icloud-drive` + non-iCloud canonical path => invalid
- explicit `local-folder` + iCloud path => warning
- no explicit provider + iCloud path => infer `icloud-drive`
- no iCloud root discoverable => `icloud-drive` invalid and no implicit inference
- when iCloud root discovery fails, the same selected path can still open as `local-folder` if it otherwise validates

Test seam requirement:
- stub canonical-path resolution and iCloud-root discovery inputs in tests rather than reading the real macOS environment directly

- [ ] **Step 2: Run the targeted Rust tests to verify they fail**

Run: `cargo test vault_provider --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because provider detection/validation commands do not exist.

- [ ] **Step 3: Write the failing frontend tests for provider validation result handling**

Add tests for parsing/using:
- `valid`
- `warning`
- `invalid`
results from the new Tauri command payload.

- [ ] **Step 4: Run the targeted frontend tests to verify they fail**

Run: `pnpm vitest run src/lib/vaultProviders.test.ts src/hooks/useVaultSwitcher.test.ts`
Expected: FAIL because the frontend types do not yet match the command contract.

- [ ] **Step 5: Implement Rust provider command surface**

Implement the smallest command set needed now:
- validate a candidate vault selection
- canonicalize and classify provider type
- resolve the canonical runtime root path for the chosen provider
- discover whether iCloud root is available on macOS

Do not add remote APIs or background sync logic.

- [ ] **Step 6: Implement matching frontend types and helpers**

Add exact enums/types mirroring the spec:
- `ProviderAvailability`
- `ProviderSyncState`
- `ProviderWatchStrategy`
- `ProviderValidationResult`

- [ ] **Step 7: Add validation and warning copy to `src/lib/locales/en.json`**

Add strings for:
- invalid explicit iCloud selection
- local-folder inside iCloud warning
- inferred iCloud confirmation
- provider unavailable / vault missing messaging used by the open flow

- [ ] **Step 8: Add the provider capability payload end to end**

Implement and test explicit capability fields:
- `fileAccess`
- `attachmentAccess`
- `watchReliability`
- `gitMode`
- `syncVisibility`

Add explicit assertions for:
- `local-folder` default capability mapping
- `icloud-drive` default capability mapping

Concrete contract path:
- Rust provider command payload exposes `capabilities()` data
- `src/lib/vaultProviders.ts` defines the shared frontend shape
- consumer hooks/UI can read the shared capability shape immediately for validation and local-folder checkpoint work
- runtime normalization and subscription wiring are deferred to Task 4 in `src/lib/vaultProviderRuntime.ts`

Frontend UI code later in the plan should consume these capabilities instead of hardcoding provider-type checks.

- [ ] **Step 9: Re-run the targeted tests**

Run:
- `cargo test vault_provider --manifest-path src-tauri/Cargo.toml`
- `pnpm vitest run src/lib/vaultProviders.test.ts src/hooks/useVaultSwitcher.test.ts`
Expected: PASS for the validation matrix and payload handling.

- [ ] **Step 10: Run localization update for the new validation copy**

Run: `pnpm l10n:translate`
Expected: locale catalogs update cleanly and preserve placeholders/product names.

- [ ] **Step 11: Run the local-folder adapter checkpoint before iCloud-specific UI work**

Run: `pnpm vitest run src/hooks/useVaultSwitcher.test.ts src/App.test.tsx`
Expected: PASS with existing local-folder open/reopen behavior now routed through the provider contract.

- [ ] **Step 12: Commit**

```bash
git add src/lib/vaultProviders.ts src/lib/vaultProviders.test.ts src/hooks/useVaultSwitcher.test.ts src/lib/locales/en.json src/lib/locales/*.json src-tauri/src/vault_provider.rs src-tauri/src/commands/system.rs src-tauri/src/lib.rs
git commit -m "feat: add vault provider validation"
```

### Task 3: Provider-Aware Vault Open Flow in Desktop UI

**Files:**
- Create: `src/components/status-bar/OpenVaultProviderDialog.tsx`
- Test: `src/components/status-bar/OpenVaultProviderDialog.test.tsx`
- Create: `src/hooks/useVaultProviderState.ts`
- Test: `src/hooks/useVaultProviderState.test.ts`
- Modify: `src/hooks/useVaultSwitcher.ts`
- Modify: `src/hooks/useVaultSwitcher.test.ts`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/StatusBar.test.tsx`
- Modify: `src/components/status-bar/StatusBarSections.tsx`
- Modify: `src/lib/locales/en.json`
- Modify: `src/mock-tauri/mock-handlers.ts`
- Modify: `src/mock-tauri/mock-handlers.coverage.test.ts`
- Modify: `src/components/status-bar/VaultMenu.tsx`

- [ ] **Step 1: Write the failing `useVaultSwitcher` tests for provider-aware open behavior**

Cover:
- persisted iCloud-backed vault entry loads and remains selectable after reload
- missing provider root on reopen is surfaced as unavailable instead of silently healthy
- invalid explicit iCloud selection is rejected
- local-folder entry inside iCloud path can still open with a warning outcome
- a persisted `local-folder` vault does not silently flip to `icloud-drive` on reopen even if its canonical path now resolves inside iCloud Drive

- [ ] **Step 2: Write the failing dialog/state tests before implementation**

Add failing tests for:
- `OpenVaultProviderDialog.test.tsx` covering explicit provider choice and confirmation rules
- `StatusBar.test.tsx` covering the open-vault entry points for the new dialog
- `useVaultProviderState.test.ts` covering the provider confirmation state machine
- `useVaultSwitcher.test.ts` or `StatusBar.test.tsx` covering both missing-vault recovery actions: `reselect folder` and `remove vault`
- the generic open action flow: pick folder first, then confirm/select provider from the canonical-path result

- [ ] **Step 3: Run the targeted hook/UI tests to verify they fail**

Run: `pnpm vitest run src/components/status-bar/OpenVaultProviderDialog.test.tsx src/components/StatusBar.test.tsx src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.test.ts src/mock-tauri/mock-handlers.coverage.test.ts`
Expected: FAIL because the hook and mocks do not understand provider metadata or validation commands.

- [ ] **Step 4: Implement provider-aware persisted state loading in `useVaultSwitcher`**

Keep this focused:
- load provider metadata from `loadVaultList()`
- use validation results before persisting new selections
- preserve current Getting Started logic unless provider metadata makes a path invalid/unavailable
- move provider-specific validation and state transitions into `useVaultProviderState.ts` instead of expanding `useVaultSwitcher.ts` further

- [ ] **Step 5: Implement provider-aware mock handlers**

Mocks must support:
- provider fields in saved vault lists
- provider validation command responses
- unavailable provider root cases

- [ ] **Step 6: Add small vault menu affordances for provider identity/unavailable state**

Use existing UI patterns only:
- show provider type text or badge in the menu row/detail area
- keep unavailable vaults visibly unavailable
- do not redesign the menu

- [ ] **Step 7: Add explicit provider selection / confirmation UI for opening an existing vault**

Implement in:
- `OpenVaultProviderDialog.tsx`
- `StatusBar.tsx`
- `StatusBarSections.tsx`
- `useVaultSwitcher.ts`

Required behavior:
- support both open flows from the spec:
  - explicit provider selection before choosing a folder
  - folder picking first, then provider selection/confirmation shown against the validated canonical path when the user starts from a generic open action
- opening an existing folder can explicitly choose `local-folder` or `icloud-drive`
- if no explicit choice is made and the inferred result is `icloud-drive`, require explicit confirmation before persistence
- if validation returns `warning` for `local-folder` inside iCloud, require explicit confirmation before persistence
- if no explicit choice is made and the inferred result is plain `local-folder` outside iCloud, no extra confirmation is required
- invalid explicit iCloud selection never persists
- missing provider-backed vaults reopened from persisted state must expose `reselect folder` and `remove vault` recovery actions through the vault management UI before the vault can become healthy again
- persisted `local-folder` vaults retain their provider identity on reopen until the user explicitly changes it

- [ ] **Step 8: Add the required open-flow copy to `src/lib/locales/en.json`**

Add the user-facing strings used by `OpenVaultProviderDialog` and provider warnings.

- [ ] **Step 9: Run localization update for the new open-flow copy**

Run: `pnpm l10n:translate`
Expected: locale catalogs update cleanly and preserve placeholders/product names.

- [ ] **Step 10: Re-run the targeted tests**

Run: `pnpm vitest run src/components/status-bar/OpenVaultProviderDialog.test.tsx src/components/StatusBar.test.tsx src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.test.ts src/mock-tauri/mock-handlers.coverage.test.ts`
Expected: PASS for provider-aware open/reopen behavior.

- [ ] **Step 11: Commit**

```bash
git add src/components/status-bar/OpenVaultProviderDialog.tsx src/components/status-bar/OpenVaultProviderDialog.test.tsx src/hooks/useVaultProviderState.ts src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.ts src/hooks/useVaultSwitcher.test.ts src/components/StatusBar.tsx src/components/StatusBar.test.tsx src/components/status-bar/StatusBarSections.tsx src/mock-tauri/mock-handlers.ts src/mock-tauri/mock-handlers.coverage.test.ts src/components/status-bar/VaultMenu.tsx src/lib/locales/en.json src/lib/locales/*.json
git commit -m "feat: support provider-aware vault selection"
```

### Task 4: Provider Status and Reconciliation Wiring

**Files:**
- Modify: `src/lib/vaultProviders.ts`
- Create: `src/lib/vaultProviderRuntime.ts`
- Test: `src/lib/vaultProviderRuntime.test.ts`
- Modify: `src/hooks/useAppSave.ts`
- Modify: `src/hooks/useAppSave.test.ts`
- Modify: `src/hooks/useVaultProviderState.ts`
- Modify: `src/hooks/useVaultProviderState.test.ts`
- Modify: `src/hooks/useVaultSwitcher.ts`
- Modify: `src/hooks/useVaultSwitcher.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/StatusBar.test.tsx`
- Modify: `src/components/status-bar/StatusBarSections.tsx`
- Modify: `src/mock-tauri/mock-handlers.ts`
- Modify: `src/mock-tauri/mock-handlers.coverage.test.ts`
- Modify: `src-tauri/src/vault_provider.rs`
- Modify: `src/hooks/useVaultWatcher.ts`
- Modify: `src/hooks/useVaultWatcher.test.ts`
- Modify: `src/utils/pulledVaultRefresh.ts`
- Modify: `src/utils/pulledVaultRefresh.test.ts`

- [ ] **Step 1: Write the failing tests for provider status mapping and reconciliation triggers**

Cover:
- `available` + `unknown` does not block use
- `degraded` + `syncing_or_delayed` surfaces non-blocking status
- `unavailable` blocks writes and marks vault unhealthy
- provider watch strategy can request bounded reconciliation without a full reload by default
- `useAppSave.test.ts` blocks save attempts when provider availability is `unavailable`

- [ ] **Step 2: Write the failing runtime-status tests before implementation**

Add failing tests in `src/lib/vaultProviderRuntime.test.ts` covering:
- `currentStatus()` initial fetch on first load
- `subscribeStatus(listener)` updates after initial state
- no-op local-folder subscription behavior

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run:
- `pnpm vitest run src/lib/vaultProviderRuntime.test.ts src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.test.ts src/hooks/useVaultWatcher.test.ts src/utils/pulledVaultRefresh.test.ts src/App.test.tsx src/components/StatusBar.test.tsx`
- `cargo test vault_provider --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because status/reconciliation state is not yet wired.

- [ ] **Step 4: Implement minimal provider status state and watch-strategy plumbing**

Implement only what the spec requires now:
- `currentStatus()` initial fetch path from the provider layer so a reopened vault does not wait for an event before rendering the correct state
- `subscribeStatus(listener)` in `src/lib/vaultProviderRuntime.ts`, with a no-op local-folder implementation and iCloud-backed best-effort updates
- watch strategy enum
- bounded reconciliation trigger points on vault open, app foreground from `App.tsx`, and completed writes
- explicit non-blocking degraded-status surface wiring in `StatusBar.tsx` / `StatusBarSections.tsx`, fed by `useVaultSwitcher` / `App.tsx`
- a write-blocked provider state consumed by `useAppSave.ts` so provider `unavailable` prevents save attempts before stale-save logic runs
- blocking save feedback surfaced through the same top-level status/recovery UI owner in `App.tsx` so unavailable-provider save failures are visible, not silent

- [ ] **Step 5: Re-run targeted tests**

Run:
- `pnpm vitest run src/lib/vaultProviderRuntime.test.ts src/hooks/useAppSave.test.ts src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.test.ts src/hooks/useVaultWatcher.test.ts src/utils/pulledVaultRefresh.test.ts src/App.test.tsx src/components/StatusBar.test.tsx`
- `cargo test vault_provider --manifest-path src-tauri/Cargo.toml`
Expected: PASS for status mapping and non-blocking degraded-state behavior.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vaultProviders.ts src/lib/vaultProviderRuntime.ts src/lib/vaultProviderRuntime.test.ts src/hooks/useAppSave.ts src/hooks/useAppSave.test.ts src/hooks/useVaultProviderState.ts src/hooks/useVaultProviderState.test.ts src/hooks/useVaultSwitcher.ts src/hooks/useVaultSwitcher.test.ts src/App.tsx src/App.test.tsx src/components/StatusBar.tsx src/components/StatusBar.test.tsx src/components/status-bar/StatusBarSections.tsx src/mock-tauri/mock-handlers.ts src/mock-tauri/mock-handlers.coverage.test.ts src/hooks/useVaultWatcher.ts src/hooks/useVaultWatcher.test.ts src/utils/pulledVaultRefresh.ts src/utils/pulledVaultRefresh.test.ts src-tauri/src/vault_provider.rs
git commit -m "refactor: wire provider status into vault refresh"
```

### Task 5: Stale-Save Enforcement and Recovery Actions

**Files:**
- Create: `src/components/editor/StaleSaveDialog.tsx`
- Test: `src/components/editor/StaleSaveDialog.test.tsx`
- Modify: `src/hooks/useAppSave.ts`
- Modify: `src/hooks/useAppSave.test.ts`
- Modify: `src/hooks/useEditorSave.ts`
- Modify: `src/hooks/useEditorSave.test.ts`
- Modify: `src/hooks/useSaveNote.ts`
- Modify: `src/hooks/useSaveNote.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/locales/en.json`
- Modify: `src-tauri/src/commands/vault/file_cmds.rs`
- Modify: `src-tauri/src/vault/file.rs`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Write the failing tests for stale-save blocking and recovery**

Cover:
- changed file identity between open and save blocks overwrite
- external delete while open does not silently recreate on save
- external delete then recreate is treated as a new on-disk identity and still blocks unsafe overwrite
- external rename with one safe match reconciles
- external rename with ambiguous match blocks unsafe write
- duplicate local draft creates a new indexed note file inside the vault using the recovery naming pattern
- unsaved editor content stays available in memory until the user chooses `reload from disk` or `duplicate local draft`

- [ ] **Step 2: Run the targeted save-path tests to verify they fail**

Run:
- `pnpm vitest run src/components/editor/StaleSaveDialog.test.tsx src/hooks/useAppSave.test.ts src/hooks/useEditorSave.test.ts src/hooks/useSaveNote.test.ts src/App.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml file_cmds`
- `cargo test --manifest-path src-tauri/Cargo.toml vault::file`
Expected: FAIL for the new conflict and recovery coverage.

- [ ] **Step 3: Implement minimal stale-save enforcement**

Implement:
- file identity snapshot at open using the spec-required inputs: canonical path, modified timestamp, and file size
- pre-save identity check using the same composite identity, with content comparison as a stronger confirmation when current file content is already available
- external rename reconciliation only when exactly one safe candidate matches prior path history plus unchanged identity/content signals; otherwise block unsafe writes
- blocked overwrite on mismatch
- in-memory preservation of unsaved content until the user chooses recovery

- [ ] **Step 4: Implement the two required recovery actions**

Required v1 actions only:
- `reload from disk`
- `duplicate local draft` persisted in the vault as `<original-stem>-recovered-<timestamp>.md`

Present them through `StaleSaveDialog.tsx` and wire the blocking flow through `useAppSave.ts` / `App.tsx` so users can actually choose a recovery action.
After `duplicate local draft`, refresh the vault-derived state so the recovered note appears as a normal indexed note in the app without requiring a full relaunch.

Do not add compare/merge UI unless it falls out naturally from existing primitives.

- [ ] **Step 5: Run localization update for stale-save recovery copy**

Run: `pnpm l10n:translate`
Expected: locale catalogs update cleanly and preserve placeholders/product names.

- [ ] **Step 6: Re-run the targeted tests**

Run:
- `pnpm vitest run src/components/editor/StaleSaveDialog.test.tsx src/hooks/useAppSave.test.ts src/hooks/useEditorSave.test.ts src/hooks/useSaveNote.test.ts src/App.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml file_cmds`
- `cargo test --manifest-path src-tauri/Cargo.toml vault::file`

Expected: PASS for stale-write protection and recovery behavior.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/StaleSaveDialog.tsx src/components/editor/StaleSaveDialog.test.tsx src/hooks/useAppSave.ts src/hooks/useAppSave.test.ts src/hooks/useEditorSave.ts src/hooks/useEditorSave.test.ts src/hooks/useSaveNote.ts src/hooks/useSaveNote.test.ts src/App.tsx src/App.test.tsx src/lib/locales/en.json src/lib/locales/*.json src-tauri/src/commands/vault/file_cmds.rs src-tauri/src/vault/file.rs docs/ARCHITECTURE.md
git commit -m "fix: prevent stale saves on provider-backed vaults"
```

### Task 6: Git Gating and Desktop Regression Verification

**Files:**
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/StatusBar.test.tsx`
- Modify: `src/components/status-bar/StatusBarSections.tsx`
- Modify: `src/components/FilePreview.tsx`
- Modify: `src/components/FilePreview.test.tsx`
- Create: `tests/smoke/vault-providers-icloud-desktop.spec.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ABSTRACTIONS.md`
- Modify: `src/lib/locales/en.json`
- Modify: `src/lib/locales/*.json`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing UI tests for git gating and unchanged local-folder behavior**

Cover:
- local-folder vaults still expose the same desktop git affordances they do today
- iCloud-backed non-git vaults do not expose git as required for support
- unavailable provider state disables/hides git actions before invocation
- automated desktop integration lane for unchanged local-folder open/browse/edit behavior in `src/App.test.tsx`
- unchanged local-folder create-note, property-edit, and view-loading behavior in `src/App.test.tsx`

- [ ] **Step 2: Write the failing attachment tests for provider-backed file previews**

Cover in `src/components/FilePreview.test.tsx`:
- normal attachment rendering when files are present
- missing/materializing-late attachments degrade only the attachment surface
- note-level UI remains usable when one attachment is unavailable

- [ ] **Step 3: Run the targeted UI tests to verify they fail**

Run: `pnpm vitest run src/components/StatusBar.test.tsx src/components/FilePreview.test.tsx src/App.test.tsx`
Expected: FAIL because provider-aware git gating, attachment degradation, and local-folder regression expectations are not implemented.

- [ ] **Step 4: Implement provider-aware git gating and attachment degradation behavior**

Keep this small:
- use existing `isGitVault` and status props where possible
- layer provider capability and availability rules on top
- do not redesign git controls
- keep attachment handling localized to `FilePreview.tsx` instead of spreading provider-specific logic across unrelated components

- [ ] **Step 5: Re-run the targeted UI tests**

Run: `pnpm vitest run src/components/StatusBar.test.tsx src/components/FilePreview.test.tsx src/App.test.tsx`
Expected: PASS for git gating, attachment degradation, and unchanged local-folder behavior.

- [ ] **Step 6: Update architecture docs after the code shape is final**

Document:
- provider boundary
- persisted provider metadata
- provider capability concepts and status semantics in `docs/ABSTRACTIONS.md`
- iCloud desktop support limits
- provider status / reconciliation assumptions

- [ ] **Step 7: Add or extend automated regression coverage in named test files**

Add or extend assertions in:
- `src/hooks/useVaultSwitcher.test.ts` for provider-backed vault open flow and migration of remembered vaults
- `src/components/StatusBar.test.tsx` and `src/App.test.tsx` for provider gating states and unchanged local-folder desktop workflow
- `src/components/FilePreview.test.tsx` for provider-backed attachment rendering and degradation behavior
- `src/hooks/useAppSave.test.ts` and `src/components/editor/StaleSaveDialog.test.tsx` for stale-save blocking and recovery presentation

- [ ] **Step 8: Run localization update for new UI copy**

Run: `pnpm l10n:translate`
Expected: locale catalogs update without breaking placeholders or Tolaria product naming.

- [ ] **Step 9: Run the targeted automated verification suite**

Run:
- `pnpm vitest run src/lib/vaultProviders.test.ts src/lib/vaultProviderRuntime.test.ts src/hooks/useVaultSwitcher.test.ts src/hooks/useAppSave.test.ts src/mock-tauri/mock-handlers.coverage.test.ts src/components/StatusBar.test.tsx src/components/FilePreview.test.tsx src/components/editor/StaleSaveDialog.test.tsx src/App.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 10: Add or update the Playwright smoke test for touched core flows**

Cover at minimum:
- vault open
- note save
- search
- wikilink navigation
- stale-save/conflict recovery if the harness can deterministically trigger it; otherwise treat stale-save as mandatory in the native/manual QA lane below, not optional coverage
- unchanged local-folder create-note and property-edit coverage if the existing smoke harness can support it without instability

- [ ] **Step 11: Run the Playwright smoke lane**

Run:
- `pnpm dev --port 5201`
- `BASE_URL="http://localhost:5201" npx playwright test tests/smoke/vault-providers-icloud-desktop.spec.ts`

Expected: PASS.

- [ ] **Step 12: Run native Tauri QA with screenshot verification**

Run:
- `pnpm tauri dev`
- `bash ~/.openclaw/skills/tolaria-qa/scripts/focus-app.sh Tolaria`
- `bash ~/.openclaw/skills/tolaria-qa/scripts/screenshot.sh /tmp/qa-vault-providers-icloud-desktop.png`

Verify natively:
- provider identity/status is visible
- missing-vault recovery actions are available when applicable
- stale-save recovery dialog appears when induced

- [ ] **Step 13: Run broader required checks for touched areas**

Run:
- `pnpm lint`
- `npx tsc --noEmit`
- `pnpm test`
- `pnpm test:coverage`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo llvm-cov --manifest-path src-tauri/Cargo.toml --no-clean --fail-under-lines 85`

Expected: PASS, or follow-up fixes before the final push.

- [ ] **Step 14: Manually verify the desktop Tolaria workflow on a real iCloud Drive vault**

Check at minimum:
- verify the explicit provider-selection-first onboarding path
- set up an iCloud-backed test vault by choosing a folder inside the detected iCloud Drive root through the provider-open flow
- verify the generic folder-first onboarding path with follow-up provider confirmation
- induce missing-provider-root by moving or temporarily renaming that folder outside the expected path before relaunch
- open remembered iCloud-backed vault
- relaunch and confirm provider identity persists
- browse sidebar and note list
- search notes
- open/edit/save note
- create note from current context
- edit properties/frontmatter-backed values
- verify H1/filename-aware rename-sensitive behavior
- navigate via wikilinks
- verify note-list sorting still works
- verify neighborhood exploration still works
- confirm views and filters still work
- confirm command-driven actions still work where they work today
- confirm normal attachment rendering when files are present
- induce stale-save by editing the same note externally between open and save
- change a note externally and confirm stale-save protection
- induce provider-unavailable state by removing access to the selected root or using the moved-folder case
- confirm missing/unavailable provider state is surfaced honestly
- induce attachment lag by referencing an attachment path that is not locally materialized yet in the test vault
- confirm attachment lag degrades only the attachment surface
- repeat the same core open/browse/edit flow on a plain local-folder vault to confirm no regression

Expected visible outcomes:
- provider identity persists across relaunch
- unavailable provider state is visibly unhealthy, not silently healthy
- stale-save blocking shows the recovery dialog
- local-folder workflow remains unchanged

- [ ] **Step 15: Commit**

```bash
git add src/components/StatusBar.tsx src/components/StatusBar.test.tsx src/components/status-bar/StatusBarSections.tsx src/components/FilePreview.tsx src/components/FilePreview.test.tsx src/App.test.tsx src/hooks/useVaultSwitcher.test.ts src/hooks/useAppSave.test.ts src/components/editor/StaleSaveDialog.test.tsx src/lib/locales/en.json src/lib/locales/*.json tests/smoke/vault-providers-icloud-desktop.spec.ts docs/ARCHITECTURE.md docs/ABSTRACTIONS.md
git commit -m "test: verify provider-backed desktop workflow"
```

- [ ] **Step 16: Push only after the repo's normal verified hooks pass**

Run: `git push origin main`
Expected: push succeeds with hooks, or surfaces any remaining issues to fix in follow-up commits.

## Notes for Execution

- Keep provider scope narrow. Do not turn providers into general file APIs.
- Preserve `local-folder` behavior first; every provider step should prove it did not regress the current desktop flow.
- Prefer adding small focused helpers over making `useVaultSwitcher.ts` even larger; if the file grows further, split provider-specific state/validation helpers into nearby modules.
- Do not start iPhone work in this plan.
- Do not generalize for Google Drive/Dropbox yet.
- If iCloud root discovery on macOS becomes messy, choose one concrete discovery path and document it in the code and docs rather than leaving multiple half-supported branches.
