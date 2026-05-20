// ---------------------------------------------------------------------------
// Position sync across BlockNote ↔ raw mode (ADR-0115 Phase 8.30)
// ---------------------------------------------------------------------------
//
// Ported from `src/components/useEditorModePositionSync.ts` (React
// reference).  Only the type imports differ — the runtime path uses
// the editor-host's slimmer `editorModePosition.ts` helpers.
//
// The hook owns two effects:
//
// 1. `useRawEditorRestoreEffect`: when the user switches into raw
//    mode and a `CodeMirrorRestoreState` was stashed on the transition
//    ref, ride the next animation frame and try to apply it to the
//    `__cmView` instance.  Retries up to MAX_RAW_RESTORE_ATTEMPTS to
//    paper over the CodeMirror mount delay (the view is registered on
//    `parent.__cmView` inside a `useEffect`).
// 2. `useBlockNoteRestoreEffect`: when the user switches back into
//    BlockNote and a `RawEditorPositionSnapshot` is stashed on the
//    transition ref, wait for the `laputa:editor-tab-swapped` event
//    (which `useEditorTabSwap` dispatches *after* the swap completes)
//    and then queue a single restore on the next animation frame.
//    The frame is cancelable so a re-entry into raw mode before the
//    frame fires aborts the restore — otherwise the BlockNote
//    selection would land on top of the user's typing.

import { useEffect, type MutableRefObject } from "react";
import {
    restoreBlockNoteView,
    restoreCodeMirrorView,
    type BlockNotePositionEditor,
    type CodeMirrorRestoreState,
    type RawEditorPositionSnapshot,
} from "./editorModePosition.ts";

const MAX_RAW_RESTORE_ATTEMPTS = 5;
const TAB_SWAP_EVENT_NAME = "laputa:editor-tab-swapped";

export interface EditorModeRestoreTransition {
    rawRestore: CodeMirrorRestoreState | null;
    roundTripRawRestore: { path: string; state: CodeMirrorRestoreState } | null;
    richRestore: RawEditorPositionSnapshot | null;
}

export function createEditorModeRestoreTransition(): EditorModeRestoreTransition {
    return {
        rawRestore: null,
        roundTripRawRestore: null,
        richRestore: null,
    };
}

function useRawEditorRestoreEffect({
    activeTabPath,
    restoreTransitionRef,
    rawMode,
}: {
    activeTabPath: string | null;
    restoreTransitionRef: MutableRefObject<EditorModeRestoreTransition>;
    rawMode: boolean;
}) {
    useEffect(() => {
        if (!rawMode || !restoreTransitionRef.current.rawRestore) return;

        let frame = 0;
        let attempts = 0;

        const tryRestore = () => {
            const pendingState = restoreTransitionRef.current.rawRestore;
            if (!pendingState) return;
            if (restoreCodeMirrorView(document, pendingState)) {
                restoreTransitionRef.current.rawRestore = null;
                return;
            }
            attempts += 1;
            if (attempts < MAX_RAW_RESTORE_ATTEMPTS) {
                frame = window.requestAnimationFrame(tryRestore);
            }
        };

        frame = window.requestAnimationFrame(tryRestore);
        return () => {
            if (frame !== 0) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [activeTabPath, restoreTransitionRef, rawMode]);
}

function useBlockNoteRestoreEffect({
    activeTabPath,
    editor,
    restoreTransitionRef,
    rawMode,
}: {
    activeTabPath: string | null;
    editor: BlockNotePositionEditor;
    restoreTransitionRef: MutableRefObject<EditorModeRestoreTransition>;
    rawMode: boolean;
}) {
    useEffect(() => {
        if (rawMode) return;

        let restoreFrame = 0;
        let canceled = false;

        const cancelPendingRestore = () => {
            canceled = true;
            if (restoreFrame === 0) return;

            window.cancelAnimationFrame(restoreFrame);
            restoreFrame = 0;
        };

        const handleEditorTabSwapped = (event: Event) => {
            const pendingSnapshot = restoreTransitionRef.current.richRestore;
            if (!activeTabPath || !pendingSnapshot) return;

            const customEvent = event as CustomEvent<{ path: string }>;
            if (customEvent.detail.path !== activeTabPath) return;

            if (restoreFrame !== 0) {
                window.cancelAnimationFrame(restoreFrame);
            }

            restoreFrame = window.requestAnimationFrame(() => {
                restoreFrame = 0;
                if (canceled) return;

                restoreBlockNoteView(editor, pendingSnapshot, document);
                restoreTransitionRef.current.roundTripRawRestore = null;
                restoreTransitionRef.current.richRestore = null;
            });
        };

        window.addEventListener(TAB_SWAP_EVENT_NAME, handleEditorTabSwapped);
        return () => {
            cancelPendingRestore();
            window.removeEventListener(TAB_SWAP_EVENT_NAME, handleEditorTabSwapped);
        };
    }, [activeTabPath, editor, restoreTransitionRef, rawMode]);
}

export function useEditorModePositionSync({
    activeTabPath,
    editor,
    restoreTransitionRef,
    rawMode,
}: {
    activeTabPath: string | null;
    editor: BlockNotePositionEditor;
    restoreTransitionRef: MutableRefObject<EditorModeRestoreTransition>;
    rawMode: boolean;
}) {
    useRawEditorRestoreEffect({ activeTabPath, restoreTransitionRef, rawMode });
    useBlockNoteRestoreEffect({ activeTabPath, editor, restoreTransitionRef, rawMode });
}
