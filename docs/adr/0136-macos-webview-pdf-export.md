# ADR-0136: macOS Webview PDF Export

## Status

Accepted

## Context

The first note PDF export implementation reused the native webview print command. On macOS that opens the full printer dialog, which is not the product behavior expected from "Export note as PDF"; users should choose a filesystem destination and get a PDF directly.

Tolaria already renders the exportable note in the live BlockNote DOM and applies print-only CSS so math, Mermaid, images, code blocks, tables, links, and custom blocks follow the same rendering path users see in the editor. Introducing a second Markdown-to-PDF renderer would duplicate that rendering logic and create drift.

## Decision

Use the existing Tauri webview and WebKit's own print operation to save the current webview directly to a chosen PDF path. The renderer remains responsible for export preparation:

- exit raw/diff modes
- apply the PDF export body class
- ask the user for a `.pdf` destination
- invoke the native `export_current_webview_pdf` command

The native command uses direct `objc2`, `objc2-app-kit`, `objc2-foundation`, and `objc2-web-kit` dependencies on macOS only. These crates are already part of Tauri's platform stack; declaring them directly lets Tolaria ask `WKWebView` for a WebKit-aware `NSPrintOperation` without adding a separate PDF rendering engine.

Windows, Linux, and browser mode keep print-dialog fallback behavior because they do not have the macOS WebKit/AppKit direct PDF save path yet. The renderer checks the native capability before opening a filesystem save dialog, so unsupported platforms do not ask for a destination that cannot be used.

## Consequences

- The macOS path opens a save-file dialog, not the printer dialog.
- The exported PDF keeps using the rendered note DOM, so frontmatter stays excluded by the existing rich-editor body extraction.
- The feature depends on macOS WebKit/AppKit behavior for direct PDF output. Other desktop platforms use the existing native print dialog until they get a platform-specific direct PDF path.
- The new direct dependencies must stay target-scoped to macOS so Linux and Windows builds do not compile AppKit crates.
