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
 */
export function blocksToMarkdown(editor: BlockNoteEditor): string {
    return editor.blocksToMarkdownLossy(editor.document);
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
