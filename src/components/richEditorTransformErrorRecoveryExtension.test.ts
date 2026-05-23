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

function expectDocumentRepairRecovery(error: Error, reason: string) {
  const { currentDoc, view } = createView(error)
  const recoverDocument = vi.fn()

  installRichEditorTransformErrorRecovery(view, { recoverDocument })

  expect(() => view.dispatch({ before: currentDoc })).not.toThrow()
  expect(recoverDocument).toHaveBeenCalledTimes(1)
  expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
    reason,
  })
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
    expect(isRecoverableEditorTransformError(new RangeError(
      'Invalid content for node blockContainer: <paragraph("Procedures are long-running"), blockGroup(blockContainer(bulletListItem("Step")))>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Inserted content deeper than insertion position',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new Error(
      'Block with ID 6c1c3bb4-e218-4f00-aaf5-40606852d286 not found',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Index 1 out of range for <paragraph("A")>',
    ))).toBe(false)
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

  it('recovers invalid-content schema transactions from mixed paragraph and list editing', () => {
    expectDocumentRepairRecovery(
      new RangeError(
        'Invalid content for node blockContainer: <paragraph("Procedures are long-running"), blockGroup(blockContainer(bulletListItem("Step")))>',
      ),
      'transform_error',
    )
  })

  it('recovers table selection transactions whose target row changed underneath BlockNote', () => {
    expectDocumentRepairRecovery(
      new RangeError('Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>'),
      'table_position_out_of_range',
    )
  })

  it('recovers invalid insertion-depth transactions after note switching and saves', () => {
    expectDocumentRepairRecovery(
      new RangeError('Inserted content deeper than insertion position'),
      'invalid_insertion_depth',
    )
  })

  it('recovers stale block-reference transactions from toolbar actions', () => {
    const { currentDoc, view } = createView(new Error(
      'Block with ID 6c1c3bb4-e218-4f00-aaf5-40606852d286 not found',
    ))
    const recoverDocument = vi.fn()

    installRichEditorTransformErrorRecovery(view, { recoverDocument })

    expect(() => view.dispatch({ before: currentDoc })).not.toThrow()
    expect(recoverDocument).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'stale_block_reference',
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

  it('restores the previous recoverDocument callback when a later install unmounts', () => {
    const schemaError = new RangeError(
      'Invalid content for node blockContainer: <paragraph("Procedures are long-running"), blockGroup(blockContainer(bulletListItem("Step")))>',
    )
    const { currentDoc, view } = createView(schemaError)
    const firstRecoverDocument = vi.fn()
    const secondRecoverDocument = vi.fn()

    installRichEditorTransformErrorRecovery(view, { recoverDocument: firstRecoverDocument })
    const secondUninstall = installRichEditorTransformErrorRecovery(view, { recoverDocument: secondRecoverDocument })
    secondUninstall()

    view.dispatch({ before: currentDoc })

    expect(firstRecoverDocument).toHaveBeenCalledTimes(1)
    expect(secondRecoverDocument).not.toHaveBeenCalled()
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

  it('repairs malformed list-heavy editor documents when invalid-content dispatch fails', () => {
    const schemaError = new RangeError(
      'Invalid content for node blockContainer: <paragraph("Procedures are long-running"), blockGroup(blockContainer(bulletListItem("Step")))>',
    )
    const { currentDoc, view } = createView(schemaError)
    const childListItem = {
      id: 'list-child',
      type: 'bulletListItem',
      content: [{ type: 'text', text: 'Step', styles: {} }],
      children: [],
    }
    const paragraph = {
      id: 'paragraph-parent',
      type: 'paragraph',
      content: [{ type: 'text', text: 'Procedures are long-running', styles: {} }],
      children: [childListItem],
    }
    const editor = {
      document: [paragraph],
      replaceBlocks: vi.fn(),
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

    expect(() => view.dispatch({ before: currentDoc })).not.toThrow()
    expect(editor.replaceBlocks).toHaveBeenCalledWith(
      [paragraph],
      [
        { ...paragraph, children: [] },
        childListItem,
      ],
    )

    controller.abort()
  })
})
