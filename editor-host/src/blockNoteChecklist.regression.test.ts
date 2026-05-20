// ---------------------------------------------------------------------------
// BlockNote checklist regression (ported from
// `src/lib/blockNoteChecklist.regression.test.ts` in the Tauri repo).
// ---------------------------------------------------------------------------
//
// Two layers of coverage:
//
// 1. Patched-control unit tests — verify that
//    `createCheckListItemBlockSpec().implementation.render` calls
//    `editor.getBlock(id)` before `editor.updateBlock(...)` (the
//    patch that lands in `patches/@blocknote__core@0.46.2.patch`).
//    Without the patch a stale checkbox `change` event during a
//    block re-render would throw.
//
// 2. Markdown round-trip — drive the actual host helpers
//    (`markdownToBlocks` / `blocksToMarkdown`) and assert that
//    `- [ ]` / `- [x]` survive a serialise-deserialise round trip.
//    This is the user-visible contract: any change to BlockNote's
//    GFM task-list pipeline that drops the `checked` prop fails
//    here before it reaches the GPUI shell.

import { createCheckListItemBlockSpec } from "@blocknote/core/blocks";
import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    blocksToMarkdown,
    markdownToBlocks,
    replaceDocument,
} from "./richEditorMarkdown.ts";

const checkListItemSpec = createCheckListItemBlockSpec();

type CheckListItemBlock = Parameters<typeof checkListItemSpec.implementation.render>[0];
type CheckListItemEditor = Parameters<typeof checkListItemSpec.implementation.render>[1];
type RenderedCheckListItem = ReturnType<typeof checkListItemSpec.implementation.render>;

interface CheckListItemControlEditor {
    getBlock: (id: string) => CheckListItemBlock | undefined;
    updateBlock: (
        block: CheckListItemBlock,
        update: { props: { checked: boolean } },
    ) => void;
}

function createCheckListItem(checked = false): CheckListItemBlock {
    return {
        id: "check-list-item-1",
        type: "checkListItem",
        props: { checked },
        content: [],
        children: [],
    } as unknown as CheckListItemBlock;
}

function renderCheckListItem(
    editor: CheckListItemControlEditor,
    checked = false,
) {
    const block = createCheckListItem(checked);
    // Call through the spec's `implementation` so BlockNote's internal
    // `this.blockContentDOMAttributes` lookup resolves; the public TS
    // types declare a stricter `this` shape than the host fixtures
    // need, so we cast through `unknown` to satisfy the call signature.
    const view = (
        checkListItemSpec.implementation as unknown as {
            render(
                b: CheckListItemBlock,
                e: CheckListItemEditor,
            ): RenderedCheckListItem;
        }
    ).render(block, editor as CheckListItemEditor);
    const host = document.createElement("div");
    host.appendChild(view.dom);
    document.body.appendChild(host);

    const checkbox = host.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error("Expected checklist checkbox");
    }

    return { block, checkbox, host, view };
}

function dispatchChange(checkbox: HTMLInputElement) {
    checkbox.dispatchEvent(new window.Event("change"));
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("patched BlockNote checklist controls", () => {
    it("ignores stale checkbox changes when the target checklist block disappeared", () => {
        const editor: CheckListItemControlEditor = {
            getBlock: vi.fn(() => undefined),
            updateBlock: vi.fn(),
        };

        const { block, checkbox, view } = renderCheckListItem(editor);
        checkbox.checked = true;
        dispatchChange(checkbox);

        expect(editor.getBlock).toHaveBeenCalledWith(block.id);
        expect(editor.updateBlock).not.toHaveBeenCalled();
        view.destroy?.();
    });

    it("applies live checkbox changes to the current checklist block", () => {
        const existingBlock = createCheckListItem();
        const editor: CheckListItemControlEditor = {
            getBlock: vi.fn(() => existingBlock),
            updateBlock: vi.fn(),
        };

        const { block, checkbox, view } = renderCheckListItem(editor);
        checkbox.checked = true;
        dispatchChange(checkbox);

        expect(editor.getBlock).toHaveBeenCalledWith(block.id);
        expect(editor.updateBlock).toHaveBeenCalledWith(existingBlock, {
            props: { checked: true },
        });
        view.destroy?.();
    });
});

describe("checklist markdown round-trip", () => {
    let editor: BlockNoteEditor;
    beforeEach(() => {
        editor = BlockNoteEditor.create();
    });

    async function roundTrip(input: string): Promise<string> {
        const parsed = await markdownToBlocks(editor, input);
        replaceDocument(editor, parsed);
        return blocksToMarkdown(editor);
    }

    it("preserves an unchecked `- [ ]` task as a checklist block", async () => {
        const parsed = await markdownToBlocks(editor, "- [ ] todo item\n");
        const taskBlock = parsed.find(
            (b: { type?: string }) => b.type === "checkListItem",
        );
        expect(taskBlock).toBeDefined();
        expect(
            (taskBlock as { props?: { checked?: boolean } })?.props?.checked,
        ).toBe(false);

        const out = await roundTrip("- [ ] todo item\n");
        // Lossy serialiser may emit `*` / `-` and either capitalisation
        // of `x`; accept the canonical GFM forms.
        expect(out).toMatch(/[-*]\s*\[ \]\s+todo item/);
    });

    it("preserves a checked `- [x] done` task with the checked prop set", async () => {
        const parsed = await markdownToBlocks(editor, "- [x] done item\n");
        const taskBlock = parsed.find(
            (b: { type?: string }) => b.type === "checkListItem",
        );
        expect(taskBlock).toBeDefined();
        expect(
            (taskBlock as { props?: { checked?: boolean } })?.props?.checked,
        ).toBe(true);

        const out = await roundTrip("- [x] done item\n");
        expect(out).toMatch(/[-*]\s*\[[xX]\]\s+done item/);
    });

    it("round-trips a mixed checklist with both states", async () => {
        const input = "- [ ] todo\n- [x] done\n- [ ] another\n";
        const out = await roundTrip(input);
        expect(out).toMatch(/[-*]\s*\[ \]\s+todo/);
        expect(out).toMatch(/[-*]\s*\[[xX]\]\s+done/);
        expect(out).toMatch(/[-*]\s*\[ \]\s+another/);
    });
});
