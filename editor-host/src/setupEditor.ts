import { BlockNoteEditor } from "@blocknote/core";

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------
//
// Constructs a fresh BlockNoteEditor instance.  Factored out of the
// React mount so subsequent Strand C rows (8.25 menus, 8.26 wikilinks,
// 8.27 IME, 8.28 regressions) can extend the schema / extension list
// in one place without touching `main.tsx`.
//
// Phase 8.24 uses the default schema only — slash menu, side menu,
// formatting toolbar, wikilink suggestion, IME guards, math input,
// arrow-ligatures, render-recovery, and raw-mode all arrive in later
// rows and slot in here as extra `extensions` / `schema` arguments.

/**
 * Build a BlockNoteEditor with the Phase 8.24 default configuration.
 *
 * Subsequent Strand C rows extend this factory rather than the React
 * component so the editor-construction surface stays in one place.
 *
 * - 8.25 — slash / side / formatting menus
 * - 8.26 — wikilink inline content + suggestion menu
 * - 8.27 — IME composition + render-recovery extensions
 * - 8.28 — code-block / table / copy / checklist regressions
 * - 8.29 — CodeMirror raw-mode fallback
 * - 8.30 — editor lifecycle hooks (mode swap, focus, memory probe)
 */
export function createEditor(): BlockNoteEditor {
    // `BlockNoteEditor.create` is the imperative constructor (the React
    // `useCreateBlockNote` hook calls into it).  Going direct keeps the
    // editor lifecycle independent of React renders — onChange wiring
    // and `replaceBlocks` calls don't have to thread through hook deps.
    return BlockNoteEditor.create({
        // Direction = `auto` so RTL paragraphs render correctly without
        // a per-language toggle (mirrors the React-side
        // `RICH_EDITOR_BIDI_DOM_ATTRIBUTES` block-level setting).
        domAttributes: {
            blockContent: { dir: "auto" },
            inlineContent: { dir: "auto" },
        },
    });
}
