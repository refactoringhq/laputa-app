# AGENTS.md — Tolaria App

> Quick links: [Architecture](docs/ARCHITECTURE.md) · [Abstractions](docs/ABSTRACTIONS.md) · [Wireframes](ui-design.pen)

---

## 1. Task Workflow

### 1a. Pick up a task

Run `/laputa-next-task` — fetches next task (To Rework first, then Open), moves to In Progress, returns full description.

**Before writing a single line of code:** run `mcp__codescene__code_health_score` to check the current codebase health against `.codescene-thresholds`. If the score is already below the threshold, **stop and refactor first** — find the worst files with the MCP, improve them, commit, then start the task. Never start feature work on a codebase that is already below the gate.

- Read task description and all comments fully
- For To Rework: the ❌ QA failed comment tells you exactly what to fix
- Check `docs/adr/` for relevant architecture decisions before structural choices
- Add a comment: `🚀 Starting work on this task. [Brief description of approach]`

### 1b. Implement

- Work on `main` branch — **no branches, no PRs, ever**. Pre-commit and pre-push block work from any other branch.
- Commit every 20–30 min: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- **⛔ NEVER use --no-verify**
- For UI tasks: open `ui-design.pen` first, study visual language, design in light mode. You don't need Pencil to use it – you can open it as a JSON file.

### 1c. When done

**Phase 1 — Playwright (only for core user flows):**

Write Playwright test in `tests/smoke/<slug>.spec.ts` only if feature touches: vault open, note create/save/delete, search, wikilink navigation, git commit/push, conflict resolution. Tag a test with `@smoke` only if it protects a core pre-push workflow. Do NOT tag cosmetic or mock-heavy checks — keep those in the full regression lane. The curated `pnpm playwright:smoke` suite must stay under **5 minutes**; use `pnpm playwright:regression` for the full Playwright pass.

```bash
pnpm dev --port 5201 &
sleep 3
BASE_URL="http://localhost:5201" npx playwright test tests/smoke/<slug>.spec.ts
```

**Phase 2 — Native app QA:**

```bash
pnpm tauri dev &
sleep 10
bash ~/.openclaw/skills/tolaria-qa/scripts/focus-app.sh laputa
bash ~/.openclaw/skills/tolaria-qa/scripts/screenshot.sh /tmp/qa-native.png
```

Use `osascript` for keyboard interactions. Write result as Todoist comment (✅ or ❌). **⚠️ WKWebView:** `osascript keystroke` blocked inside editor — rely on Playwright for text input features.

After both phases pass, add a **completion comment** to the Todoist task. The comment must include:
- What was implemented (a few lines covering logic and UX/UI)
- QA: what was tested and how (Playwright / native screenshot / osascript)
- Refactoring: any files refactored to meet the CodeScene gate (or "none needed")
- ADRs: any new/updated ADRs (or "none")
- Docs: any updated docs (ARCHITECTURE.md, ABSTRACTIONS.md, etc.) (or "none")
- Code health: final Hotspot and Average scores after push

---

## 2. Development Process

### Commits & pushes

- Push directly to `main` — no PRs, no branches. Pre-push blocks non-`main` pushes.
- Pre-push hook runs full check suite (build + tests + core Playwright smoke + CodeScene)
- **A task is NOT done until `git push origin main` succeeds.** If the hook blocks: read the error, fix it (clippy, tests, CodeScene, build), commit the fix, push again. **⛔ NEVER use --no-verify**

### TDD (mandatory)

Red → Green → Refactor → Commit. One cycle per commit. For bugs: write failing regression test first, then fix. Exception: pure CSS/layout changes.

