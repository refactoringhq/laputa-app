import {
  DEFAULT_MARKDOWN_HIGHLIGHT_COLOR,
  MARKDOWN_HIGHLIGHT_STYLE,
} from '../utils/markdownHighlightMarkdown'
import type { MarkdownHighlightInputReplacement } from './markdownHighlightInputReplacement'
import type { RichEditorInputView } from './richEditorInputTransform'

type EditorViewLike = RichEditorInputView
type MarkLike = { type: { name: string } }
type EditorMark = Parameters<EditorViewLike['state']['tr']['addMark']>[2]
type MarkTypeLike = { create: (attributes?: Record<string, string>) => EditorMark }

function hasCodeMark(marks: readonly MarkLike[] | null | undefined): boolean {
  return Boolean(marks?.some(mark => mark.type.name === 'code'))
}

export function selectionHasCodeMark(view: EditorViewLike): boolean {
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
  return hasCodeMark(marks)
}

export function rangeHasCodeMark(view: EditorViewLike, from: number, to: number): boolean {
  let containsCode = false
  view.state.doc.nodesBetween(from, to, (node: {
    isText?: boolean
    marks?: readonly MarkLike[]
  }) => {
    if (!node.isText) return true
    containsCode = hasCodeMark(node.marks)
    return !containsCode
  })
  return containsCode
}

function readMarkType(view: EditorViewLike, name: string): MarkTypeLike | null {
  const markType = Reflect.get(view.state.schema.marks, name) as MarkTypeLike | undefined
  return markType ?? null
}

export function addHighlightMarks(
  transaction: EditorViewLike['state']['tr'],
  view: EditorViewLike,
  replacement: MarkdownHighlightInputReplacement,
  from: number,
  to: number,
): EditorViewLike['state']['tr'] | null {
  const highlightMarkType = readMarkType(view, MARKDOWN_HIGHLIGHT_STYLE)
  if (!highlightMarkType) return null

  transaction.addMark(from, to, highlightMarkType.create())
  if (replacement.color === DEFAULT_MARKDOWN_HIGHLIGHT_COLOR) return transaction

  const backgroundColorMarkType = readMarkType(view, 'backgroundColor')
  if (!backgroundColorMarkType) return null

  return transaction.addMark(
    from,
    to,
    backgroundColorMarkType.create({ stringValue: replacement.color }),
  )
}
