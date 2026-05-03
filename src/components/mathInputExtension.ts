import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { MATH_INLINE_TYPE, readCompletedInlineMathAtEnd } from '../utils/mathMarkdown'

const INLINE_WHITESPACE_RE = /^[^\S\r\n]$/
const NEWLINE_INPUT_TYPES = new Set(['insertParagraph', 'insertLineBreak'])
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

function isInsertedInlineWhitespace(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText'
    && typeof event.data === 'string'
    && INLINE_WHITESPACE_RE.test(event.data)
}

function shouldHandleInput(event: InputEvent): boolean {
  return isInsertedInlineWhitespace(event) || NEWLINE_INPUT_TYPES.has(event.inputType)
}

function shouldSkipInput(event: InputEvent, view: EditorViewLike): boolean {
  if (event.isComposing) return true
  if (view.composing) return true
  return !shouldHandleInput(event)
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

function readInlineMathReplacement(view: EditorViewLike): InlineMathReplacement | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const math = readCompletedInlineMathAtEnd({ text: cursorText.beforeText })
  if (!math) return null

  return {
    from: cursorText.parentStart + math.start,
    latex: math.latex,
    to: cursorText.parentStart + math.end + 1,
  }
}

function replaceCompletedInlineMath(
  view: EditorViewLike,
  trailingText?: string,
): EditorViewLike['state']['tr'] | null {
  const replacement = readInlineMathReplacement(view)
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
    mount: ({ dom, signal }) => {
      const handleBeforeInput = (event: InputEvent) => {
        const view = readView()
        if (!view || shouldSkipInput(event, view)) return

        const trailingText = isInsertedInlineWhitespace(event) ? event.data : undefined
        const transaction = replaceCompletedInlineMath(view, trailingText)
        if (!transaction) return

        view.dispatch(transaction)
        if (trailingText !== undefined) {
          event.preventDefault()
        }
      }

      dom.addEventListener('beforeinput', handleBeforeInput as EventListener, {
        capture: true,
        signal,
      })
    },
  } as const
})
