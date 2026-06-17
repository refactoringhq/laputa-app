---
type: ADR
id: "0140"
title: "Extension-based raw text syntax highlighting"
status: active
date: 2026-06-17
---

## Context

Tolaria already indexes UTF-8 non-Markdown vault files as `fileKind: "text"` and opens them in the raw CodeMirror editor. Discussion #872 asked for those files to receive syntax highlighting by file extension, especially `.sql`, `.json`, `.py`, and `.yaml`, matching the expectation set by highlighted fenced code blocks in Markdown notes.

The raw editor previously installed the Markdown language extension for every raw file. That made Markdown notes work, but `.sql`, `.json`, `.py`, and `.yaml` files rendered as effectively plain text or Markdown-shaped text instead of using their own grammars.

## Decision

Tolaria maps raw editor file extensions to CodeMirror language packages at editor creation time:

- Markdown files keep the existing frontmatter-aware Markdown path.
- YAML, JSON, Python, SQL, JavaScript, and TypeScript-like files use the official CodeMirror language packages for those grammars.
- Unknown text files stay plain instead of inheriting Markdown highlighting.
- Markdown-only frontmatter decorations and warnings stay scoped to Markdown files.

## Options considered

- **Use official CodeMirror language packages** (chosen): keeps raw editing inside CodeMirror, provides maintained incremental parsers, and avoids a second rendering surface.
- **Reuse Shiki from BlockNote code blocks**: visually closer to rich-editor code blocks, but Shiki is a static highlighter and would require a parallel CodeMirror decoration pipeline.
- **Keep Markdown highlighting for every raw file**: no new dependencies, but fails the requested behavior and treats non-Markdown files as Markdown.

## Consequences

- New runtime dependencies: `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-python`, and `@codemirror/lang-sql`.
- `src/utils/rawEditorLanguage.ts` owns extension-to-language mapping.
- `src/extensions/rawEditorLanguage.ts` owns the CodeMirror extension selection and keeps Markdown frontmatter highlighting scoped to Markdown files.
- Additional languages should be added by extending the mapping and using official CodeMirror language packages where available.
