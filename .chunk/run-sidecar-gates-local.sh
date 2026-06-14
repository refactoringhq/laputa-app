#!/usr/bin/env bash
set -euo pipefail

readonly unavailable_status=86

rust_changed="${1:-true}"
playwright_shards="${PLAYWRIGHT_SHARDS:-8}"
playwright_concurrency="${PLAYWRIGHT_CONCURRENCY:-4}"
playwright_shared_server="${PLAYWRIGHT_SHARED_SERVER:-1}"
vitest_coverage_max_workers="${VITEST_COVERAGE_MAX_WORKERS:-${SIDECAR_VITEST_MAX_WORKERS:-2}}"
frontend_coverage_shards="${FRONTEND_COVERAGE_SHARDS:-${SIDECAR_FRONTEND_COVERAGE_SHARDS:-2}}"
cargo_build_jobs="${CARGO_BUILD_JOBS:-2}"
timeout_seconds="${SIDECAR_GATE_TIMEOUT:-1800}"
poll_interval="${SIDECAR_GATE_POLL_INTERVAL:-20}"
launch_timeout="${SIDECAR_GATE_LAUNCH_TIMEOUT:-45}"
launch_attempts="${SIDECAR_GATE_LAUNCH_ATTEMPTS:-3}"
remote_workdir="${SIDECAR_REMOTE_WORKDIR:-/home/user/tolaria}"
sidecar_prefix="${SIDECAR_NAME_PREFIX:-tolaria-hooks}"
frontend_name="${SIDECAR_FRONTEND_NAME:-${sidecar_prefix}-frontend-2}"
rust_name="${SIDECAR_RUST_NAME:-${sidecar_prefix}-rust}"
playwright_name="${SIDECAR_PLAYWRIGHT_NAME:-${sidecar_prefix}-playwright}"
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/tolaria-sidecar-lanes.XXXXXX")"
lanes_file="${state_dir}/lanes.tsv"

: > "$lanes_file"

cleanup_state() {
  rm -rf "$state_dir"
}

trap cleanup_state EXIT

resolve_chunk_bin() {
  if [[ -n "${CHUNK_BIN:-}" && -x "$CHUNK_BIN" ]]; then
    return 0
  fi

  if command -v chunk >/dev/null 2>&1; then
    CHUNK_BIN="$(command -v chunk)"
    return 0
  fi

  if [[ -x "$HOME/.local/bin/chunk" ]]; then
    CHUNK_BIN="$HOME/.local/bin/chunk"
    return 0
  fi

  return 1
}

load_org_id() {
  if [[ -n "${CIRCLECI_ORG_ID:-}" ]]; then
    printf '%s\n' "$CIRCLECI_ORG_ID"
    return
  fi

  node -e "const fs=require('node:fs'); const c=JSON.parse(fs.readFileSync('.chunk/config.json','utf8')); if (c.orgID) process.stdout.write(c.orgID)"
}

sidecar_id_by_name() {
  local name="$1"

  "$CHUNK_BIN" sidecar list 2>/dev/null | awk -v name="$name" '$1 == name { print $2; found=1; exit } END { exit found ? 0 : 1 }'
}

create_sidecar_from_snapshot() {
  local name="$1"

  if [[ -z "${SIDECAR_SNAPSHOT_ID:-}" ]]; then
    return 1
  fi

  echo "  -> Creating ${name} from snapshot ${SIDECAR_SNAPSHOT_ID}" >&2
  "$CHUNK_BIN" sidecar create --name "$name" --org-id "$org_id" --image "$SIDECAR_SNAPSHOT_ID" >/dev/null
}

ensure_sidecar() {
  local name="$1"
  local explicit_id="${2:-}"
  local id

  if [[ -n "$explicit_id" ]]; then
    printf '%s\n' "$explicit_id"
    return 0
  fi

  if id="$(sidecar_id_by_name "$name")"; then
    printf '%s\n' "$id"
    return 0
  fi

  echo "  -> Sidecar ${name} not found; provisioning it..." >&2
  if ! create_sidecar_from_snapshot "$name"; then
    "$CHUNK_BIN" sidecar setup --name "$name" --org-id "$org_id" >/dev/null
  fi

  sidecar_id_by_name "$name"
}

