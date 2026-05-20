// ---------------------------------------------------------------------------
// IME composition key guard (ADR-0115 Phase 8.27, Strand C)
// ---------------------------------------------------------------------------
//
// Tolaria's macOS Phase 0 §6 trigger #2 — pressing Enter to commit an
// IME candidate while ProseMirror still considers the view "composing"
// — would split list items or paragraphs underneath the candidate
// being committed.  BlockNote's list shortcuts handle Enter before
// the composition lifecycle finishes, so we intercept the keydown
// in capture phase and stop propagation before the list extension
// sees it.  The native IME still commits the candidate.
//
// Ported verbatim from `src/components/imeCompositionKeyGuardExtension.ts`.

import { createExtension } from "@blocknote/core";

interface ComposingEditorView {
    composing?: boolean;
}

function isComposingKeyEvent(event: KeyboardEvent, view?: ComposingEditorView | null): boolean {
    return event.isComposing || event.keyCode === 229 || Boolean(view?.composing);
}

function isEnterKey(event: KeyboardEvent): boolean {
    return event.key === "Enter"
        || event.code === "Enter"
        || event.code === "NumpadEnter"
        || event.keyCode === 13;
}

export function shouldStopComposingEnterKey(
    event: KeyboardEvent,
    view?: ComposingEditorView | null,
): boolean {
    return isEnterKey(event) && isComposingKeyEvent(event, view);
}

export const createImeCompositionKeyGuardExtension = createExtension(({ editor }) => {
    const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView;

    const handleKeyDown = (event: KeyboardEvent) => {
        if (!shouldStopComposingEnterKey(event, readView())) return;

        event.stopImmediatePropagation();
    };

    return {
        key: "imeCompositionKeyGuard",
        mount: ({ dom, signal }) => {
            dom.addEventListener("keydown", handleKeyDown, {
                capture: true,
                signal,
            });
        },
    } as const;
});
