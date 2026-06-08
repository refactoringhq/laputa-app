import type { useCreateBlockNote } from '@blocknote/react'
import { describe, expect, it, vi } from 'vitest'
import { insertImageBlockAfterCursor } from './editorImageInsertion'
import { reportRecoveredEditorTransformError } from './richEditorTransformErrorRecoveryExtension'

vi.mock('./richEditorTransformErrorRecoveryExtension', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./richEditorTransformErrorRecoveryExtension')>()
  return {
    ...actual,
    reportRecoveredEditorTransformError: vi.fn(),
  }
})

type ImageInsertionEditor = Pick<
  ReturnType<typeof useCreateBlockNote>,
  'getBlock' | 'getTextCursorPosition' | 'insertBlocks'
>

function createEditor(
  overrides: Partial<ImageInsertionEditor> = {},
): ReturnType<typeof useCreateBlockNote> {
  const editor: ImageInsertionEditor = {
    getBlock: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({ block: { id: 'cursor-block' } })),
    insertBlocks: vi.fn(),
    ...overrides,
  }
  return editor as unknown as ReturnType<typeof useCreateBlockNote>
}

describe('insertImageBlockAfterCursor', () => {
  it('resolves the current cursor block before inserting the image', () => {
    const liveBlock = { id: 'live-cursor-block' }
    const editor = createEditor({
      getBlock: vi.fn(() => liveBlock),
    })

    expect(insertImageBlockAfterCursor(editor, 'asset://localhost/photo.png')).toBe(true)

    expect(editor.getBlock).toHaveBeenCalledWith('cursor-block')
    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'image', props: { url: 'asset://localhost/photo.png' } }],
      liveBlock,
      'after',
    )
  })

  it('falls back to the captured cursor block when a live lookup misses', () => {
    const editor = createEditor({
      getBlock: vi.fn(() => undefined),
    })

    expect(insertImageBlockAfterCursor(editor, 'asset://localhost/photo.png')).toBe(true)

    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'image', props: { url: 'asset://localhost/photo.png' } }],
      expect.objectContaining({ id: 'cursor-block' }),
      'after',
    )
  })

  it('recovers stale BlockNote insertion races without surfacing them to Sentry', () => {
    const missingBlockError = new Error('Block with ID cursor-block not found')
    const editor = createEditor({
      getBlock: vi.fn(() => ({ id: 'cursor-block' })),
      insertBlocks: vi.fn(() => {
        throw missingBlockError
      }),
    })

    expect(insertImageBlockAfterCursor(editor, 'asset://localhost/photo.png')).toBe(false)

    expect(reportRecoveredEditorTransformError).toHaveBeenCalledWith(
      'stale_block_reference',
      missingBlockError,
    )
  })

  it('rethrows non-stale insertion errors', () => {
    const insertionError = new Error('Unexpected editor failure')
    const editor = createEditor({
      getBlock: vi.fn(() => ({ id: 'cursor-block' })),
      insertBlocks: vi.fn(() => {
        throw insertionError
      }),
    })

    expect(() => {
      insertImageBlockAfterCursor(editor, 'asset://localhost/photo.png')
    }).toThrow(insertionError)
  })
})
