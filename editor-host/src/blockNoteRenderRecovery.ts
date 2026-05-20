// ---------------------------------------------------------------------------
// BlockNote render-recovery markers (ADR-0115 Phase 8.27, Strand C)
// ---------------------------------------------------------------------------
//
// ProseMirror's React adapter can throw `Block doesn't have id` from
// inside a render commit when a `replaceBlocks` race produces a child
// block without a stable id.  The React component tree catches that
// via a `BlockNoteRenderRecoveryBoundary`, repairs the document, and
// re-renders.  This module is the *marker layer* — it lets the root
// `onError` handler suppress the second-order error report once the
// boundary has already absorbed the failure.
//
// Ported verbatim from `src/components/blockNoteRenderRecovery.ts` so
// the embedded editor in 8.29's planned raw-mode lifecycle can rely on
// the same suppression semantics the React-era app shipped.

const BLOCKNOTE_MISSING_ID_ERROR = "Block doesn't have id";
const BLOCKNOTE_RECOVERY_BOUNDARY_NAME = "BlockNoteRenderRecoveryBoundary";
const RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK = "__tolariaRecoveredBlockNoteRenderError";

type MarkedRecoveredBlockNoteRenderError = Error & {
    [RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK]?: true;
};

function hasRecoveredRenderErrorMark(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return Reflect.get(
        error as MarkedRecoveredBlockNoteRenderError,
        RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK,
    ) === true;
}

export function isRecoverableBlockNoteRenderError(error: unknown): boolean {
    return error instanceof Error && error.message.includes(BLOCKNOTE_MISSING_ID_ERROR);
}

export function markRecoveredBlockNoteRenderError(error: unknown): void {
    if (!isRecoverableBlockNoteRenderError(error)) return;
    const markedError = error as MarkedRecoveredBlockNoteRenderError;
    Reflect.set(markedError, RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK, true);
}

export function isRecoveredBlockNoteRenderError(
    error: unknown,
    componentStack: string,
): boolean {
    return isRecoverableBlockNoteRenderError(error)
        && (
            hasRecoveredRenderErrorMark(error)
            || componentStack.includes(BLOCKNOTE_RECOVERY_BOUNDARY_NAME)
        );
}
