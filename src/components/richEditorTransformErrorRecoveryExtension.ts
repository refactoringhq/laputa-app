import { createExtension } from '@blocknote/core'
import { trackEvent } from '../lib/telemetry'

const DISPATCH_RECOVERY_STATE_KEY = '__tolariaRichEditorTransformErrorRecovery'

type RichEditorDispatch = (transaction: unknown) => unknown

interface RichEditorDispatchView {
  dispatch: RichEditorDispatch
  state?: {
    doc?: {
      eq?: (other: unknown) => boolean
    }
  }
}

interface DispatchRecoveryState {
  originalDispatch: RichEditorDispatch
  refCount: number
}

type RecoveryReason = 'mismatched_transaction' | 'stale_transaction' | 'transform_error'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDispatchRecoveryState(value: unknown): value is DispatchRecoveryState {
  return isRecord(value)
    && typeof value.originalDispatch === 'function'
    && typeof value.refCount === 'number'
}

function transactionBefore(transaction: unknown): unknown {
  return isRecord(transaction) ? transaction.before : undefined
}

function transactionDocIsStale(transaction: unknown, view: RichEditorDispatchView): boolean {
  const before = transactionBefore(transaction)
  const currentDoc = view.state?.doc
  if (!before || !currentDoc || typeof currentDoc.eq !== 'function') return false

  return !currentDoc.eq(before)
}

function isMismatchedTransactionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Applying a mismatched transaction')
}

export function isRecoverableEditorTransformError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'TransformError'
    || isMismatchedTransactionError(error)
  )
}

function recoveryReason(
  error: unknown,
  transaction: unknown,
  view: RichEditorDispatchView,
): RecoveryReason {
  if (transactionDocIsStale(transaction, view)) return 'stale_transaction'
  if (isMismatchedTransactionError(error)) return 'mismatched_transaction'
  return 'transform_error'
}

export function reportRecoveredEditorTransformError(reason: RecoveryReason, error: unknown): void {
  console.warn('[editor] Recovered rich-editor transform error:', error)
  trackEvent('rich_editor_transform_error_recovered', { reason })
}

function releaseRecoveryState(
  view: RichEditorDispatchView,
  recoveryState: DispatchRecoveryState,
  originalDispatch: RichEditorDispatch,
): void {
  const state = Reflect.get(view, DISPATCH_RECOVERY_STATE_KEY)
  if (!isDispatchRecoveryState(state) || state.originalDispatch !== originalDispatch) return

  state.refCount -= 1
  if (state.refCount > 0) return

  view.dispatch = recoveryState.originalDispatch
  Reflect.deleteProperty(view, DISPATCH_RECOVERY_STATE_KEY)
}

function retainRecoveryState(
  view: RichEditorDispatchView,
  recoveryState: DispatchRecoveryState,
): () => void {
  recoveryState.refCount += 1
  return () => releaseRecoveryState(view, recoveryState, recoveryState.originalDispatch)
}

function createRecoveringDispatch(
  view: RichEditorDispatchView,
  originalDispatch: RichEditorDispatch,
): RichEditorDispatch {
  return (transaction: unknown) => {
    try {
      return originalDispatch.call(view, transaction)
    } catch (error) {
      if (!isRecoverableEditorTransformError(error)) throw error

      reportRecoveredEditorTransformError(recoveryReason(error, transaction, view), error)
      return undefined
    }
  }
}

function installRecoveryState(
  view: RichEditorDispatchView,
  originalDispatch: RichEditorDispatch,
): DispatchRecoveryState {
  const recoveryState: DispatchRecoveryState = {
    originalDispatch,
    refCount: 1,
  }

  view.dispatch = createRecoveringDispatch(view, originalDispatch)
  Reflect.set(view, DISPATCH_RECOVERY_STATE_KEY, recoveryState)
  return recoveryState
}

export function installRichEditorTransformErrorRecovery(view: RichEditorDispatchView): () => void {
  const currentState = Reflect.get(view, DISPATCH_RECOVERY_STATE_KEY)
  if (isDispatchRecoveryState(currentState)) {
    return retainRecoveryState(view, currentState)
  }

  const originalDispatch = view.dispatch
  const recoveryState = installRecoveryState(view, originalDispatch)

  return () => releaseRecoveryState(view, recoveryState, originalDispatch)
}

export const createRichEditorTransformErrorRecoveryExtension = createExtension(({ editor }) => ({
  key: 'richEditorTransformErrorRecovery',
  mount: ({ signal }) => {
    const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
    if (!view || typeof view.dispatch !== 'function') return

    const uninstall = installRichEditorTransformErrorRecovery(view as unknown as RichEditorDispatchView)
    signal.addEventListener('abort', uninstall, { once: true })
  },
} as const))
