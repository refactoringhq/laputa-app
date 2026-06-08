import type { useCreateBlockNote } from '@blocknote/react'
import {
  isStaleBlockReferenceError,
  reportRecoveredEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'

export function insertImageBlockAfterCursor(
  editor: ReturnType<typeof useCreateBlockNote>,
  url: string,
): boolean {
  try {
    const cursorBlock = editor.getTextCursorPosition().block
    const liveBlock = editor.getBlock(cursorBlock.id) ?? cursorBlock

    editor.insertBlocks([{ type: 'image' as const, props: { url } }], liveBlock, 'after')
    return true
  } catch (error) {
    if (!isStaleBlockReferenceError(error)) throw error

    reportRecoveredEditorTransformError('stale_block_reference', error)
    return false
  }
}
