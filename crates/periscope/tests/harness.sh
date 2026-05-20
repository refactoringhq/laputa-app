#!/usr/bin/env bash
#
# Generic Tolaria spawn-and-wait harness for periscope-driven capture
# sweeps.  Companion scenario docs live under `docs/plans/.../`; the
# first example consumer is
# `docs/plans/native-gpui-chrome/phase-8-sweep.md`.
#
# Spawns a `tolaria` window pinned to 1516x1052 against demo-vault-v2,
# resolves the binary pid `periscope list` reports, prints
# `BIN_PID` + `OUT_DIR`, then blocks on stdin so an agent (or human)
# can drive the consuming doc's scenarios from another shell.
# `<enter>` (or SIGINT) tears the child down via the cleanup trap.
#
# This shell does NOT drive any captures — `osascript keystroke` can't
# reach the WKWebView editor body (AGENTS.md §4 macOS gotchas), so the
# gesture-dependent scenarios need human input anyway.  See the
# consuming doc for per-scenario steps.
#
# Usage:
#   bash crates/periscope/tests/harness.sh             # spawn + wait on stdin
#   bash crates/periscope/tests/harness.sh --no-block  # spawn + wait on SIGINT
#   BLOCK=0 bash …                                     # same as --no-block
#
# Env vars: TOLARIA_PROFILE (debug|release, default debug),
# VAULT (default demo-vault-v2), WIDTH/HEIGHT (default 1516/1052),
# OUT_DIR (default $REPO_ROOT/target/periscope/sweep — override per
# consuming doc, e.g.
# `OUT_DIR=$REPO_ROOT/target/periscope/phase-8-sweep`).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PROFILE="${TOLARIA_PROFILE:-debug}"
case "$PROFILE" in
  debug)   PROFILE_FLAGS=() ;;
  release) PROFILE_FLAGS=(--release) ;;
  *) echo "TOLARIA_PROFILE must be 'debug' or 'release' (got: $PROFILE)" >&2; exit 2 ;;
esac

VAULT="${VAULT:-demo-vault-v2}"
WIDTH="${WIDTH:-1516}"
HEIGHT="${HEIGHT:-1052}"
BLOCK="${BLOCK:-1}"
for arg in "$@"; do
  case "$arg" in
    --no-block) BLOCK=0 ;;
    --help|-h)  sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

OUT_DIR="${OUT_DIR:-$REPO_ROOT/target/periscope/sweep}"
mkdir -p "$OUT_DIR"

TOLARIA_PID=""
BIN_PID=""
cleanup() {
  if [[ -n "$TOLARIA_PID" ]] && kill -0 "$TOLARIA_PID" 2>/dev/null; then
    echo ""
    echo "==> Tearing down Tolaria (cargo pid=$TOLARIA_PID, bin pid=${BIN_PID:-?})"
    kill "$TOLARIA_PID" 2>/dev/null || true
    wait "$TOLARIA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "==> Building periscope ($PROFILE)"
PERISCOPE_BIN="$REPO_ROOT/target/$PROFILE/periscope"
cargo build -q -p periscope "${PROFILE_FLAGS[@]}" && {
    echo "==> Built periscope successfully: $PERISCOPE_BIN" >&2;
} || {
    echo "failed to build periscope" >&2; exit 1;
}

echo "==> Building tolaria ($PROFILE)"
TOLARIA_BIN="$REPO_ROOT/target/$PROFILE/tolaria"
cargo build -q -p tolaria "${PROFILE_FLAGS[@]}" && {
    echo "==> Built tolaria successfully: $TOLARIA_BIN" >&2;
} || {
    echo "failed to build tolaria" >&2; exit 1;
}

echo "==> Launching tolaria ($PROFILE) against $VAULT at ${WIDTH}x${HEIGHT}"
"$TOLARIA_BIN" \
  --vault "$VAULT" --width "$WIDTH" --height "$HEIGHT" \
  >"$OUT_DIR/tolaria.stdout.log" 2>"$OUT_DIR/tolaria.stderr.log" &
TOLARIA_PID=$!

echo "==> Waiting up to 30s for the tolaria window"
for _ in $(seq 1 60); do
  BIN_PID="$($PERISCOPE_BIN list 2>/dev/null \
    | awk -F'[= ]' '/^pid=.* app=tolaria/ {print $2; exit}')"
  [[ -n "$BIN_PID" ]] && break
  if ! kill -0 "$TOLARIA_PID" 2>/dev/null; then
    echo "==> Tolaria exited before the window appeared. Tail of stderr:" >&2
    tail -n 20 "$OUT_DIR/tolaria.stderr.log" >&2 || true
    exit 1
  fi
  sleep 0.5
done
[[ -z "$BIN_PID" ]] && {
  echo "==> Timed out waiting for Tolaria window (Screen Recording / Accessibility granted?)" >&2
  exit 1
}
sleep 0.5  # let the window paint its first frame before any capture.

echo ""
echo "==> Harness ready."
echo "    BIN_PID=$BIN_PID"
echo "    OUT_DIR=$OUT_DIR"
echo ""
echo "    Drive captures from another shell, e.g.:"
echo "      $PERISCOPE_BIN screenshot --pid $BIN_PID --raise \\"
echo "          --out $OUT_DIR/00-light-baseline.png"
echo ""
echo "    Scenario list: see the consuming doc (e.g. \`docs/plans/native-gpui-chrome/phase-8-sweep.md\`)"
echo ""

if [[ "$BLOCK" = "0" ]]; then
  echo "==> --no-block / BLOCK=0: staying in the foreground until SIGINT (Ctrl-C)."
  wait "$TOLARIA_PID"
else
  echo "==> Press <enter> in this terminal to tear down."
  read -r _
fi
