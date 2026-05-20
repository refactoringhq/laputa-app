import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
    parseFrontmatterEntries,
    PropertiesPanel,
} from "./propertiesPanel.tsx";

// ---------------------------------------------------------------------------
// parseFrontmatterEntries — read-only display parser (worklist 2.27)
// ---------------------------------------------------------------------------
//
// Mirrors the shape of `frontmatter.test.ts` — this is the *display*
// complement to `splitFrontmatter`.  Cases cover the realistic shapes
// that show up in vault notes; the parser intentionally does NOT
// validate YAML, it just renders what's there.

describe("parseFrontmatterEntries", () => {
    it("returns [] for an empty prefix", () => {
        expect(parseFrontmatterEntries("")).toEqual([]);
    });

    it("parses a single key/value into one entry", () => {
        const entries = parseFrontmatterEntries("---\ntitle: Hello\n---\n");
        expect(entries).toEqual([{ key: "title", value: "Hello" }]);
    });

    it("keeps multi-line list values as raw source", () => {
        const entries = parseFrontmatterEntries(
            "---\ntags:\n  - a\n  - b\n---\n",
        );
        expect(entries).toEqual([
            { key: "tags", value: "  - a\n  - b" },
        ]);
    });

    it("skips comment lines without crashing", () => {
        const entries = parseFrontmatterEntries(
            "---\n# this is a comment\ntitle: Hello\n---\n",
        );
        expect(entries).toEqual([{ key: "title", value: "Hello" }]);
    });

    it("skips malformed lines without crashing", () => {
        const entries = parseFrontmatterEntries(
            "---\n:no-key\ntitle: Hello\n---\n",
        );
        expect(entries).toEqual([{ key: "title", value: "Hello" }]);
    });

    it("handles CRLF delimiters the same as LF", () => {
        const entries = parseFrontmatterEntries(
            "---\r\ntitle: Hello\r\ntags: [a, b]\r\n---\r\n",
        );
        expect(entries).toEqual([
            { key: "title", value: "Hello" },
            { key: "tags", value: "[a, b]" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// <PropertiesPanel /> render
// ---------------------------------------------------------------------------

describe("PropertiesPanel", () => {
    it("renders null when entries is empty", () => {
        const { container } = render(<PropertiesPanel entries={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders one row per entry with key and value text", () => {
        const { getByTestId, container } = render(
            <PropertiesPanel
                entries={[
                    { key: "title", value: "Hello" },
                    { key: "tags", value: "[a, b]" },
                ]}
            />,
        );

        expect(getByTestId("properties-panel")).toBeInTheDocument();
        const rows = container.querySelectorAll(".properties-panel__row");
        expect(rows).toHaveLength(2);

        const keys = Array.from(
            container.querySelectorAll(".properties-panel__key"),
        ).map((el) => el.textContent);
        const values = Array.from(
            container.querySelectorAll(".properties-panel__value"),
        ).map((el) => el.textContent);

        expect(keys).toEqual(["title", "tags"]);
        expect(values).toEqual(["Hello", "[a, b]"]);
    });
});
