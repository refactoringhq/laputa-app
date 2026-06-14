#!/usr/bin/env bash
set -euo pipefail

total_shards="${1:-${PLAYWRIGHT_SHARDS:-8}}"
concurrency="${PLAYWRIGHT_CONCURRENCY:-$total_shards}"
log_dir="${TMPDIR:-/tmp}/tolaria-playwright-shards-$$"
batch_pids=()
shared_server="${PLAYWRIGHT_SHARED_SERVER:-1}"
server_port="${PLAYWRIGHT_SMOKE_PORT:-41741}"
base_url="${BASE_URL:-http://127.0.0.1:${server_port}}"
server_port="$(node -e 'console.log(new URL(process.argv[1]).port || "41741")' "$base_url")"
server_pid=""

if [[ ! "$total_shards" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Usage: %s [total-shards]\n' "$0" >&2
  exit 2
fi

if [[ ! "$concurrency" =~ ^[1-9][0-9]*$ ]]; then
  printf 'PLAYWRIGHT_CONCURRENCY must be a positive integer\n' >&2
  exit 2
fi

mkdir -p "$log_dir"

stop_shared_server() {
  if [[ -z "$server_pid" ]]; then
    return
  fi

  kill -TERM "$server_pid" 2>/dev/null || true
  sleep 2
  kill -KILL "$server_pid" 2>/dev/null || true
  server_pid=""
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  for pid in "${batch_pids[@]:-}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 2

  for pid in "${batch_pids[@]:-}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done

  stop_shared_server

  exit "$status"
}

trap cleanup EXIT INT TERM

wait_for_shared_server() {
  local deadline=$((SECONDS + 30))

  until curl -fsS "$base_url" >/dev/null 2>&1; do
    if [[ -n "$server_pid" ]] && ! kill -0 "$server_pid" 2>/dev/null; then
      printf '[chunk-playwright] shared server exited before becoming ready\n' >&2
      sed 's/^/[shared-server] /' "${log_dir}/shared-server.log" >&2 || true
      return 1
    fi

    if [[ "$SECONDS" -ge "$deadline" ]]; then
      printf '[chunk-playwright] shared server did not become ready at %s\n' "$base_url" >&2
      sed 's/^/[shared-server] /' "${log_dir}/shared-server.log" >&2 || true
      return 1
    fi

    sleep 1
  done
}

start_shared_server() {
  if [[ "$shared_server" != "1" ]]; then
    return
  fi

  printf '[chunk-playwright] starting shared server at %s\n' "$base_url"
  TOLARIA_VITE_CACHE_DIR="${TOLARIA_VITE_CACHE_DIR:-${TMPDIR:-/tmp}/tolaria-vite-smoke-shared}" \
    node scripts/playwright-smoke-server.mjs "$server_port" >"${log_dir}/shared-server.log" 2>&1 &
  server_pid="$!"
  wait_for_shared_server
}

run_batch() {
  local first_shard="$1"
  local failures=0
  local names=()
  local shard="$first_shard"

  batch_pids=()

  while [[ "$shard" -le "$total_shards" && "${#batch_pids[@]}" -lt "$concurrency" ]]; do
    local name="smoke-${shard}-${total_shards}"
    local log_file="${log_dir}/${name}.log"

    printf '[chunk-playwright] starting %s\n' "$name"
    if [[ "$shared_server" == "1" ]]; then
      BASE_URL="$base_url" PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_SMOKE_PORT="$server_port" \
        bash .chunk/run-playwright-smoke.sh "${shard}/${total_shards}" >"$log_file" 2>&1 &
    else
      bash .chunk/run-playwright-smoke.sh "${shard}/${total_shards}" >"$log_file" 2>&1 &
    fi
    batch_pids+=("$!")
    names+=("$name")
    shard=$((shard + 1))
  done

  for index in "${!batch_pids[@]}"; do
    local pid="${batch_pids[$index]}"
    local name="${names[$index]}"
    local log_file="${log_dir}/${name}.log"

    if wait "$pid"; then
      printf '[chunk-playwright] %s passed\n' "$name"
    else
      failures=1
      printf '[chunk-playwright] %s failed\n' "$name"
    fi

    sed "s/^/[${name}] /" "$log_file"
  done

  batch_pids=()
  return "$failures"
}

next_shard=1
failed=0

start_shared_server

while [[ "$next_shard" -le "$total_shards" ]]; do
  if ! run_batch "$next_shard"; then
    failed=1
  fi
  next_shard=$((next_shard + concurrency))
done

stop_shared_server
exit "$failed"
