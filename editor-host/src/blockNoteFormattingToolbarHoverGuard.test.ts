import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
    isWithinFormattingToolbarHoverBridge,
    shouldSuppressFormattingToolbarHoverUpdate,
    useBlockNoteFormattingToolbarHoverGuard,
} from "./blockNoteFormattingToolbarHoverGuard.ts";

// Ported from `src/components/blockNoteFormattingToolbarHoverGuard.test.ts`
// (Phase 8.25).  Adjustment: import path and `.ts` extensions; the test
// logic exercises the same bridge geometry, the same fallback selectors,
// and the same restore-on-stale behavior.

function rect(left: number, top: number, width: number, height: number) {
    return DOMRect.fromRect({ x: left, y: top, width, height });
}

function setRect(element: HTMLElement, nextRect: DOMRect) {
    element.getBoundingClientRect = () => nextRect;
}

function appendFileBlock({
    container,
    blockId,
    innerClass,
}: {
    container: HTMLElement;
    blockId: string;
    innerClass: string;
}) {
    const block = document.createElement("div");
    block.className = "bn-block";
    block.dataset.id = blockId;

    const fileBlock = document.createElement("div");
    fileBlock.dataset.fileBlock = "true";

    const inner = document.createElement("div");
    inner.className = innerClass;
    fileBlock.appendChild(inner);
    block.appendChild(fileBlock);
    container.appendChild(block);

    return inner;
}

function createToolbarHoverScenario(withToolbarButton = false) {
    const container = document.createElement("div");
    const block = document.createElement("div");
    block.className = "bn-block";
    block.dataset.id = "image-block";

    const fileBlock = document.createElement("div");
    fileBlock.dataset.fileBlock = "true";
    block.appendChild(fileBlock);
    container.appendChild(block);
    document.body.appendChild(container);

    const toolbar = document.createElement("div");
    toolbar.className = "bn-formatting-toolbar";
    const toolbarButton = withToolbarButton
        ? document.createElement("button")
        : null;
    if (toolbarButton) toolbar.appendChild(toolbarButton);
    document.body.appendChild(toolbar);

    setRect(fileBlock, rect(300, 130, 140, 90));
    setRect(toolbar, rect(322, 78, 96, 24));

    return { container, toolbarButton };
}

function makeEditor(overrides: Record<string, unknown> = {}) {
    return {
        getSelection: vi.fn(() => null),
        getTextCursorPosition: vi.fn(() => ({
            block: { id: "paragraph-block", type: "paragraph" },
        })),
        setTextCursorPosition: vi.fn(),
        ...overrides,
    };
}

