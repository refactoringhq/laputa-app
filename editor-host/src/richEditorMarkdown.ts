import type { BlockNoteEditor } from "@blocknote/core";

// ---------------------------------------------------------------------------
// Markdown round-trip helpers (Phase 8.24)
// ---------------------------------------------------------------------------
//
// Thin wrappers around BlockNote's `tryParseMarkdownToBlocks` /
// `blocksToMarkdownLossy` that mirror the canonical
// `src/utils/richEditorMarkdown.ts` shape in the Tauri-era app.
//
// Phase 8.24 keeps these helpers minimal — wikilink restore, file
// attachments, image portability, durable code-block markdown,
// frontmatter splitting, and the post-process compaction pass all
// arrive in later Strand C rows (8.26 wikilinks, 8.28 regressions).

/**
 * Parse a markdown string into BlockNote `Block`s using the editor's
 * own pmSchema.  Wrapped so the dispatch loop can swap in vault-aware
 * preprocessing (wikilink encode, attachment URL resolve) in 8.26 /
 * 8.28 without touching the call site.
 */
export function markdownToBlocks(
    editor: BlockNoteEditor,
    markdown: string,
): ReturnType<BlockNoteEditor["tryParseMarkdownToBlocks"]> {
    return editor.tryParseMarkdownToBlocks(markdown);
}

/**
 * Serialise the editor's current `document` to markdown.  Calls
 * `blocksToMarkdownLossy` against the live document so callers don't
 * need to read `editor.document` themselves.
 *
 * BlockNote's serialiser passes link / image URLs through
 * `new URL(href, document.baseURI)`, which absolutises any note-
 * relative path (e.g. `attachments/foo.png` →
 * `http://localhost:1430/attachments/foo.png` under the WKWebView,
 * `http://localhost:3000/attachments/foo.png` under happy-dom).  That
 * round-trips wrong on save: the on-disk note had a relative URL, but
 * the saved buffer carries the WebView origin glued to the front.
 *
 * Strip the current window origin back off so the saved markdown
 * matches the original.  Cheap, deterministic, and a no-op when
 * `window` / `location` aren't available (e.g. a node-only consumer).
 */
export function blocksToMarkdown(editor: BlockNoteEditor): string {
    return stripWindowOriginPrefix(editor.blocksToMarkdownLossy(editor.document));
}

function stripWindowOriginPrefix(md: string): string {
    if (typeof window === "undefined" || typeof window.location === "undefined") {
        return md;
    }
    const origin = window.location.origin;
    // `about:blank` and other null-origin contexts surface as
    // `"null"` — nothing to strip.
    if (!origin || origin === "null") return md;
    // Both image (`![…](…)`) and link (`[…](…)`) targets get their
    // URLs absolutised by the serialiser; strip the origin from
    // either form.  Match the URL anywhere inside the `(…)` (the
    // serialiser may also emit `<…>`-quoted forms for spaces).
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(!?\\[[^\\]]*\\]\\()(<?)${escaped}/`, "g");
    return md.replace(pattern, "$1$2");
}

/**
 * Replace the editor's entire document with `blocks`.  Mirrors the
 * React-side `editor.replaceBlocks(editor.document, parsed)` pattern
 * — replacing every existing block with the parsed payload is the
 * established way to swap in a fresh note body.
 */
export function replaceDocument(
    editor: BlockNoteEditor,
    blocks: ReturnType<BlockNoteEditor["tryParseMarkdownToBlocks"]>,
): void {
    editor.replaceBlocks(editor.document, blocks);
}
