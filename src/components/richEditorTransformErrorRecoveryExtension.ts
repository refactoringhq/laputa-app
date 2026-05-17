import { createExtension } from '@blocknote/core'
import { trackEvent } from '../lib/telemetry'
import { repairMalformedEditorBlocks } from '../hooks/editorBlockRepair'

const DISPATCH_RECOVERY_STATE_KEY = '__tolariaRichEditorTransformErrorRecovery'

type RichEditorDispatch = (transaction: unknown) => unknown
type RecoverEditorDocument = () => void
type RecoveryToken = symbol

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
  recoverDocuments: Array<{
    recoverDocument: RecoverEditorDocument
    token: RecoveryToken
  }>
  refCount: number
}

interface InstallRecoveryOptions {
  recoverDocument?: RecoverEditorDocument
}

interface RepairableBlockNoteEditor {
  document?: unknown[]
  replaceBlocks?: (currentBlocks: unknown[], nextBlocks: unknown[]) => unknown
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

function isInvalidContentTransactionError(error: unknown): boolean {
  return error instanceof RangeError && error.message.startsWith('Invalid content for node ')
}

export function isRecoverableEditorTransformError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'TransformError'
    || isMismatchedTransactionError(error)
    || isInvalidContentTransactionError(error)
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
  token: RecoveryToken,
): void {
  const state = Reflect.get(view, DISPATCH_RECOVERY_STATE_KEY)
  if (!isDispatchRecoveryState(state) || state.originalDispatch !== originalDispatch) return

  state.recoverDocuments = state.recoverDocuments.filter((entry) => entry.token !== token)
  state.refCount -= 1
  if (state.refCount > 0) return

  view.dispatch = recoveryState.originalDispatch
  Reflect.deleteProperty(view, DISPATCH_RECOVERY_STATE_KEY)
}

function retainRecoveryState(
  view: RichEditorDispatchView,
  recoveryState: DispatchRecoveryState,
  token: RecoveryToken,
  recoverDocument?: RecoverEditorDocument,
): () => void {
  recoveryState.refCount += 1
  if (recoverDocument) recoveryState.recoverDocuments.push({ recoverDocument, token })
  return () => releaseRecoveryState(view, recoveryState, recoveryState.originalDispatch, token)
}

function activeRecoverDocument(recoveryState: DispatchRecoveryState): RecoverEditorDocument | undefined {
  return recoveryState.recoverDocuments.at(-1)?.recoverDocument
}

function createRecoveringDispatch(
  view: RichEditorDispatchView,
  recoveryState: DispatchRecoveryState,
): RichEditorDispatch {
  return (transaction: unknown) => {
    try {
      return recoveryState.originalDispatch.call(view, transaction)
    } catch (error) {
      if (!isRecoverableEditorTransformError(error)) throw error

      if (isInvalidContentTransactionError(error)) {
        activeRecoverDocument(recoveryState)?.()
      }
      reportRecoveredEditorTransformError(recoveryReason(error, transaction, view), error)
      return undefined
    }
  }
}

function installRecoveryState(
  view: RichEditorDispatchView,
  originalDispatch: RichEditorDispatch,
  token: RecoveryToken,
  recoverDocument?: RecoverEditorDocument,
): DispatchRecoveryState {
  const recoveryState: DispatchRecoveryState = {
    originalDispatch,
    recoverDocuments: recoverDocument ? [{ recoverDocument, token }] : [],
    refCount: 1,
  }

  view.dispatch = createRecoveringDispatch(view, recoveryState)
  Reflect.set(view, DISPATCH_RECOVERY_STATE_KEY, recoveryState)
  return recoveryState
}

function repairEditorDocumentAfterInvalidContentError(editor: RepairableBlockNoteEditor): void {
  if (!Array.isArray(editor.document) || typeof editor.replaceBlocks !== 'function') return

  const currentBlocks = editor.document
  const safeBlocks = repairMalformedEditorBlocks(currentBlocks)
  if (safeBlocks === currentBlocks) return

  try {
    editor.replaceBlocks(currentBlocks, safeBlocks)
  } catch (error) {
    console.warn('[editor] Failed to repair rich-editor document after transform error:', error)
  }
}

export function installRichEditorTransformErrorRecovery(
  view: RichEditorDispatchView,
  options: InstallRecoveryOptions = {},
): () => void {
  const token = Symbol('rich-editor-transform-error-recovery')
  const currentState = Reflect.get(view, DISPATCH_RECOVERY_STATE_KEY)
  if (isDispatchRecoveryState(currentState)) {
    return retainRecoveryState(view, currentState, token, options.recoverDocument)
  }

  const originalDispatch = view.dispatch
  const recoveryState = installRecoveryState(view, originalDispatch, token, options.recoverDocument)

  return () => releaseRecoveryState(view, recoveryState, originalDispatch, token)
}

export const createRichEditorTransformErrorRecoveryExtension = createExtension(({ editor }) => ({
  key: 'richEditorTransformErrorRecovery',
  mount: ({ signal }) => {
    const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
    if (!view || typeof view.dispatch !== 'function') return

    const uninstall = installRichEditorTransformErrorRecovery(
      view as unknown as RichEditorDispatchView,
      { recoverDocument: () => repairEditorDocumentAfterInvalidContentError(editor as RepairableBlockNoteEditor) },
    )
    signal.addEventListener('abort', uninstall, { once: true })
  },
} as const))
