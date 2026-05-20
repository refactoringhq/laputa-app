#!/usr/bin/env bash
#
# Phase 8 periscope smoke sweep — companion script for
# docs/plans/native-gpui-chrome/periscope-phase-8-sweep.md.
#
# Spawns tolaria against demo-vault-v2 pinned to 1516x1052 logical
# points, polls for the window, drives ten captures into
# target/periscope/phase-8-sweep/, and exits non-zero if any
# expected capture is missing or under the 10 kB black-frame floor.
#
# Manual captures (slash menu, side menu, formatting toolbar,
# wikilink popup, IME composition) pause the sweep and wait for
# the user to press <enter> after performing the required gesture.
# `osascript keystroke` doesn't reach the WKWebView editor body
# (AGENTS.md §4 macOS / Tauri gotchas), so these stay manual.
#
# Usage:
#   bash scripts/periscope-phase-8-sweep.sh
#
# Env vars:
#   TOLARIA_PROFILE   debug (default) or release. Release builds skip
#                     the SIGUSR1 tree_dump handler, so all --id
#                     captures fall back to coordinate clicks — leave
#                     unset for the sweep.
#
# Exits 0 on a clean sweep, 1 if any expected capture is missing or
# fails the 10 kB size floor.

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROFILE="${TOLARIA_PROFILE:-debug}"
case "$PROFILE" in
  debug)   PROFILE_FLAGS=() ;;
  release) PROFILE_FLAGS=(--release) ;;
  *)
    echo "TOLARIA_PROFILE must be 'debug' or 'release' (got: $PROFILE)" >&2
    exit 2
    ;;
esac

OUT_DIR="target/periscope/phase-8-sweep"
mkdir -p "$OUT_DIR"

VAULT="demo-vault-v2"
WIDTH=1516
HEIGHT=1052
MIN_BYTES=$((10 * 1024)) # 10 kB — matches periscope's black-frame floor.
WINDOW_TITLE="Tolaria"

# --- Child-process management ---------------------------------------------

