# Architecture Decision Records

This folder contains Architecture Decision Records (ADRs) for the Laputa app.

## Format

Each ADR is a markdown note with YAML frontmatter. Template:

```markdown
---
type: ADR
id: "0001"
title: "Short decision title"
status: proposed        # proposed | active | superseded | retired
date: YYYY-MM-DD
superseded_by: "0007"  # only if status: superseded
---

## Context
What situation led to this decision? What forces and constraints are at play?

## Decision
**What was decided.** State it clearly in one or two sentences — bold so it stands out.

## Options considered
- **Option A** (chosen): brief description — pros / cons
- **Option B**: brief description — pros / cons
- **Option C**: brief description — pros / cons

## Consequences
What becomes easier or harder as a result?
What are the positive and negative ramifications?
What would trigger re-evaluation of this decision?

## Advice
*(optional)* Input received before making this decision — who was consulted, what they said, when.
Omit if the decision was made unilaterally with no external input.
```

### Status lifecycle

```
proposed → active → superseded
                 ↘ retired      (decision no longer relevant, not replaced)
```

## Rules

- One decision per file
- Files named `NNNN-short-title.md` (monotonic numbering)
- Once `active`, never edit — supersede instead
- When superseded: update `status: superseded` and add `superseded_by: "NNNN"`
- ARCHITECTURE.md reflects the current state (active decisions only)

## Index

