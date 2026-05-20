# Process & invariants

Workflow, naming, and verification rules that apply throughout the
ADR-0115 migration.

## Crate naming

No prefixes (Zed style).  `workspace`, `actions`, `vault` — not
`tolaria_workspace`.  Deviates from ADR-0115 §1 but matches the
reference codebase.

## Branch policy

ADR-0021 push-to-`main`.  All intermediates land on
`feat/native-gpui-chrome` and are dogfood-only.  The Tauri stack
under `src-tauri/` stays untouched throughout every chrome /
service / harness phase.

## Per-iteration verification loop

After **every iteration** of Rust source changes (per crate or per
logical sub-task within a phase), in this order:

1. `cargo fmt -p <crate>` (or `--all` if multi-crate).
2. `cargo test -p <crate>` — confirm green.
3. **Spawn `code-reviewer agent` with the
   `idiomatic-rust-review` skill** against the changed files.
   **Auto-apply every MUST and SHOULD finding** without prompting
   the user (MAY findings get surfaced separately for the user to
   decide).
4. Re-run `cargo fmt` + `cargo test` after applying review findings.
5. Commit.

## Phase-boundary sweep

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p tolaria --release
```

Parallel sanity (Tauri stack stays alive throughout every chrome /
service / harness phase):

```sh
pnpm tauri dev                                        # legacy app still runs
pnpm test                                             # editor-body Playwright suite
```

## Hard rules

- Each chrome crate is **self-contained**; no cross-panel deps.
  Plumbing through `TolariaWorkspace` events lands in later phases.
- Every crate's tests use the `install_theme(cx)` helper pattern
  from `crates/embed_poc/src/layout.rs:243`.
- Mock services are accessed via the `Global` accessor pattern;
  never hold mock data inline in panel state.
- `cargo fmt` + per-crate test green + workspace clippy
  `-D warnings` before any commit.
- `cargo build --workspace` clean per crate landing (no cascade
  breakage on `tolaria`, `embed_poc`, or sibling chrome crates).
- Mock methods return `Task<T>` (via `Task::ready` for instant) so
  the shape stays forward-compatible with the real service swap.

## Visual fidelity rule

Every chrome surface, in every phase, targets **minimum visible
delta** against
[`tolaria-demo-vault-v2-light.png`](tolaria-demo-vault-v2-light.png)
and
[`tolaria-demo-vault-v2-dark.png`](tolaria-demo-vault-v2-dark.png),
in both themes.  When implementation shortcuts the visual
(placeholder styling, missing icons, wrong weights), it carries a
`TODO(visual-parity)` comment so a periscope diff pass can find it
later.

[`components.md`](components.md) holds the per-component visual
contract; [`e2e-harness.md`](e2e-harness.md) is the verification
loop.

## Manual regression sweep process

1. The user names the worklist document where regression issues are tracked.
2. The worklist has three sections — Blockers / High Priority / Low Priority —
   each with hierarchical numbering: `1.1.`, `1.2.`, `2.1.`, etc.

   ```markdown
   ## 1. Blockers
   1.1. <issue description>
   1.2. <issue description>

   ## 2. High Priority
   2.1. <issue description>

   ## 3. Low Priority
   3.1. <issue description>
   ---
   ```

3. Mark the item as in progress with ⏳ e.g. `1.1. ⏳ <issue description>`.
   IMPORTANT! be aware that multiple subagents might be working on the same area. Instruct 
   subagents to quickly bail out and report back the names of files that are changing
   unexpectedly.
4. The only edit you may make to an existing item is to add ✅ after its number,
   e.g. `1.1. ✅ <issue description>`, to mark it resolved.
5. Never change issue numbers. They are stable references the user cites.
6. When the user reports a regression — phrased as `[<issue number>] [optional note]`,
   e.g. `[1.2] still broken in dark mode` — locate that item and remove its ✅.
6. The user may ask you to add new items, phrased as `[<severity>] <description>`,
   e.g. `[high] menu is broken`. Append the item to the matching section with the
   next available `<section>.<n>` number; drop the bracketed severity (the section
   already encodes it); be very brief in item description; explanations must go to notes under `---`.
7. The area after `---` is for your per-sweep observations (environment notes,
   reproduction blockers, follow-up suggestions). Do not annotate individual
   issue lines — keep those clean.
