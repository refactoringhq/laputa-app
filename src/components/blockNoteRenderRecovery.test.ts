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

  it('recognizes recovered BlockNote block type mismatch render errors', () => {
    const error = new Error('Block type does not match')

    expect(blockNoteRenderRecoveryReason(error)).toBe('block_type_mismatch')
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