**Test quality (Kent Beck's Desiderata):** Isolated · Deterministic · Fast · Behavioral · Structure-insensitive · Specific · Predictive. Fix flaky tests first. Prefer E2E over unit tests for user flows.

### Localization (mandatory for UI copy)

All user-facing UI labels/copy must live in `src/lib/locales/en.json` and be translated into every target listed in `lara.yaml`. When adding or changing interface copy:

```bash
pnpm l10n:translate
```

Use `pnpm l10n:translate:force` only when intentionally regenerating existing translations. Commit `src/lib/locales/*.json`, `lara.yaml`/`lara.lock` changes if produced, and verify placeholders/product names stayed intact.

### Code health (mandatory)

Pre-commit and pre-push hooks enforce **Hotspot Code Health** and **Average Code Health** ≥ thresholds in `.codescene-thresholds`. Both gates block commit/push. Thresholds are a **ratchet** — only go up. When pre-push sees improved remote scores, it updates `.codescene-thresholds`, stages it, and stops so you can commit the new floor with normal verified hooks before pushing again. Never add `// eslint-disable`, `#[allow(...)]`, or `as any`.

**⛔ NEVER edit `.codescene-thresholds` to lower the values.** If the gate blocks you, improve the code — do not lower the bar.

**CodeScene access order:** use CodeScene MCP tools if available. If MCP is unavailable, use the installed `cs` CLI for file-level review/delta work, and use the CodeScene API (`CODESCENE_PAT` + `CODESCENE_PROJECT_ID`) for project-wide Hotspot/Average threshold checks from `.codescene-thresholds`.

**Before editing any existing code file:** capture its current file-level CodeScene score. After your edits, re-run the same file-level review and verify the score is higher. If the file already starts at `10.0`, it must remain `10.0`.

**New files:** every new **scorable code file** must reach CodeScene score `10.0` before commit. If CodeScene reports `null` / "no scorable code" for a new file, it must still have zero CodeScene findings/warnings.

**Before every commit:** run CodeScene file-level review on every touched or newly created code file and verify the rule above. **Boy Scout Rule:** every file you touch must leave with a higher score, unless it was already `10.0`, in which case it must stay `10.0`.

**If CodeScene gate blocks your push:** use `mcp__codescene__code_health_score` to find the worst file, refactor it, commit, push again. Do NOT stop or wait for laputa-refactor — that is a background loop, not a substitute for fixing your own regressions.

### Check suite (runs on every push)
```bash
pnpm lint && npx tsc --noEmit && pnpm test && pnpm test:coverage  # frontend ≥70%
cargo test && cargo llvm-cov --manifest-path src-tauri/Cargo.toml --no-clean --fail-under-lines 85
```

### ADRs & docs

ADRs live in `docs/adr/`. Create in the same commit as the code. Never edit existing — create a new one that supersedes. Use `/create-adr`. **When:** new dependency, storage strategy, platform target, core abstraction, cross-cutting pattern. **Not for:** bug fixes, styling, refactors.

After any Tauri command, new component/hook, data model change, or new integration: update `docs/ARCHITECTURE.md`, `docs/ABSTRACTIONS.md`, and/or `docs/GETTING-STARTED.md` in the same commit.

---

## 3. Product Rules

### Demo vault hygiene (`demo-vault/`, `demo-vault-v2/`)

Default to `demo-vault-v2/` for testing.

- Treat `demo-vault/` and `demo-vault-v2/` as disposable QA fixtures unless the task explicitly changes demo content.
- If you create untracked notes, attachments, or other temporary files there for testing, delete them before the task is complete.
- If you modify tracked demo-vault files only to test or QA behavior, revert those edits before the final commit.
- Before declaring a task done, make sure `git status --short -- demo-vault demo-vault-v2` is empty unless demo fixture changes are part of the task.
- If a fresh run starts and the only local dirt is inside `demo-vault/` or `demo-vault-v2/`, clean those paths first and continue. That case is recoverable QA residue, not a blocker.

### User vault (`~/Laputa/`)

Default to `demo-vault-v2/`. If you must use `~/Laputa/` for testing:
- **Never commit or push** any test notes to the remote vault
- **Delete all test notes from disk** when done — do not leave untitled or temporary notes on the filesystem. Run `cd ~/Laputa && git checkout -- . && git clean -fd` to restore the vault to its last committed state.
- **Rationale:** test notes pollute the local vault over time, making it a collection of nonsensical untitled files. The vault must stay clean on disk, not just on the remote.

### UI components — mandatory rules

**Always use shadcn/ui components.** Never use raw HTML form elements (`<input>`, `<select>`, `<button>`, native `<input type="date">`, etc.) for user-facing UI. Every interactive element must use the shadcn/ui equivalent:

| Need | Use |
|---|---|
| Text input | `Input` from shadcn/ui |
| Dropdown/select | `Select` from shadcn/ui |
| Date picker | `Calendar` + `Popover` from shadcn/ui (NOT native `<input type="date">`) |
| Button | `Button` from shadcn/ui |
| Autocomplete/combobox | Reuse existing combobox components from the app (check `src/components/`) |
| Wikilink picker | Reuse the wikilink autocomplete component already used in the editor and Properties panel |
| Emoji picker | Reuse the emoji picker component already used for note/type icons |
| Color picker | Reuse the color swatch picker used for type customization |
| Toggle/switch | `Switch` or `ToggleGroup` from shadcn/ui |
| Dialog/modal | `Dialog` from shadcn/ui |

**When in doubt:** search `src/components/` for an existing component before building new. **Visual language:** all new UI must feel native to Tolaria — if it looks like a browser default, it's wrong.

---

## 4. Reference

### macOS / Tauri gotchas

- `Option+N` → special chars on macOS. Use `e.code` or `Cmd+N`
- Tauri menu accelerators: `MenuItemBuilder::new(label).accelerator("CmdOrCtrl+1")`
- `app.set_menu()` replaces the ENTIRE menu bar — include all submenus
- `mock-tauri.ts` silently swallows Tauri calls — not a substitute for native testing

### QA scripts

```bash
bash ~/.openclaw/skills/tolaria-qa/scripts/focus-app.sh Tolaria
bash ~/.openclaw/skills/tolaria-qa/scripts/screenshot.sh /tmp/out.png
bash ~/.openclaw/skills/tolaria-qa/scripts/shortcut.sh "command" "s"
```

### Diagrams

Prefer Mermaid (`flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`). ASCII only for spatial wireframe layouts.
