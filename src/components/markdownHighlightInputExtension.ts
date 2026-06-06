import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import {
  isRecoverableEditorTransformError,
  reportRecoveredEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'

const MARKDOWN_HIGHLIGHT_DELIMITER = '=='
const MARKDOWN_HIGHLIGHT_DELIMITER_LENGTH = MARKDOWN_HIGHLIGHT_DELIMITER.length
const FINAL_MARKDOWN_HIGHLIGHT_INPUT = '='
const CODE_MARK_TYPE = 'code'

type EditorViewLike = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>
type MarkLike = { type: { name: string } }
type EditorMark = Parameters<EditorViewLike['state']['tr']['addMark']>[2]
type MarkTypeLike = { create: () => EditorMark }
type ReadEditorView = () => EditorViewLike | undefined

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

function readCursorText(view: EditorViewLike): MarkdownHighlightCursorText | null {
  const { from, to, $from } = view.state.selection
  if (from !== to) return null
  if (!$from.parent.isTextblock) return null

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

function recoverTransformError(error: unknown): boolean {
  if (!isRecoverableEditorTransformError(error)) return false

  reportRecoveredEditorTransformError('transform_error', error)
  return true
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

function readMarkdownHighlightInputTransaction(
  view: EditorViewLike,
): EditorViewLike['state']['tr'] | null {
  try {
    return replaceCompletedMarkdownHighlight(view)
  } catch (error) {
    if (!recoverTransformError(error)) throw error
    return null
  }
}

function shouldSkipInputEvent(event: InputEvent, view: EditorViewLike): boolean {
  return !isInsertedFinalEquals(event) || event.isComposing || Boolean(view.composing)
}

function dispatchMarkdownHighlightTransaction(
  view: EditorViewLike,
  transaction: EditorViewLike['state']['tr'],
): boolean {
  try {
    view.dispatch(transaction)
    return true
  } catch (error) {
    if (!recoverTransformError(error)) throw error
    return false
  }
}

function handleMarkdownHighlightBeforeInput(event: InputEvent, readView: ReadEditorView) {
  const view = readView()
  if (!view || shouldSkipInputEvent(event, view)) return

  const transaction = readMarkdownHighlightInputTransaction(view)
  if (!transaction) return

  if (!dispatchMarkdownHighlightTransaction(view, transaction)) return

  event.preventDefault()
}

export const createMarkdownHighlightInputExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView

  return {
    key: 'markdownHighlightInput',
    mount: ({ dom, signal }) => {
      dom.addEventListener('beforeinput', ((event: InputEvent) => {
        handleMarkdownHighlightBeforeInput(event, readView)
      }) as EventListener, {
        capture: true,
        signal,
      })
    },
  } as const
})
