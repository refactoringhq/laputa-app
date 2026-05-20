import type {
    BlockNoteEditor,
    BlockSchema,
    InlineContentSchema,
    StyleSchema,
} from "@blocknote/core";
import { useEffect, useRef, type RefObject } from "react";

// ---------------------------------------------------------------------------
// Formatting-toolbar hover guard (Phase 8.25)
// ---------------------------------------------------------------------------
//
// When a file block (image, audio, video, generic file) is selected the
// floating formatting toolbar hovers above it.  If the user mouses from
// the toolbar back down onto the image, the default BlockNote behavior
// briefly drops the selection — the toolbar disappears, then reappears,
// flickering across the hover bridge.  This guard suppresses those
// hover updates *and* re-pins the cursor onto the file block while the
// toolbar is open.
//
// Ported verbatim from the React-era `src/components/
// blockNoteFormattingToolbarHoverGuard.ts` — only the import paths and
// `.ts` extensions changed.

type RectLike = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

const HOVER_BRIDGE_PADDING_X = 8;
const HOVER_BRIDGE_PADDING_Y = 8;
const FORMATTING_TOOLBAR_FILE_BLOCK_TYPES = new Set([
    "audio",
    "file",
    "image",
    "video",
]);

function isVisibleRect(rect: RectLike) {
    return rect.right > rect.left && rect.bottom > rect.top;
}

function getSelectedFileBlockBridgeElement(
    container: HTMLElement,
    blockId: string,
) {
    const selectedBlock = container.querySelector<HTMLElement>(
        `.bn-block[data-id="${blockId}"]`,
    );

    if (!selectedBlock) return null;

    return (
        selectedBlock.querySelector<HTMLElement>(
            "[data-file-block] .bn-visual-media-wrapper",
        ) ??
        selectedBlock.querySelector<HTMLElement>(
            "[data-file-block] .bn-file-name-with-icon",
        ) ??
        selectedBlock.querySelector<HTMLElement>(
            "[data-file-block] .bn-add-file-button",
        ) ??
        selectedBlock.querySelector<HTMLElement>("[data-file-block]")
    );
}

/** Pure rectangle math — exposed so the unit test suite can drive it
 *  without spinning up a DOM. */
export function isWithinFormattingToolbarHoverBridge(
    point: { x: number; y: number },
    fileBlockRect: RectLike,
    toolbarRect: RectLike,
): boolean {
    if (!isVisibleRect(fileBlockRect) || !isVisibleRect(toolbarRect)) {
        return false;
    }

    const left =
        Math.min(fileBlockRect.left, toolbarRect.left) - HOVER_BRIDGE_PADDING_X;
    const right =
        Math.max(fileBlockRect.right, toolbarRect.right) + HOVER_BRIDGE_PADDING_X;
    const top = Math.min(fileBlockRect.top, toolbarRect.top) - HOVER_BRIDGE_PADDING_Y;
    const bottom =
        Math.max(fileBlockRect.bottom, toolbarRect.bottom) + HOVER_BRIDGE_PADDING_Y;

    return (
        point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    );
}

/** Decide whether to stop a `mousemove` from reaching BlockNote's
 *  formatting-toolbar hover update. */
export function shouldSuppressFormattingToolbarHoverUpdate({
    eventTarget,
    point,
    container,
    doc,
    selectedFileBlockId,
}: {
    eventTarget: EventTarget | null;
    point: { x: number; y: number };
    container: HTMLElement | null;
    doc: Document;
    selectedFileBlockId: string | null;
}): boolean {
    if (!container || !selectedFileBlockId) return false;

    if (
        eventTarget instanceof Element &&
        eventTarget.closest(".bn-formatting-toolbar")
    ) {
        return true;
    }

    const selectedFileBlock = getSelectedFileBlockBridgeElement(
        container,
        selectedFileBlockId,
    );
    const toolbar = doc.querySelector<HTMLElement>(".bn-formatting-toolbar");

    if (!selectedFileBlock || !toolbar) return false;

    return isWithinFormattingToolbarHoverBridge(
        point,
        selectedFileBlock.getBoundingClientRect(),
        toolbar.getBoundingClientRect(),
    );
}

