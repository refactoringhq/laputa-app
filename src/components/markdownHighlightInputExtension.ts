import type { useCreateBlockNote } from '@blocknote/react'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import {
  createRichEditorInputTransformExtension,
  type RichEditorInputTransform,
} from './richEditorInputTransform'

const MARKDOWN_HIGHLIGHT_DELIMITER = '=='
const MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH = MARKDOWN_HIGHLIGHT_DELIMITER.length
const FINAL_MARKDOWN_HIGHLIGHT_INPUT = '='
const CODE_BLOCK_NODE_TYPE = 'codeBlock'
const CODE_MARK_TYPE = 'code'

type EditorViewLike = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>
type TextblockParent = EditorViewLike['state']['selection']['$from']['parent']
type MarkLike = { type: { name: string } }
type EditorMark = Parameters<EditorViewLike['state']['tr']['addMark']>[2]
type MarkTypeLike = { create: () => EditorMark }

interface MarkdownHighlightCursorText {
  beforeText: string
  cursor: number
  parentStart: number
}

export interface MarkdownHighlightInputReplacement {
  closingFrom: number
  closingTo: number
  contentFrom: number
  contentTo: number
  openingFrom: number
  openingTo: number
}

function isInsertedFinalEquals(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText'
    && event.data === FINAL_MARKDOWN_HIGHLIGHT_INPUT
}

function hasCodeMark(marks: readonly MarkLike[] | null | undefined): boolean {
  return Boolean(marks?.some((mark) => mark.type.name === CODE_MARK_TYPE))
}

function selectionHasCodeMark(view: EditorViewLike): boolean {
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
  return hasCodeMark(marks)
}

function rangeHasCodeMark(
  view: EditorViewLike,
  from: number,
  to: number,
): boolean {
  let containsCode = false

  view.state.doc.nodesBetween(from, to, (node: {
    isText?: boolean
    marks?: readonly MarkLike[]
  }) => {
    if (!node.isText) return true

    containsCode = hasCodeMark(node.marks)
    return containsCode ? false : true
  })

  return containsCode
}

function isCodeBlockTextblock(parent: TextblockParent): boolean {
  return parent.type?.name === CODE_BLOCK_NODE_TYPE
}

function readCursorText(view: EditorViewLike): MarkdownHighlightCursorText | null {
  const { from, to, $from } = view.state.selection
  if (from !== to) return null
  if (!$from.parent.isTextblock) return null
  if (isCodeBlockTextblock($from.parent)) return null

  return {
    beforeText: $from.parent.textBetween(0, $from.parentOffset, '', ''),
    cursor: from,
    parentStart: from - $from.parentOffset,
  }
}

function hasValidHighlightContent(content: string): boolean {
  if (content.trim().length === 0) return false
  if (/^\s|\s$/.test(content)) return false
  return !/[\r\n]/.test(content)
}

export function readMarkdownHighlightInputReplacement({
  beforeText,
  cursor,
  parentStart,
}: MarkdownHighlightCursorText): MarkdownHighlightInputReplacement | null {
  const candidateText = `${beforeText}${FINAL_MARKDOWN_HIGHLIGHT_INPUT}`
  if (!candidateText.endsWith(MARKDOWN_HIGHLIGHT_DELIMITER)) return null

  const closingStart = candidateText.length - MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH
  const openingStart = candidateText.lastIndexOf(
    MARKDOWN_HIGHLIGHT_DELIMITER,
    closingStart - 1,
  )
  if (openingStart === -1) return null

  const contentStart = openingStart + MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH
  const content = candidateText.slice(contentStart, closingStart)
  if (!hasValidHighlightContent(content)) return null

  const closingFrom = parentStart + closingStart
  if (cursor !== closingFrom + 1) return null

  return {
    closingFrom,
    closingTo: cursor,
    contentFrom: parentStart + contentStart,
    contentTo: parentStart + closingStart,
    openingFrom: parentStart + openingStart,
    openingTo: parentStart + contentStart,
  }
}

function readHighlightMarkType(view: EditorViewLike): MarkTypeLike | null {
  const markType = Reflect.get(view.state.schema.marks, MARKDOWN_HIGHLIGHT_STYLE) as MarkTypeLike | undefined
  return markType ?? null
}

function replaceCompletedMarkdownHighlight(
  view: EditorViewLike,
): EditorViewLike['state']['tr'] | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const replacement = readMarkdownHighlightInputReplacement(cursorText)
  const highlightMarkType = readHighlightMarkType(view)
  if (!replacement || !highlightMarkType) return null
  if (rangeHasCodeMark(view, replacement.contentFrom, replacement.contentTo)) return null

  const highlightedFrom = replacement.contentFrom - MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH
  const highlightedTo = replacement.contentTo - MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH

  return view.state.tr
    .delete(replacement.closingFrom, replacement.closingTo)
    .delete(replacement.openingFrom, replacement.openingTo)
    .addMark(highlightedFrom, highlightedTo, highlightMarkType.create())
    .scrollIntoView()
}

export function createMarkdownHighlightInputTransform(): RichEditorInputTransform {
  return {
    handleBeforeInput(event, { view }) {
      if (!isInsertedFinalEquals(event)) return null

      const transaction = replaceCompletedMarkdownHighlight(view)
      if (!transaction) return null

      return { preventDefault: true, transaction }
    },
  }
}

export const createMarkdownHighlightInputExtension = createRichEditorInputTransformExtension({
  createTransforms: () => [createMarkdownHighlightInputTransform()],
  key: 'markdownHighlightInput',
})
