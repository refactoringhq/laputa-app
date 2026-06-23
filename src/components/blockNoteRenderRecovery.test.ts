import { describe, expect, it } from 'vitest'
import {
  blockNoteRenderRecoveryReason,
  isRecoverableBlockNoteRenderError,
  isRecoveredBlockNoteRenderError,
  markRecoveredBlockNoteRenderError,
} from './blockNoteRenderRecovery'

describe('blockNoteRenderRecovery', () => {
  it('marks only recovered BlockNote missing-id render errors for root suppression', () => {
    const error = new Error("Block doesn't have id")

    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(false)

    markRecoveredBlockNoteRenderError(error)

    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(true)
    expect(isRecoveredBlockNoteRenderError(new Error('Other render failure'), '')).toBe(false)
  })

  it('recognizes recovered BlockNote table row index render errors', () => {
    const error = new RangeError(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    )

    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(false)

    markRecoveredBlockNoteRenderError(error)

    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(true)
  })

  it('recognizes production table row index render errors that are plain Error instances', () => {
    const error = new Error(
      'Index 1 out of range for <tableRow(tableCell(tableParagraph("A")))>',
    )

    expect(blockNoteRenderRecoveryReason(error)).toBe('table_row_index_out_of_range')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
  })

  it('recognizes production paragraph index render errors from slash input', () => {
    const error = new RangeError('Index 1 out of range for <paragraph("/")>')

    expect(blockNoteRenderRecoveryReason(error)).toBe('paragraph_index_out_of_range')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
  })

  it('recognizes production paragraph index render errors that are plain Error instances', () => {
    const error = new Error('Index 1 out of range for <paragraph("/")>')

    expect(blockNoteRenderRecoveryReason(error)).toBe('paragraph_index_out_of_range')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
  })

  it('recognizes recovered BlockNote block type mismatch render errors', () => {
    const error = new Error('Block type does not match')

    expect(blockNoteRenderRecoveryReason(error)).toBe('block_type_mismatch')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(false)

    markRecoveredBlockNoteRenderError(error)

    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(true)
  })

  it('recognizes stale BlockNote block references during note render', () => {
    const error = new Error('Block with ID stale-block not found')

    expect(blockNoteRenderRecoveryReason(error)).toBe('stale_block_reference')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
  })

  it('recognizes recovered WebKit DOM NotFoundError render races', () => {
    const error = new Error('The object can not be found here.')
    error.name = 'NotFoundError'

    expect(blockNoteRenderRecoveryReason(error)).toBe('dom_not_found')
    expect(isRecoverableBlockNoteRenderError(error)).toBe(true)
    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(false)

    markRecoveredBlockNoteRenderError(error)

    expect(isRecoveredBlockNoteRenderError(error, '')).toBe(true)
  })

  it('recognizes recovered BlockNote errors from the React component stack fallback', () => {
    expect(isRecoveredBlockNoteRenderError(
      new Error("Block doesn't have id"),
      '\n    in MermaidBlock\n    in BlockNoteRenderRecoveryBoundary',
    )).toBe(true)
  })
})
