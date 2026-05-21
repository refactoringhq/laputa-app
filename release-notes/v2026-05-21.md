## New Features

- 🧭 **Expanded Note Context Menus** — Right-click notes for faster everyday actions, including opening in a new window, favorites, organization state, Finder reveal, and file path copy.
- 🤖 **More Local AI Agent Options** — Use Kiro as a local AI agent, run Tolaria's MCP server through Bun as well as Node, and launch Pi more reliably from shell-managed installs.
- 📚 **Portent Knowledge-Base Template** — Tolaria's docs now include Portent as a reference template for structuring durable, agent-friendly knowledge bases.
- 🌍 **Belarusian Language Support** — Use Tolaria with new Belarusian interface translations.

## Improvements

- ⚡ **Much Faster Note Windows** — Opening a note in a separate window now uses a lighter startup path, avoiding the full main-window load and reducing app-wide stalls.
- 🪟 **More Complete Note Actions** — Note-list actions are now available from the context menu as well as existing command paths, making common file and organization tasks easier to reach.
- 🧩 **Cleaner CLI Agent Runtime Detection** — Shared binary discovery was consolidated so local agent launches handle shell-managed runtimes more consistently.

## Stability and Fixes

- Note windows now open reliably from all entry points and no longer stall the whole application during startup.
- Editor reliability is improved around Go code-block highlighting, Mermaid fullscreen zoom, non-Markdown wikilink targets, active-note refresh after external edits, and retained editor memory.
- Vault and workspace behavior is steadier around AutoGit multi-vault pushes, new views in the default workspace, and vault watcher Git symlinks.
- Release build type safety, pnpm patched dependency handling, CodeScene thresholds, and multiple patch-review findings were addressed before promotion.