sync_lane() {
  local lane="$1"
  local sidecar_id="$2"
  local log_file="${state_dir}/sync-${lane}.log"

  {
    echo "[sidecar-sync] ${lane}: syncing to ${sidecar_id}"
    if "$CHUNK_BIN" sidecar sync --sidecar-id "$sidecar_id" --workdir "$remote_workdir"; then
      exit 0
    fi

    echo "[sidecar-sync] ${lane}: sync failed, rerunning setup once"
    "$CHUNK_BIN" sidecar setup --sidecar-id "$sidecar_id" --dir .
    "$CHUNK_BIN" sidecar sync --sidecar-id "$sidecar_id" --workdir "$remote_workdir"
  } >"$log_file" 2>&1
}

sync_all_lanes() {
  local failures=0
  local frontend_pid rust_pid playwright_pid

  sync_lane frontend "$frontend_id" &
  frontend_pid=$!
  sync_lane rust "$rust_id" &
  rust_pid=$!
  sync_lane playwright "$playwright_id" &
  playwright_pid=$!

  for lane_pid in "$frontend_pid" "$rust_pid" "$playwright_pid"; do
    if ! wait "$lane_pid"; then
      failures=1
    fi
  done

  if [[ "$failures" != "0" ]]; then
    echo "Chunk sidecar sync failed"
    sed 's/^/  /' "${state_dir}"/sync-*.log 2>/dev/null || true
    return 1
  fi
}

record_lane() {
  local lane="$1"
  local sidecar_id="$2"
  local status_file="$3"
  local log_file="$4"
  local pid_file="$5"

  printf '%s\t%s\t%s\t%s\t%s\n' "$lane" "$sidecar_id" "$status_file" "$log_file" "$pid_file" >> "$lanes_file"
}

launch_lane() {
  local lane="$1"
  local sidecar_id="$2"
  local run_id="tolaria-${lane}-$(date +%s)-$$"
  local remote_status="/tmp/${run_id}.status"
  local remote_log="/tmp/${run_id}.log"
  local remote_pid="/tmp/${run_id}.pid"
  local remote_launcher="/tmp/${run_id}.launcher.log"
  local launch_output_file="${state_dir}/launch-${lane}.log"
  local launch_attempt=1

  while [[ "$launch_attempt" -le "$launch_attempts" ]]; do
    local launch_status=0
    local launch_pid
    local launch_elapsed=0

    echo "  -> Launching ${lane} on ${sidecar_id} (attempt ${launch_attempt}/${launch_attempts})"
    "$CHUNK_BIN" sidecar exec \
      --sidecar-id "$sidecar_id" \
      --command bash \
      --args -lc \
      --args "cd '$remote_workdir' && export RUST_CHANGED='$rust_changed' PLAYWRIGHT_SHARDS='$playwright_shards' PLAYWRIGHT_CONCURRENCY='$playwright_concurrency' PLAYWRIGHT_SHARED_SERVER='$playwright_shared_server' VITEST_COVERAGE_MAX_WORKERS='$vitest_coverage_max_workers' FRONTEND_COVERAGE_SHARDS='$frontend_coverage_shards' CARGO_BUILD_JOBS='$cargo_build_jobs' && rm -f '$remote_status' '$remote_log' '$remote_pid' '$remote_launcher' && nohup setsid -f bash -lc 'bash .chunk/run-sidecar-lane.sh $lane >\"$remote_log\" 2>&1; printf \"%s\\n\" \"\$?\" >\"$remote_status\"' </dev/null >'$remote_launcher' 2>&1" \
      >"$launch_output_file" 2>&1 &
    launch_pid=$!

    while kill -0 "$launch_pid" 2>/dev/null; do
      if [[ "$launch_elapsed" -ge "$launch_timeout" ]]; then
        launch_status=124
        kill "$launch_pid" 2>/dev/null || true
        sleep 1
        kill -KILL "$launch_pid" 2>/dev/null || true
        wait "$launch_pid" 2>/dev/null || true
        break
      fi
      sleep 1
      launch_elapsed=$((launch_elapsed + 1))
    done

    if [[ "$launch_status" == "0" ]]; then
      wait "$launch_pid" || launch_status=$?
    fi

    if [[ "$launch_status" == "0" ]]; then
      record_lane "$lane" "$sidecar_id" "$remote_status" "$remote_log" "$remote_pid"
      return 0
    fi

    cat "$launch_output_file"
    if launch_state="$(poll_lane_status "$sidecar_id" "$remote_status" "$remote_log" "$remote_pid" 2>/dev/null)"; then
      launch_state="$(printf '%s\n' "$launch_state" | tail -1 | tr -d '[:space:]')"
      if [[ "$launch_state" == "running" || "$launch_state" == "0" || "$launch_state" =~ ^[1-9][0-9]*$ ]]; then
        echo "  -> ${lane} appears to have started despite launch status ${launch_status}"
        record_lane "$lane" "$sidecar_id" "$remote_status" "$remote_log" "$remote_pid"
        return 0
      fi
    fi
    echo "Chunk sidecar launch failed for ${lane} with status ${launch_status}"
    if [[ "$launch_attempt" -lt "$launch_attempts" ]]; then
      sleep 5
    fi
    launch_attempt=$((launch_attempt + 1))
  done

  return 1
}

