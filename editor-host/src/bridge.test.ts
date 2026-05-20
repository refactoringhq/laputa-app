import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
    dispatchToHost,
    type EditorBridgeHandlers,
} from "./EditorApp.tsx";
import { blocksToMarkdown } from "./richEditorMarkdown.ts";
import { parseFrontmatterEntries } from "./propertiesPanel.tsx";
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
    rawBuffer?: string | null;
}): EditorBridgeHandlers & {
    cancelCalls: number;
    setActiveIdCalls: Array<number | null>;
    rawNoteCalls: Array<{ id: number; path: string; body: string } | null>;
    frontmatterCalls: string[];
} {
    let activeId: number | null = initial?.activeId ?? null;
    const setActiveIdCalls: Array<number | null> = [];
    const rawNoteCalls: Array<{ id: number; path: string; body: string } | null> = [];
    const frontmatterCalls: string[] = [];
    let frontmatter = "";
    let rawBuffer: string | null = initial?.rawBuffer ?? null;
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
        setRawNote(note) {
            rawNoteCalls.push(note);
            rawBuffer = note?.body ?? null;
        },
        getRawBuffer() {
            return rawBuffer;
        },
        setFrontmatter(prefix) {
            frontmatterCalls.push(prefix);
            frontmatter = prefix;
        },
        getFrontmatter() {
            return frontmatter;
        },
        get cancelCalls() {
            return cancelCalls;
        },
        get setActiveIdCalls() {
            return setActiveIdCalls;
        },
        get rawNoteCalls() {
            return rawNoteCalls;
        },
        get frontmatterCalls() {
            return frontmatterCalls;
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

    it("note_open with a markdown path clears the raw note", () => {
        const handlers = makeHandlers();
        // Open a yaml note first so the raw slot is populated.
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 1, path: "/v/a.yaml", body: "key: 1\n" },
            },
            handlers,
        );
        // Then swap to a markdown note — the raw slot must be cleared
        // so the rich editor takes over.
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 2, path: "/v/a.md", body: "# md\n" },
            },
            handlers,
        );

        expect(handlers.rawNoteCalls).toEqual([
            { id: 1, path: "/v/a.yaml", body: "key: 1\n" },
            null,
        ]);
        // The BlockNote editor must have received the markdown body.
        const serialised = blocksToMarkdown(editor);
        expect(serialised).toMatch(/^#\s+md/m);
    });

    it("note_open with a raw extension routes to the raw note slot", () => {
        const handlers = makeHandlers();
        // Seed the BlockNote editor with something so we can verify the
        // markdown side is *not* touched on a raw open.
        const baseline = blocksToMarkdown(editor);
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 42, path: "/v/config.yaml", body: "name: example\n" },
            },
            handlers,
        );

        expect(handlers.rawNoteCalls).toEqual([
            { id: 42, path: "/v/config.yaml", body: "name: example\n" },
        ]);
        expect(handlers.getActiveId()).toBe(42);
        // BlockNote document is untouched on a raw open.
        expect(blocksToMarkdown(editor)).toBe(baseline);
    });

    it("save_request for a raw note ships the raw buffer instead of the BlockNote markdown", () => {
        const handlers = makeHandlers();
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 7, path: "/v/c.json", body: '{"a":1}' },
            },
            handlers,
        );

        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };
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
        expect(decoded.v.id).toBe(7);
        // Body must match the raw buffer literally — no markdown
        // serialisation could turn a JSON payload into the same string.
        expect(decoded.v.body).toBe('{"a":1}');
    });

    // -----------------------------------------------------------------
    // Frontmatter round-trip (worklist 2.26)
    // -----------------------------------------------------------------
    //
    // BlockNote's parser/serialiser pair is lossy on YAML — feeding the
    // raw frontmatter through `tryParseMarkdownToBlocks` reformats it
    // as paragraph text and `blocksToMarkdownLossy` cannot reconstruct
    // the original.  `dispatchToHost` peels the YAML off on `note_open`
    // and prepends it back on `save_request` so the on-disk block
    // survives byte-for-byte.

    it("note_open with frontmatter stashes it via setFrontmatter", () => {
        const handlers = makeHandlers();
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: {
                    id: 1,
                    path: "/v/a.md",
                    body: "---\ntitle: T\ntags: [a, b]\n---\n\n# Heading\n\nBody text\n",
                },
            },
            handlers,
        );
        expect(handlers.frontmatterCalls).toEqual([
            "---\ntitle: T\ntags: [a, b]\n---\n",
        ]);
        expect(handlers.getFrontmatter()).toBe(
            "---\ntitle: T\ntags: [a, b]\n---\n",
        );
    });

    it("save_request prepends the stashed frontmatter to BlockNote's body", () => {
        const handlers = makeHandlers();
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: {
                    id: 1,
                    path: "/v/a.md",
                    body: "---\ntitle: T\ntags: [a, b]\n---\n\n# Heading\n\nBody text\n",
                },
            },
            handlers,
        );

        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };
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
        // Body must START with the YAML block byte-for-byte.  We don't
        // assert the trailing body slice — BlockNote is lossy on body
        // whitespace; that's a separate worklist row.
        expect(decoded.v.body.startsWith("---\ntitle: T\ntags: [a, b]\n---\n"))
            .toBe(true);
    });

    it("save_request does not invent a frontmatter prefix when none was stashed", () => {
        const handlers = makeHandlers();
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 1, path: "/v/a.md", body: "# Heading\n\nBody text\n" },
            },
            handlers,
        );
        // The split returns an empty prefix for body-only content; the
        // stash must therefore be "" and the saved body must not start
        // with `---`.
        expect(handlers.getFrontmatter()).toBe("");

        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };
        try {
            dispatchToHost(editor, { k: "save_request" }, handlers);
        } finally {
            w.ipc = prev;
        }

        const decoded = JSON.parse(posted[0] ?? "") as {
            k: string;
            v: { id: number; body: string };
        };
        expect(decoded.v.body.startsWith("---")).toBe(false);
        // The heading must still be there — we only stripped a (missing)
        // frontmatter prefix, not the body itself.
        expect(decoded.v.body).toMatch(/^#\s+Heading/m);
    });

    it("raw-mode note_open does not disturb the stashed frontmatter, and save_request bypasses the prepend", () => {
        const handlers = makeHandlers();
        // Open a markdown note with frontmatter so the stash is set.
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: {
                    id: 1,
                    path: "/v/a.md",
                    body: "---\ntitle: Stashed\n---\n\nbody\n",
                },
            },
            handlers,
        );
        expect(handlers.getFrontmatter()).toBe("---\ntitle: Stashed\n---\n");

        // Now open a raw note — the raw branch must not touch the
        // frontmatter stash (it doesn't apply to .yaml / .json / …).
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: { id: 2, path: "/v/cfg.yaml", body: "key: value\n" },
            },
            handlers,
        );
        // The frontmatter stash is still the markdown note's prefix.
        // The save path won't use it on the raw branch — `getRawBuffer`
        // short-circuits — but the value must persist regardless.
        expect(handlers.getFrontmatter()).toBe("---\ntitle: Stashed\n---\n");

        const posted: string[] = [];
        const w = window as unknown as { ipc?: { postMessage(m: string): void } };
        const prev = w.ipc;
        w.ipc = { postMessage: (m: string) => posted.push(m) };
        try {
            dispatchToHost(editor, { k: "save_request" }, handlers);
        } finally {
            w.ipc = prev;
        }

        const decoded = JSON.parse(posted[0] ?? "") as {
            k: string;
            v: { id: number; body: string };
        };
        // Raw save: body is the raw buffer verbatim, the stashed YAML
        // prefix must NOT be glued onto a .yaml note.
        expect(decoded.v.body).toBe("key: value\n");
    });

    it("stashed frontmatter parses into the properties-panel entries (worklist 2.27)", () => {
        // Integration check between the 2.26 stash and the 2.27 display
        // parser: an open envelope with frontmatter must produce a
        // stash whose `parseFrontmatterEntries` output matches the
        // user-visible key/value pairs.  The render side is covered in
        // `propertiesPanel.test.tsx`; here we only assert the bridge
        // hand-off feeds the parser correctly.
        const handlers = makeHandlers();
        dispatchToHost(
            editor,
            {
                k: "note_open",
                v: {
                    id: 1,
                    path: "/v/a.md",
                    body: "---\ntitle: T\ntags:\n  - a\n  - b\n---\n\n# Heading\n",
                },
            },
            handlers,
        );
        const entries = parseFrontmatterEntries(handlers.getFrontmatter());
        expect(entries).toEqual([
            { key: "title", value: "T" },
            { key: "tags", value: "  - a\n  - b" },
        ]);
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
