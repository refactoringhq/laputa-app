import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AUTO_SAVE_DEBOUNCE_MS, useEditorSave } from "./useEditorSave.ts";

// ---------------------------------------------------------------------------
// useEditorSave — editor-host port
// ---------------------------------------------------------------------------
//
// The React reference's tests bake in Tauri vault invocation,
// `setTabs` / `setToastMessage` callbacks, and frontmatter-aware path
// resolution.  None of that machinery exists in the editor-host: saves
// fire as bridge `FromHost::Save { id, body }` envelopes.  These tests
// therefore exercise the *behavioural contract* shared with the React
// reference — debounce, dedup, immediate flush, cleanup, error path —
// using a `persistSave` stub instead of a Tauri mock.

describe("useEditorSave", () => {
    let persistSave: ReturnType<typeof vi.fn>;
    let onAfterSave: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        persistSave = vi.fn().mockResolvedValue(undefined);
        onAfterSave = vi.fn();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function renderSaveHook(options?: Partial<Parameters<typeof useEditorSave>[0]>) {
        return renderHook(() =>
            useEditorSave({
                persistSave,
                onAfterSave,
                ...options,
            }),
        );
    }

    it("handleSave returns false when no pending content", async () => {
        const { result } = renderSaveHook();

        let saved: boolean | undefined;
        await act(async () => {
            saved = await result.current.handleSave();
        });

        expect(saved).toBe(false);
        expect(persistSave).not.toHaveBeenCalled();
        expect(onAfterSave).not.toHaveBeenCalled();
    });

    it("handleSave persists pending content and returns true", async () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(7, "hello world");
        });

        let saved: boolean | undefined;
        await act(async () => {
            saved = await result.current.handleSave();
        });

        expect(saved).toBe(true);
        expect(persistSave).toHaveBeenCalledWith(7, "hello world");
        expect(onAfterSave).toHaveBeenCalledTimes(1);

        // Second save is a no-op (pending slot drained).
        await act(async () => {
            saved = await result.current.handleSave();
        });
        expect(saved).toBe(false);
        expect(persistSave).toHaveBeenCalledTimes(1);
    });

    it("debounces auto-save and fires after the configured idle window", async () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(1, "draft");
        });

        // Within the debounce window — nothing fires yet.
        await act(async () => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1);
        });
        expect(persistSave).not.toHaveBeenCalled();

        // Crossing the window flushes the pending body.
        await act(async () => {
            vi.advanceTimersByTime(1);
            // Drain the microtask the timer enqueues.
            await Promise.resolve();
        });
        expect(persistSave).toHaveBeenCalledWith(1, "draft");
    });

    it("coalesces rapid edits into one auto-save firing the latest body", async () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(4, "v1");
            vi.advanceTimersByTime(50);
            result.current.handleContentChange(4, "v2");
            vi.advanceTimersByTime(50);
            result.current.handleContentChange(4, "v3");
        });
        expect(persistSave).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS);
            await Promise.resolve();
        });

        expect(persistSave).toHaveBeenCalledTimes(1);
        expect(persistSave).toHaveBeenCalledWith(4, "v3");
    });

    it("Cmd+S flushes immediately and cancels the armed auto-save", async () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(2, "buf");
        });

        await act(async () => {
            await result.current.handleSave();
        });
        expect(persistSave).toHaveBeenCalledTimes(1);

        // The previously-armed auto-save must not double-fire.
        await act(async () => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS * 2);
            await Promise.resolve();
        });
        expect(persistSave).toHaveBeenCalledTimes(1);
    });

    it("savePendingForId only flushes when the pending id matches", async () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(99, "abc");
        });

        let saved: boolean | undefined;
        await act(async () => {
            saved = await result.current.savePendingForId(1);
        });
        expect(saved).toBe(false);
        expect(persistSave).not.toHaveBeenCalled();

        await act(async () => {
            saved = await result.current.savePendingForId(99);
        });
        expect(saved).toBe(true);
        expect(persistSave).toHaveBeenCalledWith(99, "abc");
    });

    it("does not re-arm the timer when the same body is recorded twice", () => {
        const { result } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(3, "same");
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 100);
        });
        act(() => {
            // No-op — the existing timer keeps counting.
            result.current.handleContentChange(3, "same");
        });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        // The (re-armed-vs-not) distinction matters: if the second
        // identical change reset the timer we'd still be 100ms shy of
        // firing.  Since we didn't reset, the persist call has landed.
        expect(persistSave).toHaveBeenCalledTimes(1);
        expect(persistSave).toHaveBeenCalledWith(3, "same");
    });

    it("logs and recovers when auto-save throws", async () => {
        const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
        persistSave.mockRejectedValueOnce(new Error("network down"));

        const { result } = renderSaveHook();
        act(() => {
            result.current.handleContentChange(5, "body");
        });
        await act(async () => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS);
            // Two microtasks: timer body → flush → rejected promise.
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(consoleErr).toHaveBeenCalled();
        expect(onAfterSave).not.toHaveBeenCalled();
    });

    it("cancels armed auto-save on unmount", async () => {
        const { result, unmount } = renderSaveHook();

        act(() => {
            result.current.handleContentChange(8, "body");
        });
        unmount();

        await act(async () => {
            vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS * 2);
            await Promise.resolve();
        });
        expect(persistSave).not.toHaveBeenCalled();
    });

    it("respects a custom debounce window", async () => {
        const { result } = renderSaveHook({ autoSaveDebounceMs: 50 });

        act(() => {
            result.current.handleContentChange(11, "fast");
        });

        await act(async () => {
            vi.advanceTimersByTime(49);
        });
        expect(persistSave).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
        });
        expect(persistSave).toHaveBeenCalledWith(11, "fast");
    });
});
