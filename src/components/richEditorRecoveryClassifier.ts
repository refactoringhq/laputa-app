const BLOCKNOTE_MISSING_ID_ERROR = "Block doesn't have id"
const BLOCKNOTE_BLOCK_TYPE_MISMATCH_ERROR = 'Block type does not match'
const BLOCKNOTE_EMPTY_FRAGMENT_INDEX_ERROR = /^Index \d+ out of range for <>$/
const BLOCKNOTE_TABLE_ROW_INDEX_ERROR = /^Index \d+ out of range for <tableRow\(/
const BLOCKNOTE_PARAGRAPH_INDEX_ERROR = /^Index \d+ out of range for <paragraph\(/
const NULL_APPEND_PROPERTY_ERROR = "Cannot read properties of null (reading 'append')"
const REACT_UPDATE_DEPTH_EXCEEDED_ERROR = 'Maximum update depth exceeded'
const REACT_MINIFIED_UPDATE_DEPTH_ERROR = /\b(?:React error #185|errors\/185|#185)\b/
const WEBKIT_DOM_NOT_FOUND_MESSAGES = [
  'The object can not be found here',
  'A requested file or directory could not be found at the time an operation was processed',
]

export type BlockNoteRenderRecoveryReason =
  | 'block_type_mismatch'
  | 'block_missing_id'
  | 'dom_not_found'
  | 'empty_fragment_index_out_of_range'
  | 'paragraph_index_out_of_range'
  | 'react_update_depth_exceeded'
  | 'stale_block_reference'
  | 'table_row_index_out_of_range'

export type RichEditorTransformRecoveryReason =
  | 'block_type_mismatch'
  | 'block_missing_id'
  | 'dom_index_size'
  | 'dom_not_found'
  | 'empty_fragment_index_out_of_range'
  | 'invalid_block_join'
  | 'invalid_insertion_depth'
  | 'mismatched_transaction'
  | 'null_fragment_append'
  | 'paragraph_index_out_of_range'
  | 'stale_block_reference'
  | 'stale_transaction'
  | 'table_row_index_out_of_range'
  | 'transform_error'

type RichEditorRecoverySurface = 'render' | 'transform'
type StaticTransformRecoveryReason = Exclude<RichEditorTransformRecoveryReason, 'stale_transaction'>
type RichEditorRecoveryReason = BlockNoteRenderRecoveryReason | StaticTransformRecoveryReason

interface RecoveryErrorMatcher {
  matches: (error: unknown) => boolean
  reason: RichEditorRecoveryReason
  repairsDocument?: boolean
  surfaces: RichEditorRecoverySurface[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message
}

function messageIncludes(error: unknown, text: string): boolean {
  return error instanceof Error && error.message.includes(text)
}

function messageMatches(error: unknown, pattern: RegExp): boolean {
  return error instanceof Error && pattern.test(error.message)
}

function isMismatchedTransactionError(error: unknown): boolean {
  return messageIncludes(error, 'Applying a mismatched transaction')
}

function isInvalidContentTransactionError(error: unknown): boolean {
  return error instanceof RangeError && error.message.startsWith('Invalid content for node ')
}

function isReactUpdateDepthExceededError(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message.includes(REACT_UPDATE_DEPTH_EXCEEDED_ERROR)
      || REACT_MINIFIED_UPDATE_DEPTH_ERROR.test(error.message)
    )
}

function isInvalidInsertionDepthError(error: unknown): boolean {
  return error instanceof RangeError && messageIncludes(error, 'Inserted content deeper than insertion position')
}

function isInvalidBlockJoinError(error: unknown): boolean {
  return isTransformError(error) && /^Cannot join (blockGroup|tableCell) onto blockContainer$/.test(error.message)
}

function isNullFragmentAppendError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  if (error.message === NULL_APPEND_PROPERTY_ERROR) return true

  const details = `${error.message}\n${error.stack ?? ''}`
  return details.includes('fillBefore') && details.includes('.append')
}

export function isStaleBlockReferenceError(error: unknown): boolean {
  return error instanceof Error && /^Block with ID .+ not found$/.test(error.message)
}

function isDomIndexSizeError(error: unknown): boolean {
  return isRecord(error) && error.name === 'IndexSizeError'
}

function isWebKitDomNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false
  if (error.name !== 'NotFoundError') return false
  if (typeof error.message !== 'string') return false

  const { message } = error
  return WEBKIT_DOM_NOT_FOUND_MESSAGES.some((expectedMessage) => message.includes(expectedMessage))
}

function isTransformError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'TransformError'
}