describe("blockNoteFormattingToolbarHoverGuard", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("treats the gap between the selected image block and toolbar as part of the hover bridge", () => {
        expect(
            isWithinFormattingToolbarHoverBridge(
                { x: 368, y: 104 },
                rect(300, 130, 140, 90),
                rect(322, 78, 96, 24),
            ),
        ).toBe(true);
    });

    it("ignores invisible rectangles and missing hover bridge context", () => {
        expect(
            isWithinFormattingToolbarHoverBridge(
                { x: 10, y: 10 },
                rect(300, 130, 0, 90),
                rect(322, 78, 96, 24),
            ),
        ).toBe(false);

        expect(
            shouldSuppressFormattingToolbarHoverUpdate({
                eventTarget: document.body,
                point: { x: 350, y: 90 },
                container: null,
                doc: document,
                selectedFileBlockId: "image-block",
            }),
        ).toBe(false);

        expect(
            shouldSuppressFormattingToolbarHoverUpdate({
                eventTarget: document.body,
                point: { x: 350, y: 90 },
                container: document.createElement("div"),
                doc: document,
                selectedFileBlockId: null,
            }),
        ).toBe(false);
    });

    it.each([
        {
            name: "suppresses hover updates when the pointer is already over the toolbar",
            point: { x: 350, y: 90 },
            eventTarget: "toolbarButton",
            expected: true,
            withToolbarButton: true,
        },
        {
            name: "suppresses hover updates while the pointer crosses the image-toolbar bridge",
            point: { x: 368, y: 104 },
            eventTarget: "body",
            expected: true,
            withToolbarButton: false,
        },
        {
            name: "leaves unrelated pointer movement alone",
            point: { x: 520, y: 220 },
            eventTarget: "body",
            expected: false,
            withToolbarButton: false,
        },
    ])("$name", ({ point, eventTarget, expected, withToolbarButton }) => {
        const { container, toolbarButton } = createToolbarHoverScenario(
            withToolbarButton,
        );
        const target = eventTarget === "toolbarButton"
            ? toolbarButton
            : document.body;

        expect(
            shouldSuppressFormattingToolbarHoverUpdate({
                eventTarget: target as EventTarget,
                point,
                container,
                doc: document,
                selectedFileBlockId: "image-block",
            }),
        ).toBe(expected);
    });

    it("uses the filename bridge fallback and restores the last selected file block while the toolbar stays open", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const bridge = appendFileBlock({
            container,
            blockId: "image-block",
            innerClass: "bn-file-name-with-icon",
        });

        const toolbar = document.createElement("div");
        toolbar.className = "bn-formatting-toolbar";
        document.body.appendChild(toolbar);

        setRect(bridge, rect(300, 130, 140, 90));
        setRect(toolbar, rect(322, 78, 96, 24));

        const editor = makeEditor();

        const { rerender } = renderHook(
            ({ selectedFileBlockId, isOpen }) =>
                useBlockNoteFormattingToolbarHoverGuard({
                    editor: editor as never,
                    container,
                    selectedFileBlockId,
                    isOpen,
                }),
            {
                initialProps: { selectedFileBlockId: "image-block", isOpen: true } as {
                    selectedFileBlockId: string | null;
                    isOpen: boolean;
                },
            },
        );

        rerender({ selectedFileBlockId: null, isOpen: true });

        window.dispatchEvent(
            new MouseEvent("mousemove", {
                clientX: 368,
                clientY: 104,
                bubbles: true,
            }),
        );

        expect(editor.setTextCursorPosition).toHaveBeenCalledWith("image-block");

        vi.mocked(editor.setTextCursorPosition).mockClear();
        rerender({ selectedFileBlockId: null, isOpen: false });
        rerender({ selectedFileBlockId: null, isOpen: true });

        window.dispatchEvent(
            new MouseEvent("mousemove", {
                clientX: 368,
                clientY: 104,
                bubbles: true,
            }),
        );

        expect(editor.setTextCursorPosition).not.toHaveBeenCalled();
    });

    it("uses the add-file-button fallback and swallows restore errors when the block disappears", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const bridge = appendFileBlock({
            container,
            blockId: "image-block",
            innerClass: "bn-add-file-button",
        });

        const toolbar = document.createElement("div");
        toolbar.className = "bn-formatting-toolbar";
        document.body.appendChild(toolbar);

        setRect(bridge, rect(300, 130, 140, 90));
        setRect(toolbar, rect(322, 78, 96, 24));

        const editor = makeEditor({
            setTextCursorPosition: vi.fn(() => {
                throw new Error("gone");
            }),
        });

        const { rerender } = renderHook(
            ({ selectedFileBlockId, isOpen }) =>
                useBlockNoteFormattingToolbarHoverGuard({
                    editor: editor as never,
                    container,
                    selectedFileBlockId,
                    isOpen,
                }),
            {
                initialProps: { selectedFileBlockId: "image-block", isOpen: true } as {
                    selectedFileBlockId: string | null;
                    isOpen: boolean;
                },
            },
        );

        rerender({ selectedFileBlockId: null, isOpen: true });

        expect(() => {
            window.dispatchEvent(
                new MouseEvent("mousemove", {
                    clientX: 368,
                    clientY: 104,
                    bubbles: true,
                }),
            );
        }).not.toThrow();
    });

    it("leaves the cursor alone when the selected file block is already active", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const bridge = appendFileBlock({
            container,
            blockId: "image-block",
            innerClass: "bn-file-name-with-icon",
        });

        const toolbar = document.createElement("div");
        toolbar.className = "bn-formatting-toolbar";
        document.body.appendChild(toolbar);

        setRect(bridge, rect(300, 130, 140, 90));
        setRect(toolbar, rect(322, 78, 96, 24));

        const editor = makeEditor({
            getSelection: vi.fn(() => ({
                blocks: [{ id: "image-block", type: "image" }],
            })),
        });

        renderHook(() =>
            useBlockNoteFormattingToolbarHoverGuard({
                editor: editor as never,
                container,
                selectedFileBlockId: "image-block",
                isOpen: true,
            }),
        );

        window.dispatchEvent(
            new MouseEvent("mousemove", {
                clientX: 368,
                clientY: 104,
                bubbles: true,
            }),
        );

        expect(editor.setTextCursorPosition).not.toHaveBeenCalled();
    });
});
