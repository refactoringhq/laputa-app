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

function nullFragmentAppendError(message = "null is not an object (evaluating 'o.fillBefore(e).append')") {
  return new TypeError(message)
}

function indexSizeError() {
  return new DOMException('The index is not in the allowed range.', 'IndexSizeError')
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

function createViewWithSomeProp(handleKeyDown: () => boolean) {
  const { currentDoc, dispatch, view } = createView()
  const keyDownPlugin = vi.fn(handleKeyDown)
  const someProp = vi.fn((_propName: string, run?: (prop: typeof keyDownPlugin) => unknown) => (
    run?.(keyDownPlugin)
  ))

  return {
    currentDoc,
    dispatch,
    keyDownPlugin,
    view: {
      ...view,
      someProp,
    },
  }
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
    expect(isRecoverableEditorTransformError(transformError(
      'Cannot join blockGroup onto blockContainer',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Inserted content deeper than insertion position',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new Error(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new RangeError(
      'Index 1 out of range for <paragraph("/")>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new Error(
      'Index 1 out of range for <paragraph("/")>',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(new Error(
      'Block with ID 6c1c3bb4-e218-4f00-aaf5-40606852d286 not found',
    ))).toBe(true)
    expect(isRecoverableEditorTransformError(nullFragmentAppendError())).toBe(true)
    const stackOnlyAppendError = nullFragmentAppendError("Cannot read properties of null (reading 'append')")
    stackOnlyAppendError.stack =
      "TypeError: Cannot read properties of null (reading 'append')\n    at o.fillBefore(e).append (App-CrXlNLOq.js:1:1)"
    expect(isRecoverableEditorTransformError(stackOnlyAppendError)).toBe(true)
    expect(isRecoverableEditorTransformError(indexSizeError())).toBe(true)
    expect(isRecoverableEditorTransformError(new TypeError(
      "Cannot read properties of null (reading 'append')",
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

  it('repairs invalid block joins after pull refreshes editor state', () => {
    expectDocumentRepairRecovery(
      transformError('Cannot join blockGroup onto blockContainer'),
      'invalid_block_join',
    )
  })

  it('repairs invalid table-cell joins while editing table contents', () => {
    expectDocumentRepairRecovery(
      transformError('Cannot join tableCell onto blockContainer'),
      'invalid_block_join',
    )
  })

  it('recovers invalid block joins thrown during keydown handling before dispatch', () => {
    const { view, keyDownPlugin } = createViewWithSomeProp(() => {
      throw transformError('Cannot join blockGroup onto blockContainer')
    })
    const recoverDocument = vi.fn()

    installRichEditorTransformErrorRecovery(view, { recoverDocument })

    expect(view.someProp('handleKeyDown', (handler) => handler())).toBe(true)
    expect(keyDownPlugin).toHaveBeenCalledTimes(1)
    expect(recoverDocument).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'invalid_block_join',
    })
  })

  it('recovers invalid table-cell joins thrown during keydown handling', () => {
    const { view, keyDownPlugin } = createViewWithSomeProp(() => {
      throw transformError('Cannot join tableCell onto blockContainer')
    })
    const recoverDocument = vi.fn()

    installRichEditorTransformErrorRecovery(view, { recoverDocument })

    expect(view.someProp('handleKeyDown', (handler) => handler())).toBe(true)
    expect(keyDownPlugin).toHaveBeenCalledTimes(1)
    expect(recoverDocument).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'invalid_block_join',
    })
  })

  it('keeps unrelated keydown handler failures visible', () => {
    const { view } = createViewWithSomeProp(() => {
      throw new Error('keyboard plugin failed')
    })

    installRichEditorTransformErrorRecovery(view)

    expect(() => view.someProp('handleKeyDown', (handler) => handler())).toThrow('keyboard plugin failed')
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('recovers table selection transactions whose target row changed underneath BlockNote', () => {
    expectDocumentRepairRecovery(
      new RangeError('Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>'),
      'table_row_index_out_of_range',
    )
  })

  it('recovers production table row index transactions reported as plain errors', () => {
    expectDocumentRepairRecovery(
      new Error('Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>'),
      'table_row_index_out_of_range',
    )
  })

  it('recovers production paragraph index transactions from stale slash input', () => {
    expectDocumentRepairRecovery(
      new RangeError('Index 1 out of range for <paragraph("/")>'),
      'paragraph_index_out_of_range',
    )
  })

  it('recovers invalid insertion-depth transactions after note switching and saves', () => {
    expectDocumentRepairRecovery(
      new RangeError('Inserted content deeper than insertion position'),
      'invalid_insertion_depth',
    )
  })

  it('repairs null fragment append failures from invalid document model fills', () => {
    expectDocumentRepairRecovery(
      nullFragmentAppendError(),
      'null_fragment_append',
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

  it('recovers DOM index-size selection failures from editor dispatch', () => {
    const { currentDoc, view } = createView(indexSizeError())

    installRichEditorTransformErrorRecovery(view)

    expect(() => view.dispatch({ before: currentDoc })).not.toThrow()
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'dom_index_size',
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

  it('restores the original keydown prop lookup after all installs are cleaned up', () => {
    const { view } = createViewWithSomeProp(() => false)
    const originalSomeProp = view.someProp

    const firstUninstall = installRichEditorTransformErrorRecovery(view)
    const secondUninstall = installRichEditorTransformErrorRecovery(view)
    const wrappedSomeProp = view.someProp

    expect(wrappedSomeProp).not.toBe(originalSomeProp)

    firstUninstall()
    expect(view.someProp).toBe(wrappedSomeProp)

    secondUninstall()
    expect(view.someProp).toBe(originalSomeProp)
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
