# 0108. Sanitized Rendered Markup and Safe User Regex

Date: 2026-05-03

## Status

Accepted

## Context

Tolaria renders generated SVG/HTML from trusted libraries such as Mermaid and KaTeX, and it allows users to opt into regex matching in filters and editor find/replace. Codacy SRM flagged the raw markup insertion and direct regex construction as Critical XSS/DoS risks.

## Decision

Add direct runtime dependencies on `dompurify` and `safe-regex2`.

Rendered Mermaid SVG and KaTeX HTML must be sanitized before insertion and mounted through DOM nodes rather than React `dangerouslySetInnerHTML`. User-provided regex sources must be length-bounded and checked with `safe-regex2` before compilation.

SCA-reported vulnerable transitive dependencies are pinned through package-manager overrides so Codacy resolves patched floors until upstream dependencies adopt them naturally. This includes `protobufjs`, the MCP SDK web-server stack, and Vite's parser/build transitive stack. Rust lockfile-only updates keep OpenSSL, rustls-webpki, and tar on patched versions without changing public Tauri APIs.

## Consequences

Markup rendering now has an explicit sanitizer boundary that is shared by Mermaid and math rendering. User regex features remain available, but unsafe or overly large expressions fail validation instead of running in the UI thread.

The overrides should be removed once the dependency graph no longer pulls the vulnerable versions.
