---
type: ADR
id: "0116"
title: "Stable MCP server extraction for Linux AppImage"
status: active
date: 2026-05-08
---

## Context

On Linux, Tolaria ships as an AppImage — a self-contained archive that mounts a read-only squashfs filesystem at a different `APPDIR` on every launch. When the app registers its bundled MCP server with external AI tools (Claude Code, Cursor, Gemini CLI, OpenCode), the config files store the `node` command and `mcp-server/index.js` path. Because AppImage mount points change across restarts, those paths break immediately after the next launch.

Additionally, Tolaria's MCP registration did not cover OpenCode (`~/.config/opencode/opencode.json`), which uses a different config schema (`"mcp"` key, `"command"` as array, `"type": "local"`, `"environment"` instead of `"env"`).

## Decision

**On Linux AppImage launches, Tolaria extracts the bundled `mcp-server/` directory to `~/.local/share/tolaria/mcp-server/` (via `dirs::data_dir()`) and uses that stable path for all external MCP registrations. Extraction is gated by the app version, not triggered on every startup. OpenCode is added as a registration target.**

- `extract_mcp_server_to_stable_dir(app_version)` copies the bundled server to the XDG data directory using atomic extraction (staging directory + rename) with cross-process file locking.
- A `.tolaria-version` marker file records which app version last extracted. Extraction is skipped when the marker matches the running version.
- The version marker is tied to the Tauri app release version (`app_handle.package_info().version`), not to `mcp-server/package.json` — the server ships as part of the app bundle and its updates are coupled to app releases.
- Extraction is guarded by AppImage detection (`APPIMAGE` + `APPDIR` environment variables). On macOS, Windows, and `.deb` installs the bundled path is already stable — extraction is a no-op.
- `mcp_server_dir_for_registration()` returns the stable extracted path on AppImage, or the bundled path on other platforms.
- OpenCode registration writes to `~/.config/opencode/opencode.json` under the `"mcp"` key with its specific schema.

## Options considered

- **Stable extraction to XDG data dir, version-gated** (chosen): platform-appropriate path (`~/.local/share/`), survives restarts and updates, atomic extraction prevents partial state, version gating avoids redundant I/O — pros: reliable, follows Linux conventions, minimal startup cost after first run / cons: duplicates ~2 MB of server files outside the bundle.
- **Symlink from stable path to AppImage mount**: zero duplication — pros: no file copy / cons: symlink target changes on every launch (same fundamental problem), and symlinks into FUSE mounts are fragile.
- **Hash-based extraction gating** (hash `mcp-server/` contents): decoupled from app version — pros: re-extracts only when server code actually changes / cons: hashing the directory on every startup is slower than a single file read, and the server version is already coupled to the app version.
- **Re-extract on every startup**: simplest implementation — pros: always fresh / cons: unnecessary I/O on every launch, slower startup.

## Consequences

- External MCP registrations on Linux AppImage now reference `~/.local/share/tolaria/mcp-server/index.js`, which persists across app restarts, updates, and AppImage re-downloads.
- After an app update, the first launch re-extracts the server directory and subsequent launches skip extraction.
- Atomic extraction (staging dir + rename + file lock) prevents corrupt state if the app crashes mid-extraction or multiple instances race.
- OpenCode users can now register Tolaria's MCP server through the same setup flow as Claude Code, Cursor, and Gemini CLI.
- The `~/.local/share/tolaria/mcp-server/` directory is an app-managed artifact — users should not edit it manually. App uninstallation does not remove it automatically.
- Re-evaluation trigger: if AppImage changes its mount-point behavior to provide stable paths, the extraction step becomes unnecessary and can be removed.
