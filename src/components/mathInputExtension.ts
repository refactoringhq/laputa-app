import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { splitBlock } from 'prosemirror-commands'
import {
  MATH_BLOCK_TYPE,
  MATH_INLINE_TYPE,
  readCompletedDisplayMathAtEnd,
  readCompletedInlineMathAtEnd,
} from '../utils/mathMarkdown'

const INLINE_WHITESPACE_RE = /^[^\S\r\n]$/
const NEWLINE_INPUT_TYPES = new Set(['insertParagraph', 'insertLineBreak'])
const CURSOR_EXIT_EVENTS = ['keyup', 'mouseup'] as const
type EditorViewLike = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>

interface CursorText {
  beforeText: string
  parentStart: number
}

interface InlineMathReplacement {
  from: number
  latex: string
  to: number
}

type BlockNoteEditorLike = ReturnType<typeof useCreateBlockNote>

function isInsertedInlineWhitespace(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText'
    && typeof event.data === 'string'
    && INLINE_WHITESPACE_RE.test(event.data)
}

function isInsertedDollar(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText' && event.data === '$'
}

function shouldHandleInput(event: InputEvent): boolean {
  return isInsertedInlineWhitespace(event) || NEWLINE_INPUT_TYPES.has(event.inputType)
}

function shouldHandleInsertedDollar(event: InputEvent, view: EditorViewLike): boolean {
  if (event.isComposing || view.composing) return false
  return isInsertedDollar(event)
}

function selectionHasCodeMark(view: EditorViewLike): boolean {
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
  return marks.some((mark: { type: { name: string } }) => mark.type.name === 'code')
}

function readCursorText(view: EditorViewLike): CursorText | null {
  const { from, to, $from } = view.state.selection
  if (from !== to) return null
  if (!$from.parent.isTextblock) return null

  return {
    beforeText: $from.parent.textBetween(0, $from.parentOffset, '', ''),
    parentStart: from - $from.parentOffset,
  }
}

function readInlineMathReplacement(
  view: EditorViewLike,
  insertedText = '',
): InlineMathReplacement | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const math = readCompletedInlineMathAtEnd({ text: `${cursorText.beforeText}${insertedText}` })
  if (!math) return null

  return {
    from: cursorText.parentStart + math.start,
    latex: math.latex,
    to: cursorText.parentStart + Math.min(math.end + 1, cursorText.beforeText.length),
  }
}

function readDisplayMathLatex(view: EditorViewLike, insertedText = ''): string | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  return readCompletedDisplayMathAtEnd({
    text: `${cursorText.beforeText}${insertedText}`,
  })?.latex ?? null
}

function replaceCompletedDisplayMath(
  editor: BlockNoteEditorLike,
  view: EditorViewLike,
  trailingText?: string,
  insertedText = '',
): boolean {
  const latex = readDisplayMathLatex(view, insertedText)
  if (!latex || !view.state.schema.nodes[MATH_BLOCK_TYPE]) return false

  const currentBlock = editor.getTextCursorPosition().block
  const updatedBlock = editor.updateBlock(currentBlock, {
    type: MATH_BLOCK_TYPE,
    props: { latex },
  })

  if (trailingText === undefined) {
    const [nextBlock] = editor.insertBlocks([{ type: 'paragraph' }], updatedBlock, 'after')
    editor.setTextCursorPosition(nextBlock, 'start')
  }

  return true
}

function replaceCompletedInlineMath(
  view: EditorViewLike,
  trailingText?: string,
  insertedText = '',
): EditorViewLike['state']['tr'] | null {
  const replacement = readInlineMathReplacement(view, insertedText)
  const mathNodeType = view.state.schema.nodes[MATH_INLINE_TYPE]
  if (!replacement || !mathNodeType) return null

  const mathNode = mathNodeType.createChecked({ latex: replacement.latex })
  const transaction = view.state.tr.replaceWith(replacement.from, replacement.to, mathNode)

  if (trailingText !== undefined) {
    transaction.insertText(trailingText, replacement.from + mathNode.nodeSize)
  }

  return transaction.scrollIntoView()
}

export const createMathInputExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView

  return {
    key: 'mathInput',
    mount: ({ dom, root, signal }) => {
      const compileCompletedMathAtCursor = (): boolean => {
        const view = readView()
        if (!view || view.composing) return false
        if (replaceCompletedDisplayMath(editor, view)) return true

        const transaction = replaceCompletedInlineMath(view)
        if (!transaction) return false
        view.dispatch(transaction)
        return true
      }

      const handleBeforeInput = (event: InputEvent) => {
        const view = readView()
        if (!view || event.isComposing || view.composing) return

        if (isInsertedDollar(event)) {
          if (replaceCompletedDisplayMath(editor, view, undefined, event.data)) {
            event.preventDefault()
            return
          }

          const transaction = replaceCompletedInlineMath(view, undefined, event.data)
          if (!transaction) return
          view.dispatch(transaction)
          event.preventDefault()
          return
        }

        if (!shouldHandleInput(event)) return

        const trailingText = isInsertedInlineWhitespace(event) ? event.data : undefined
        if (replaceCompletedDisplayMath(editor, view, trailingText)) {
          event.preventDefault()
          return
        }

        const transaction = replaceCompletedInlineMath(view, trailingText)
        if (!transaction) return
        view.dispatch(transaction)
        if (trailingText !== undefined) {
          event.preventDefault()
        } else if (NEWLINE_INPUT_TYPES.has(event.inputType)) {
          event.preventDefault()
          splitBlock(view.state, view.dispatch)
        }
      }

      const handleInput = (event: InputEvent) => {
        const view = readView()
        if (!view || !shouldHandleInsertedDollar(event, view)) return
        compileCompletedMathAtCursor()
      }

      dom.addEventListener('beforeinput', handleBeforeInput as EventListener, {
        capture: true,
        signal,
      })
      dom.addEventListener('input', handleInput as EventListener, { signal })
      for (const eventName of CURSOR_EXIT_EVENTS) {
        dom.addEventListener(eventName, compileCompletedMathAtCursor, { signal })
      }
      root.addEventListener('selectionchange', compileCompletedMathAtCursor, { signal })
    },
  } as const
})
