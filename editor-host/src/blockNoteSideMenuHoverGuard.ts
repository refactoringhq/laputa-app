import { useEffect, type RefObject } from "react";

// ---------------------------------------------------------------------------
// Side-menu hover guard (Phase 8.25)
// ---------------------------------------------------------------------------
//
// BlockNote's default side menu attaches to the *currently hovered* block,
// and a stock mousemove listener flickers the highlight as the pointer
// crosses the narrow gutter between the block and the floating handle.
//
// This guard suppresses hover updates whose pointer position falls within
// the "bridge" rectangle that spans the editor's left edge and the side
// menu's right edge — exactly the dead zone where flicker happens.
//
// Ported verbatim from the React-era `src/components/
// blockNoteSideMenuHoverGuard.ts` with type adjustments only.

type RectLike = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

const HOVER_BRIDGE_PADDING_X = 8;
const HOVER_BRIDGE_PADDING_Y = 6;

function isVisibleRect(rect: RectLike) {
    return rect.right > rect.left && rect.bottom > rect.top;
}

/** Pure rectangle math — exposed so the unit test suite can drive it
 *  without spinning up a DOM. */
export function isWithinBlockNoteHandleHoverBridge(
    point: { x: number; y: number },
    editorRect: RectLike,
    sideMenuRect: RectLike,
): boolean {
    if (!isVisibleRect(editorRect) || !isVisibleRect(sideMenuRect)) return false;

    const left = Math.min(editorRect.left, sideMenuRect.left) - HOVER_BRIDGE_PADDING_X;
    const right = Math.max(editorRect.left, sideMenuRect.right) + HOVER_BRIDGE_PADDING_X;
    const top = sideMenuRect.top - HOVER_BRIDGE_PADDING_Y;
    const bottom = sideMenuRect.bottom + HOVER_BRIDGE_PADDING_Y;

    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

/** Decide whether to stop a `mousemove` from reaching BlockNote's
 *  side-menu hover update.  Returns `true` for events inside the bridge
 *  band or over the menu itself; `false` for unrelated movement and for
 *  in-flight drag gestures (`hasPressedButton`). */
export function shouldSuppressBlockNoteHandleHoverUpdate({
    eventTarget,
    point,
    container,
    doc,
    hasPressedButton = false,
}: {
    eventTarget: EventTarget | null;
    point: { x: number; y: number };
    container: HTMLElement | null;
    doc: Document;
    hasPressedButton?: boolean;
}): boolean {
    if (hasPressedButton) return false;
    if (!container) return false;

    const editor = container.querySelector(".bn-editor");
    if (!(editor instanceof HTMLElement)) return false;

    if (eventTarget instanceof Element && eventTarget.closest(".bn-side-menu")) {
        return true;
    }

    const sideMenu = doc.querySelector(".bn-side-menu");
    if (!(sideMenu instanceof HTMLElement)) return false;

    return isWithinBlockNoteHandleHoverBridge(
        point,
        editor.getBoundingClientRect(),
        sideMenu.getBoundingClientRect(),
    );
}

/** React hook that wires the guard onto the container's owning window.
 *  Returns nothing; the cleanup function is registered on the `useEffect`
 *  return so listener teardown follows component lifecycle. */
export function useBlockNoteSideMenuHoverGuard(
    containerRef: RefObject<HTMLElement | null>,
): void {
    useEffect(() => {
        const doc = containerRef.current?.ownerDocument;
        const view = doc?.defaultView;
        if (!doc || !view) return;

        const handleMouseMove = (event: MouseEvent) => {
            if (
                !shouldSuppressBlockNoteHandleHoverUpdate({
                    eventTarget: event.target,
                    point: { x: event.clientX, y: event.clientY },
                    container: containerRef.current,
                    doc,
                    hasPressedButton: event.buttons !== 0,
                })
            ) {
                return;
            }

            event.stopPropagation();
        };

        view.addEventListener("mousemove", handleMouseMove, true);
        return () => view.removeEventListener("mousemove", handleMouseMove, true);
    }, [containerRef]);
}
