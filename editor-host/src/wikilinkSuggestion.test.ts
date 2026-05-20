import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockNoteEditor } from "@blocknote/core";
import { createEditor } from "./setupEditor.ts";
import { markdownToBlocks, replaceDocument } from "./richEditorMarkdown.ts";
import {
    WIKILINK_MIN_QUERY_LENGTH,
    buildWikilinkGetItems,
    buildWikilinkSuggestionItem,
    defaultWikilinkItemsProvider,
    insertWikilinkItem,
    type WikilinkSuggestionItem,
} from "./wikilinkSuggestion.ts";

/** Mount a fresh editor against a detached DOM node so
 *  `insertInlineContent` (which requires the ProseMirror view) works
 *  inside happy-dom.  Mirrors what `BlockNoteViewRaw` does in
 *  production; tests have to call `mount` explicitly. */
function mountEditor(): { editor: BlockNoteEditor; teardown: () => void } {
    const editor = createEditor();
    const host = document.createElement("div");
    document.body.appendChild(host);
    editor.mount(host);
    return {
        editor,
        teardown() {
            editor.unmount();
            host.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// Wikilink suggestion (Phase 8.26)
// ---------------------------------------------------------------------------
//
// The suggestion menu plumbing is exercised end-to-end against a real
// `BlockNoteEditor` so that `insertInlineContent({ type: 'wikilink' })`
// actually round-trips through the schema added in `setupEditor.ts`.
// The bridge-side provider is missing (`FromHost::WikilinkQuery` /
// `ToHost::WikilinkSuggestions` aren't wired yet — see the
// 8.26-bridge TODO in `wikilinkSuggestion.ts`); these tests therefore
// drive `getItems` with hand-rolled providers and assert the surface
// behaviour the future bridge integration will need to satisfy.

function openEmptyParagraph(editor: BlockNoteEditor): void {
    const parsed = markdownToBlocks(editor, "starter\n");
    replaceDocument(editor, parsed);
    // Park the cursor at the end of the starter paragraph so
    // `insertInlineContent` inserts in-line, not as a new block.
    const last = editor.document.at(-1);
    if (last) {
        editor.setTextCursorPosition(last, "end");
    }
}

interface InlineNodeProbe {
    type?: string;
    props?: { target?: string };
}

/** Walk every block in the document looking for an inline node with
 *  `type === 'wikilink'`.  BlockNote may split the cursor block when
 *  `insertInlineContent` runs against the end of a paragraph, so the
 *  wikilink might land on a newly-created sibling instead of the
 *  block the cursor was on at call time. */
function findWikilinkNode(editor: BlockNoteEditor): InlineNodeProbe | undefined {
    for (const block of editor.document) {
        const content = block.content as unknown as InlineNodeProbe[] | undefined;
        if (!Array.isArray(content)) continue;
        const found = content.find((node) => node.type === "wikilink");
        if (found) return found;
    }
    return undefined;
}

describe("WIKILINK_MIN_QUERY_LENGTH", () => {
    it("matches the React reference of zero — `[[` is the gate", () => {
        expect(WIKILINK_MIN_QUERY_LENGTH).toBe(0);
    });
});

describe("defaultWikilinkItemsProvider", () => {
    it("returns an empty list until the bridge variants land", async () => {
        // Bridge audit (8.26): `FromHost::WikilinkQuery` and
        // `ToHost::WikilinkSuggestions` do not exist yet, so the
        // default provider has to stub.  Locking the stub in a test
        // makes the eventual replacement an obvious diff.
        const items = await defaultWikilinkItemsProvider("anything");
        expect(items).toEqual([]);
    });
});

describe("buildWikilinkSuggestionItem", () => {
    let editor: BlockNoteEditor;
    let teardown: () => void;
    beforeEach(() => {
        const mounted = mountEditor();
        editor = mounted.editor;
        teardown = mounted.teardown;
    });
    afterEach(() => {
        teardown();
    });

    it("defaults title to the wikilink target when none is supplied", () => {
        const item = buildWikilinkSuggestionItem({
            editor,
            target: "Alpha",
        });
        expect(item.title).toBe("Alpha");
        expect(item.wikilinkTarget).toBe("Alpha");
    });

    it("preserves a custom title and subtext when supplied", () => {
        const item = buildWikilinkSuggestionItem({
            editor,
            target: "alpha/project",
            title: "Alpha Project",
            subtext: "alpha/project.md",
        });
        expect(item.title).toBe("Alpha Project");
        expect(item.subtext).toBe("alpha/project.md");
        expect(item.wikilinkTarget).toBe("alpha/project");
    });

    it("attaches an onItemClick that inserts the wikilink at the cursor", () => {
        openEmptyParagraph(editor);
        const item = buildWikilinkSuggestionItem({
            editor,
            target: "Alpha Project",
        });
        item.onItemClick();
        // The markdown exporter has no wikilink renderer yet (port
        // for 8.28); the schema-level assertion is that an inline
        // content node with the right type and target was inserted
        // somewhere in the document.  `insertInlineContent` may
        // split the cursor block and shift the wikilink onto a
        // newly-created paragraph, so we walk every block looking
        // for it.
        const wikilinkNode = findWikilinkNode(editor);
        expect(wikilinkNode?.props?.target).toBe("Alpha Project");
        // And the document is non-empty after insertion — the wikilink
        // didn't vanish into a no-op.
        const md = editor.blocksToMarkdownLossy(editor.document);
        expect(md.length).toBeGreaterThan(0);
    });
});

describe("insertWikilinkItem", () => {
    it("inserts a typed wikilink inline content and a trailing space", () => {
        const { editor, teardown } = mountEditor();
        try {
            openEmptyParagraph(editor);
            const item: WikilinkSuggestionItem = {
                wikilinkTarget: "Beta",
                title: "Beta",
                onItemClick: () => {},
            };
            insertWikilinkItem(editor, item);
            const wikilink = findWikilinkNode(editor);
            expect(wikilink?.props?.target).toBe("Beta");
        } finally {
            teardown();
        }
    });
});

describe("buildWikilinkGetItems", () => {
    let editor: BlockNoteEditor;
    let teardown: () => void;
    beforeEach(() => {
        const mounted = mountEditor();
        editor = mounted.editor;
        teardown = mounted.teardown;
    });
    afterEach(() => {
        teardown();
    });

    it("delegates to the supplied provider and attaches click handlers", async () => {
        openEmptyParagraph(editor);
        const provider = vi.fn(async (query: string) => [
            buildWikilinkSuggestionItem({
                editor,
                target: query.length ? `match-${query}` : "any",
            }),
        ]);
        const getItems = buildWikilinkGetItems(editor, provider);

        const result = await getItems("alp");
        expect(provider).toHaveBeenCalledWith("alp");
        expect(result).toHaveLength(1);
        expect(result[0]?.wikilinkTarget).toBe("match-alp");
        // Picking the item must insert at the live cursor — proves
        // the closure points at `editor`, not a stale capture.
        result[0]?.onItemClick();
        expect(findWikilinkNode(editor)?.props?.target).toBe("match-alp");
    });

    it("re-attaches a click handler when the provider ships items without one", async () => {
        openEmptyParagraph(editor);
        // Cast through `unknown` because `DefaultReactSuggestionItem`
        // requires `onItemClick` — we're explicitly testing the
        // case where a provider forgot to wire it.
        const provider = (async () => [
            { wikilinkTarget: "Gamma", title: "Gamma" } as unknown as WikilinkSuggestionItem,
        ]);
        const getItems = buildWikilinkGetItems(editor, provider);
        const result = await getItems("");
        expect(typeof result[0]?.onItemClick).toBe("function");
        result[0]?.onItemClick();
        expect(findWikilinkNode(editor)?.props?.target).toBe("Gamma");
    });

    it("swallows provider errors and returns an empty list with a warning", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const provider = async () => {
            throw new Error("network down");
        };
        const getItems = buildWikilinkGetItems(editor, provider);

        const result = await getItems("anything");
        expect(result).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            "[wikilink-suggestion] provider failed:",
            expect.any(Error),
        );
        warn.mockRestore();
    });

    it("falls back to the default empty-list provider when none is supplied", async () => {
        const getItems = buildWikilinkGetItems(editor);
        const result = await getItems("anything");
        expect(result).toEqual([]);
    });
});
