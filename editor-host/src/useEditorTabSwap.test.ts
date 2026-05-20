import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    createTabSwapStateMap,
    DEFAULT_TAB_STATE_LRU_SIZE,
    signalEditorTabSwapped,
    TAB_SWAP_EVENT_NAME,
    useEditorTabSwap,
    type TabSwapSnapshot,
} from "./useEditorTabSwap.ts";

// ---------------------------------------------------------------------------
// useEditorTabSwap — editor-host port
// ---------------------------------------------------------------------------
//
// The React reference's tests exercise BlockNote parsing, frontmatter
// preservation, and parsed-block caching — all of which live above the
// bridge boundary in the native app.  These tests pin the *bridge-side
// contract*: snapshot capture/restore, LRU bookkeeping, the swap
// signal, and the no-op cases that the editor-host wiring relies on.

function makeSnapshot(scrollTop: number): TabSwapSnapshot {
    return { anchor: scrollTop, head: scrollTop, scrollTop };
}

describe("createTabSwapStateMap", () => {
    it("returns the latest snapshot per id", () => {
        const map = createTabSwapStateMap();
        map.set(1, makeSnapshot(10));
        map.set(1, makeSnapshot(20));
        expect(map.get(1)).toEqual({ anchor: 20, head: 20, scrollTop: 20 });
    });

    it("returns undefined for unseen ids", () => {
        const map = createTabSwapStateMap();
        expect(map.get(42)).toBeUndefined();
    });

    it("drop removes a snapshot and returns whether it existed", () => {
        const map = createTabSwapStateMap();
        map.set(7, makeSnapshot(1));
        expect(map.drop(7)).toBe(true);
        expect(map.drop(7)).toBe(false);
        expect(map.get(7)).toBeUndefined();
    });

    it("enforces the LRU capacity by evicting the oldest entry", () => {
        const map = createTabSwapStateMap(3);
        map.set(1, makeSnapshot(1));
        map.set(2, makeSnapshot(2));
        map.set(3, makeSnapshot(3));
        map.set(4, makeSnapshot(4));

        expect(map.size()).toBe(3);
        expect(map.get(1)).toBeUndefined();
        expect(map.get(2)).toBeDefined();
        expect(map.get(4)).toBeDefined();
    });

    it("re-getting an entry bumps it to the most recently used slot", () => {
        const map = createTabSwapStateMap(3);
        map.set(1, makeSnapshot(1));
        map.set(2, makeSnapshot(2));
        map.set(3, makeSnapshot(3));
        // Touch entry 1 — now 2 is the oldest.
        map.get(1);
        map.set(4, makeSnapshot(4));

        expect(map.get(1)).toBeDefined();
        expect(map.get(2)).toBeUndefined();
        expect(map.get(4)).toBeDefined();
    });

    it("rejects non-positive capacity", () => {
        expect(() => createTabSwapStateMap(0)).toThrow(/capacity/);
        expect(() => createTabSwapStateMap(-1)).toThrow(/capacity/);
    });
});

describe("signalEditorTabSwapped", () => {
    it("dispatches the React-reference-compatible custom event", () => {
        const handler = vi.fn();
        window.addEventListener(TAB_SWAP_EVENT_NAME, handler as EventListener);
        signalEditorTabSwapped(99);
        window.removeEventListener(TAB_SWAP_EVENT_NAME, handler as EventListener);

        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0]?.[0] as CustomEvent;
        expect(event.detail).toEqual({ path: "99", id: 99 });
    });
});

