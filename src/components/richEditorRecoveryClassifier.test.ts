import { describe, expect, it } from 'vitest'
import {
  classifyRichEditorRecoveryError,
  richEditorRecoveryErrorNeedsDocumentRepair,
  SHARED_RICH_EDITOR_RECOVERY_REASONS,
  type RichEditorSharedRecoveryReason,
} from './richEditorRecoveryClassifier'

function transformError(message = 'Invalid transform') {
  const error = new Error(message)
  error.name = 'TransformError'
  return error
}

function nodeIndexMessage(nodeDescription: string, index = 1) {
  const openNode = String.fromCharCode(60)
  const closeNode = String.fromCharCode(62)

  return `Index ${index} out of range for ${openNode}${nodeDescription}${closeNode}`
}

function tableRootIndexMessage() {
  return nodeIndexMessage(
    'table(tableRow(tableCell(tableParagraph), tableCell(tableParagraph("done")), tableCell(tableParagraph("@zhaoliu"))))',
  )
}

function webkitNotFoundError(message = 'The object can not be found here.') {
  const error = new Error(message)
  error.name = 'NotFoundError'
  return error
}

interface SharedRecoveryCase {
  error: Error
  needsDocumentRepair: boolean
  reason: RichEditorSharedRecoveryReason
}

const sharedRecoveryCases: SharedRecoveryCase[] = [
  {
    error: new Error('Block type does not match'),
    needsDocumentRepair: false,
    reason: 'block_type_mismatch',
  },
  {
    error: new Error("Block doesn't have id"),
    needsDocumentRepair: true,
    reason: 'block_missing_id',
  },
  {
    error: webkitNotFoundError(),
    needsDocumentRepair: false,
    reason: 'dom_not_found',
  },
  {
    error: new RangeError(nodeIndexMessage('', 0)),
    needsDocumentRepair: true,
    reason: 'empty_fragment_index_out_of_range',
  },
  {
    error: new Error(nodeIndexMessage('paragraph("/")')),
    needsDocumentRepair: true,
    reason: 'paragraph_index_out_of_range',
  },
  {
    error: new RangeError('Selection passed to setSelection must point at the current document'),
    needsDocumentRepair: false,
    reason: 'prosemirror_position_out_of_range',
  },
  {
    error: new Error('Block with ID block-1 not found'),
    needsDocumentRepair: false,
    reason: 'stale_block_reference',
  },
  {
    error: new RangeError(tableRootIndexMessage()),
    needsDocumentRepair: true,
    reason: 'table_row_index_out_of_range',
  },
  {
    error: new TypeError("Cannot read properties of undefined (reading 'type')"),
    needsDocumentRepair: false,
    reason: 'undefined_node_type',
  },
]

describe('richEditorRecoveryClassifier', () => {
  it('defines the shared recovery reason source once', () => {
    expect(SHARED_RICH_EDITOR_RECOVERY_REASONS).toEqual(
      sharedRecoveryCases.map(({ reason }) => reason),
    )
  })

  it.each(sharedRecoveryCases)(
    'classifies shared $reason errors once for both recovery surfaces',
    ({ error, needsDocumentRepair, reason }) => {
      expect(classifyRichEditorRecoveryError(error, 'render')).toBe(reason)
      expect(classifyRichEditorRecoveryError(error, 'transform')).toBe(reason)
      expect(richEditorRecoveryErrorNeedsDocumentRepair(error)).toBe(needsDocumentRepair)
    },
  )

  it('keeps render-only recovery reasons off the transform surface', () => {
    const error = new Error('Maximum update depth exceeded')

    expect(classifyRichEditorRecoveryError(error, 'render')).toBe('react_update_depth_exceeded')
    expect(classifyRichEditorRecoveryError(error, 'transform')).toBeNull()
  })

  it('keeps transform-only recovery reasons off the render surface', () => {
    const error = transformError()

    expect(classifyRichEditorRecoveryError(error, 'transform')).toBe('transform_error')
    expect(classifyRichEditorRecoveryError(error, 'render')).toBeNull()
  })

  it('recognizes every stale ProseMirror document position as the shared reason', () => {
    const stalePositionErrors = [
      new RangeError('Position 21183 out of range'),
      new RangeError('Selection points outside of document'),
      new RangeError('Selection passed to setSelection must point at the current document'),
    ]

    for (const error of stalePositionErrors) {
      expect(classifyRichEditorRecoveryError(error, 'render')).toBe('prosemirror_position_out_of_range')
      expect(classifyRichEditorRecoveryError(error, 'transform')).toBe('prosemirror_position_out_of_range')
    }
  })

  it('classifies null firstChild DOM races as the shared DOM reason', () => {
    const error = new TypeError("Cannot read properties of null (reading 'firstChild')")

    expect(classifyRichEditorRecoveryError(error, 'transform')).toBe('dom_not_found')
    expect(classifyRichEditorRecoveryError(error, 'render')).toBe('dom_not_found')
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

    expect(classifyRichEditorRecoveryError(invalidContentError, 'transform')).toBe('transform_error')
    expect(richEditorRecoveryErrorNeedsDocumentRepair(invalidContentError)).toBe(true)
  })
})
