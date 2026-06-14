#!/usr/bin/env bash
set -euo pipefail

lane="${1:-}"
start_time=$(date +%s)

elapsed_seconds() {
  printf '%s' "$(($(date +%s) - start_time))"
}

log_lane() {
  printf '[sidecar-%s +%ss] %s\n' "$lane" "$(elapsed_seconds)" "$*"
}

run_job() {
  local name="$1"
  shift
  local log_file="${log_dir}/${name}.log"

  (
    set +e
    log_lane "${name} started"
    "$@" 2>&1 | tee "$log_file"
    local status=${PIPESTATUS[0]}
    log_lane "${name} exited with status ${status}"
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

wait_for_jobs() {
  local failures=0

  while IFS=: read -r name pid; do
    if wait "$pid"; then
      printf '[sidecar-%s] %s passed\n' "$lane" "$name"
    else
      failures=1
      printf '[sidecar-%s] %s failed\n' "$lane" "$name"
    fi
  done < "$jobs_file"

  return "$failures"
}

run_frontend_coverage_job() {
  local shard_count="${FRONTEND_COVERAGE_SHARDS:-1}"

  if [[ ! "$shard_count" =~ ^[1-9][0-9]*$ ]]; then
    printf 'FRONTEND_COVERAGE_SHARDS must be a positive integer\n' >&2
    return 2
  fi

  if [[ "$shard_count" == "1" ]]; then
    run_job frontend-coverage pnpm test:coverage --silent
    return
  fi

  run_job frontend-coverage node scripts/run-vitest-coverage-shards.mjs --silent
}

run_frontend_lane() {
  log_dir="${TMPDIR:-/tmp}/tolaria-sidecar-frontend-$$"
  jobs_file="${log_dir}/jobs"
  mkdir -p "$log_dir"
  : > "$jobs_file"
  trap terminate_jobs INT TERM

  export VITEST_COVERAGE_MAX_WORKERS="${VITEST_COVERAGE_MAX_WORKERS:-2}"
  log_lane "vitest workers=${VITEST_COVERAGE_MAX_WORKERS}; coverage shards=${FRONTEND_COVERAGE_SHARDS:-1}"
  run_job frontend-lint pnpm lint
  run_job frontend-build pnpm build

  if ! wait_for_jobs; then
    return 1
  fi

  : > "$jobs_file"
  run_frontend_coverage_job
  wait_for_jobs
}

run_rust_lane() {
  if [[ "${RUST_CHANGED:-true}" != "true" ]]; then
    log_lane 'skipped because RUST_CHANGED=false'
    return 0
  fi

  bash .chunk/run-rust-gate.sh
}

run_playwright_lane() {
  export PLAYWRIGHT_SHARED_SERVER="${PLAYWRIGHT_SHARED_SERVER:-1}"
  export PLAYWRIGHT_CONCURRENCY="${PLAYWRIGHT_CONCURRENCY:-4}"
  local shards="${PLAYWRIGHT_SHARDS:-8}"

  log_lane "shards=${shards}; concurrency=${PLAYWRIGHT_CONCURRENCY}; shared server=${PLAYWRIGHT_SHARED_SERVER}"
  bash .chunk/run-playwright-shards.sh "$shards"
}

case "$lane" in
  frontend)
    run_frontend_lane
    ;;
  rust)
    run_rust_lane
    ;;
  playwright)
    run_playwright_lane
    ;;
  *)
    printf 'Usage: %s frontend|rust|playwright\n' "$0" >&2
    exit 2
    ;;
esac

log_lane "completed in $(elapsed_seconds)s"
