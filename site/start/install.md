# Install Tolaria

Tolaria publishes desktop builds for macOS, Windows, and Linux. macOS is the primary day-to-day development target, with Windows and Linux builds supported through the release pipeline and fixed as platform issues are found.

## Download

Use the latest stable release unless you are intentionally testing pre-release builds:

- <a href="https://tolaria.md/download/" target="_self">Download the latest stable build</a>
- [Browse all GitHub releases](https://github.com/refactoringhq/tolaria/releases)
- [Read the release notes](/releases/)

## Homebrew

On macOS you can install the cask:

```bash
brew install --cask tolaria
```

## Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | Primary | Apple Silicon and Intel builds are published. Homebrew is available. |
| Windows | Supported, early | NSIS installers and signed updater bundles are published. Some shell and menu behavior can still need Windows-specific fixes. |
| Linux | Supported, early | AppImage and deb artifacts are published. Desktop behavior depends on distribution WebKitGTK and input-method integration. |

See [Supported Platforms](/reference/supported-platforms) for the current support policy.

## After Installing

1. Open Tolaria.
2. Choose the Getting Started vault if you want a guided sample.
3. Or open an existing folder of Markdown files as a vault.
4. Use the command palette with `Cmd+K` on macOS or `Ctrl+K` on Linux and Windows.
