import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import {
  consumeKeyboardEvent,
  createCaptureKeydownMount,
  isComposingKeyboardEvent,
  type RichEditorView,
} from './richEditorKeyboard'

const CODE_BLOCK_TYPE = 'codeBlock'

type EditorLike = ReturnType<typeof useCreateBlockNote>
type ArrowKey = 'ArrowDown' | 'ArrowUp'
type CodeBlockArrowEditor = EditorLike & {
  isEditable?: boolean
}
type ArrowEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'ctrlKey'
  | 'isComposing'
  | 'key'
  | 'keyCode'
  | 'metaKey'
  | 'preventDefault'
  | 'shiftKey'
  | 'stopImmediatePropagation'
>

function isPlainArrowKey(event: ArrowEvent): event is ArrowEvent & { key: ArrowKey } {
  return (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

function lineEnd(source: string, start: number): number {
  const newline = source.indexOf('\n', start)
  return newline === -1 ? source.length : newline
}

export function adjacentCodeLineOffset(
  source: string,
  offset: number,
  key: ArrowKey,
): number | null {
  const currentStart = lineStart(source, offset)
  const column = offset - currentStart

  if (key === 'ArrowDown') {
    const currentEnd = lineEnd(source, currentStart)
    if (currentEnd === source.length) return null
    const nextStart = currentEnd + 1
    return nextStart + Math.min(column, lineEnd(source, nextStart) - nextStart)
  }

  if (currentStart === 0) return null
  const previousEnd = currentStart - 1
  const previousStart = lineStart(source, previousEnd)
  return previousStart + Math.min(column, previousEnd - previousStart)
}

function setAdjacentCodeLineSelection(tr: Transaction, key: ArrowKey): boolean | null {
  const { selection } = tr
  if (!selection.empty || selection.$from.parent.type.name !== CODE_BLOCK_TYPE) return false

  const targetOffset = adjacentCodeLineOffset(
    selection.$from.parent.textContent,
    selection.$from.parentOffset,
    key,
  )
  if (targetOffset === null) return null

  tr.setSelection(TextSelection.create(tr.doc, selection.$from.start() + targetOffset))
  return true
}

function moveAcrossCodeBlockBoundary(
  editor: CodeBlockArrowEditor,
  key: ArrowKey,
): boolean {
  const { block, nextBlock, prevBlock } = editor.getTextCursorPosition()
  if (block.type !== CODE_BLOCK_TYPE) return false

  const adjacentBlock = key === 'ArrowDown' ? nextBlock : prevBlock
  if (!adjacentBlock) return false

  editor.setTextCursorPosition(adjacentBlock, key === 'ArrowDown' ? 'start' : 'end')
  return true
}

function codeBlockElement(node: Node | null): Element | null {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-content-type="codeBlock"]') ?? null
}

function restoreDomSelection(selection: Selection, range: Range): void {
  selection.removeAllRanges()
  selection.addRange(range)
}

function restoreEditorSelection(
  view: RichEditorView,
  selection: Selection,
  range: Range,
  position: number,
): void {
  restoreDomSelection(selection, range)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))
}

function activeCollapsedSelection(view: RichEditorView): Selection | null {
  const selection = view.dom.ownerDocument.getSelection()
  if (!selection?.isCollapsed) return null
  return selection.rangeCount === 0 ? null : selection
}

function codePositionAfterNativeMove(
  view: RichEditorView,
  selection: Selection,
  sourceCodeBlock: Element,
  key: ArrowKey,
): number | null {
  selection.modify('move', key === 'ArrowDown' ? 'forward' : 'backward', 'line')
  const anchorNode = selection.anchorNode
  if (!anchorNode || codeBlockElement(anchorNode) !== sourceCodeBlock) return null

  const targetPosition = view.posAtDOM(anchorNode, selection.anchorOffset)
  const target = view.state.doc.resolve(targetPosition)
  if (target.parent.type.name !== CODE_BLOCK_TYPE) return null
  return targetPosition === view.state.selection.from ? null : targetPosition
}

function moveVisuallyWithinCodeBlock(view: RichEditorView, key: ArrowKey): boolean {
  const selection = activeCollapsedSelection(view)
  if (!selection) return false

  const sourceCodeBlock = codeBlockElement(selection.anchorNode)
  const sourceNode = selection.anchorNode
  if (!sourceCodeBlock || !sourceNode) return false

  const originalRange = selection.getRangeAt(0).cloneRange()
  const originalPosition = view.posAtDOM(sourceNode, selection.anchorOffset)
  const targetPosition = codePositionAfterNativeMove(view, selection, sourceCodeBlock, key)
  if (targetPosition === null) {
    restoreEditorSelection(view, selection, originalRange, originalPosition)
    return false
  }

  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPosition)))
  return true
}

function moveCodeBlockCaret(
  editor: CodeBlockArrowEditor,
  key: ArrowKey,
  view?: RichEditorView | null,
): boolean {
  if (view && moveVisuallyWithinCodeBlock(view, key)) return true

  return editor.transact((tr: Transaction) => {
    const movedWithinCode = setAdjacentCodeLineSelection(tr, key)
    if (movedWithinCode !== null) return movedWithinCode
    return moveAcrossCodeBlockBoundary(editor, key)
  })
}

function handleArrowKey(
  event: ArrowEvent,
  editor: CodeBlockArrowEditor,
  view?: RichEditorView | null,
): void {
  if (!isPlainArrowKey(event) || editor.isEditable === false || isComposingKeyboardEvent(event, view)) return
  if (!moveCodeBlockCaret(editor, event.key, view)) return

  consumeKeyboardEvent(event)
}

export const createRichEditorCodeBlockArrowNavigationExtension = createExtension(({ editor }) => {
  const richEditor = editor as CodeBlockArrowEditor

  return {
    key: 'richEditorCodeBlockArrowNavigation',
    mount: createCaptureKeydownMount(richEditor, (event, view) => {
      handleArrowKey(event, richEditor, view)
    }),
  } as const
})
