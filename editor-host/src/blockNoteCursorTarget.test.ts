import { describe, expect, it } from "vitest";
import {
    findNearestTextCursorBlock,
    findNearestTextCursorBlockById,
} from "./blockNoteCursorTarget.ts";

// ---------------------------------------------------------------------------
// Cursor target restoration (Phase 8.26)
// ---------------------------------------------------------------------------
//
// The helpers under test are pure block-list lookups — `block.content`
// is `Array.isArray` is the only thing they branch on.  These tests
// drive them with hand-rolled fixtures so the suite stays fast and
// doesn't need a real BlockNote editor.

type Block = { id: string; content?: unknown };

function textBlock(id: string): Block {
    return { id, content: [] };
}

function imageBlock(id: string): Block {
    // BlockNote represents non-text blocks (image, audio, video, file)
    // without a `content` array — exactly the shape the helper must
    // skip past.
    return { id };
}

describe("findNearestTextCursorBlock", () => {
    it("returns null for an empty list", () => {
        expect(findNearestTextCursorBlock([], 0)).toBeNull();
    });

    it("returns the block at the target index when it supports a text cursor", () => {
        const blocks = [textBlock("a"), textBlock("b"), textBlock("c")];
        expect(findNearestTextCursorBlock(blocks, 1)).toBe(blocks[1]);
    });

    it("walks forward past a non-text block at the target index", () => {
        const blocks = [textBlock("a"), imageBlock("img"), textBlock("c")];
        expect(findNearestTextCursorBlock(blocks, 1)).toBe(blocks[2]);
    });

    it("falls back to a backward block when the forward search runs out", () => {
        const blocks = [textBlock("a"), imageBlock("img")];
        expect(findNearestTextCursorBlock(blocks, 1)).toBe(blocks[0]);
    });

    it("returns null when the entire document has no text-cursorable blocks", () => {
        const blocks = [imageBlock("img1"), imageBlock("img2")];
        expect(findNearestTextCursorBlock(blocks, 0)).toBeNull();
    });

    it("clamps a negative target index to zero before searching", () => {
        const blocks = [textBlock("a"), textBlock("b")];
        expect(findNearestTextCursorBlock(blocks, -5)).toBe(blocks[0]);
    });

    it("clamps an out-of-range target index to the last valid index", () => {
        const blocks = [textBlock("a"), textBlock("b")];
        expect(findNearestTextCursorBlock(blocks, 999)).toBe(blocks[1]);
    });

    it("prefers the forward block when forward and backward are equidistant", () => {
        const blocks = [
            textBlock("backward"),
            imageBlock("img"),
            textBlock("forward"),
        ];
        expect(findNearestTextCursorBlock(blocks, 1)).toBe(blocks[2]);
    });
});

describe("findNearestTextCursorBlockById", () => {
    it("looks up the index by id then delegates to the index search", () => {
        const blocks = [textBlock("a"), imageBlock("img"), textBlock("c")];
        expect(findNearestTextCursorBlockById(blocks, "img")).toBe(blocks[2]);
    });

    it("returns null when the id isn't in the document", () => {
        const blocks = [textBlock("a"), textBlock("b")];
        expect(findNearestTextCursorBlockById(blocks, "missing")).toBeNull();
    });

    it("returns the same block when the id is itself cursorable", () => {
        const blocks = [textBlock("a"), textBlock("b")];
        expect(findNearestTextCursorBlockById(blocks, "b")).toBe(blocks[1]);
    });
});
