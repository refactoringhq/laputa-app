import {
  classifyRichEditorRecoveryError,
  type BlockNoteRenderRecoveryReason,
} from './richEditorRecoveryClassifier'

const BLOCKNOTE_RECOVERY_BOUNDARY_NAME = 'BlockNoteRenderRecoveryBoundary'
const RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK = '__tolariaRecoveredBlockNoteRenderError'
export type { BlockNoteRenderRecoveryReason } from './richEditorRecoveryClassifier'

type MarkedRecoveredBlockNoteRenderError = Error & {
  [RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK]?: true
}

function hasRecoveredRenderErrorMark(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return Reflect.get(error as MarkedRecoveredBlockNoteRenderError, RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK) === true
}

export function isRecoverableBlockNoteRenderError(error: unknown): boolean {
  return blockNoteRenderRecoveryReason(error) !== null
}

export function blockNoteRenderRecoveryReason(error: unknown): BlockNoteRenderRecoveryReason | null {
  return classifyRichEditorRecoveryError(error, 'render')
}

export function markRecoveredBlockNoteRenderError(error: unknown): void {
  if (!isRecoverableBlockNoteRenderError(error)) return
  const markedError = error as MarkedRecoveredBlockNoteRenderError
  Reflect.set(markedError, RECOVERED_BLOCKNOTE_RENDER_ERROR_MARK, true)
}

export function isRecoveredBlockNoteRenderError(
  error: unknown,
  componentStack: string,
): boolean {
  return isRecoverableBlockNoteRenderError(error)
    && (
      hasRecoveredRenderErrorMark(error)
      || componentStack.includes(BLOCKNOTE_RECOVERY_BOUNDARY_NAME)
    )
}
