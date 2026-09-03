---
type: ADR
id: "0180"
title: "Shared cross-runtime word-count contract"
status: active
date: 2026-09-03
---

## Context

Vault indexing in Rust and live editor metadata in TypeScript both need the same body word count. The two runtimes previously carried parallel character-by-character multilingual algorithms and different Markdown preprocessing. Rust counted raw wikilink targets while TypeScript removed wikilinks and Markdown markers, so saved metadata and the visible inspector could disagree.

Calling Rust through IPC on each editor change would centralize execution, but it would add asynchronous request ordering to a latency-sensitive path. Compiling a dedicated WebAssembly module would add another build artifact and runtime boundary for a small text operation.

## Decision

**`src/shared/wordCountContract.json` is the canonical owner of word-count token patterns, Markdown exclusions, and cross-runtime fixtures. Rust and TypeScript compile those same patterns locally, and both fixture suites consume the same examples.**

Rust remains the authority for persisted `VaultEntry.wordCount` during vault parsing. While content is dirty, `useEditorSaveWithLinks` derives the provisional value in its existing deferred metadata pass. Clean editor chrome and the Inspector read `VaultEntry.wordCount`; they do not independently recount content.

## Options considered

- **Shared executable pattern contract with local adapters** (chosen): removes duplicate state machines and locks preprocessing parity with one fixture matrix without adding a runtime boundary.
- **Rust command for every live count**: one executable implementation, but introduces IPC volume, stale-response ordering, and browser-test fallback behavior.
- **Rust compiled to WebAssembly**: shares executable code, but adds packaging and initialization complexity larger than the deleted logic.
- **Independent implementations with copied tests**: simple locally, but preserves the original drift risk.

## Consequences

- Word tokenization and exclusions change in one shared contract and must pass in both runtimes.
- Rust and TypeScript retain small regex adapters because they execute in separate runtimes, but neither owns an independent multilingual state machine.
- Dirty word counts update on the existing deferred metadata schedule, keeping per-keystroke rendering free of recount work.
- Any future preprocessing or script coverage change must update the shared fixture matrix before either adapter.
- Re-evaluate if Tolaria introduces an existing shared Rust/Wasm text-processing runtime whose adoption removes more code than it adds.
