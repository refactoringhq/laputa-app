import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import {
  createRichEditorTransformErrorRecoveryExtension,
  installRichEditorTransformErrorRecovery,
  isRecoverableEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function transformError(message = 'Invalid transform') {
  const error = new Error(message)
  error.name = 'TransformError'
  return error
}

function createView(error?: Error) {
  const currentDoc = {
    eq: vi.fn((candidate: unknown) => candidate === currentDoc),
  }
  const dispatch = vi.fn(() => {
    if (error) throw error
    return 'dispatched'
  })
  const view = {
    dispatch,
    state: { doc: currentDoc },
  }

  return { currentDoc, dispatch, view }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('isRecoverableEditorTransformError', () => {
  it('recognizes ProseMirror transform and mismatched transaction failures', () => {
    expect(isRecoverableEditorTransformError(transformError())).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError('Applying a mismatched transaction'))).toBe(true)
    expect(isRecoverableEditorTransformError(new Error('unrelated'))).toBe(false)
  })
})

describe('installRichEditorTransformErrorRecovery', () => {
  it('recovers stale transform errors without rethrowing from editor dispatch', () => {
    const { dispatch, view } = createView(transformError())
    const previousDoc = { stale: true }

    installRichEditorTransformErrorRecovery(view)

    expect(() => view.dispatch({ before: previousDoc })).not.toThrow()
    expect(dispatch).toHaveBeenCalledWith({ before: previousDoc })
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'stale_transaction',
    })
  })

  it('recovers ProseMirror mismatched transactions from active key handling', () => {
    const { currentDoc, view } = createView(new RangeError('Applying a mismatched transaction'))

    installRichEditorTransformErrorRecovery(view)

    expect(() => view.dispatch({ before: currentDoc })).not.toThrow()
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'mismatched_transaction',
    })
  })

  it('keeps non-ProseMirror dispatch failures visible', () => {
    const { view } = createView(new Error('plugin failed'))

    installRichEditorTransformErrorRecovery(view)

    expect(() => view.dispatch({})).toThrow('plugin failed')
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('restores the original dispatch after all installs are cleaned up', () => {
    const { dispatch, view } = createView()

    const firstUninstall = installRichEditorTransformErrorRecovery(view)
    const secondUninstall = installRichEditorTransformErrorRecovery(view)
    const wrappedDispatch = view.dispatch

    expect(wrappedDispatch).not.toBe(dispatch)

    firstUninstall()
    expect(view.dispatch).toBe(wrappedDispatch)

    secondUninstall()
    expect(view.dispatch).toBe(dispatch)
  })
})

describe('createRichEditorTransformErrorRecoveryExtension', () => {
  it('installs and removes dispatch recovery with the BlockNote mount signal', () => {
    const { dispatch, view } = createView()
    const editor = {
      _tiptapEditor: { view },
      prosemirrorView: view,
    }
    const extension = createRichEditorTransformErrorRecoveryExtension()({ editor: editor as never })
    const controller = new AbortController()

    extension.mount?.({
      dom: document.createElement('div'),
      root: document,
      signal: controller.signal,
    })
    expect(view.dispatch).not.toBe(dispatch)

    controller.abort()

    expect(view.dispatch).toBe(dispatch)
  })
})