const RECOVERY_ERROR_MATCHERS: RecoveryErrorMatcher[] = [
  {
    matches: (error) => isMessage(error, BLOCKNOTE_BLOCK_TYPE_MISMATCH_ERROR),
    reason: 'block_type_mismatch',
    surfaces: ['render', 'transform'],
  },
  {
    matches: (error) => messageIncludes(error, BLOCKNOTE_MISSING_ID_ERROR),
    reason: 'block_missing_id',
    repairsDocument: true,
    surfaces: ['render', 'transform'],
  },
  {
    matches: (error) => messageMatches(error, BLOCKNOTE_EMPTY_FRAGMENT_INDEX_ERROR),
    reason: 'empty_fragment_index_out_of_range',
    repairsDocument: true,
    surfaces: ['render', 'transform'],
  },
  {
    matches: (error) => messageMatches(error, BLOCKNOTE_TABLE_ROW_INDEX_ERROR),
    reason: 'table_row_index_out_of_range',
    repairsDocument: true,
    surfaces: ['render', 'transform'],
  },
  {
    matches: (error) => messageMatches(error, BLOCKNOTE_PARAGRAPH_INDEX_ERROR),
    reason: 'paragraph_index_out_of_range',
    repairsDocument: true,
    surfaces: ['render', 'transform'],
  },
  {
    matches: isReactUpdateDepthExceededError,
    reason: 'react_update_depth_exceeded',
    surfaces: ['render'],
  },
  {
    matches: isDomIndexSizeError,
    reason: 'dom_index_size',
    surfaces: ['transform'],
  },
  {
    matches: isWebKitDomNotFoundError,
    reason: 'dom_not_found',
    surfaces: ['render', 'transform'],
  },
  {
    matches: isMismatchedTransactionError,
    reason: 'mismatched_transaction',
    surfaces: ['transform'],
  },
  {
    matches: isStaleBlockReferenceError,
    reason: 'stale_block_reference',
    surfaces: ['render', 'transform'],
  },
  {
    matches: isInvalidBlockJoinError,
    reason: 'invalid_block_join',
    repairsDocument: true,
    surfaces: ['transform'],
  },
  {
    matches: isInvalidInsertionDepthError,
    reason: 'invalid_insertion_depth',
    repairsDocument: true,
    surfaces: ['transform'],
  },
  {
    matches: isNullFragmentAppendError,
    reason: 'null_fragment_append',
    repairsDocument: true,
    surfaces: ['transform'],
  },
  {
    matches: isInvalidContentTransactionError,
    reason: 'transform_error',
    repairsDocument: true,
    surfaces: ['transform'],
  },
  {
    matches: isTransformError,
    reason: 'transform_error',
    surfaces: ['transform'],
  },
]

export function classifyRichEditorRecoveryError(
  error: unknown,
  surface: 'render',
): BlockNoteRenderRecoveryReason | null
export function classifyRichEditorRecoveryError(
  error: unknown,
  surface: 'transform',
): StaticTransformRecoveryReason | null
export function classifyRichEditorRecoveryError(
  error: unknown,
  surface: RichEditorRecoverySurface,
): RichEditorRecoveryReason | null {
  return RECOVERY_ERROR_MATCHERS.find((matcher) => (
    matcher.surfaces.includes(surface) && matcher.matches(error)
  ))?.reason ?? null
}

export function richEditorRecoveryErrorNeedsDocumentRepair(error: unknown): boolean {
  return RECOVERY_ERROR_MATCHERS.some((matcher) => (
    matcher.repairsDocument === true && matcher.matches(error)
  ))
}
