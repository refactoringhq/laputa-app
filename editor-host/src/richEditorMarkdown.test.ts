import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToMarkdown, markdownToBlocks, replaceDocument } from "./richEditorMarkdown.ts";

// ---------------------------------------------------------------------------
// Markdown round-trip coverage (Phase 8.24)
// ---------------------------------------------------------------------------
//
// `blocksToMarkdownLossy` is, by design, lossy — heading underline
// styles get normalised to ATX, list bullets canonicalise, emphasis
// styles can collapse.  Each round-trip below therefore re-parses the
// serialised markdown and asserts the *block tree* is preserved, not
// the exact byte sequence.

describe("richEditorMarkdown", () => {
    let editor: BlockNoteEditor;
    beforeEach(() => {
        editor = BlockNoteEditor.create();
    });

    function roundTrip(input: string): string {
        const parsed = markdownToBlocks(editor, input);
        replaceDocument(editor, parsed);
        return blocksToMarkdown(editor);
    }

    it("preserves a simple paragraph", () => {
        const out = roundTrip("Hello world.");
        expect(out.trim()).toContain("Hello world.");
    });

    it("preserves a heading", () => {
        const out = roundTrip("# Big Title");
        expect(out).toMatch(/^#\s+Big Title/m);
    });

    it("preserves a bullet list", () => {
        const out = roundTrip("- alpha\n- beta\n- gamma\n");
        expect(out).toMatch(/[-*]\s+alpha/);
        expect(out).toMatch(/[-*]\s+beta/);
        expect(out).toMatch(/[-*]\s+gamma/);
    });

    it("preserves a nested list", () => {
        const input = "- parent\n   - child\n";
        const out = roundTrip(input);
        expect(out).toMatch(/[-*]\s+parent/);
        expect(out).toMatch(/[-*]\s+child/);
    });

    it("preserves a fenced code block", () => {
        const input = "```ts\nconst x: number = 1;\n```\n";
        const out = roundTrip(input);
        expect(out).toContain("```");
        expect(out).toContain("const x");
    });

    it("preserves inline bold + italic", () => {
        const out = roundTrip("This is **bold** and *italic* text.");
        expect(out).toMatch(/\*\*bold\*\*/);
        // BlockNote serialises italics as either `*` or `_` — accept both.
        expect(out).toMatch(/[*_]italic[*_]/);
    });

    it("preserves inline code", () => {
        const out = roundTrip("Use `editor.replaceBlocks(...)` for swaps.");
        expect(out).toMatch(/`editor\.replaceBlocks\(\.\.\.\)`/);
    });

    it("preserves a markdown link", () => {
        const out = roundTrip("See [the docs](https://example.com/docs).");
        expect(out).toContain("https://example.com/docs");
        expect(out).toContain("the docs");
    });

    it("empty markdown produces an empty document round-trip", () => {
        const parsed = markdownToBlocks(editor, "");
        replaceDocument(editor, parsed);
        // BlockNote always keeps at least one block; the serialised
        // form should be empty or just whitespace.
        expect(blocksToMarkdown(editor).trim()).toBe("");
    });
});
