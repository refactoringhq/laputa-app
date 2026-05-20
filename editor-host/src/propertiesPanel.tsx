// ---------------------------------------------------------------------------
// Properties panel — read-only frontmatter display (worklist 2.27)
// ---------------------------------------------------------------------------
//
// 2.26 keeps YAML frontmatter intact across `note_open` -> `save_request`
// round-trips by stashing the raw prefix and prepending it back on save.
// That fixes the data side, but the YAML block is *invisible* in the
// editor surface — BlockNote receives a body that has been stripped of
// the prefix, and there is no chrome above it.  The React variant
// renders a rich `DynamicPropertiesPanel` instead.
//
// This module is the native-shell complement: a small read-only panel
// that shows each key/value pair from the parsed frontmatter so the
// YAML block stops being invisible.  Editing controls (type-aware
// editors, add/remove/reorder, validation) are deliberately out of
// scope and tracked as a follow-up worklist row.
//
// The parser is intentionally shallow — we do not pull in `js-yaml`
// (the editor-host bundle is already ~2.4 MB after the shadcn install).
// Nested mappings and sequences are surfaced as their raw source
// string so the panel still *shows* the data even if it cannot pretty-
// print it.

import type { ReactElement } from "react";

/** Parsed frontmatter entry — key as it appears in YAML, value as the
 *  raw source string (no type coercion, no quote stripping).  Entries
 *  are returned in source order. */
export interface FrontmatterEntry {
    key: string;
    value: string;
}

/** Match the same opening fence shapes that `splitFrontmatter` accepts. */
function frontmatterOpeningLength(content: string): number | null {
    if (content.startsWith("---\r\n")) return 5;
    if (content.startsWith("---\n")) return 4;
    return null;
}

/** Strip the trailing closing fence (`\n---\n`, `\r\n---\r\n`, etc.)
 *  from the inner body.  The fence detection in `splitFrontmatter`
 *  already guarantees the prefix ends with a `---` token, so we can
 *  safely peel it off by regex without re-validating. */
function stripClosingFence(inner: string): string {
    return inner.replace(/(?:\r?\n)?---(?:\r?\n|\n)?$/, "");
}

/** Pattern for a top-level YAML key: `^([A-Za-z0-9_-]+):\s*(.*)$`.
 *  Intentionally narrow — we don't try to validate YAML, we just want
 *  to detect "this line introduces a new key".  Anything else gets
 *  treated as a continuation of the previous entry. */
const KEY_LINE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

/** Parse a YAML frontmatter prefix (including the `---` fences and
 *  trailing newline produced by `splitFrontmatter`) into ordered
 *  key/value entries.
 *
 *  Algorithm:
 *  1. Strip the leading `---\n` / `---\r\n` and the trailing closing
 *     fence.  If the input doesn't open with `---`, return `[]`.
 *  2. Walk the inner lines:
 *     - Blank / whitespace-only -> skip.
 *     - Indented (starts with whitespace) -> continuation of the
 *       previous entry's value; append `\n` + the raw line so the
 *       display layer can show multi-line scalars / list items as
 *       their source text.
 *     - Matches the top-level key regex -> new entry; trim trailing
 *       whitespace from the value but leave quotes intact.
 *     - Anything else (comments, malformed lines) -> skip silently.
 *     This is a display layer, not a validator.
 */
export function parseFrontmatterEntries(prefix: string): FrontmatterEntry[] {
    const openLength = frontmatterOpeningLength(prefix);
    if (openLength === null) return [];

    const inner = stripClosingFence(prefix.slice(openLength));
    if (inner.length === 0) return [];

    // Split on LF; CRLF inputs leave a trailing `\r` on each line that
    // we trim before matching but preserve in continuation values so
    // the displayed text matches the source byte-for-byte.
    const lines = inner.split("\n");
    const entries: FrontmatterEntry[] = [];

    for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.trim().length === 0) continue;

        if (/^\s/.test(line)) {
            // Continuation of the previous entry — append the raw line.
            const last = entries[entries.length - 1];
            if (last !== undefined) {
                last.value = last.value.length === 0 ? line : `${last.value}\n${line}`;
            }
            continue;
        }

        const match = KEY_LINE.exec(line);
        if (match === null) {
            // Comment / malformed line — skip silently.
            continue;
        }

        const [, key, rawValue] = match;
        entries.push({ key: key!, value: (rawValue ?? "").trimEnd() });
    }

    return entries;
}

export interface PropertiesPanelProps {
    entries: FrontmatterEntry[];
}

/** Read-only panel that renders each frontmatter entry as a key/value
 *  row above the editor body.  Returns `null` when the entries list is
 *  empty so notes without frontmatter pay no chrome cost. */
export function PropertiesPanel({ entries }: PropertiesPanelProps): ReactElement | null {
    if (entries.length === 0) return null;
    return (
        <div className="properties-panel" data-testid="properties-panel">
            {entries.map((entry) => (
                <div key={entry.key} className="properties-panel__row">
                    <span className="properties-panel__key">{entry.key}</span>
                    <span className="properties-panel__value">{entry.value}</span>
                </div>
            ))}
        </div>
    );
}
