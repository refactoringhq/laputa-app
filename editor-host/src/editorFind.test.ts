import { describe, it, expect } from "vitest";
import {
    buildEditorFindReplacementChange,
    buildEditorFindReplacementChanges,
    clampEditorFindIndex,
    findEditorMatches,
    nextEditorFindIndex,
    replacementForEditorFindMatch,
    type EditorFindOptions,
} from "./editorFind";

const PLAIN: EditorFindOptions = { caseSensitive: false, regex: false };
const PLAIN_CASE: EditorFindOptions = { caseSensitive: true, regex: false };
const REGEX_CASE: EditorFindOptions = { caseSensitive: true, regex: true };

describe("findEditorMatches", () => {
    it("returns an empty result for an empty query", () => {
        expect(findEditorMatches("hello", "", PLAIN)).toEqual({ error: null, matches: [] });
    });

    it("finds case-insensitive plain-text matches", () => {
        const result = findEditorMatches("Alpha alpha Beta", "alpha", PLAIN);
        expect(result.error).toBeNull();
        expect(result.matches.map((m) => [m.from, m.to])).toEqual([
            [0, 5],
            [6, 11],
        ]);
    });

    it("respects case sensitivity", () => {
        const result = findEditorMatches("Alpha alpha", "Alpha", PLAIN_CASE);
        expect(result.matches.map((m) => [m.from, m.to])).toEqual([[0, 5]]);
    });

    it("escapes regex metacharacters in plain mode", () => {
        const result = findEditorMatches("a.b a.b a-b", "a.b", PLAIN);
        // Plain mode should match the literal "a.b" twice, not "a.b" + "a-b".
        expect(result.matches.length).toBe(2);
    });

    it("supports regex mode with capture groups", () => {
        const result = findEditorMatches("foo-123 foo-456", "foo-(\\d+)", REGEX_CASE);
        expect(result.matches.map((m) => m.text)).toEqual(["foo-123", "foo-456"]);
    });

    it("reports an invalid regex without throwing", () => {
        const result = findEditorMatches("text", "(", { caseSensitive: false, regex: true });
        expect(result.error).toBe("Invalid regex");
        expect(result.matches).toEqual([]);
    });

    it("guards against zero-length regex matches", () => {
        const result = findEditorMatches("foo", "a*", { caseSensitive: false, regex: true });
        expect(result.error).toBe("Regex must match text");
        expect(result.matches).toEqual([]);
    });
});

describe("clampEditorFindIndex", () => {
    it("returns 0 when there are no matches", () => {
        expect(clampEditorFindIndex(5, 0)).toBe(0);
    });

    it("clamps to [0, matchCount - 1]", () => {
        expect(clampEditorFindIndex(-2, 4)).toBe(0);
        expect(clampEditorFindIndex(0, 4)).toBe(0);
        expect(clampEditorFindIndex(2, 4)).toBe(2);
        expect(clampEditorFindIndex(10, 4)).toBe(3);
    });
});

describe("nextEditorFindIndex", () => {
    it("returns 0 for an empty match set", () => {
        expect(nextEditorFindIndex(0, 0, 1)).toBe(0);
        expect(nextEditorFindIndex(0, 0, -1)).toBe(0);
    });

    it("wraps forward and backward", () => {
        expect(nextEditorFindIndex(0, 3, 1)).toBe(1);
        expect(nextEditorFindIndex(2, 3, 1)).toBe(0);
        expect(nextEditorFindIndex(0, 3, -1)).toBe(2);
    });
});

describe("replacementForEditorFindMatch / buildEditorFindReplacementChange", () => {
    it("returns the literal replacement in plain mode", () => {
        const result = findEditorMatches("Alpha", "Alpha", PLAIN_CASE);
        const match = result.matches[0]!;
        expect(replacementForEditorFindMatch(match, "Alpha", "Beta", PLAIN_CASE)).toBe(
            "Beta",
        );
    });

    it("applies capture references in regex mode", () => {
        const result = findEditorMatches("foo-123", "foo-(\\d+)", REGEX_CASE);
        const match = result.matches[0]!;
        expect(
            replacementForEditorFindMatch(match, "foo-(\\d+)", "bar-$1", REGEX_CASE),
        ).toBe("bar-123");
    });

    it("falls back to the literal replacement if the regex is invalid", () => {
        const result = findEditorMatches("Alpha", "Alpha", PLAIN_CASE);
        const match = result.matches[0]!;
        expect(
            replacementForEditorFindMatch(match, "(", "BAD", {
                caseSensitive: true,
                regex: true,
            }),
        ).toBe("BAD");
    });

    it("builds typed replacement changes", () => {
        const result = findEditorMatches("foo-123", "foo-(\\d+)", REGEX_CASE);
        const match = result.matches[0]!;
        const change = buildEditorFindReplacementChange(
            match,
            "foo-(\\d+)",
            "bar-$1",
            REGEX_CASE,
        );
        expect(change).toEqual({ from: 0, to: 7, insert: "bar-123" });
    });

    it("builds a list of changes for replace-all", () => {
        const result = findEditorMatches("foo-1 foo-22", "foo-(\\d+)", REGEX_CASE);
        const changes = buildEditorFindReplacementChanges(
            result.matches,
            "foo-(\\d+)",
            "bar-$1",
            REGEX_CASE,
        );
        expect(changes).toEqual([
            { from: 0, to: 5, insert: "bar-1" },
            { from: 6, to: 12, insert: "bar-22" },
        ]);
    });
});
