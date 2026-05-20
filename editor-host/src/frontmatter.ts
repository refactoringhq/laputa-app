// ---------------------------------------------------------------------------
// YAML frontmatter splitter (Phase 8.26 / worklist 2.26)
// ---------------------------------------------------------------------------
//
// Ported from `src/utils/wikilinks.ts:302-330` so the editor-host
// preserves YAML frontmatter byte-for-byte across `note_open` ->
// `save_request` round-trips.
//
// BlockNote's `tryParseMarkdownToBlocks` / `blocksToMarkdownLossy`
// pair is lossy on YAML — feeding `---\ntitle: T\n---` through the
// parser reflows it as paragraph text and the serialiser cannot
// reconstruct the original.  The React variant works around this in
// `serializeRichEditorDocumentToMarkdown` by peeling the YAML block
// off the on-disk content before parsing, then prepending it back on
// serialise.  We mirror that strategy here.
//
// Keep the algorithm identical to the React variant so round-tripping
// matches byte-for-byte; the React tests live in
// `src/utils/wikilinks.test.ts:199-242` and the editor-host tests in
// `frontmatter.test.ts` are direct ports.

function frontmatterOpeningLength(content: string): number | null {
    if (content.startsWith("---\r\n")) return 5;
    if (content.startsWith("---\n")) return 4;
    return null;
}

function precedingLineEndingLength(value: string): number {
    return value.startsWith("\r\n") ? 2 : value.startsWith("\n") ? 1 : 0;
}

function frontmatterCloseLength(value: string): number {
    const lineEndingLength = precedingLineEndingLength(value);
    if (value.endsWith("\r\n")) return lineEndingLength + 5;
    if (value.endsWith("\n")) return lineEndingLength + 4;
    return lineEndingLength + 3;
}

/** Strip YAML frontmatter from markdown, returning [frontmatter, body].
 *  Ported from src/utils/wikilinks.ts:320 — keep the algorithm
 *  identical to the React variant so round-tripping matches
 *  byte-for-byte. */
export function splitFrontmatter(content: string): [string, string] {
    const openLength = frontmatterOpeningLength(content);
    if (openLength === null) return ["", content];

    const afterOpen = content.slice(openLength);
    const close = afterOpen.match(/(?:^|\r?\n)---(?:\r?\n|$)/);
    if (!close || close.index === undefined) return ["", content];

    const to = openLength + close.index + frontmatterCloseLength(close[0]);
    return [content.slice(0, to), content.slice(to)];
}
