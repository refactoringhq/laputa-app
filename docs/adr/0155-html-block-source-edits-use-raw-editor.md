---
type: ADR
id: "0155"
title: "HTML block source edits use the raw editor"
status: active
date: 2026-07-04
---

## Context

ADR-0154 introduced sandboxed fenced HTML blocks and initially made the block source editable inline in rich mode. Tolaria already has a raw Markdown editor that exposes the exact fenced source users need to change, and keeping a second inline source editor creates duplicate editing behavior inside an otherwise rendered block.

Raw mode also needs to stay comfortable for HTML-block work: fenced `html` contents should be syntax-highlighted as HTML, and pressing `Tab` while editing source should insert a tab instead of moving focus out of CodeMirror.

## Decision

**Tolaria renders HTML blocks as preview-only rich-editor blocks and routes source edits through raw CodeMirror mode.** The rich block keeps copy, raw-editor, height reset, and resize controls, but no inline source textarea or edit button.

Raw Markdown mode directly depends on CodeMirror's HTML language support so fenced `html` code contents are highlighted inside the Markdown document. The raw editor binds `Tab` to CodeMirror's literal tab insertion command.

## Consequences

- There is one source-editing surface for HTML block markup: the raw Markdown editor.
- Empty or blocked HTML blocks no longer open an inline editor; users use the raw-editor action to change the fenced source.
- CodeMirror's Markdown mode highlights HTML tags, attributes, and values within fenced `html` blocks without changing the durable Markdown storage format.
- `Tab` is captured by the raw editor while focused, matching code-editor expectations and avoiding accidental focus movement during source edits.
