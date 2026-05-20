import {
    BlockNoteEditor,
    BlockNoteSchema,
    createInlineContentSpec,
    defaultInlineContentSpecs,
} from "@blocknote/core";
import { createImeCompositionKeyGuardExtension } from "./imeCompositionKeyGuardExtension.ts";
import { createRichEditorTransformErrorRecoveryExtension } from "./richEditorTransformErrorRecoveryExtension.ts";

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------
//
// Constructs a fresh BlockNoteEditor instance.  Factored out of the
// React mount so subsequent Strand C rows (8.27 IME, 8.28 regressions,
// 8.29 raw-mode, 8.30 lifecycle) can extend the schema / extension
// list in one place without touching `main.tsx`.
//
// Phase 8.26 adds the `wikilink` inline content schema so the
// suggestion menu (`wikilinkSuggestion.ts`) can `insertInlineContent`
// a typed wikilink span — the same shape the Tauri-era editor used,
// minus the React-rendered icon / colour helpers (those land with
// Strand C's later visual-fidelity row).
//
// Schedule for the remaining schema additions:
//
// - 8.27 — IME composition + render-recovery extensions
// - 8.28 — code-block / table / copy / checklist regressions
// - 8.29 — CodeMirror raw-mode fallback
// - 8.30 — editor lifecycle hooks (mode swap, focus, memory probe)

/** The inline content type used for `[[Wikilink]]` spans.  Kept in a
 *  named constant so the suggestion menu can target it by string
 *  without a literal-typo risk. */
export const WIKILINK_INLINE_CONTENT_TYPE = "wikilink" as const;

/** Build the minimal `WikiLink` inline content spec.
 *
 *  The rendered DOM matches the React-era editor (`class="wikilink"`,
 *  `data-target="…"`) so the link-activation helper in
 *  `linkActivation.ts` can find the target without a separate
 *  hand-off and the existing wikilink CSS in `style.css` (added by a
 *  later Strand C row) cascades onto it.  We deliberately *do not*
 *  port the React icon / colour resolution here — those depend on
 *  `VaultEntry` data that the embedded editor has no access to; the
 *  native shell will inject a richer renderer in 8.28+ if needed.
 */
function buildWikilinkSpec() {
    return createInlineContentSpec(
        {
            type: WIKILINK_INLINE_CONTENT_TYPE,
            propSchema: {
                target: { default: "" },
            },
            content: "none",
        } as const,
        {
            render(inlineContent) {
                const dom = document.createElement("span");
                dom.className = "wikilink";
                const target = String(inlineContent.props.target);
                dom.dataset.target = target;
                dom.textContent = target;
                return { dom };
            },
        },
    );
}

/** Build the editor schema with the default block / style specs and
 *  the wikilink inline content spec added on top.  Exposed so tests
 *  can reach for `schema.inlineContentSpecs` directly. */
export function buildEditorSchema() {
    return BlockNoteSchema.create({
        inlineContentSpecs: {
            ...defaultInlineContentSpecs,
            [WIKILINK_INLINE_CONTENT_TYPE]: buildWikilinkSpec(),
        },
    });
}

/** The stability extensions installed by `createEditor`.  Factored
 *  out so the unit-tests can introspect the list (and so any future
 *  row can re-use the same set when building a ad-hoc test editor).
 *
 *  Order matters in principle (extensions mount in array order), but
 *  these two are independent — the transform-error recovery wraps
 *  `view.dispatch`, the IME guard installs a `keydown` capture
 *  listener; neither affects the other. */
export function buildStabilityExtensions() {
    return [
        // Wraps `view.dispatch` so the editor survives stale /
        // mismatched / invalid-content transactions (Phase 8.27).
        // First so it's the outermost handler — if the IME guard ever
        // grows a dispatch hook in the future, recovery still wraps it.
        createRichEditorTransformErrorRecoveryExtension(),
        // Capture-phase `keydown` listener that swallows IME-composition
        // Enter so BlockNote's list extension doesn't split items
        // while the macOS candidate window is committing (Phase 8.27,
        // Phase 0 §6 trigger #2).
        createImeCompositionKeyGuardExtension(),
    ];
}

/**
 * Build a BlockNoteEditor with the Phase 8.27 configuration.
 *
 * Subsequent Strand C rows extend this factory rather than the React
 * component so the editor-construction surface stays in one place.
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
        // The schema is intentionally cast back to the loosely-typed
        // `BlockNoteEditor` return shape — the rest of the host
        // (`richEditorMarkdown.ts`, `EditorApp.tsx`) does not care
        // about the extended `InlineContentSchema`, and keeping the
        // narrow return type avoids forcing every call site to thread
        // generic parameters through.
        schema: buildEditorSchema(),
        // Stability extensions ported from the Tauri-era app.  Future
        // Strand C rows (8.28 regressions, 8.29 raw-mode fallback)
        // append to the array returned by `buildStabilityExtensions`.
        extensions: buildStabilityExtensions(),
    }) as unknown as BlockNoteEditor;
}
