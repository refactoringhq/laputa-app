#!/usr/bin/env bash
set -euo pipefail

start_time=$(date +%s)
log_dir="${TMPDIR:-/tmp}/tolaria-sidecar-gates-$$"
rust_changed="${RUST_CHANGED:-true}"
rust_phase="${SIDECAR_RUST_PHASE:-after-coverage}"
playwright_phase="${SIDECAR_PLAYWRIGHT_PHASE:-after}"
playwright_shards="${PLAYWRIGHT_SHARDS:-8}"

mkdir -p "$log_dir"

if [[ -z "${VITEST_COVERAGE_MAX_WORKERS:-}" ]]; then
  if [[ "$playwright_phase" == "early" ]]; then
    export VITEST_COVERAGE_MAX_WORKERS="${SIDECAR_EARLY_VITEST_MAX_WORKERS:-2}"
  else
    export VITEST_COVERAGE_MAX_WORKERS="${SIDECAR_VITEST_MAX_WORKERS:-3}"
  fi
fi

elapsed_seconds() {
  printf '%s' "$(($(date +%s) - start_time))"
}

log_gate() {
  printf '[sidecar-gates +%ss] %s\n' "$(elapsed_seconds)" "$*"
}

run_job() {
  local name="$1"
  shift
  local log_file="${log_dir}/${name}.log"

  (
    set +e
    log_gate "${name} started"
    "$@" 2>&1 | tee "$log_file"
    local status=${PIPESTATUS[0]}
    log_gate "${name} exited with status ${status}"
    exit "$status"
  ) &
  printf '%s:%s\n' "$name" "$!" >> "$jobs_file"
}

terminate_jobs() {
  local pids
  pids="$(jobs -pr || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 2
    kill -KILL $pids 2>/dev/null || true
  fi
}

jobs_file="${log_dir}/jobs"
: > "$jobs_file"
trap terminate_jobs INT TERM

wait_for_jobs() {
  local failures=0

  while IFS=: read -r name pid; do
    if wait "$pid"; then
      printf '[sidecar-gates] %s passed\n' "$name"
    else
      failures=1
      printf '[sidecar-gates] %s failed\n' "$name"
    fi
  done < "$jobs_file"

  return "$failures"
}

log_gate "rust phase=${rust_phase}; playwright phase=${playwright_phase}; shards=${playwright_shards}; concurrency=${PLAYWRIGHT_CONCURRENCY:-${playwright_shards}}; vitest workers=${VITEST_COVERAGE_MAX_WORKERS:-4}"

run_job frontend-lint pnpm lint
run_job frontend-build pnpm build
run_job frontend-coverage pnpm test:coverage --silent

if [[ "$rust_changed" == "true" && "$rust_phase" == "early" ]]; then
  run_job rust bash .chunk/run-rust-gate.sh
elif [[ "$rust_changed" != "true" ]]; then
  log_gate 'rust skipped because RUST_CHANGED=false'
fi

if [[ "$playwright_phase" == "early" ]]; then
  run_job playwright-smoke bash .chunk/run-playwright-shards.sh "$playwright_shards"
fi

if ! wait_for_jobs; then
  if [[ "$playwright_phase" == "early" ]]; then
    log_gate 'one or more sidecar gates failed'
  else
    log_gate 'stopping before Playwright because a prerequisite gate failed'
  fi
  exit 1
fi

if [[ "$playwright_phase" != "early" || ( "$rust_changed" == "true" && "$rust_phase" != "early" ) ]]; then
  : > "$jobs_file"
  if [[ "$rust_changed" == "true" && "$rust_phase" != "early" ]]; then
    run_job rust bash .chunk/run-rust-gate.sh
  fi
  if [[ "$playwright_phase" != "early" ]]; then
    run_job playwright-smoke bash .chunk/run-playwright-shards.sh "$playwright_shards"
  fi

  if ! wait_for_jobs; then
    exit 1
  fi
fi

log_gate "completed in $(elapsed_seconds)s"

exit 0