| ID | Title | Status |
|----|-------|--------|
| [0001](0001-tauri-react-stack.md) | Tauri v2 + React as application stack | active |
| [0002](0002-filesystem-source-of-truth.md) | Filesystem as the single source of truth | active |
| [0003](0003-single-note-model.md) | Single note open at a time (no tabs) | active |
| [0004](0004-vault-vs-app-settings-storage.md) | Vault vs app settings for state storage | active |
| [0005](0005-tauri-ios-for-ipad.md) | Tauri v2 iOS for iPad support (vs SwiftUI rewrite) | active |
| [0006](0006-flat-vault-structure.md) | Flat vault structure (no type-based folders) | active |
| [0007](0007-title-filename-sync.md) | Title equals filename (slug sync) | active |
| [0008](0008-underscore-system-properties.md) | Underscore convention for system properties | active |
| [0009](0009-keyword-only-search.md) | Keyword-only search (remove semantic indexing) | active |
| [0010](0010-dynamic-wikilink-relationship-detection.md) | Dynamic wikilink relationship detection | active |
| [0011](0011-mcp-server-for-ai-integration.md) | MCP server for AI tool integration | superseded → [0074](0074-explicit-external-ai-tool-setup-and-least-privilege-desktop-scope.md) |
| [0012](0012-claude-cli-for-ai-agent.md) | Claude CLI subprocess for AI agent | active |
| [0013](0013-remove-theming-system.md) | Remove vault-based theming system | superseded -> [0081](0081-internal-light-dark-theme-runtime.md) |
| [0014](0014-git-based-vault-cache.md) | Git-based incremental vault cache | active |
| [0015](0015-auto-save-with-debounce.md) | Auto-save with 500ms debounce | active |
| [0016](0016-sentry-posthog-telemetry.md) | Sentry + PostHog telemetry with consent | active |
| [0017](canary-release-channel-and-local-feature-flags.md) | Canary release channel and feature flags | superseded → [0057](0057-alpha-stable-release-channels-and-beta-cohorts.md) |
| [0018](0018-codescene-code-health-gates.md) | CodeScene code health gates in CI | superseded → [0064](0064-ratcheted-codescene-thresholds.md) |
| [0019](0019-github-device-flow-oauth.md) | GitHub device flow OAuth for vault sync | superseded → [0056](0056-system-git-cli-auth-no-provider-oauth.md) |
| [0020](0020-keyboard-first-design.md) | Keyboard-first design principle | active |
| [0021](0021-push-to-main-workflow.md) | Push directly to main (no PRs) | active |
| [0022](0022-blocknote-rich-text-editor.md) | BlockNote as the rich text editor | active |
| [0023](0023-repair-vault-auto-bootstrap.md) | Repair Vault auto-bootstrap pattern | active |
| [0024](0024-cache-outside-vault.md) | Vault cache stored outside vault directory | active |
| [0025](0025-type-field-canonical.md) | type: as canonical field (replacing Is A:) | active |
| [0026](0026-props-down-no-global-state.md) | Props-down callbacks-up (no global state) | active |
| [0027](0027-dual-ai-architecture.md) | Dual AI architecture (API chat + CLI agent) | superseded |
| [0028](0028-cli-agent-only-no-api-key.md) | CLI agent only — no direct Anthropic API key | active |
| [0029](0029-domain-command-builder-pattern.md) | Domain command builder pattern for useCommandRegistry | active |
| [0030](0030-rust-commands-module-split.md) | Rust commands/ module split by domain | active |
| [0031](0031-full-app-for-note-windows.md) | Full App instance for secondary note windows | active |
| [0032](0032-status-bar-for-git-actions.md) | Git actions (Changes, Pulse, Commit) in status bar, not sidebar | active |
| [0033](0033-subfolder-scanning-and-folder-tree.md) | Subfolder scanning and folder tree navigation | active |
| [0034](0034-git-repo-required-for-vault.md) | Git repo required — blocking modal enforces vault prerequisite | superseded → [0085](0085-non-git-vault-support.md) |
| [0035](0035-path-suffix-wikilink-resolution.md) | Path-suffix wikilink resolution for subfolder vaults | active |
| [0036](0036-external-rename-detection-via-git-diff.md) | External rename detection via git diff on focus regain | active |
| [0037](0037-codemirror-language-markdown-highlighting.md) | Language-based markdown syntax highlighting in raw editor | active |
| [0038](0038-frontmatter-backed-favorites.md) | Frontmatter-backed favorites (_favorite, _favorite_index) | active |
| [0039](0039-git-history-for-note-dates.md) | Git history as source of truth for note creation/modification dates | active |
| [0040](0040-custom-views-yml-filter-engine.md) | Custom Views — .laputa/views/*.yml with YAML filter engine | active |
| [0041](0041-filekind-all-files-in-vault-scanner.md) | fileKind field — scan all vault files, not just markdown | active |
| [0042](0042-trash-auto-purge-safety-model.md) | Trash auto-purge safety model | superseded → [0045](0045-permanent-delete-no-trash.md) |
| [0043](0043-reactive-vault-state-on-save.md) | Reactive vault state: editor changes propagate immediately to all UI | active |
| [0044](0044-h1-as-title-primary-source.md) | H1 as primary title source — filename as stable identifier | superseded → [0055](0055-h1-is-the-only-editor-title-surface.md) |
| [0045](0045-permanent-delete-no-trash.md) | Permanent delete with confirm modal — no Trash system | active |
| [0046](0046-starter-vault-cloned-from-github.md) | Starter vault cloned from GitHub at runtime — no bundled content | active |
| [0047](0047-regex-mode-for-view-filter-conditions.md) | Regex mode for view filter conditions | active |
| [0048](0048-relative-date-expressions-in-view-filters.md) | Relative date expressions in view filter conditions | active |
| [0049](0049-per-note-icon-property.md) | Per-note icon property (_icon on individual notes) | active |
| [0050](0050-deterministic-shortcut-command-routing.md) | Deterministic shortcut command routing | superseded → [0051](0051-shared-shortcut-manifest-for-testable-routing.md) |
| [0051](0051-shared-shortcut-manifest-for-testable-routing.md) | Shared shortcut manifest for testable routing | superseded → [0052](0052-renderer-first-shortcut-execution-with-native-menu-dedupe.md) |
| [0052](0052-renderer-first-shortcut-execution-with-native-menu-dedupe.md) | Renderer-first shortcut execution with native-menu dedupe | active |
| [0053](0053-webview-init-prevention-for-browser-reserved-shortcuts.md) | Webview-init prevention for browser-reserved shortcuts | active |
| [0054](0054-deterministic-shortcut-qa-matrix.md) | Deterministic shortcut QA matrix | active |
| [0055](0055-h1-is-the-only-editor-title-surface.md) | H1 is the only editor title surface | superseded → [0068](0068-h1-only-title-surface-with-optional-untitled-auto-rename.md) |
| [0056](0056-system-git-cli-auth-no-provider-oauth.md) | System git auth only — no provider-specific OAuth or repo APIs | active |
| [0057](0057-alpha-stable-release-channels-and-beta-cohorts.md) | Alpha/stable release channels with PostHog beta cohorts | superseded → [0066](0066-calendar-semver-versioning-for-alpha-and-stable-releases.md) |
| [0058](0058-claude-code-first-launch-onboarding-gate.md) | Claude Code first-launch onboarding gate | superseded → [0062](0062-selectable-cli-ai-agents.md) |
| [0059](0059-local-only-git-commits-without-remote.md) | Local-only git commits for vaults without a remote | active |
| [0060](0060-network-aware-ui-gating-for-remote-features.md) | Network-aware UI gating for remote-dependent features | active |
| [0061](0061-ai-prompt-bridge-event-bus.md) | AI prompt bridge — module-level event bus for cross-component prompt routing | active |
| [0062](0062-selectable-cli-ai-agents.md) | Selectable CLI AI agents with a shared panel architecture | active |
| [0063](0063-blocknote-code-block-package-for-editor-highlighting.md) | BlockNote code-block package for editor syntax highlighting | active |
| [0064](0064-ratcheted-codescene-thresholds.md) | Ratcheted CodeScene thresholds as the quality gate baseline | active |
| [0065](0065-root-managed-ai-guidance-files.md) | Root-managed AI guidance files with Claude shim | active |
| [0066](0066-calendar-semver-versioning-for-alpha-and-stable-releases.md) | Calendar-semver versioning for alpha and stable releases | active |
| [0067](0067-autogit-idle-and-inactive-checkpoints.md) | AutoGit idle and inactive checkpoints | active |
| [0068](0068-h1-only-title-surface-with-optional-untitled-auto-rename.md) | H1-only title surface with optional untitled auto-rename | active |
| [0069](0069-neighborhood-mode-for-note-list-relationship-browsing.md) | Neighborhood mode for note-list relationship browsing | active |
| [0070](0070-starter-vaults-local-first-with-explicit-remote-connection.md) | Starter vaults are local-first with explicit remote connection | active |
| [0071](0071-external-vault-refresh-and-clean-tab-reopen.md) | External vault updates reload derived state and reopen the clean active note | active |
| [0072](0072-confirmed-vault-paths-gate-startup-state.md) | Confirmed vault paths gate startup state | active |
| [0073](0073-persistent-linkify-protocol-registry-across-editor-remounts.md) | Persistent linkify protocol registry across editor remounts | active |
| [0074](0074-explicit-external-ai-tool-setup-and-least-privilege-desktop-scope.md) | Explicit external AI tool setup and least-privilege desktop scope | active |
| [0075](0075-crash-safe-note-rename-transactions.md) | Crash-safe note rename transactions | active |
| [0076](0076-note-retargeting-separates-type-and-folder-moves.md) | Note retargeting separates type changes from folder moves | active |
| [0077](0077-concurrent-safe-vault-cache-replacement.md) | Concurrent-safe vault cache replacement | active |
| [0078](0078-scoped-unsigned-fallback-for-app-managed-git-commits.md) | Scoped unsigned fallback for app-managed git commits | active |
| [0079](0079-linux-window-chrome-and-menu-reuse.md) | Linux window chrome and menu reuse | active |
| [0080](0080-cross-platform-desktop-release-artifacts-and-portable-vault-names.md) | Cross-platform desktop release artifacts and portable vault names | superseded → [0083](0083-dual-architecture-macos-release-artifacts.md) |
| [0081](0081-internal-light-dark-theme-runtime.md) | Internal light and dark theme runtime | active |
| [0082](0082-markdown-durable-math-notes.md) | Markdown-durable math in notes | active |
| [0083](0083-dual-architecture-macos-release-artifacts.md) | Dual-architecture macOS release artifacts | active |
| [0085](0085-non-git-vault-support.md) | Non-git vaults open with explicit later Git initialization | active |
| [0088](0088-markdown-durable-mermaid-diagrams.md) | Markdown-durable Mermaid diagrams in notes | active |
| [0089](0089-active-vault-filesystem-watcher.md) | Active vault filesystem watcher | active |
| [0090](0090-pi-cli-agent-adapter.md) | Pi CLI agent adapter | active |
| [0091](0091-gemini-cli-external-ai-setup.md) | Gemini CLI external AI setup | active |
| [0092](0092-vault-ai-agent-permission-modes.md) | Vault-scoped AI agent permission modes | active |
| [0093](0093-shared-cli-agent-runtime-adapters.md) | Shared CLI agent runtime adapters | active |
| [0094](0094-gitignored-content-visibility-boundary-filter.md) | Gitignored content visibility as a command-boundary filter | active |
| [0095](0095-saved-view-order-field.md) | Saved views use an explicit YAML order field | active |
| [0097](0097-gemini-cli-agent-adapter.md) | Gemini CLI agent adapter | active |