fetch_remote_log_tail() {
  local lane="$1"
  local sidecar_id="$2"
  local log_file="$3"

  echo ""
  echo "----- ${lane} log tail -----"
  "$CHUNK_BIN" sidecar exec \
    --sidecar-id "$sidecar_id" \
    --command bash \
    --args -lc \
    --args "tail -180 '$log_file' 2>/dev/null || true" 2>&1 || true
}

stop_lane() {
  local sidecar_id="$1"
  local pid_file="$2"
  local log_file="$3"

  "$CHUNK_BIN" sidecar exec \
    --sidecar-id "$sidecar_id" \
    --command bash \
    --args -lc \
    --args "if [ -s '$pid_file' ]; then pid=\$(cat '$pid_file'); kill -TERM -\"\$pid\" 2>/dev/null || kill -TERM \"\$pid\" 2>/dev/null || true; sleep 3; kill -KILL -\"\$pid\" 2>/dev/null || kill -KILL \"\$pid\" 2>/dev/null || true; fi; ps -eo pid=,command= | awk -v target='$log_file' '\$0 ~ target && \$0 !~ /awk/ { print \$1 }' | xargs -r kill -TERM 2>/dev/null || true" \
    >/dev/null 2>&1 || true
}

stop_all_lanes() {
  while IFS=$'\t' read -r _lane sidecar_id _status_file log_file pid_file; do
    stop_lane "$sidecar_id" "$pid_file" "$log_file"
  done < "$lanes_file"
}

poll_lane_status() {
  local sidecar_id="$1"
  local status_file="$2"
  local log_file="$3"
  local pid_file="$4"

  "$CHUNK_BIN" sidecar exec \
    --sidecar-id "$sidecar_id" \
    --command bash \
    --args -lc \
    --args "if [ -f '$status_file' ]; then cat '$status_file'; elif test -s '$pid_file' && kill -0 \"\$(cat '$pid_file')\" 2>/dev/null; then echo running; elif ps -eo pid=,command= | awk -v target='$log_file' '\$0 ~ target && \$0 !~ /awk/ { found=1 } END { exit found ? 0 : 1 }'; then echo running; else echo missing; fi" 2>&1
}

