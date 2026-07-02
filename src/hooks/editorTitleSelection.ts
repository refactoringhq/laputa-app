import { hasTitleHeadingText, headingBlockText } from './editorTitleHeadingText'
import type { FocusableEditor, TiptapEditor } from './editorFocusUtils'
import {
  reportRecoveredEditorTransformError,
  richEditorTransformRecoveryErrorReason,
} from '../components/richEditorTransformErrorRecoveryExtension'

interface HeadingRange {
  from: number
  to: number
}

type FocusableHeadingBlock = NonNullable<FocusableEditor['document']>[number]

function buildHeadingRange(pos: number, nodeSize: number): HeadingRange | null {
  const range = { from: pos + 1, to: pos + nodeSize - 1 }
  return range.from <= range.to ? range : null
}

function findFirstHeadingRange(tiptap: TiptapEditor): HeadingRange | null {
  let range: HeadingRange | null = null

  tiptap.state.doc.descendants((node, pos) => {
    if (range) return false
    if (node.type.name !== 'heading') return

    range = buildHeadingRange(pos, node.nodeSize)
    return false
  })

  return range
}

function isTopLevelHeadingBlock(block: FocusableHeadingBlock): boolean {
  return block.type === 'heading' && (block.props?.level === undefined || block.props?.level === 1)
}

function getFirstHeadingBlock(editor: FocusableEditor): FocusableHeadingBlock | undefined {
  return editor.document?.find(isTopLevelHeadingBlock)
}

function usableBlockId(block: FocusableHeadingBlock): string | null {
  return typeof block.id === 'string' && block.id.trim().length > 0
    ? block.id
    : null
}

function tryPlaceCursorInBlock(editor: FocusableEditor, blockId: string): boolean {
  try {
    editor.setTextCursorPosition?.(blockId, 'start')
    return true
  } catch {
    return false
  }
}

function trySelectEmptyFirstHeading(editor: FocusableEditor): boolean {
  const firstHeadingBlock = getFirstHeadingBlock(editor)
  if (!firstHeadingBlock || headingBlockText(firstHeadingBlock)) return false
  const headingBlockId = usableBlockId(firstHeadingBlock)
  return headingBlockId ? tryPlaceCursorInBlock(editor, headingBlockId) : false
}

function recoverTitleSelectionError(error: unknown): boolean {
  const reason = richEditorTransformRecoveryErrorReason(error)
  if (!reason) return false

  reportRecoveredEditorTransformError(reason, error)
  return true
}

function tryApplyHeadingRange(tiptap: TiptapEditor, range: HeadingRange): boolean {
  try {
    tiptap.chain().setTextSelection(range).run()
    return true
  } catch (error) {
    if (recoverTitleSelectionError(error)) return false
    throw error
  }
}

export function trySelectFirstHeading(editor: FocusableEditor): boolean {
  if (hasTitleHeadingText(getFirstHeadingBlock(editor))) return true
  if (trySelectEmptyFirstHeading(editor)) return true
  const tiptap = editor._tiptapEditor
  if (!tiptap?.state?.doc) return false

  const range = findFirstHeadingRange(tiptap)
  if (!range) return false

  return tryApplyHeadingRange(tiptap, range)
}