TOLARIA_PID=""
cleanup() {
  if [[ -n "$TOLARIA_PID" ]] && kill -0 "$TOLARIA_PID" 2>/dev/null; then
    echo ""
    echo "==> Tearing down Tolaria (pid=$TOLARIA_PID)"
    kill "$TOLARIA_PID" 2>/dev/null || true
    wait "$TOLARIA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- Spawn the windowed app ------------------------------------------------

echo "==> Launching tolaria ($PROFILE) against $VAULT at ${WIDTH}x${HEIGHT}"
cargo run -q -p tolaria "${PROFILE_FLAGS[@]}" -- \
  --vault "$VAULT" --width "$WIDTH" --height "$HEIGHT" \
  >"$OUT_DIR/tolaria.stdout.log" 2>"$OUT_DIR/tolaria.stderr.log" &
TOLARIA_PID=$!

# Poll for the window to appear in `periscope list`. Caps at 30 s so a
# silent build / link failure surfaces fast instead of hanging the sweep.
echo "==> Waiting up to 30s for window titled \"$WINDOW_TITLE\""
window_found=0
for _ in $(seq 1 60); do
  if cargo run -q -p periscope -- list 2>/dev/null | grep -q "title=$WINDOW_TITLE\$"; then
    window_found=1
    break
  fi
  if ! kill -0 "$TOLARIA_PID" 2>/dev/null; then
    echo "==> Tolaria exited before the window appeared. Tail of stderr:" >&2
    tail -n 20 "$OUT_DIR/tolaria.stderr.log" >&2 || true
    exit 1
  fi
  sleep 0.5
done

if [[ "$window_found" -ne 1 ]]; then
  echo "==> Timed out waiting for Tolaria window (Screen Recording / Accessibility granted?)" >&2
  exit 1
fi

# Give the window one more half-second to paint its initial frame so the
# baseline captures aren't blank.
sleep 0.5

# --- Capture helpers -------------------------------------------------------

# capture <slot> <filename>
#   Runs `periscope screenshot --raise` and tees stderr into a per-capture
#   log so permission-remediation hints aren't lost.
capture() {
  local slot="$1"
  local filename="$2"
  shift 2
  local stderr_log="$OUT_DIR/${slot}.stderr.log"
  echo ""
  echo "==> [$slot] periscope screenshot $* --out $OUT_DIR/$filename"
  if cargo run -q -p periscope -- screenshot \
      --title "$WINDOW_TITLE" --raise \
      --out "$OUT_DIR/$filename" \
      "$@" 2>"$stderr_log"; then
    echo "    wrote $filename ($(stat -f%z "$OUT_DIR/$filename") bytes)"
  else
    echo "    FAILED ($filename) — see $stderr_log" >&2
    tail -n 5 "$stderr_log" >&2 || true
  fi
}

# click_id <element-id>
click_id() {
  local id="$1"
  echo "==> periscope click --id $id"
  if ! cargo run -q -p periscope -- click \
      --title "$WINDOW_TITLE" --raise --id "$id" 2>"$OUT_DIR/click-$id.stderr.log"; then
    echo "    click --id $id FAILED — see $OUT_DIR/click-$id.stderr.log" >&2
  fi
  # Settle for layout / dump refresh.
  sleep 0.4
}

# click_xy <x> <y>
click_xy() {
  local x="$1"
  local y="$2"
  echo "==> periscope click --x $x --y $y"
  if ! cargo run -q -p periscope -- click \
      --title "$WINDOW_TITLE" --raise --x "$x" --y "$y" \
      2>"$OUT_DIR/click-${x}-${y}.stderr.log"; then
    echo "    click ($x,$y) FAILED — see $OUT_DIR/click-${x}-${y}.stderr.log" >&2
  fi
  sleep 0.4
}

# manual_pause <message>
#   Prompts the user to perform a manual gesture and waits for <enter>
#   before returning so the next capture fires while the gesture is
#   still on screen.
manual_pause() {
  local msg="$1"
  echo ""
  echo "==> MANUAL SETUP REQUIRED"
  echo "    $msg"
  echo "    Hit <enter> when ready to capture (or Ctrl-C to abort)."
  read -r _
}

# osascript_menu_click <menu-name> <item-name>
#   Drives a top-level menu-bar click via System Events. Used for Save
#   because cmd-s is not bound in crates/actions/assets/default.json.
osascript_menu_click() {
  local menu="$1"
  local item="$2"
  echo "==> osascript: menu bar → $menu → $item"
  osascript <<EOF
tell application "System Events"
  tell process "tolaria"
    set frontmost to true
    click menu item "$item" of menu "$menu" of menu bar 1
  end tell
end tell
EOF
  sleep 0.4
}

# --- The sweep -------------------------------------------------------------

# 01 — light baseline.
capture "00" "00-light-baseline.png"

# 02 — dark baseline (toggle theme first).
click_id "status-bar-theme-toggle"
capture "01" "01-dark-baseline.png"
# Restore light theme for the remaining captures so reviewers compare
# against the light baseline.
click_id "status-bar-theme-toggle"
sleep 0.3

# 03 — BlockNote mount. Click the note-list pane area, then the first
# row (no per-row dump_as yet — see "Stable ids that don't exist yet"
# in the companion doc). The coordinate below targets the first
# visible markdown row in demo-vault-v2 at the pinned 1516x1052 size.
click_id "workspace-note-list"
sleep 0.2
# First-row coordinate inside the note-list pane. Adjust if the list
# layout shifts; see periscope dump-tree output for current bounds.
click_xy 220 220
sleep 0.6
capture "02" "02-blocknote-mount.png"

# 04 — slash menu open. Manual gesture (osascript keystroke is blocked
# inside the WKWebView editor body).
manual_pause "Click into the editor body, type '/', keep the slash menu open."
capture "03" "03-slash-menu-open.png"

# 05 — side-menu handle visible on hover.
manual_pause "Hover the cursor over a block; keep the '⋮⋮' handle visible."
capture "04" "04-side-menu-handle.png"

# 06 — formatting toolbar over a selection.
manual_pause "Double-click a word in the editor body; keep the floating toolbar visible."
capture "05" "05-formatting-toolbar.png"

# 07 — wikilink suggestion popup.
manual_pause "Click into the editor body, type '[[' — expect an empty popup (pending 8.26)."
capture "06" "06-wikilink-suggestion.png"

# 08 — raw-mode yaml note (Views → Active Projects).
click_id "sidebar-section-views"
sleep 0.3
# Click the Active Projects row inside Views. Coordinate-driven until
# a `sidebar-row-views-active-projects` dump_as lands.
click_xy 120 360
sleep 0.6
capture "07" "07-raw-mode-yaml.png"

# 09 — save round-trip. Re-open a markdown note first (raw mode left
# us on the yaml view), then drive File → Save via System Events.
click_id "workspace-note-list"
sleep 0.2
click_xy 220 220
sleep 0.6
osascript_menu_click "File" "Save"
sleep 0.5
capture "08" "08-save-round-trip.png"

# 10 — IME composition. Fully manual; requires the user to switch
# input source before invoking the sweep, or between the previous
# capture and this one.
manual_pause "Switch input source to Pinyin / Japanese / Korean, type a composition glyph; keep the composition popup visible."
capture "09" "09-ime-composition.png"

# --- Summary ---------------------------------------------------------------

expected=(
  "00-light-baseline.png"
  "01-dark-baseline.png"
  "02-blocknote-mount.png"
  "03-slash-menu-open.png"
  "04-side-menu-handle.png"
  "05-formatting-toolbar.png"
  "06-wikilink-suggestion.png"
  "07-raw-mode-yaml.png"
  "08-save-round-trip.png"
  "09-ime-composition.png"
)

echo ""
echo "==> Sweep summary"
fail=0
total_bytes=0
present=0
for f in "${expected[@]}"; do
  path="$OUT_DIR/$f"
  if [[ ! -f "$path" ]]; then
    echo "    MISSING  $f"
    fail=1
    continue
  fi
  size="$(stat -f%z "$path")"
  total_bytes=$((total_bytes + size))
  if [[ "$size" -lt "$MIN_BYTES" ]]; then
    echo "    TOO SMALL $f ($size bytes < $MIN_BYTES)"
    fail=1
  else
    echo "    ok       $f ($size bytes)"
    present=$((present + 1))
  fi
done

echo ""
echo "==> $present / ${#expected[@]} captures present; total $(printf '%d' "$total_bytes") bytes"
if [[ "$fail" -ne 0 ]]; then
  echo "==> sweep INCOMPLETE — see per-capture stderr logs in $OUT_DIR" >&2
  exit 1
fi
echo "==> sweep complete — attach $OUT_DIR/*.png to the Phase 8 close-out evidence"
exit 0
