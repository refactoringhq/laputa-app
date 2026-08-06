import {
  readMarkdownHighlightInputReplacement,
  type MarkdownHighlightCursorText,
} from './markdownHighlightInputReplacement'
import {
  addHighlightMarks,
  rangeHasCodeMark,
  selectionHasCodeMark,
} from './markdownHighlightInputMarks'
import {
  createRichEditorInputTransformExtension,
  type RichEditorInputView,
  type RichEditorInputTransform,
} from './richEditorInputTransform'

const FINAL_MARKDOWN_HIGHLIGHT_INPUT = '='
const CODE_BLOCK_NODE_TYPE = 'codeBlock'
type EditorViewLike = RichEditorInputView
type TextblockParent = EditorViewLike['state']['selection']['$from']['parent']

export { readMarkdownHighlightInputReplacement } from './markdownHighlightInputReplacement'

function isInsertedFinalEquals(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText'
    && event.data === FINAL_MARKDOWN_HIGHLIGHT_INPUT
}

function isCodeBlockTextblock(parent: TextblockParent): boolean {
  const type = Reflect.get(parent, 'type') as unknown
  return typeof type === 'object'
    && type !== null
    && Reflect.get(type, 'name') === CODE_BLOCK_NODE_TYPE
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

function replaceCompletedMarkdownHighlight(
  view: EditorViewLike,
): EditorViewLike['state']['tr'] | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const replacement = readMarkdownHighlightInputReplacement(cursorText)
  if (!replacement) return null
  if (rangeHasCodeMark(view, replacement.contentFrom, replacement.contentTo)) return null

  const openingLength = replacement.openingTo - replacement.openingFrom
  const highlightedFrom = replacement.contentFrom - openingLength
  const highlightedTo = replacement.contentTo - openingLength

  const transaction = view.state.tr
    .delete(replacement.closingFrom, replacement.closingTo)
    .delete(replacement.openingFrom, replacement.openingTo)

  return addHighlightMarks(
    transaction,
    view,
    replacement,
    highlightedFrom,
    highlightedTo,
  )?.scrollIntoView() ?? null
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
