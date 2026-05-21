import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BlockNoteEditor } from "@blocknote/core";
import {
    dispatchToHost,
    type EditorBridgeHandlers,
} from "./EditorApp.tsx";
import type { ToHost } from "./bridge.ts";

// ---------------------------------------------------------------------------
// Worklist 2.26 follow-up — byte-to-byte round-trip across every *.md
// in demo-vault-v2/
// ---------------------------------------------------------------------------
//
// User report: "[2.26] is not fixed.  verify byte to byte roundtrip for
// all *.md files under `demo-vault-v2/`".
//
// This test iterates every markdown file in the demo vault, drives the
// editor-host's note_open/save_request dispatch round-trip, and asserts
// `saved === original` byte-for-byte.  Any divergence dumps a unified
// diff to stdout so the next root-cause hunt has the data it needs.
//
// The contract worklist 2.26 committed to is "YAML frontmatter survives
// byte-for-byte"; the BlockNote-lossy body whitespace has been deferred
// in earlier commits.  The user is escalating: they want the WHOLE FILE
// to round-trip, body included.  This test makes the gap explicit per
// file so we can decide whether to port React's `compactMarkdown` /
// `serializeDurableEditorBlocks` mitigation or accept the divergence
// as a known limitation.

const VAULT_ROOT = resolve(__dirname, "../../demo-vault-v2");

function makeHandlers(): EditorBridgeHandlers {
    let activeId: number | null = null;
    let frontmatter = "";
    let rawBuffer: string | null = null;
    let bodyLeading = "";
    let bodyTrailing = "";
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
        setBodyWhitespace(leading, trailing) {
            bodyLeading = leading;
            bodyTrailing = trailing;
        },
        getBodyLeadingWhitespace() {
            return bodyLeading;
        },
        getBodyTrailingWhitespace() {
            return bodyTrailing;
        },
    };
}

function roundTrip(absolutePath: string): { original: string; saved: string } {
    const original = readFileSync(absolutePath, "utf-8");
    const editor = BlockNoteEditor.create();
    const handlers = makeHandlers();

    dispatchToHost(
        editor,
        {
            k: "note_open",
            v: { id: 1, path: `/v/${relative(VAULT_ROOT, absolutePath)}`, body: original },
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

    const decoded = JSON.parse(posted[0] ?? "{}") as {
        k: string;
        v: { id: number; body: string };
    };
    return { original, saved: decoded.v.body };
}

/** Walk `dir` recursively, returning every `*.md` file as an absolute path. */
function listMarkdownFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            out.push(...listMarkdownFiles(full));
        } else if (entry.endsWith(".md")) {
            out.push(full);
        }
    }
    return out.sort();
}

/** Inline diff that highlights character-level divergences. */
function inlineDiff(a: string, b: string): string {
    if (a === b) return "(identical)";
    // Find first divergence
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const aTail = a.slice(i, i + 80);
    const bTail = b.slice(i, i + 80);
    const aHex = aTail
        .slice(0, 40)
        .split("")
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(" ");
    const bHex = bTail
        .slice(0, 40)
        .split("")
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(" ");
    return [
        `first divergence at byte ${i} (of ${a.length} vs ${b.length})`,
        `  original: ${JSON.stringify(aTail)}`,
        `       hex: ${aHex}`,
        `     saved: ${JSON.stringify(bTail)}`,
        `       hex: ${bHex}`,
    ].join("\n");
}

describe("byte-to-byte round-trip for all demo-vault-v2/*.md (worklist 2.26)", () => {
    const files = listMarkdownFiles(VAULT_ROOT);
    expect(files.length).toBeGreaterThan(0);

    // Summary collector so the per-file failures don't drown the
    // top-level "X of Y notes diverge" headline.
    const divergences: Array<{ path: string; bytesOriginal: number; bytesSaved: number; firstByte: number }> = [];

    for (const abs of files) {
        const rel = relative(VAULT_ROOT, abs);
        it(`${rel}: byte-for-byte`, () => {
            const { original, saved } = roundTrip(abs);
            if (original !== saved) {
                // Compute first-divergence position for the summary.
                let i = 0;
                while (i < original.length && i < saved.length && original[i] === saved[i]) i++;
                divergences.push({
                    path: rel,
                    bytesOriginal: original.length,
                    bytesSaved: saved.length,
                    firstByte: i,
                });
                // Surface the per-file inline diff in the test output so
                // the next root-cause hunt can read it without re-running.
                console.error(`\n=== DIVERGENCE: ${rel} ===\n${inlineDiff(original, saved)}\n`);
            }
            expect(saved).toBe(original);
        });
    }
});
