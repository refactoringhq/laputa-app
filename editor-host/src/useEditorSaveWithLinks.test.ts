import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorSaveWithLinks } from "./useEditorSaveWithLinks.ts";

// ---------------------------------------------------------------------------
// useEditorSaveWithLinks — editor-host stub
// ---------------------------------------------------------------------------
//
// The React reference exercises wikilink extraction + frontmatter sync.
// The editor-host doesn't own the vault graph and no rename-ripple
// bridge envelope exists yet (audit in `useEditorSaveWithLinks.ts`), so
// the tests pin the *seam* that the future bridge wiring will hang
// off: every successful save must invoke `onLinksChanged` exactly once
// with the persisted `(id, body)`.

describe("useEditorSaveWithLinks", () => {
    let persistSave: ReturnType<typeof vi.fn>;
    let onLinksChanged: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        persistSave = vi.fn().mockResolvedValue(undefined);
        onLinksChanged = vi.fn();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("invokes onLinksChanged after a Cmd+S flush", async () => {
        const { result } = renderHook(() =>
            useEditorSaveWithLinks({ persistSave, onLinksChanged }),
        );

        act(() => {
            result.current.handleContentChange(7, "# Hello [[Other]]");
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(persistSave).toHaveBeenCalledWith(7, "# Hello [[Other]]");
        expect(onLinksChanged).toHaveBeenCalledTimes(1);
        expect(onLinksChanged).toHaveBeenCalledWith({
            id: 7,
            body: "# Hello [[Other]]",
            links: null,
        });
    });

    it("invokes onLinksChanged after a debounced auto-save", async () => {
        const { result } = renderHook(() =>
            useEditorSaveWithLinks({ persistSave, onLinksChanged }),
        );

        act(() => {
            result.current.handleContentChange(2, "draft");
        });
        await act(async () => {
            vi.advanceTimersByTime(2_000);
            await Promise.resolve();
        });

        expect(persistSave).toHaveBeenCalledWith(2, "draft");
        expect(onLinksChanged).toHaveBeenCalledWith({
            id: 2,
            body: "draft",
            links: null,
        });
    });

    it("does not fire onLinksChanged when nothing was pending", async () => {
        const { result } = renderHook(() =>
            useEditorSaveWithLinks({ persistSave, onLinksChanged }),
        );

        await act(async () => {
            await result.current.handleSave();
        });

        expect(persistSave).not.toHaveBeenCalled();
        expect(onLinksChanged).not.toHaveBeenCalled();
    });

    it("does not fire onLinksChanged when persistSave rejects", async () => {
        persistSave.mockRejectedValueOnce(new Error("disk full"));
        const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
        const { result } = renderHook(() =>
            useEditorSaveWithLinks({ persistSave, onLinksChanged }),
        );

        act(() => {
            result.current.handleContentChange(3, "body");
        });
        await act(async () => {
            vi.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(persistSave).toHaveBeenCalled();
        expect(onLinksChanged).not.toHaveBeenCalled();
        expect(consoleErr).toHaveBeenCalled();
    });

    it("delegates the savePendingForId surface from useEditorSave", async () => {
        const { result } = renderHook(() =>
            useEditorSaveWithLinks({ persistSave, onLinksChanged }),
        );

        act(() => {
            result.current.handleContentChange(11, "fragment");
        });
        await act(async () => {
            await result.current.savePendingForId(11);
        });

        expect(persistSave).toHaveBeenCalledWith(11, "fragment");
        expect(onLinksChanged).toHaveBeenCalledTimes(1);
    });
});
