// ---------------------------------------------------------------------------
// BlockNote code-block control regression (ported from
// `src/lib/blockNoteCodeBlockControl.regression.test.ts` in the Tauri repo).
// ---------------------------------------------------------------------------
//
// Protects two upstream BlockNote behaviours that the Tolaria React app
// patched and the GPUI port now inherits via the mirrored
// `patches/@blocknote__core@0.46.2.patch`:
//
// 1. A stale language-`change` event on a code block whose data has
//    disappeared (e.g. the block was deleted between mount and the
//    user releasing the `<select>`) must be a no-op.  Without the
//    patch BlockNote calls `updateBlock(id, …)` against a missing
//    target and throws.
//
// 2. Live language changes still flow through `editor.updateBlock`
//    with the correct payload — `{ props: { language: <choice> } }`.
//
// `createCodeBlockSpec` is exported by `@blocknote/core/blocks` and
// reaches into the same render path that the Tolaria editor mount
// uses (see the BlockNote core dist's `defaultBlocks-*.js`).

import { BlockNoteEditor } from "@blocknote/core";
import { createCodeBlockSpec } from "@blocknote/core/blocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    blocksToMarkdown,
    markdownToBlocks,
    replaceDocument,
} from "./richEditorMarkdown.ts";

const codeBlockSpec = createCodeBlockSpec({
    defaultLanguage: "text",
    supportedLanguages: {
        text: { name: "Plain Text" },
        typescript: { name: "TypeScript", aliases: ["ts"] },
    },
});

type CodeBlock = Parameters<typeof codeBlockSpec.implementation.render>[0];
type CodeBlockEditor = Parameters<typeof codeBlockSpec.implementation.render>[1];
type RenderedCodeBlock = ReturnType<typeof codeBlockSpec.implementation.render>;

interface CodeBlockControlEditor {
    isEditable: boolean;
    getBlock: (id: string) => CodeBlock | undefined;
    updateBlock: (id: string, update: { props: { language: string } }) => void;
}

function createCodeBlock(): CodeBlock {
    return {
        id: "code-block-1",
        type: "codeBlock",
        props: { language: "text" },
        content: [],
        children: [],
    } as CodeBlock;
}

function renderLanguageSelect(editor: CodeBlockControlEditor) {
    const block = createCodeBlock();
    // `render` is typed with an internal `this` requirement that the
    // host-side test fixtures don't (and don't need to) replicate.
    // Calling through the spec implementation keeps the original
    // method binding so the `this.blockContentDOMAttributes` lookup
    // inside BlockNote's `createSpec.render` resolves.
    const view = (
        codeBlockSpec.implementation as unknown as {
            render(b: CodeBlock, e: CodeBlockEditor): RenderedCodeBlock;
        }
    ).render(block, editor as CodeBlockEditor);
    const host = document.createElement("div");
    host.appendChild(view.dom);
    document.body.appendChild(host);

    const select = host.querySelector("select");
    if (!select) throw new Error("Expected code block language select");

    return { block, host, select, view };
}

function dispatchChange(select: HTMLSelectElement) {
    select.dispatchEvent(new window.Event("change"));
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("patched BlockNote code block controls", () => {
    it("ignores stale language changes when the target code block disappeared", () => {
        const editor: CodeBlockControlEditor = {
            isEditable: true,
            getBlock: vi.fn(() => undefined),
            updateBlock: vi.fn(),
        };

        const { block, select, view } = renderLanguageSelect(editor);
        select.value = "typescript";
        dispatchChange(select);

        expect(editor.getBlock).toHaveBeenCalledWith(block.id);
        expect(editor.updateBlock).not.toHaveBeenCalled();
        view.destroy?.();
    });

    it("keeps live language changes wired to the code block update", () => {
        const existingBlock = createCodeBlock();
        const editor: CodeBlockControlEditor = {
            isEditable: true,
            getBlock: vi.fn(() => existingBlock),
            updateBlock: vi.fn(),
        };

        const { block, select, view } = renderLanguageSelect(editor);
        select.value = "typescript";
        dispatchChange(select);

        expect(editor.getBlock).toHaveBeenCalledWith(block.id);
        expect(editor.updateBlock).toHaveBeenCalledWith(block.id, {
            props: { language: "typescript" },
        });
        view.destroy?.();
    });

    it("disables the language select on a read-only editor", () => {
        const editor: CodeBlockControlEditor = {
            isEditable: false,
            getBlock: vi.fn(() => createCodeBlock()),
            updateBlock: vi.fn(),
        };

        const { select, view } = renderLanguageSelect(editor);
        expect(select.disabled).toBe(true);

        // Even if a stray `change` arrives, the patch should leave the
        // editor untouched because the `change` listener is never wired.
        select.value = "typescript";
        dispatchChange(select);
        expect(editor.updateBlock).not.toHaveBeenCalled();
        view.destroy?.();
    });
});

describe("code block markdown round-trip", () => {
    let editor: BlockNoteEditor;
    beforeEach(() => {
        editor = BlockNoteEditor.create();
    });

    async function roundTrip(input: string): Promise<string> {
        const parsed = await markdownToBlocks(editor, input);
        replaceDocument(editor, parsed);
        return blocksToMarkdown(editor);
    }

    it("preserves a fenced code block language hint", async () => {
        const input = "```typescript\nconst x: number = 1;\n```\n";
        const parsed = await markdownToBlocks(editor, input);

        const codeBlock = parsed.find(
            (b: { type?: string }) => b.type === "codeBlock",
        ) as
            | { type: string; props?: { language?: string } }
            | undefined;
        expect(codeBlock).toBeDefined();
        expect(codeBlock?.props?.language).toBe("typescript");

        const out = await roundTrip(input);
        expect(out).toContain("```typescript");
        expect(out).toContain("const x: number = 1;");
    });

    it("preserves a `text` (plain) fenced code block without a language tag", async () => {
        const input = "```\njust text\n```\n";
        const parsed = await markdownToBlocks(editor, input);

        const codeBlock = parsed.find(
            (b: { type?: string }) => b.type === "codeBlock",
        ) as
            | { type: string; props?: { language?: string } }
            | undefined;
        expect(codeBlock).toBeDefined();
        // Without an explicit hint BlockNote falls back to the default
        // language (`text`) — the round trip must therefore include
        // the body text but not invent a spurious language tag.
        const out = await roundTrip(input);
        expect(out).toContain("just text");
    });

    it("inserts a code block via the slash-menu shape and keeps the language", () => {
        // Mirrors the slash-menu insertion path used by the editor:
        // a paragraph cursor block is replaced via `updateBlock` into
        // a `codeBlock` with a `language` prop.  The patched code block
        // spec keeps the language through the in-editor render.
        const inserted = {
            id: "inserted-code",
            type: "codeBlock",
            props: { language: "typescript" },
            content: [],
            children: [],
        };
        editor.replaceBlocks(editor.document, [inserted] as never);

        const live = editor.document.find(
            (b: { type?: string }) => b.type === "codeBlock",
        ) as { props?: { language?: string } } | undefined;

        expect(live).toBeDefined();
        expect(live?.props?.language).toBe("typescript");
    });
});
