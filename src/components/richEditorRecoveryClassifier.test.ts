import { describe, expect, it } from 'vitest'
import {
  classifyRichEditorRecoveryError,
  richEditorRecoveryErrorNeedsDocumentRepair,
} from './richEditorRecoveryClassifier'

function transformError(message = 'Invalid transform') {
  const error = new Error(message)
  error.name = 'TransformError'
  return error
}

describe('richEditorRecoveryClassifier', () => {
  function webkitNotFoundError(message = 'The object can not be found here.') {
    const error = new Error(message)
    error.name = 'NotFoundError'
    return error
  }

  it('normalizes ProseMirror index failures across render and transform recovery', () => {
    const tableError = new RangeError(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    )
    const paragraphError = new Error('Index 1 out of range for <paragraph("/")>')
    const emptyFragmentError = new RangeError('Index 0 out of range for <>')

    expect(classifyRichEditorRecoveryError(tableError, 'render')).toBe('table_row_index_out_of_range')
    expect(classifyRichEditorRecoveryError(tableError, 'transform')).toBe('table_row_index_out_of_range')
    expect(classifyRichEditorRecoveryError(paragraphError, 'render')).toBe('paragraph_index_out_of_range')
    expect(classifyRichEditorRecoveryError(paragraphError, 'transform')).toBe('paragraph_index_out_of_range')
    expect(classifyRichEditorRecoveryError(emptyFragmentError, 'render')).toBe('empty_fragment_index_out_of_range')
    expect(classifyRichEditorRecoveryError(emptyFragmentError, 'transform')).toBe('empty_fragment_index_out_of_range')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(emptyFragmentError)).toBe(true)
  })

  it('classifies missing-id failures across render and transform recovery', () => {
    expect(classifyRichEditorRecoveryError(new Error("Block doesn't have id"), 'render')).toBe('block_missing_id')
    expect(classifyRichEditorRecoveryError(new Error("Block doesn't have id"), 'transform')).toBe('block_missing_id')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(new Error("Block doesn't have id"))).toBe(true)
  })

  it('classifies DOM NotFoundError across editor recovery surfaces', () => {
    expect(classifyRichEditorRecoveryError(webkitNotFoundError(), 'transform')).toBe('dom_not_found')
    expect(classifyRichEditorRecoveryError(webkitNotFoundError(), 'render')).toBe('dom_not_found')
    expect(classifyRichEditorRecoveryError(transformError(), 'transform')).toBe('transform_error')
    expect(classifyRichEditorRecoveryError(transformError(), 'render')).toBeNull()
  })

  it('classifies null firstChild editor DOM races across recovery surfaces', () => {
    const error = new TypeError("Cannot read properties of null (reading 'firstChild')")

    expect(classifyRichEditorRecoveryError(error, 'transform')).toBe('dom_not_found')
    expect(classifyRichEditorRecoveryError(error, 'render')).toBe('dom_not_found')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(error)).toBe(false)
  })

  it('classifies the WebKit filesystem NotFoundError message from production', () => {
    const error = webkitNotFoundError(
      'A requested file or directory could not be found at the time an operation was processed.',
    )

    expect(classifyRichEditorRecoveryError(error, 'transform')).toBe('dom_not_found')
    expect(classifyRichEditorRecoveryError(error, 'render')).toBe('dom_not_found')
  })

  it('separates document repair decisions from telemetry reason names', () => {
    const invalidContentError = new RangeError(
      'Invalid content for node blockContainer: <paragraph("A"), blockGroup(blockContainer(bulletListItem("B")))>',
    )
    const staleBlockError = new Error('Block with ID block-1 not found')

    expect(classifyRichEditorRecoveryError(invalidContentError, 'transform')).toBe('transform_error')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(invalidContentError)).toBe(true)
    expect(classifyRichEditorRecoveryError(staleBlockError, 'render')).toBe('stale_block_reference')
    expect(classifyRichEditorRecoveryError(staleBlockError, 'transform')).toBe('stale_block_reference')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(staleBlockError)).toBe(false)
  })
})
