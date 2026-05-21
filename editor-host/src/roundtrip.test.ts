import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BlockNoteEditor } from "@blocknote/core";
import {
    dispatchToHost,
    type EditorBridgeHandlers,
} from "./EditorApp.tsx";
import type { ToHost } from "./bridge.ts";

// ---------------------------------------------------------------------------
// Worklist 2.27 follow-up — round-trip the user-named demo notes
// ---------------------------------------------------------------------------
//
// User report: "[2.27] needs follow up. Test the load save loop on:
//   demo-vault-v2/type/person.md
//   demo-vault-v2/type/topic.md
//   demo-vault-v2/writing-for-clarity-vs-writing-for-credit.md
//   demo-vault-v2/writing-weekly-rhythm.md"
//
// This test simulates the editor-host's load/save round-trip for each
// of those notes and asserts the contract worklist 2.26+2.27 ship:
//
//   1. The YAML frontmatter block round-trips BYTE-for-BYTE.  This is
//      the data-integrity guarantee — the worklist-2.27 regression that
//      commit 6b19ddf5 fixed was the auto-save flush sending a body
//      without the stashed frontmatter prefix, losing the YAML on disk.
//
//   2. The BlockNote body round-trip preserves textual content (heading
//      text + paragraph text reach the saved buffer).  Exact whitespace
//      is intentionally NOT asserted because BlockNote's
//      `blocksToMarkdownLossy` reflows blank lines and trailing newlines
//      — that's its documented "lossy" behaviour, mitigated in the
//      React variant by `compactMarkdown`, which is tracked as a
//      separate follow-up.
//
// The test reads each note off disk via Node's `fs` module, dispatches
// `note_open` + `save_request` against a real BlockNoteEditor, captures
// the emitted `FromHost::Save` envelope, and asserts (1) and (2).

const VAULT_NOTES = [
    "type/person.md",
    "type/topic.md",
    "writing-for-clarity-vs-writing-for-credit.md",
    "writing-weekly-rhythm.md",
] as const;

function makeHandlers(): EditorBridgeHandlers {
    let activeId: number | null = null;
    let frontmatter = "";
    let rawBuffer: string | null = null;
    return {
        setActiveId(id) {
            activeId = id;
        },
        getActiveId() {
            return activeId;
        },
        setTheme() {},
        cancelDirty() {},
        setRawNote(note) {
            rawBuffer = note?.body ?? null;
        },
        getRawBuffer() {
            return rawBuffer;
        },
        setFrontmatter(prefix) {
            frontmatter = prefix;
        },
        getFrontmatter() {
            return frontmatter;
        },
    };
}

/**
 * Load a demo-vault note, drive the open/save bridge round-trip, and
 * return both the original on-disk bytes and the body that would be
 * written back to disk on `Cmd+S`.
 */
function roundTrip(relativePath: string): { original: string; saved: string } {
    const path = resolve(__dirname, "../../demo-vault-v2", relativePath);
    const original = readFileSync(path, "utf-8");

    const editor = BlockNoteEditor.create();
    const handlers = makeHandlers();

    dispatchToHost(
        editor,
        {
            k: "note_open",
            v: { id: 1, path: `/v/${relativePath}`, body: original },
        } satisfies ToHost,
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
    const decoded = JSON.parse(posted[0] ?? "{}") as {
        k: string;
        v: { id: number; body: string };
    };
    expect(decoded.k).toBe("save");

    return { original, saved: decoded.v.body };
}

/**
 * Extract the YAML frontmatter prefix (everything from the opening
 * `---` up to and including the closing `---` + trailing newline) from
 * a markdown source.  Mirrors `splitFrontmatter` so the test doesn't
 * take a dep on the helper it's also verifying.
 */
function extractFrontmatter(content: string): string {
    if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
        return "";
    }
    const open = content.startsWith("---\r\n") ? 5 : 4;
    const rest = content.slice(open);
    const close = rest.match(/(?:^|\r?\n)---(?:\r?\n|$)/);
    if (!close || close.index === undefined) return "";
    const closeStart = close.index;
    const closeLen = close[0].length;
    return content.slice(0, open + closeStart + closeLen);
}

describe("user-named round-trip (worklist 2.27 follow-up)", () => {
    for (const note of VAULT_NOTES) {
        it(`${note}: frontmatter round-trips byte-for-byte`, () => {
            const { original, saved } = roundTrip(note);
            const originalFm = extractFrontmatter(original);
            // The note is expected to have frontmatter — flag if not.
            expect(originalFm).not.toBe("");
            const savedFm = extractFrontmatter(saved);
            expect(savedFm).toBe(originalFm);
        });

        it(`${note}: H1 heading text survives round-trip`, () => {
            const { original, saved } = roundTrip(note);
            const originalHeading = original.match(/^#\s+(.+)$/m)?.[1];
            expect(originalHeading).toBeDefined();
            // Heading must appear somewhere in the saved buffer.
            // Don't assert exact line position — BlockNote may reflow
            // blank lines around it.
            expect(saved).toContain(`# ${originalHeading}`);
        });

        it(`${note}: paragraph text survives round-trip`, () => {
            const { original, saved } = roundTrip(note);
            // Lift each body paragraph (after the YAML + H1) and confirm
            // it appears verbatim in the saved buffer.  Empty lines and
            // trailing whitespace are tolerated either side; this is a
            // CONTENT preservation check, not a whitespace check.
            const bodyAfterHeading = original.replace(
                /^---\n[\s\S]*?\n---\n+#\s+[^\n]+\n+/,
                "",
            );
            const paragraphs = bodyAfterHeading
                .split(/\n{2,}/)
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
            for (const para of paragraphs) {
                expect(saved).toContain(para);
            }
        });
    }
});
