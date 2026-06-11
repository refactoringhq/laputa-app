import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import {
  isRecoverableEditorTransformError,
  reportRecoveredEditorTransformError,
  richEditorTransformRecoveryErrorReason,
} from './richEditorTransformErrorRecoveryExtension'

export type RichEditorInputView = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>
export type RichEditorInputTransaction = Parameters<RichEditorInputView['dispatch']>[0]

export interface RichEditorInputTransformContext {
  view: RichEditorInputView
}

export interface RichEditorInputTransformResult {
  ignoreDispatchError?: boolean
  onDispatchError?: (error: unknown) => void
  preventDefault?: boolean
  transaction: RichEditorInputTransaction
}

export interface RichEditorInputTransform {
  handleBeforeInput: (
    event: InputEvent,
    context: RichEditorInputTransformContext
  ) => RichEditorInputTransformResult | null
  reset?: () => void
}

interface RichEditorInputTransformExtensionOptions {
  createTransforms: () => RichEditorInputTransform[]
  key: string
}

interface MountRichEditorInputTransformsOptions {
  dom: HTMLElement
  readView: () => RichEditorInputView | undefined
  signal: AbortSignal
  transforms: RichEditorInputTransform[]
}

const RECOVERED_INPUT_TRANSFORM_ERROR = Symbol('recoveredInputTransformError')
type TransformReadResult = RichEditorInputTransformResult | null | typeof RECOVERED_INPUT_TRANSFORM_ERROR

function resetInputTransforms(transforms: RichEditorInputTransform[]): void {
  transforms.forEach((transform) => transform.reset?.())
}

function isLiveEditorView(view: RichEditorInputView): boolean {
  if (view.isDestroyed) return false
  if (view.dom?.isConnected === false) return false

  return true
}

function isComposingInput(event: InputEvent, view: RichEditorInputView): boolean {
  const inputType = typeof event.inputType === 'string' ? event.inputType : ''

  return event.isComposing
    || inputType.toLowerCase().includes('composition')
    || Boolean(view.composing)
}

export function recoverRichEditorInputTransformError(error: unknown): boolean {
  if (!isRecoverableEditorTransformError(error)) return false

  reportRecoveredEditorTransformError(
    richEditorTransformRecoveryErrorReason(error) ?? 'transform_error',
    error,
  )
  return true
}

function readTransformResult(
  transform: RichEditorInputTransform,
  event: InputEvent,
  context: RichEditorInputTransformContext,
): TransformReadResult {
  try {
    return transform.handleBeforeInput(event, context)
  } catch (error) {
    if (!recoverRichEditorInputTransformError(error)) throw error
    return RECOVERED_INPUT_TRANSFORM_ERROR
  }
}

function readReadyInputView({
  readView,
  transforms,
}: Omit<MountRichEditorInputTransformsOptions, 'dom' | 'signal'>): RichEditorInputView | null {
  const view = readView()
  if (!view) return null
  if (isLiveEditorView(view)) return view

  resetInputTransforms(transforms)
  return null
}

export function dispatchRichEditorInputTransaction(
  view: RichEditorInputView,
  result: RichEditorInputTransformResult,
): boolean {
  try {
    view.dispatch(result.transaction)
    return true
  } catch (error) {
    result.onDispatchError?.(error)
    if (recoverRichEditorInputTransformError(error)) return false
    if (result.ignoreDispatchError) return false
    throw error
  }
}

function completeInputTransform(
  event: InputEvent,
  view: RichEditorInputView,
  result: TransformReadResult,
): boolean {
  if (result === RECOVERED_INPUT_TRANSFORM_ERROR) return true
  if (!result) return false
  if (!dispatchRichEditorInputTransaction(view, result)) return true
  if (result.preventDefault) event.preventDefault()
  return true
}

function runInputTransform(
  transform: RichEditorInputTransform,
  event: InputEvent,
  view: RichEditorInputView,
): boolean {
  return completeInputTransform(
    event,
    view,
    readTransformResult(transform, event, { view }),
  )
}

function runInputTransforms(
  event: InputEvent,
  view: RichEditorInputView,
  transforms: RichEditorInputTransform[],
): void {
  transforms.some((transform) => runInputTransform(transform, event, view))
}

function handleRichEditorBeforeInput(
  event: InputEvent,
  { readView, transforms }: Omit<MountRichEditorInputTransformsOptions, 'dom' | 'signal'>,
): void {
  const view = readReadyInputView({ readView, transforms })
  if (!view) return
  if (isComposingInput(event, view)) return

  runInputTransforms(event, view, transforms)
}

export function mountRichEditorInputTransforms({
  dom,
  readView,
  signal,
  transforms,
}: MountRichEditorInputTransformsOptions): void {
  dom.addEventListener('beforeinput', ((event: InputEvent) => {
    handleRichEditorBeforeInput(event, { readView, transforms })
  }) as EventListener, {
    capture: true,
    signal,
  })
}

export function createRichEditorInputTransformExtension({
  createTransforms,
  key,
}: RichEditorInputTransformExtensionOptions) {
  return createExtension(({ editor }) => {
    const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView
    const transforms = createTransforms()

    return {
      key,
      mount: ({ dom, signal }) => {
        mountRichEditorInputTransforms({
          dom,
          readView,
          signal,
          transforms,
        })
      },
    } as const
  })
}