poll_lanes() {
  local started_at="$1"
  local last_heartbeat=0
  local completed_file="${state_dir}/completed"
  local failed=0

  : > "$completed_file"

  while true; do
    local all_done=1

    while IFS=$'\t' read -r lane sidecar_id status_file log_file pid_file; do
      if grep -qx "$lane" "$completed_file"; then
        continue
      fi

      local poll_status=0
      local poll_output
      local status

      poll_output="$(poll_lane_status "$sidecar_id" "$status_file" "$log_file" "$pid_file")" || poll_status=$?
      if [[ "$poll_status" != "0" ]]; then
        echo "  -> ${lane} status poll failed: $(printf '%s\n' "$poll_output" | head -1)"
        all_done=0
        continue
      fi

      status="$(printf '%s\n' "$poll_output" | tail -1 | tr -d '[:space:]')"
      case "$status" in
        0)
          echo "$lane" >> "$completed_file"
          echo "  -> ${lane} passed"
          fetch_remote_log_tail "$lane" "$sidecar_id" "$log_file"
          ;;
        running|"")
          all_done=0
          ;;
        missing)
          echo "  -> ${lane} stopped before writing a status file"
          fetch_remote_log_tail "$lane" "$sidecar_id" "$log_file"
          failed=1
          echo "$lane" >> "$completed_file"
          ;;
        *)
          echo "  -> ${lane} failed with status ${status}"
          fetch_remote_log_tail "$lane" "$sidecar_id" "$log_file"
          failed=1
          echo "$lane" >> "$completed_file"
          ;;
      esac
    done < "$lanes_file"

    if [[ "$failed" != "0" ]]; then
      stop_all_lanes
      return 1
    fi

    if [[ "$all_done" == "1" ]]; then
      return 0
    fi

    local elapsed
    elapsed=$(($(date +%s) - started_at))
    if [[ "$elapsed" -ge "$timeout_seconds" ]]; then
      echo "Chunk sidecar lanes timed out after ${elapsed}s"
      stop_all_lanes
      return 124
    fi

    if [[ $((elapsed - last_heartbeat)) -ge 60 ]]; then
      echo "  -> Sidecar lanes still running (${elapsed}s elapsed)"
      last_heartbeat="$elapsed"
    fi

    sleep "$poll_interval"
  done
}

if ! resolve_chunk_bin; then
  echo "Chunk CLI not found"
  exit "$unavailable_status"
fi

org_id="$(load_org_id)"
if [[ -z "$org_id" ]]; then
  echo "Chunk org id not found"
  exit "$unavailable_status"
fi

echo "Chunk sidecar lanes:"
echo "  frontend:   ${frontend_name}"
echo "  rust:       ${rust_name}"
echo "  playwright: ${playwright_name}"
if [[ -n "${SIDECAR_FRONTEND_ID:-}${SIDECAR_RUST_ID:-}${SIDECAR_PLAYWRIGHT_ID:-}" ]]; then
  echo "  explicit sidecar IDs are set for one or more lanes"
fi
echo "  vitest workers=${vitest_coverage_max_workers}; frontend coverage shards=${frontend_coverage_shards}; playwright shards=${playwright_shards}; concurrency=${playwright_concurrency}; cargo jobs=${cargo_build_jobs}"

if ! frontend_id="$(ensure_sidecar "$frontend_name" "${SIDECAR_FRONTEND_ID:-}")"; then
  echo "Chunk frontend sidecar unavailable"
  exit "$unavailable_status"
fi
if ! rust_id="$(ensure_sidecar "$rust_name" "${SIDECAR_RUST_ID:-}")"; then
  echo "Chunk rust sidecar unavailable"
  exit "$unavailable_status"
fi
if ! playwright_id="$(ensure_sidecar "$playwright_name" "${SIDECAR_PLAYWRIGHT_ID:-}")"; then
  echo "Chunk Playwright sidecar unavailable"
  exit "$unavailable_status"
fi

echo "Syncing worktree to sidecar lanes..."
if ! sync_all_lanes; then
  exit "$unavailable_status"
fi

started_at=$(date +%s)
echo "Launching sidecar lanes..."
launch_lane frontend "$frontend_id"
if [[ "$rust_changed" == "true" ]]; then
  launch_lane rust "$rust_id"
else
  echo "  -> Rust lane skipped because RUST_CHANGED=false"
fi
launch_lane playwright "$playwright_id"

if ! poll_lanes "$started_at"; then
  exit 1
fi

elapsed=$(($(date +%s) - started_at))
echo "Chunk sidecar lanes passed in ${elapsed}s"
exit 0
