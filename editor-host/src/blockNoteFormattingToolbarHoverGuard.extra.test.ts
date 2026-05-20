import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    isWithinFormattingToolbarHoverBridge,
    shouldSuppressFormattingToolbarHoverUpdate,
    useBlockNoteFormattingToolbarHoverGuard,
} from "./blockNoteFormattingToolbarHoverGuard.ts";

// Ported from `src/components/blockNoteFormattingToolbarHoverGuard.extra.test.ts`
// (Phase 8.25).  Adjustments: import path + `.ts` extensions, plus the
// `rerender` initial props are typed explicitly so the editor-host
// strict `noUncheckedIndexedAccess` build doesn't widen them to never.

function rect(left: number, top: number, width: number, height: number) {
    return DOMRect.fromRect({ x: left, y: top, width, height });
}

function setRect(element: HTMLElement, nextRect: DOMRect) {
    element.getBoundingClientRect = () => nextRect;
}

function setupHoverDom() {
    const container = document.createElement("div");
    const block = document.createElement("div");
    block.className = "bn-block";
    block.dataset.id = "image-block";
    const fileBlock = document.createElement("div");
    fileBlock.dataset.fileBlock = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "bn-visual-media-wrapper";
    fileBlock.appendChild(wrapper);
    block.appendChild(fileBlock);
    container.appendChild(block);
    document.body.appendChild(container);

    const toolbar = document.createElement("div");
    toolbar.className = "bn-formatting-toolbar";
    document.body.appendChild(toolbar);

    setRect(wrapper, rect(300, 130, 140, 90));
    setRect(toolbar, rect(322, 78, 96, 24));

    return { container, toolbar };
}

function createEditor(options: {
    selectionType?: string | null;
    selectionId?: string;
    cursorType?: string;
    cursorId?: string;
    setTextCursorPosition?: ReturnType<typeof vi.fn>;
}) {
    const {
        selectionType = "paragraph",
        selectionId = "other-block",
        cursorType = "paragraph",
        cursorId = "cursor-block",
        setTextCursorPosition = vi.fn(),
    } = options;

    return {
        getSelection: () =>
            selectionType
                ? { blocks: [{ type: selectionType, id: selectionId }] }
                : null,
        getTextCursorPosition: () => ({ block: { type: cursorType, id: cursorId } }),
        setTextCursorPosition,
    };
}

function dispatchBridgeMousemove(target: EventTarget = document.body) {
    const event = new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 368,
        clientY: 104,
    });
    Object.defineProperty(event, "target", { configurable: true, value: target });
    const stopPropagation = vi.fn();
    event.stopPropagation = stopPropagation;
    act(() => {
        window.dispatchEvent(event);
    });
    return stopPropagation;
}

describe("blockNoteFormattingToolbarHoverGuard extra coverage", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("treats invisible rects and missing bridge inputs as non-suppressing", () => {
        expect(
            isWithinFormattingToolbarHoverBridge(
                { x: 12, y: 12 },
                rect(10, 10, 0, 20),
                rect(10, 10, 20, 20),
            ),
        ).toBe(false);

        expect(
            shouldSuppressFormattingToolbarHoverUpdate({
                eventTarget: document.body,
                point: { x: 12, y: 12 },
                container: null,
                doc: document,
                selectedFileBlockId: "image-block",
            }),
        ).toBe(false);
    });

    it("remembers the last selected file block while open and clears it when closed", () => {
        const addSpy = vi.spyOn(window, "addEventListener");
        const removeSpy = vi.spyOn(window, "removeEventListener");
        const { container } = setupHoverDom();
        const setTextCursorPosition = vi.fn();
        const editor = createEditor({ setTextCursorPosition });

        const { rerender, unmount } = renderHook(
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

        expect(addSpy).toHaveBeenCalledWith(
            "mousemove",
            expect.any(Function),
            true,
        );

        rerender({ selectedFileBlockId: null, isOpen: true });
        const stopPropagation = dispatchBridgeMousemove();

        expect(setTextCursorPosition).toHaveBeenCalledWith("image-block");
        expect(stopPropagation).toHaveBeenCalledTimes(1);

        rerender({ selectedFileBlockId: null, isOpen: false });
        rerender({ selectedFileBlockId: null, isOpen: true });
        dispatchBridgeMousemove();

        expect(setTextCursorPosition).toHaveBeenCalledTimes(1);

        unmount();
        expect(removeSpy).toHaveBeenCalledWith(
            "mousemove",
            expect.any(Function),
            true,
        );
    });

    it("skips listener setup when the environment is invalid and safely ignores already-active or failing restores", () => {
        const addSpy = vi.spyOn(window, "addEventListener");
        const { container } = setupHoverDom();
        const alreadySelectedEditor = createEditor({
            selectionType: null,
            cursorType: "image",
            cursorId: "image-block",
            setTextCursorPosition: vi.fn(),
        });

        renderHook(() =>
            useBlockNoteFormattingToolbarHoverGuard({
                editor: alreadySelectedEditor as never,
                container: null,
                selectedFileBlockId: "image-block",
                isOpen: true,
            }),
        );

        expect(addSpy).not.toHaveBeenCalled();

        const { unmount } = renderHook(() =>
            useBlockNoteFormattingToolbarHoverGuard({
                editor: alreadySelectedEditor as never,
                container,
                selectedFileBlockId: "image-block",
                isOpen: true,
            }),
        );

        dispatchBridgeMousemove();
        expect(alreadySelectedEditor.setTextCursorPosition).not.toHaveBeenCalled();

        unmount();

        const throwingEditor = createEditor({
            selectionType: null,
            cursorType: "paragraph",
            cursorId: "other-block",
            setTextCursorPosition: vi.fn(() => {
                throw new Error("gone");
            }),
        });

        renderHook(() =>
            useBlockNoteFormattingToolbarHoverGuard({
                editor: throwingEditor as never,
                container,
                selectedFileBlockId: "image-block",
                isOpen: true,
            }),
        );

        expect(() => dispatchBridgeMousemove()).not.toThrow();
    });
});
