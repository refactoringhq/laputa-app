import { describe, it, expect } from "vitest";
import { splitFrontmatter } from "./frontmatter.ts";

// ---------------------------------------------------------------------------
// splitFrontmatter — ported from src/utils/wikilinks.test.ts:199-242
// ---------------------------------------------------------------------------
//
// The editor-host copy of the splitter must behave identically to the
// React variant or round-tripping a note will diverge between the two
// editors.  Keep these cases in lockstep with the React tests; if you
// add a case here, port it there too.

describe("splitFrontmatter", () => {
    it("splits YAML frontmatter from body", () => {
        const content = "---\ntitle: Hello\n---\n\n# Hello\n";
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe("---\ntitle: Hello\n---\n");
        expect(body).toBe("\n# Hello\n");
    });

    it("returns empty frontmatter when none present", () => {
        const content = "# No Frontmatter";
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe("");
        expect(body).toBe("# No Frontmatter");
    });

    it("returns empty frontmatter when closing --- is missing", () => {
        const content = "---\ntitle: Hello\nNo closing";
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe("");
        expect(body).toBe(content);
    });

    it("handles frontmatter followed by immediate content", () => {
        const content = "---\ntitle: Hello\n---\nContent";
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe("---\ntitle: Hello\n---\n");
        expect(body).toBe("Content");
    });

    it("preserves CRLF frontmatter delimiters and trailing line ending", () => {
        const content = "---\r\ntitle: Hello\r\n---\r\n# Hello\r\n";
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe("---\r\ntitle: Hello\r\n---\r\n");
        expect(body).toBe("# Hello\r\n");
    });

    it("ignores dashes inside frontmatter values", () => {
        const content = '---\ntitle: "A --- B"\ntype: Note\n---\n\nBody text';
        const [fm, body] = splitFrontmatter(content);
        expect(fm).toBe('---\ntitle: "A --- B"\ntype: Note\n---\n');
        expect(body).toBe("\nBody text");
    });
});
