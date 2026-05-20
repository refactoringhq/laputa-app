// ---------------------------------------------------------------------------
// BlockNote copy / clipboard compatibility regression
// (ported from `src/lib/blockNoteCopyCompatibility.regression.test.ts`).
// ---------------------------------------------------------------------------
//
// The Tauri WebView shipped without `Array.prototype.toReversed` for a
// long stretch (Safari 16.0 / WKWebView baseline), and BlockNote's
// `blocksToHTMLLossy` / `blocksToMarkdownLossy` pipeline calls
// `toReversed` while serialising mark stacks during a copy operation.
//
// The mirrored `@blocknote/core` patch replaces every `Array#toReversed`
// call with `Array.from(...).reverse()` (see
// `patches/@blocknote__core@0.46.2.patch`).  This test mounts an
// editor, deletes `Array.prototype.toReversed` from the global prototype
// while it runs, and asserts every serialiser still produces the
// expected text.
//
// If a future BlockNote upgrade re-introduces `toReversed` on the copy
// path this test fails before the bundle ships into the GPUI host.

import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";

interface ArrayWithToReversed<T> extends Array<T> {
    toReversed?: () => T[];
}

const arrayToReversedDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "toReversed",
);

function removeArrayToReversed() {
    Object.defineProperty(Array.prototype, "toReversed", {
        configurable: true,
        writable: true,
        value: undefined,
    });
}

function restoreArrayToReversed() {
    if (arrayToReversedDescriptor) {
        Object.defineProperty(
            Array.prototype,
            "toReversed",
            arrayToReversedDescriptor,
        );
        return;
    }

    delete (Array.prototype as ArrayWithToReversed<unknown>).toReversed;
}

afterEach(() => {
    restoreArrayToReversed();
});

describe("patched BlockNote rich text copy compatibility", () => {
    it("serializes marked rich text without Array.prototype.toReversed", async () => {
        removeArrayToReversed();

        const editor = BlockNoteEditor.create({
            initialContent: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "Copied rich text",
                            styles: { bold: true, italic: true },
                        },
                    ],
                },
            ],
        });

        try {
            const html = await editor.blocksToHTMLLossy(editor.document);
            const fullHtml = await editor.blocksToFullHTML(editor.document);
            const markdown = await editor.blocksToMarkdownLossy(editor.document);

            expect(html).toContain("Copied rich text");
            expect(fullHtml).toContain("Copied rich text");
            expect(markdown).toContain("Copied rich text");
        } finally {
            // `_tiptapEditor` is internal API but the React reference
            // test reaches for it — we mirror that so the editor's
            // ProseMirror view detaches cleanly in `happy-dom`.
            const internal = (
                editor as unknown as { _tiptapEditor?: { destroy: () => void } }
            )._tiptapEditor;
            internal?.destroy();
        }
    });

    it("round-trips an HTML clipboard payload through the BlockNote serialiser", async () => {
        // A clipboard copy ultimately calls `blocksToFullHTML` and pastes
        // back through `tryParseHTMLToBlocks`.  Without the patch the
        // initial copy throws on engines that lack `toReversed`; with
        // the patch a paste of the same HTML restores the formatted run.
        removeArrayToReversed();

        const editor = BlockNoteEditor.create({
            initialContent: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "Round trip",
                            styles: { bold: true },
                        },
                    ],
                },
            ],
        });

        try {
            const html = await editor.blocksToFullHTML(editor.document);
            const parsed = await editor.tryParseHTMLToBlocks(html);
            const flat = JSON.stringify(parsed);
            expect(flat).toContain("Round trip");
            expect(flat).toContain('"bold":true');
        } finally {
            const internal = (
                editor as unknown as { _tiptapEditor?: { destroy: () => void } }
            )._tiptapEditor;
            internal?.destroy();
        }
    });
});
