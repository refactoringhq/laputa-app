# Performance Regression Harness

Tolaria's core performance gate measures milestones a user can perceive in an isolated
Chromium session. It uses deterministic in-memory vault fixtures, one discarded warmup,
five measured samples, median budgets, and p90 diagnostics. The gate never reads or
modifies a real vault.

## Instrumentation audit

| Flow | Existing signal | Automated guard |
|---|---|---|
| Renderer startup | `startupPerformance` phases plus native `record_startup_milestone` traces | User Timing marks for React shell, active-vault usability, and app interactivity |
| Note open | `noteOpen` and editor block resolve/apply traces | Small and 130 KB note scenarios measure visible editor, first/full content, edit frame, and trace durations |
| Note-list navigation | DEV-only keyboard-move trace | A 2,000-row Virtuoso fixture scrolls near the end and waits through the rendered paint |
| Native process startup | `TOLARIA_STARTUP_TRACE=1` native trace | Release/native diagnostic tier; excluded from the per-commit browser gate because host startup varies materially |
| Create-note focus and search | Local timing helpers and focused behavioral tests | Not yet budgeted: their mock/native boundaries dominate browser timing, so a threshold would currently protect test plumbing rather than user latency |

The benchmark opts existing DEV-only note/editor trace logging into the production build
only for pages that set `__TOLARIA_PERFORMANCE_HARNESS__`. Ordinary production sessions
do not emit these logs.

## Commands

```bash
pnpm perf:test
pnpm perf
pnpm perf:editor
pnpm perf:update
```

`pnpm perf` builds the production renderer, starts an isolated preview server, and runs
all scenarios. `pnpm perf:editor` is the faster compatibility subset for small and large
note opens. A machine-readable report is written to
`test-results/performance-summary.json`.

CircleCI runs `pnpm perf:ci` in the dedicated `performance-regression` job. Keeping this
separate from the curated Playwright smoke lane prevents a noisy performance rerun from
blocking functional smoke sharding or consuming its five-minute budget.

## Budgets and baseline changes

`.editor-performance-thresholds.json` stores the observed median, p90 diagnostic, and
maximum median for every metric. Normal runs fail closed if a scenario, budget, or
measurement is missing. A budget is initially the slower of 35% or 25 ms above the
median; edit-frame budgets keep a 16 ms floor. This tolerance absorbs ordinary scheduler
and renderer jitter while still catching regressions large enough to affect interaction.

`pnpm perf:update` records a new baseline but only tightens existing maxima. Do not run it
to make an unexplained failure pass. A reviewer may explicitly change a maximum only
when the measured milestone or representative fixture intentionally changes; document
that semantic rebaseline in the commit.

Review p90 alongside the median. Repeated p90 growth without a median failure is a signal
to investigate variance and tighten the scenario before raising or adding a budget.

## Adding a scenario

1. Add deterministic fixture generation and a scripted user interaction to
   `scripts/editor-performance-benchmark.mjs`.
2. Measure the first point where the result is visible or interactive, not merely when
   an internal function returns.
3. Add the scenario's metric names and concise labels.
4. Cover new aggregation, planning, or threshold behavior in
   `scripts/editor-performance-harness.test.mjs`.
5. Run at least one warmup and five measured samples, then intentionally add the initial
   threshold with `pnpm perf:update`.
6. Verify the normal `pnpm perf` command passes without changing the threshold file.
