import { describe, it, expect } from "vitest";
import {
    buildRawLanguageExtension,
    detectYamlError,
    extractExtension,
    extractWikilinkQuery,
    inferRawLanguage,
    replaceActiveWikilinkQuery,
    shouldUseRawEditor,
} from "./rawEditorUtils";

describe("extractWikilinkQuery", () => {
    it("returns null when no [[ trigger", () => {
        expect(extractWikilinkQuery("hello world", 5)).toBeNull();
    });

    it("returns empty string immediately after [[", () => {
        const text = "see [[";
        expect(extractWikilinkQuery(text, text.length)).toBe("");
    });

    it("returns query after [[", () => {
        const text = "see [[Proj";
        expect(extractWikilinkQuery(text, text.length)).toBe("Proj");
    });

    it("returns null when ]] closes the link", () => {
        const text = "[[Proj]]";
        expect(extractWikilinkQuery(text, text.length)).toBeNull();
    });

    it("returns null when newline is in query", () => {
        const text = "[[Proj\ncontinued";
        expect(extractWikilinkQuery(text, text.length)).toBeNull();
    });

    it("handles cursor before end of text", () => {
        const text = "[[Proj after";
        expect(extractWikilinkQuery(text, 6)).toBe("Proj");
    });
});

describe("replaceActiveWikilinkQuery", () => {
    it("replaces the active wikilink query with the canonical target", () => {
        expect(replaceActiveWikilinkQuery("See [[Proj", 10, "projects/alpha")).toEqual({
            text: "See [[projects/alpha]]",
            cursor: 22,
        });
    });

    it("preserves text after the cursor", () => {
        expect(
            replaceActiveWikilinkQuery("See [[Proj today", 10, "projects/alpha"),
        ).toEqual({
            text: "See [[projects/alpha]] today",
            cursor: 22,
        });
    });

    it("returns null when no active wikilink trigger exists", () => {
        expect(replaceActiveWikilinkQuery("See Proj", 8, "projects/alpha")).toBeNull();
    });
});

describe("detectYamlError", () => {
    it("returns null for content without frontmatter", () => {
        expect(detectYamlError("# Title\n\nSome content.")).toBeNull();
    });

    it("returns null for valid frontmatter", () => {
        expect(detectYamlError("---\ntitle: My Note\n---\n\n# Title")).toBeNull();
    });

    it("returns null for valid CRLF frontmatter", () => {
        expect(detectYamlError("---\r\ntitle: My Note\r\n---\r\n\r\n# Title")).toBeNull();
    });

    it("returns error for unclosed frontmatter", () => {
        const error = detectYamlError("---\ntitle: My Note\n\n# Title");
        expect(error).toContain("Unclosed frontmatter");
    });

    it("returns error for tab indentation in frontmatter", () => {
        const error = detectYamlError("---\n\ttitle: My Note\n---\n");
        expect(error).toContain("tab indentation");
    });

    it("returns null for content not starting with ---", () => {
        expect(detectYamlError("Not frontmatter")).toBeNull();
    });
});

describe("extractExtension", () => {
    it("returns the lowercase extension of a simple file name", () => {
        expect(extractExtension("foo.yaml")).toBe("yaml");
        expect(extractExtension("foo.YAML")).toBe("yaml");
    });

    it("returns the trailing extension of a multi-dot file", () => {
        expect(extractExtension("foo.config.json")).toBe("json");
    });

    it("returns the extension when path includes directories", () => {
        expect(extractExtension("/vault/notes/foo.toml")).toBe("toml");
        expect(extractExtension("vault\\notes\\foo.css")).toBe("css");
    });

    it("returns an empty string for paths without an extension", () => {
        expect(extractExtension("")).toBe("");
        expect(extractExtension("README")).toBe("");
        expect(extractExtension("/vault/notes/README")).toBe("");
        expect(extractExtension(".hidden")).toBe("");
    });
});

describe("shouldUseRawEditor", () => {
    it("returns true for raw-mode extensions", () => {
        for (const path of [
            "config.yaml",
            "config.yml",
            "package.json",
            "theme.css",
            "build.sh",
            "deploy.bash",
            "shell.zsh",
            "Cargo.toml",
            "notes.txt",
            "/vault/Cargo.TOML",
        ]) {
            expect(shouldUseRawEditor(path)).toBe(true);
        }
    });

    it("returns false for markdown and unknown extensions", () => {
        for (const path of ["note.md", "note", "", "vault/note.MD", "image.png"]) {
            expect(shouldUseRawEditor(path)).toBe(false);
        }
    });
});

describe("inferRawLanguage", () => {
    it.each([
        ["foo.yaml", "yaml"],
        ["foo.YML", "yaml"],
        ["foo.json", "json"],
        ["foo.css", "css"],
        ["foo.sh", "shell"],
        ["foo.bash", "shell"],
        ["foo.ZSH", "shell"],
        ["Cargo.toml", "toml"],
        ["note.md", "plaintext"],
        ["note.txt", "plaintext"],
        ["", "plaintext"],
    ])("infers %s as %s", (path, expected) => {
        expect(inferRawLanguage(path)).toBe(expected);
    });
});

describe("buildRawLanguageExtension", () => {
    it("returns a non-empty extension array for yaml / json / css", () => {
        expect(buildRawLanguageExtension("yaml")).toHaveLength(1);
        expect(buildRawLanguageExtension("json")).toHaveLength(1);
        expect(buildRawLanguageExtension("css")).toHaveLength(1);
    });

    it("returns an empty extension array for shell / toml / plaintext", () => {
        expect(buildRawLanguageExtension("shell")).toEqual([]);
        expect(buildRawLanguageExtension("toml")).toEqual([]);
        expect(buildRawLanguageExtension("plaintext")).toEqual([]);
    });
});
