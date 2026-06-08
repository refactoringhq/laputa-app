import { createExtension } from '@blocknote/core'
import { trackEvent } from '../lib/telemetry'
import { repairMalformedEditorBlocks } from '../hooks/editorBlockRepair'
import {
  classifyRichEditorRecoveryError,
  richEditorRecoveryErrorNeedsDocumentRepair,
  type RichEditorTransformRecoveryReason,
} from './richEditorRecoveryClassifier'
export { isStaleBlockReferenceError } from './richEditorRecoveryClassifier'

const DISPATCH_RECOVERY_STATE_KEY = '__tolariaRichEditorTransformErrorRecovery'

type RichEditorDispatch = (transaction: unknown) => unknown
type RichEditorPropRunner<T> = (prop: T) => unknown
type RichEditorSomeProp = <T>(propName: string, run?: RichEditorPropRunner<T>) => unknown
type RecoverEditorDocument = () => void
type RecoveryToken = symbol

interface RecoveryDocumentEntry {
  recoverDocument: RecoverEditorDocument
  token: RecoveryToken
}

interface RichEditorDispatchView {
  dispatch: RichEditorDispatch
  state?: {
    doc?: {
      eq?: (other: unknown) => boolean
    }
  }
}

interface RichEditorRecoveryView extends RichEditorDispatchView {
  someProp?: RichEditorSomeProp
}

interface DispatchRecoveryState {
  originalDispatch: RichEditorDispatch
  originalSomeProp?: RichEditorSomeProp
  recoverDocuments: RecoveryDocumentEntry[]
  refCount: number
}

interface InstallRecoveryOptions {
  recoverDocument?: RecoverEditorDocument
}

interface RepairableBlockNoteEditor {
  document?: unknown[]
  replaceBlocks?: (currentBlocks: unknown[], nextBlocks: unknown[]) => unknown
}

type RecoveryReason = RichEditorTransformRecoveryReason

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

export function isRecoverableEditorTransformError(error: unknown): boolean {
  return richEditorTransformRecoveryErrorReason(error) !== null
}

export function richEditorTransformRecoveryErrorReason(error: unknown): RecoveryReason | null {
  return classifyRichEditorRecoveryError(error, 'transform')
}

function recoveryReason(
  error: unknown,
  transaction: unknown,
  view: RichEditorDispatchView,
): RecoveryReason {
  if (transactionDocIsStale(transaction, view)) return 'stale_transaction'
  return richEditorTransformRecoveryErrorReason(error) ?? 'transform_error'
}

function shouldRepairEditorDocument(error: unknown): boolean {
  return richEditorRecoveryErrorNeedsDocumentRepair(error)
}

export const reportRecoveredEditorTransformError = (reason: RecoveryReason, error: unknown): void => {
  console.warn('[editor] Recovered rich-editor transform error:', error)
  trackEvent('rich_editor_transform_error_recovered', { reason })
}

function releaseRecoveryState(
  view: RichEditorRecoveryView,
  recoveryState: DispatchRecoveryState,
  originalDispatch: RichEditorDispatch,
  token: RecoveryToken,
): void {
  const state = Reflect.get(view, DISPATCH_RECOVERY_STATE_KEY)
  if (!isDispatchRecoveryState(state) || state.originalDispatch !== originalDispatch) return

  state.recoverDocuments = state.recoverDocuments.filter((entry) => !Object.is(entry.token, token))
  state.refCount -= 1
  if (state.refCount > 0) return

  view.dispatch = recoveryState.originalDispatch
  if (recoveryState.originalSomeProp) view.someProp = recoveryState.originalSomeProp
  Reflect.deleteProperty(view, DISPATCH_RECOVERY_STATE_KEY)
}

function retainRecoveryState(
  view: RichEditorRecoveryView,
  recoveryState: DispatchRecoveryState,
  token: RecoveryToken,
  recoverDocument?: RecoverEditorDocument,
): () => void {
  recoveryState.refCount += 1
  if (recoverDocument) recoveryState.recoverDocuments.push({ recoverDocument, token })
  return () => releaseRecoveryState(view, recoveryState, recoveryState.originalDispatch, token)
}

function activeRecoverDocument(recoveryState: { recoverDocuments: RecoveryDocumentEntry[] }): RecoverEditorDocument | undefined {
  return recoveryState.recoverDocuments.at(-1)?.recoverDocument
}

function recoverAfterEditorTransformError(
  error: unknown,
  transaction: unknown,
  view: RichEditorDispatchView,
  recoveryState: { recoverDocuments: RecoveryDocumentEntry[] },
): void {
  if (!isRecoverableEditorTransformError(error)) throw error

  if (shouldRepairEditorDocument(error)) {
    activeRecoverDocument(recoveryState)?.()
  }
  reportRecoveredEditorTransformError(recoveryReason(error, transaction, view), error)
}

function createRecoveringDispatch(
  view: RichEditorDispatchView,
  recoveryState: DispatchRecoveryState,
): RichEditorDispatch {
  return (transaction: unknown) => {
    try {
      return recoveryState.originalDispatch.call(view, transaction)
    } catch (error) {
      recoverAfterEditorTransformError(error, transaction, view, recoveryState)
      return undefined
    }
  }
}

function createRecoveringKeydownRunner<T>(
  view: RichEditorRecoveryView,
  recoveryState: DispatchRecoveryState,
  run: RichEditorPropRunner<T>,
): RichEditorPropRunner<T> {
  return (prop: T) => {
    try {
      return run(prop)
    } catch (error) {
      recoverAfterEditorTransformError(error, undefined, view, recoveryState)
      return true
    }
  }
}

function callSomeProp<T>(
  view: RichEditorRecoveryView,
  someProp: RichEditorSomeProp,
  propName: string,
  run?: RichEditorPropRunner<T>,
): unknown {
  const boundSomeProp = someProp as (
    this: RichEditorRecoveryView,
    propName: string,
    run?: RichEditorPropRunner<T>,
  ) => unknown

  return boundSomeProp.call(view, propName, run)
}

function createRecoveringSomeProp(
  view: RichEditorRecoveryView,
  recoveryState: DispatchRecoveryState,
): RichEditorSomeProp {
  return <T>(propName: string, run?: RichEditorPropRunner<T>) => {
    const originalSomeProp = recoveryState.originalSomeProp
    if (!originalSomeProp) return undefined

    if (propName !== 'handleKeyDown' || typeof run !== 'function') {
      return callSomeProp(view, originalSomeProp, propName, run)
    }

    return callSomeProp(
      view,
      originalSomeProp,
      propName,
      createRecoveringKeydownRunner(view, recoveryState, run),
    )
  }
}

function installRecoveryState(
  view: RichEditorRecoveryView,
  originalDispatch: RichEditorDispatch,
  token: RecoveryToken,
  recoverDocument?: RecoverEditorDocument,
): DispatchRecoveryState {
  const originalSomeProp = typeof view.someProp === 'function' ? view.someProp : undefined
  const recoveryState: DispatchRecoveryState = {
    originalDispatch,
    originalSomeProp,
    recoverDocuments: recoverDocument ? [{ recoverDocument, token }] : [],
    refCount: 1,
  }

  view.dispatch = createRecoveringDispatch(view, recoveryState)
  if (originalSomeProp) view.someProp = createRecoveringSomeProp(view, recoveryState)
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
  view: RichEditorRecoveryView,
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
      view as unknown as RichEditorRecoveryView,
      { recoverDocument: () => repairEditorDocumentAfterInvalidContentError(editor as RepairableBlockNoteEditor) },
    )
    signal.addEventListener('abort', uninstall, { once: true })
  },
} as const))
