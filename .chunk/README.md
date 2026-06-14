# Chunk Sidecar Validation

This repo uses Chunk as an experimental inner-loop validation runner for the same gates enforced by the local git hooks.

## Setup

Install the CLI:

```bash
brew install CircleCI-Public/circleci/chunk
```

If Homebrew cannot install the formula, use the matching archive from the Chunk CLI GitHub releases and place the `chunk` binary on `PATH`.

Authenticate before remote sidecar runs:

```bash
chunk auth set circleci
```

`chunk validate` can run locally without CircleCI auth. Remote sidecars require `CIRCLECI_TOKEN` or stored CircleCI auth.

## Commands

```bash
chunk validate --list
chunk validate lint
chunk validate typecheck
chunk validate frontend-coverage
chunk validate --remote lint
bash .chunk/run-sidecar-gates-local.sh true
```

Use `chunk sidecar setup --name tolaria-hooks` for the first remote environment setup. Once the environment passes, create a snapshot and launch future sidecars from that snapshot to avoid reinstalling Node, Rust, Tauri Linux dependencies, Playwright Chromium, and `cargo-llvm-cov` every time.

Keep native macOS Tauri QA outside Chunk. The sidecar is Linux-based and is meant to catch portable lint, build, unit coverage, Rust, and Playwright smoke failures before the full local pre-push hook runs. Browser provisioning uses `.chunk/install-playwright-browsers.mjs` because Playwright's built-in installer can outlive the current Chunk SSH session while extracting large archives.

## Fast Pre-Push Path

The local pre-push hook prefers the sidecar fast path when Chunk is available. It targets three independent sidecars by name and always passes `--sidecar-id` after resolution, avoiding races with Chunk's global active-sidecar state:

- `tolaria-hooks-frontend-2`: lint and build first, then frontend coverage with `FRONTEND_COVERAGE_SHARDS=2` and `VITEST_COVERAGE_MAX_WORKERS=2`.
- `tolaria-hooks-rust`: clippy, rustfmt, and `cargo llvm-cov` with `CARGO_BUILD_JOBS=2`.
- `tolaria-hooks-playwright`: curated Playwright smoke with one shared Vite server, eight shards, and four concurrent shard workers.

Set `LAPUTA_PREPUSH_LOCAL=1` to force the old local path. Use `SIDECAR_FRONTEND_ID`, `SIDECAR_RUST_ID`, or `SIDECAR_PLAYWRIGHT_ID` to pin a lane to a specific sidecar when duplicate names exist in CircleCI. Use `SIDECAR_SNAPSHOT_ID=<snapshot-id>` when provisioning missing lane sidecars from a prepared snapshot.

The lane launcher uses `chunk sidecar exec` only to start detached remote lane processes with `setsid -f`, then polls status files. Long foreground `exec` commands hit CircleCI's sidecar API deadline; plain background jobs are still tracked by `exec` and can time out.

```bash
bash .chunk/run-sidecar-gates-local.sh true
```

Latest measured passing run with two frontend coverage shards: lane runtime 318s including sync, frontend completed in 313s, and Playwright smoke completed in 104s. The previous single-coverage frontend path took 441s with 457s external wall time, so the two-shard experiment reduced the sidecar long pole by about 29%. A previous Playwright run exposed `tests/smoke/h1-title-decoupled.spec.ts` as flaky on sidecar, so it remains in regression coverage but is no longer part of the curated smoke lane.

To compare the frontend coverage experiment against the old single coverage run, use:

```bash
FRONTEND_COVERAGE_SHARDS=1 bash .chunk/run-sidecar-gates-local.sh false
FRONTEND_COVERAGE_SHARDS=2 bash .chunk/run-sidecar-gates-local.sh false
```

The default sidecar fast path uses two frontend coverage shards. Each shard disables per-shard coverage thresholds, then the merged V8/Istanbul coverage map is checked once against the same 70% line/function/branch/statement thresholds.