function getActiveFormattingToolbarFileBlockId(
    editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
    let selectedBlock:
        | ReturnType<typeof editor.getTextCursorPosition>["block"]
        | null = null;

    try {
        selectedBlock = editor.getSelection()?.blocks[0] ?? null;
    } catch {
        selectedBlock = null;
    }

    if (!selectedBlock) {
        try {
            selectedBlock = editor.getTextCursorPosition().block;
        } catch {
            selectedBlock = null;
        }
    }

    if (!selectedBlock) return null;

    return FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(selectedBlock.type)
        ? selectedBlock.id
        : null;
}

function restoreFormattingToolbarFileBlockSelection(
    editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
    selectedFileBlockIdRef: RefObject<string | null>,
) {
    const selectedFileBlockId = selectedFileBlockIdRef.current;
    if (!selectedFileBlockId) return;
    if (getActiveFormattingToolbarFileBlockId(editor) === selectedFileBlockId) {
        return;
    }

    try {
        editor.setTextCursorPosition(selectedFileBlockId);
    } catch {
        // The file block may have been deleted or replaced while the
        // toolbar stayed open.  Swallow rather than crash the gesture.
    }
}

function useLastSelectedFormattingToolbarFileBlockId(
    selectedFileBlockId: string | null,
    isOpen: boolean,
) {
    const lastSelectedFileBlockIdRef = useRef<string | null>(selectedFileBlockId);

    useEffect(() => {
        if (selectedFileBlockId) {
            lastSelectedFileBlockIdRef.current = selectedFileBlockId;
            return;
        }

        if (!isOpen) {
            lastSelectedFileBlockIdRef.current = null;
        }
    }, [isOpen, selectedFileBlockId]);

    return lastSelectedFileBlockIdRef;
}

function getFormattingToolbarHoverGuardEnvironment(
    container: HTMLElement | null,
) {
    const doc = container?.ownerDocument;
    const view = doc?.defaultView;

    if (!container || !doc || !view) return null;

    return { container, doc, view };
}

function createFormattingToolbarHoverGuardHandler({
    editor,
    container,
    doc,
    selectedFileBlockIdRef,
}: {
    editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;
    container: HTMLElement;
    doc: Document;
    selectedFileBlockIdRef: RefObject<string | null>;
}) {
    return (event: MouseEvent) => {
        if (
            !shouldSuppressFormattingToolbarHoverUpdate({
                eventTarget: event.target,
                point: { x: event.clientX, y: event.clientY },
                container,
                doc,
                selectedFileBlockId: selectedFileBlockIdRef.current,
            })
        ) {
            return;
        }

        restoreFormattingToolbarFileBlockSelection(editor, selectedFileBlockIdRef);
        event.stopPropagation();
    };
}

/** React hook driving the formatting-toolbar hover guard.  Only attaches
 *  the mousemove listener while the toolbar is `isOpen`. */
export function useBlockNoteFormattingToolbarHoverGuard({
    editor,
    container,
    selectedFileBlockId,
    isOpen,
}: {
    editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;
    container: HTMLElement | null;
    selectedFileBlockId: string | null;
    isOpen: boolean;
}): void {
    const lastSelectedFileBlockIdRef = useLastSelectedFormattingToolbarFileBlockId(
        selectedFileBlockId,
        isOpen,
    );

    useEffect(() => {
        if (!isOpen) return;

        const environment = getFormattingToolbarHoverGuardEnvironment(container);
        if (!environment) return;

        const handleMouseMove = createFormattingToolbarHoverGuardHandler({
            editor,
            container: environment.container,
            doc: environment.doc,
            selectedFileBlockIdRef: lastSelectedFileBlockIdRef,
        });

        environment.view.addEventListener("mousemove", handleMouseMove, true);
        return () => {
            environment.view.removeEventListener("mousemove", handleMouseMove, true);
        };
    }, [container, editor, isOpen, lastSelectedFileBlockIdRef]);
}
