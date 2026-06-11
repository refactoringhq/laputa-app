# First Launch

Source: start/first-launch.md
URL: /start/first-launch

# First Launch

The first launch flow is designed to get you into a real vault quickly without hiding the local-first model.

## What You Choose

Tolaria asks whether you want to:

- Create or clone the Getting Started vault.
- Open an existing local vault.
- Create a new empty vault.

The Getting Started vault is cloned locally and then disconnected from its remote. That keeps the sample safe to edit without accidentally pushing tutorial changes.

## What Tolaria Creates

Tolaria stores app-level settings on the local machine. Your notes stay in the vault folder you choose.

| Data | Stored in |
| --- | --- |
| Notes and attachments | Your vault folder |
| Type definitions and saved views | Your vault folder |
| Window size, zoom, recent vaults | Local app settings |
| Cache data | Rebuildable local cache |

## First Commands To Try

- `Cmd+K` / `Ctrl+K`: open the command palette.
- `New Note`: create a note in the current vault.
- `Open Getting Started Vault`: clone the public sample vault.
- `Reload Vault`: rescan files after external edits.

## AI Setup Prompt

Tolaria can show an optional AI agents prompt after a vault is open. It checks common local install locations for supported coding agents and gives you setup paths, but you can dismiss it and use Tolaria without AI.

---

# Getting Started Vault

Source: start/getting-started-vault.md
URL: /start/getting-started-vault

# Getting Started Vault

The Getting Started vault is a small public sample vault hosted at [refactoringhq/tolaria-getting-started](https://github.com/refactoringhq/tolaria-getting-started).

It exists to show Tolaria's conventions without requiring you to restructure your own notes first.

## What It Demonstrates

- Markdown notes with YAML frontmatter.
- Types such as Project, Person, Topic, and Procedure.
- Wikilinks in note bodies.
- Relationship fields in frontmatter.
- A local Git repository that can be connected to a remote later.
- Vault guidance files for AI agents.

## Local-Only By Default

When Tolaria clones the sample, it removes the remote from the local copy. This makes the sample vault disposable. You can edit it freely, commit locally, and delete it later.

To connect a vault to your own remote, use the bottom status bar remote chip or run `Add Remote` from the command palette.

Tolaria also repairs starter-vault guidance files when needed. `AGENTS.md` is the canonical guidance file, `CLAUDE.md` is kept as a compatibility shim, and `GEMINI.md` is only created when you explicitly restore Gemini guidance.

## Use It Alongside Your Own Vaults

You can keep the Getting Started vault open while working in your own notes. Enable `Settings` -> `Vaults` -> `Use multiple vaults at the same time`, then use the bottom-left vault menu to include both the sample vault and your real vault in the unified graph.

This lets search, quick open, note lists, backlinks, and wikilink navigation span both vaults. Git actions still stay scoped to each vault's own repository, and new notes go to the default vault you choose in `Manage vaults`.

## When To Move On

After you understand the sample, open your own vault. Tolaria does not require a special folder structure: a folder of Markdown files is enough to start. You can remove the sample from Tolaria's vault list later without deleting its files from disk.

---

# Install Tolaria

Source: start/install.md
URL: /start/install

# Install Tolaria

Tolaria publishes desktop builds for macOS, Windows, and Linux. macOS is the primary day-to-day development target, with Windows and Linux builds supported through the release pipeline and fixed as platform issues are found.

## Download

Use the latest stable release unless you are intentionally testing pre-release builds:

- <a href="https://tolaria.md/download/" target="_self">Download the latest stable build</a>
- [Browse all GitHub releases](https://github.com/refactoringhq/tolaria/releases)
- <a href="https://tolaria.md/releases/" target="_self">Read the release notes</a>

## Homebrew

On macOS you can install the cask:

```bash
brew install --cask tolaria
```

## Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | Primary | Apple Silicon and Intel builds are published. Homebrew is available. |
| Windows | Supported, early | NSIS installers and updater bundles are Tauri-signed. Authenticode publisher signing will be added after Windows certificate provisioning; company-managed SmartScreen, Defender, or WDAC policies can still require IT approval before install. |
| Linux | Supported, early | AppImage, deb, and RPM artifacts are published. Desktop behavior depends on distribution WebKitGTK and input-method integration. |

See [Supported Platforms](/reference/supported-platforms) for the current support policy.

## Managed Windows Devices

Do not disable SmartScreen or Windows Security to install Tolaria. On a managed Windows device, install Tolaria through your normal software approval path if policy blocks unsigned or unknown-publisher installers. After Authenticode provisioning is complete, validate that the downloaded installer has a valid Tolaria publisher signature before installing.

## After Installing

1. Open Tolaria.
2. Choose the Getting Started vault if you want a guided sample.
3. Or open an existing folder of Markdown files as a vault.
4. Use the command palette with `Cmd+K` on macOS or `Ctrl+K` on Linux and Windows.

---

# Open Or Create A Vault

Source: start/open-or-create-vault.md
URL: /start/open-or-create-vault

# Open Or Create A Vault

A Tolaria vault is a folder on disk. The folder can contain Markdown notes, attachments, type definitions, saved views, and Git metadata.

## Open An Existing Folder

Choose an existing folder if you already have Markdown notes. Tolaria scans `.md` files and uses frontmatter when it exists.

Good starting points:

- A folder of plain Markdown files.
- An Obsidian-style vault.
- A Git repository containing notes.
- A copy of the Getting Started vault.

## Create A New Vault

Choose a new empty folder if you want Tolaria conventions from the start. New notes and optional type definitions are created as Markdown files.

## Use More Than One Vault

You do not have to merge everything into one folder. Register each local folder as its own vault, then turn on `Use multiple vaults at the same time` in `Settings` -> `Vaults`.

Once enabled, the bottom-left vault menu lets you include vaults in the unified graph. Search, quick open, wikilinks, and note lists can span the included vaults, while Git sync and commits remain tied to each vault's own repository.

## Git Is Recommended, Not Required

Tolaria works well with a plain folder of Markdown files. You can open, edit, organize, and search notes without making the vault a Git repository.

Git is recommended when you want local history, diff views, recovery, pull, push, and remote sync without a proprietary backend. If a vault is not already a repository, Tolaria can initialize one when you explicitly ask it to.