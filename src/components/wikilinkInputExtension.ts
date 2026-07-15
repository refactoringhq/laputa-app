import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { createRichEditorInputTransformExtension, type RichEditorInputTransform } from './richEditorInputTransform'

const WIKILINK_NODE_TYPE = 'wikilink'
const CLOSING_WIKILINK_INPUT = ']'
const WIKILINK_OPEN = '[['
const WIKILINK_CLOSE = ']]'
const CODE_BLOCK_NODE_TYPE = 'codeBlock'
const CODE_MARK_TYPE = 'code'

type EditorViewLike = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>
type TextblockParent = EditorViewLike['state']['selection']['$from']['parent']
type MarkLike = { type: { name: string } }
type WikilinkNodeType = {
  createChecked: (attrs: { target: string }) => unknown
}

interface WikilinkCursorText {
  beforeText: string
  cursor: number
  parentStart: number
}

interface WikilinkInputReplacement {
  from: number
  target: string
  to: number
}

function isInsertedClosingBracket(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText' && event.data === CLOSING_WIKILINK_INPUT
}

function hasCodeMark(marks: readonly MarkLike[] | null | undefined): boolean {
  return Boolean(marks?.some((mark) => mark.type.name === CODE_MARK_TYPE))
}

function selectionHasCodeMark(view: EditorViewLike): boolean {
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
  return hasCodeMark(marks)
}

function isCodeBlockTextblock(parent: TextblockParent): boolean {
  return parent.type?.name === CODE_BLOCK_NODE_TYPE
}

function readCursorText(view: EditorViewLike): WikilinkCursorText | null {
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

function hasValidWikilinkTarget(target: string): boolean {
  if (target.trim().length === 0) return false
  if (/[\r\n]/u.test(target)) return false
  return !target.includes(WIKILINK_OPEN) && !target.includes(WIKILINK_CLOSE)
}

export function readWikilinkInputReplacement({
  beforeText,
  cursor,
  parentStart,
}: WikilinkCursorText): WikilinkInputReplacement | null {
  const candidateText = `${beforeText}${CLOSING_WIKILINK_INPUT}`
  if (!candidateText.endsWith(WIKILINK_CLOSE)) return null

  const closingStart = candidateText.length - WIKILINK_CLOSE.length
  const openingStart = candidateText.lastIndexOf(WIKILINK_OPEN, closingStart - 1)
  if (openingStart === -1) return null

  const target = candidateText.slice(openingStart + WIKILINK_OPEN.length, closingStart).trim()
  if (!hasValidWikilinkTarget(target)) return null

  return {
    from: parentStart + openingStart,
    target,
    to: cursor,
  }
}

function readWikilinkNodeType(view: EditorViewLike): WikilinkNodeType | null {
  const nodeType = Reflect.get(view.state.schema.nodes, WIKILINK_NODE_TYPE) as WikilinkNodeType | undefined
  return nodeType ?? null
}

function replaceCompletedWikilink(view: EditorViewLike): EditorViewLike['state']['tr'] | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const replacement = readWikilinkInputReplacement(cursorText)
  const wikilinkNodeType = readWikilinkNodeType(view)
  if (!replacement || !wikilinkNodeType) return null

  const wikilinkNode = wikilinkNodeType.createChecked({ target: replacement.target })
  return view.state.tr
    .replaceWith(replacement.from, replacement.to, wikilinkNode)
    .scrollIntoView()
}

export function createWikilinkInputTransform(): RichEditorInputTransform {
  return {
    handleBeforeInput(event, { view }) {
      if (!isInsertedClosingBracket(event)) return null

      const transaction = replaceCompletedWikilink(view)
      if (!transaction) return null

      return {
        ignoreDispatchError: true,
        preventDefault: true,
        transaction,
      }
    },
  }
}

export function createTrackedWikilinkInputTransform(): RichEditorInputTransform {
  const transform = createWikilinkInputTransform()
  return {
    handleBeforeInput(event, context) {
      const result = transform.handleBeforeInput(event, context)
      if (result) trackEvent('wikilink_inserted', { trigger: 'typed' })
      return result
    },
    reset: transform.reset,
  }
}

export const createWikilinkInputExtension = createRichEditorInputTransformExtension({
  createTransforms: () => [createTrackedWikilinkInputTransform()],
  key: 'wikilinkInput',
})
