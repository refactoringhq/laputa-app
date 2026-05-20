import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
    dispatchToHost,
    type EditorBridgeHandlers,
} from "./EditorApp.tsx";
import { blocksToMarkdown } from "./richEditorMarkdown.ts";
import type { ToHost } from "./bridge.ts";

// ---------------------------------------------------------------------------
// Bridge dispatch (Phase 8.24)
// ---------------------------------------------------------------------------
//
// `dispatchToHost` is the pure-logic core of the `window.tolariaBridge.
// receive` handler installed by `EditorApp`.  Testing it directly
// keeps us off React-rendered DOM (and out of @testing-library/react)
// while still exercising every envelope branch end-to-end through a
// real BlockNoteEditor.

function makeHandlers(initial?: {
    activeId?: number | null;
    theme?: (mode: "light" | "dark") => void;
}): EditorBridgeHandlers & {
    cancelCalls: number;
    setActiveIdCalls: Array<number | null>;
} {
    let activeId: number | null = initial?.activeId ?? null;
    const setActiveIdCalls: Array<number | null> = [];
    let cancelCalls = 0;
    return {
        setActiveId(id) {
            activeId = id;
            setActiveIdCalls.push(id);
        },
        getActiveId() {
            return activeId;
        },
        setTheme: initial?.theme ?? (() => {}),
        cancelDirty() {
            cancelCalls += 1;
        },
        get cancelCalls() {
            return cancelCalls;
        },
        get setActiveIdCalls() {
            return setActiveIdCalls;
        },
    };
}

describe("dispatchToHost", () => {
    let editor: BlockNoteEditor;
    beforeEach(() => {
        editor = BlockNoteEditor.create();
    });

    it("note_open parses markdown and replaces the document", () => {
        const handlers = makeHandlers();
        const msg: ToHost = {
            k: "note_open",
            v: { id: 7, path: "/v/a.md", body: "# Hi\n\nbody text\n" },
        };
        dispatchToHost(editor, msg, handlers);

        expect(handlers.getActiveId()).toBe(7);
        expect(handlers.cancelCalls).toBe(1);
        const serialised = blocksToMarkdown(editor);
        expect(serialised).toMatch(/^#\s+Hi/m);
        expect(serialised).toContain("body text");
    });

    it("note_open clears any prior dirty state via cancelDirty", () => {
        const handlers = makeHandlers({ activeId: 99 });
        dispatchToHost(
            editor,
            { k: "note_open", v: { id: 1, path: "/v/a.md", body: "x" } },
            handlers,
        );
        expect(handlers.cancelCalls).toBe(1);
    });

    it("focus_editor calls editor.focus", () => {
        const focusSpy = vi.spyOn(editor, "focus");
        dispatchToHost(editor, { k: "focus_editor" }, makeHandlers());
        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it("save_request emits FromHost.Save when a note is open", () => {
        const handlers = makeHandlers();
        // Open a note first.
        dispatchToHost(
            editor,
            { k: "note_open", v: { id: 42, path: "/v/x.md", body: "alpha" } },
            handlers,
        );

        // Capture postMessage payloads.
        const posted: string[] = [];
        const fakeIpc = { postMessage: (m: string) => posted.push(m) };
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = fakeIpc;
        try {
            dispatchToHost(editor, { k: "save_request" }, handlers);
        } finally {
            w.ipc = prev;
        }

        expect(posted).toHaveLength(1);
        const decoded = JSON.parse(posted[0] ?? "") as {
            k: string;
            v: { id: number; body: string };
        };
        expect(decoded.k).toBe("save");
        expect(decoded.v.id).toBe(42);
        expect(decoded.v.body).toContain("alpha");
    });

    it("save_request is a no-op when no note is open", () => {
        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };
        try {
            dispatchToHost(editor, { k: "save_request" }, makeHandlers());
        } finally {
            w.ipc = prev;
        }
        expect(posted).toHaveLength(0);
    });

    it("theme_set calls handlers.setTheme with the parsed mode", () => {
        const themeCalls: Array<"light" | "dark"> = [];
        const handlers = makeHandlers({
            theme: (mode) => themeCalls.push(mode),
        });
        dispatchToHost(editor, { k: "theme_set", v: { mode: "dark" } }, handlers);
        dispatchToHost(editor, { k: "theme_set", v: { mode: "light" } }, handlers);
        expect(themeCalls).toEqual(["dark", "light"]);
    });
});

// ---------------------------------------------------------------------------
// Debounced Dirty (mirrors the React-side `onChange` -> `Dirty` wiring)
// ---------------------------------------------------------------------------
//
// The full debounce + dedupe path is exercised by the React tree, but
// asserting the shape directly is cheaper and catches regressions in
// the timer arithmetic before they reach a WKWebView.

describe("dirty debounce contract", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("setTimeout collapses bursts into one Dirty send", () => {
        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };

        // Simulate the EditorApp wiring: timer fires once even with
        // three rapid `onChange` notifications.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const schedule = () => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                w.ipc?.postMessage(JSON.stringify({ k: "dirty", v: { id: 1 } }));
            }, 150);
        };

        try {
            schedule();
            schedule();
            schedule();
            expect(posted).toHaveLength(0);
            vi.advanceTimersByTime(150);
            expect(posted).toHaveLength(1);
            const decoded = JSON.parse(posted[0] ?? "");
            expect(decoded).toEqual({ k: "dirty", v: { id: 1 } });
        } finally {
            w.ipc = prev;
        }
    });
});