describe("useEditorTabSwap", () => {
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        rafCallbacks = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function flushFrames() {
        act(() => {
            const drained = rafCallbacks.splice(0);
            drained.forEach((cb) => cb(0));
        });
    }

    it("captures the outgoing snapshot on swap", () => {
        const activeIdRef = { current: 1 as number | null };
        const captureSnapshot = vi.fn().mockReturnValue(makeSnapshot(42));
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        act(() => {
            result.current.recordSwap(2);
        });

        expect(captureSnapshot).toHaveBeenCalledWith(1);
        expect(result.current.getSnapshot(1)).toEqual(makeSnapshot(42));
    });

    it("restores the stashed snapshot when re-opening a known note", () => {
        const activeIdRef = { current: null as number | null };
        const captureSnapshot = vi.fn().mockReturnValue(makeSnapshot(7));
        const restoreSnapshot = vi.fn();
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot, restoreSnapshot }),
        );

        // Open #1, edit, then swap to #2 (which captures #1).
        activeIdRef.current = 1;
        act(() => {
            result.current.recordSwap(2);
        });
        flushFrames();

        // Now swap back to #1 — the restore must run with the stashed
        // snapshot.
        activeIdRef.current = 2;
        act(() => {
            result.current.recordSwap(1);
        });
        flushFrames();

        expect(restoreSnapshot).toHaveBeenCalledWith(1, makeSnapshot(7));
    });

    it("does not capture when the swap is a no-op (same id)", () => {
        const activeIdRef = { current: 5 as number | null };
        const captureSnapshot = vi.fn();
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        act(() => {
            result.current.recordSwap(5);
        });

        expect(captureSnapshot).not.toHaveBeenCalled();
    });

    it("does not capture when there is no outgoing id (first open)", () => {
        const activeIdRef = { current: null as number | null };
        const captureSnapshot = vi.fn();
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        act(() => {
            result.current.recordSwap(3);
        });

        expect(captureSnapshot).not.toHaveBeenCalled();
    });

    it("dispatches the swap signal on the next animation frame", () => {
        const activeIdRef = { current: 1 as number | null };
        const swapEvents: CustomEvent[] = [];
        const handler = (e: Event) => swapEvents.push(e as CustomEvent);
        window.addEventListener(TAB_SWAP_EVENT_NAME, handler);
        const { result } = renderHook(() => useEditorTabSwap({ activeIdRef }));

        act(() => {
            result.current.recordSwap(2);
        });
        expect(swapEvents).toHaveLength(0);

        flushFrames();
        expect(swapEvents).toHaveLength(1);
        expect(swapEvents[0]?.detail).toEqual({ path: "2", id: 2 });

        window.removeEventListener(TAB_SWAP_EVENT_NAME, handler);
    });

    it("skips capture when the callback returns null", () => {
        const activeIdRef = { current: 1 as number | null };
        const captureSnapshot = vi.fn().mockReturnValue(null);
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        act(() => {
            result.current.recordSwap(2);
        });

        expect(captureSnapshot).toHaveBeenCalledWith(1);
        expect(result.current.getSnapshot(1)).toBeUndefined();
    });

    it("dropSnapshot invalidates the stored entry", () => {
        const activeIdRef = { current: 1 as number | null };
        const captureSnapshot = vi.fn().mockReturnValue(makeSnapshot(11));
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        act(() => {
            result.current.recordSwap(2);
        });
        expect(result.current.dropSnapshot(1)).toBe(true);
        expect(result.current.getSnapshot(1)).toBeUndefined();
        expect(result.current.dropSnapshot(1)).toBe(false);
    });

    it("respects the default LRU capacity", () => {
        const activeIdRef = { current: null as number | null };
        const captureSnapshot = vi.fn().mockImplementation((id: number) => makeSnapshot(id));
        const { result } = renderHook(() =>
            useEditorTabSwap({ activeIdRef, captureSnapshot }),
        );

        // Push DEFAULT_TAB_STATE_LRU_SIZE + 1 swaps through the hook.
        for (let i = 0; i <= DEFAULT_TAB_STATE_LRU_SIZE; i += 1) {
            activeIdRef.current = i;
            act(() => result.current.recordSwap(i + 10_000));
        }

        expect(result.current.stateMap.size()).toBe(DEFAULT_TAB_STATE_LRU_SIZE);
        // The first-recorded id (0) must have aged out.
        expect(result.current.getSnapshot(0)).toBeUndefined();
    });

    it("recordSwap is callable without window.requestAnimationFrame", () => {
        const ogRaf = window.requestAnimationFrame;
        // Simulate environments (SSR snapshot) where rAF is missing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
        (window as any).requestAnimationFrame = undefined;
        try {
            const activeIdRef = { current: 1 as number | null };
            const captureSnapshot = vi.fn().mockReturnValue(makeSnapshot(1));
            const restoreSnapshot = vi.fn();
            const { result } = renderHook(() =>
                useEditorTabSwap({ activeIdRef, captureSnapshot, restoreSnapshot }),
            );

            act(() => {
                result.current.recordSwap(2);
            });

            // Without rAF the signal/restore fires synchronously.  No
            // restore on this swap because nothing was stashed for #2.
            expect(restoreSnapshot).not.toHaveBeenCalled();
        } finally {
            window.requestAnimationFrame = ogRaf;
        }
    });
});
