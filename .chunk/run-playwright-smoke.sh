#!/usr/bin/env bash
set -euo pipefail

shard="${1:-}"
shard_label="all"
base_url="${BASE_URL:-}"
port="${PLAYWRIGHT_SMOKE_PORT:-41741}"

if [[ -n "$shard" ]]; then
  if [[ ! "$shard" =~ ^[1-9][0-9]*/[1-9][0-9]*$ ]]; then
    printf 'Usage: %s [shard/total]\n' "$0" >&2
    exit 2
  fi

  shard_index="${shard%%/*}"
  shard_label="${shard//\//-}"
  if [[ -z "$base_url" ]]; then
    port=$((41740 + shard_index))
  fi
fi

base_url="${base_url:-http://127.0.0.1:${port}}"
port="$(node -e 'console.log(new URL(process.argv[1]).port || "41741")' "$base_url")"

log_file="${TMPDIR:-/tmp}/tolaria-playwright-smoke-${shard_label}.log"
playwright_pid=""

cleanup() {
  local status=$?

  if [[ -n "$playwright_pid" ]]; then
    kill -TERM "$playwright_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$playwright_pid" 2>/dev/null || true
  fi

  if [[ "${PLAYWRIGHT_REUSE_SERVER:-}" != "1" ]]; then
    pkill -TERM -f "playwright-smoke-server.mjs ${port}" 2>/dev/null || true
    pkill -TERM -f "vite.js --host 127.0.0.1 --port ${port}" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup INT TERM

mapfile -t smoke_files < <(node <<'NODE'
const fs = require('node:fs')

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const script = packageJson.scripts && packageJson.scripts['playwright:smoke']
const prefix = 'playwright test --config playwright.smoke.config.ts '

if (!script || !script.startsWith(prefix)) {
  throw new Error('Unexpected playwright:smoke script format')
}

for (const file of script.slice(prefix.length).trim().split(/\s+/)) {
  if (file) {
    console.log(file)
  }
}
NODE
)

: > "$log_file"
playwright_args=(
  test
  --config playwright.smoke.config.ts
  "${smoke_files[@]}"
  --reporter=line
)

if [[ -n "$shard" ]]; then
  playwright_args+=(--shard "$shard")
fi

printf '[chunk-playwright] running %s curated smoke files on port %s' "${#smoke_files[@]}" "$port"
if [[ -n "$shard" ]]; then
  printf ' with shard %s' "$shard"
fi
printf '\n'

set +e
env CI=true BASE_URL="$base_url" PLAYWRIGHT_REUSE_SERVER="${PLAYWRIGHT_REUSE_SERVER:-}" pnpm exec playwright "${playwright_args[@]}" \
  > >(tee "$log_file") 2>&1 &
playwright_pid=$!
wait "$playwright_pid"
playwright_status=$?
playwright_pid=""
set -e

printf '[chunk-playwright] smoke %s exited with status %s\n' "$shard_label" "$playwright_status"
exit "$playwright_status"
