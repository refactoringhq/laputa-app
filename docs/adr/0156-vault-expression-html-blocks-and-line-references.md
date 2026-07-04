---
type: ADR
id: "0156"
title: "Vault expressions in sandboxed HTML blocks and line references"
status: active
date: 2026-07-04
---

## Context

Sandboxed HTML blocks are useful for small dashboards, report fragments, and presentation-oriented views, but static HTML forces users to duplicate values that already live in note frontmatter or sheet cells. Tolaria already has a vault-aware reference contract in sheet formulas: `[[note]].A1` reads one grid cell and `[[note]].property.path` reads scalar frontmatter.

Normal Markdown notes also need a coherent way to expose prose lines without interpreting commas as spreadsheet columns. The existing grid address syntax should remain stable, so `[[note]].A1` must keep CSV/sheet semantics even when the target note displays as text.

## Decision

**Tolaria adds a renderer-owned vault expression layer for sandboxed HTML blocks and a raw body-line reference syntax shared with sheet formulas.**

HTML block source may contain `{{...}}` expressions. The renderer compiles each block into static HTML chunks plus expression ASTs, resolves referenced values from the current note, other note frontmatter, sheet cells, and raw body lines, escapes expression output as text, then passes the assembled HTML through the existing sanitizer and sandboxed iframe pipeline.

Supported v1 expression references are:

- `{{status}}` and `{{this.status}}` for current-note scalar frontmatter and selected entry fields.
- `{{[[project]].status}}` for scalar frontmatter on another note.
- `{{[[budget]].B12}}` for a single sheet/grid cell.
- `{{[[brief]].2}}` for the second raw body line, excluding frontmatter and preserving commas as text.

Formatting is limited to deterministic pure functions: `upper`, `lower`, `title`, `trim`, `truncate`, `replace`, `round`, `formatNumber`, `formatPercent`, `formatCurrency`, `formatDate`, `default`, and `isEmpty`. String concatenation with `+` is allowed; arbitrary JavaScript, user-defined functions, loops, mutation, remote values, and raw HTML interpolation are not supported.

The `.1`/`.2` line reference syntax is also valid inside sheet formulas. It returns one frontmatter-stripped raw body line as a formula literal and does not split commas. Existing `.A1` references continue to use CSV/sheet cell semantics.

## Consequences

- HTML block previews can be reactive without granting script execution to the iframe.
- Expression output is never trusted HTML; unsafe values are escaped before sanitization.
- Existing sheet cell references keep their current meaning across all note display modes.
- Text notes gain a stable line-addressing surface through `.1`, `.2`, and later line numbers.
- Line-reference formulas use the JavaScript resolver path; the native sheet worker remains reserved for current cell-only cases.
- Future expression growth should extend the pure parser/evaluator and dependency model, not add browser eval or iframe scripting.
