# Editor

Tolaria offers a rich editor for daily writing and a raw Markdown mode for exact file control. Both modes write back to the same Markdown file.

## Rich Editing

The rich editor supports blocks, slash commands, wikilinks, tables, code blocks, images, Mermaid diagrams, LaTeX-style math, sandboxed HTML blocks, and markdown-backed whiteboards.

Use it when you want to write and reorganize quickly without thinking about Markdown syntax.

## HTML Blocks

HTML blocks render fenced `html` code as sandboxed previews. They are useful for dashboards, report fragments, custom layouts, and small interactive local views.

HTML source is edited in raw mode. The rich editor shows the preview, copy source action, raw-editor action, height reset, and resize handle.

::: v-pre
HTML blocks can read vault values with `{{...}}` expressions, including current-note properties, external note properties, sheet cells, raw body lines, formatting helpers, and structured `json(...)` data for sandboxed scripts.
:::

See [Use HTML Blocks](/guides/use-html-blocks) for the workflow and [Vault Expressions](/reference/vault-expressions) for the syntax.

## Raw Mode

Raw mode shows the Markdown source directly. Use it when you need to edit YAML frontmatter, repair unusual Markdown, or make an exact text change.

Toggle raw mode with `Cmd+\` on macOS or `Ctrl+\` on Windows and Linux.

## Table Of Contents

The table of contents panel builds an outline from headings in the current note. It is useful for long notes, procedures, research files, and generated documents. Toggle it with `Cmd+Shift+T` on macOS or `Ctrl+Shift+T` on Windows and Linux.

## Width

Notes can use normal or wide editor width. Set the default in Settings, or override an individual note from the editor toolbar.
