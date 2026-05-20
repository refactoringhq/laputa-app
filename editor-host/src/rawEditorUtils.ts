/**
 * Pure utilities for the CodeMirror raw-mode editor.
 *
 * Ported from the Tauri-era `src/utils/rawEditorUtils.ts`.  The
 * suggestion-enrichment / VaultEntry-typed helpers (`buildRawEditorBaseItems`,
 * `buildRawEditorAutocompleteState`, `getRawEditorDropdownPosition`) are
 * intentionally *not* ported because the embedded editor-host has no
 * vault data and no `WikilinkQuery` bridge envelope yet (Phase 8.29 row
 * is editor-host-only; cross-bridge wikilink suggestion lands in a later
 * row).  Only the three pure helpers — `extractWikilinkQuery`,
 * `replaceActiveWikilinkQuery`, `detectYamlError` — make the trip.
 *
 * Added on top: `RawLanguage` + extension-based language inference that
 * mirrors `crates/raw_editor/src/lib.rs` — the editor-host picks a
 * CodeMirror language pack based on the file extension carried in
 * `NoteOpen.path`.
 */

import type { Extension } from "@codemirror/state";
import { json as jsonLang } from "@codemirror/lang-json";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { css as cssLang } from "@codemirror/lang-css";
import { markdownLanguage } from "./extensions/markdownHighlight.ts";

// ---------------------------------------------------------------------------
// Wikilink query helpers — verbatim from the React reference.
// ---------------------------------------------------------------------------

/** Extract the wikilink query that the user is currently typing after [[ */
export function extractWikilinkQuery(text: string, cursor: number): string | null {
    const before = text.slice(0, cursor);
    const triggerIdx = before.lastIndexOf("[[");
    if (triggerIdx === -1) return null;
    const afterTrigger = before.slice(triggerIdx + 2);
    // Don't trigger if the query contains ] (already closed) or a newline
    if (afterTrigger.includes("]") || afterTrigger.includes("\n")) return null;
    return afterTrigger;
}

export function replaceActiveWikilinkQuery(
    text: string,
    cursor: number,
    target: string,
): { text: string; cursor: number } | null {
    const before = text.slice(0, cursor);
    const triggerIdx = before.lastIndexOf("[[");
    if (triggerIdx === -1) return null;
    const after = text.slice(cursor);
    return {
        text: `${text.slice(0, triggerIdx)}[[${target}]]${after}`,
        cursor: triggerIdx + target.length + 4,
    };
}

/** Basic YAML frontmatter structural checks. */
export function detectYamlError(content: string): string | null {
    if (!content.startsWith("---")) return null;
    const rest = content.slice(3);
    const closeIdx = rest.search(/(?:^|\r?\n)---(?:\r?\n|$)/);
    if (closeIdx === -1) return "Unclosed frontmatter block — add a closing --- line";
    const block = rest.slice(0, closeIdx);
    if (/^\t/m.test(block)) return "YAML frontmatter contains tab indentation — use spaces";
    return null;
}

// ---------------------------------------------------------------------------
// Language inference — bridges the Phase 8.16 RawLanguage enum into
// editor-host so the right CodeMirror language pack lights up.
// ---------------------------------------------------------------------------

/**
 * File kind the raw editor recognises.  Mirrors the Phase 8.16 GPUI-side
 * `RawLanguage` enum (see `crates/raw_editor/src/lib.rs`).
 */
export type RawLanguage = "yaml" | "json" | "css" | "shell" | "toml" | "plaintext";

/**
 * Extensions that should mount the CodeMirror raw editor instead of
 * BlockNote.  Empty / unknown extensions fall through to BlockNote so
 * `.md` (and unsuffixed) notes keep their rich-text experience.
 */
const RAW_EXTENSIONS: ReadonlySet<string> = new Set([
    "yaml",
    "yml",
    "json",
    "css",
    "sh",
    "bash",
    "zsh",
    "toml",
    "txt",
]);

/**
 * Lower-case extension extracted from `path` (no leading dot).  An empty
 * string is returned for paths with no extension or no basename.
 */
export function extractExtension(path: string): string {
    if (!path) return "";
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const dot = basename.lastIndexOf(".");
    if (dot <= 0) return "";
    return basename.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether the given note path should render in the raw-mode
 * CodeMirror editor instead of BlockNote.  `.md` and unsuffixed paths
 * stay on BlockNote; everything in `RAW_EXTENSIONS` switches to raw.
 */
export function shouldUseRawEditor(path: string): boolean {
    const ext = extractExtension(path);
    if (!ext) return false;
    return RAW_EXTENSIONS.has(ext);
}

/**
 * Infer the `RawLanguage` discriminant from a file path's extension.
 * Mirrors `RawLanguage::from_extension` on the Rust side.
 */
export function inferRawLanguage(path: string): RawLanguage {
    const ext = extractExtension(path);
    switch (ext) {
        case "yaml":
        case "yml":
            return "yaml";
        case "json":
            return "json";
        case "css":
            return "css";
        case "sh":
        case "bash":
        case "zsh":
            return "shell";
        case "toml":
            return "toml";
        default:
            return "plaintext";
    }
}

/**
 * Map a `RawLanguage` to the CodeMirror language extension to mount.
 *
 * `shell` and `toml` and `plaintext` all fall through to an empty
 * extension list — CodeMirror's no-highlight fallback handles those
 * without dragging in `@codemirror/lang-shell`/`-toml` (which would
 * bloat the single-file bundle without much win).  `yaml`/`json`/`css`
 * use their dedicated language packs.  Markdown isn't reachable here
 * — `shouldUseRawEditor` returns `false` for `.md`.
 */
export function buildRawLanguageExtension(language: RawLanguage): Extension[] {
    switch (language) {
        case "yaml":
            return [yamlLang()];
        case "json":
            return [jsonLang()];
        case "css":
            return [cssLang()];
        case "shell":
        case "toml":
        case "plaintext":
            return [];
    }
}

/**
 * Re-export the markdown language extension so the raw editor can use
 * markdown highlighting as the universal fallback when callers prefer
 * a single extension.  Currently unused by the routing logic above —
 * kept as a named export so the `RawEditorView` can opt into it if
 * the design changes.
 */
export { markdownLanguage };
