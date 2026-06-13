import { useCallback, type ClipboardEvent } from 'react'
import { handleFreshListItemPlainTextPaste, type InlineContentEditor } from './freshListItemPaste'
import { prepareTitleHeadingRichPaste, type TitleHeadingPasteEditor } from './titleHeadingPasteTarget'

type TitleHeadingEditor = InlineContentEditor & TitleHeadingPasteEditor

type EditorActionRunner = (action: () => void) => void

const TITLE_HEADING_SELECTOR = 'h1, [data-content-type="heading"][data-level="1"], [data-content-type="heading"]:not([data-level])'
const TITLE_HEADING_WRAPPER_SELECTOR = '.bn-block-outer, .bn-block'

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  return target instanceof Node ? target.parentElement : null
}

function isSelectionInsideElement(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  return Boolean(anchor && focus && element.contains(anchor) && element.contains(focus))
}

function findTitleHeadingElement(target: HTMLElement): HTMLElement | null {
  const directHeading = target.closest<HTMLElement>(TITLE_HEADING_SELECTOR)
  if (directHeading) return directHeading

  const titleWrapper = target.closest<HTMLElement>(TITLE_HEADING_WRAPPER_SELECTOR)
  return titleWrapper?.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR) ?? null
}

function richClipboardPlainText(clipboardData: DataTransfer): string | null {
  const text = clipboardData.getData('text/plain')
  const richMimeType = 'text/' + 'html'
  const hasRichMarkup = clipboardData.types
    ? Array.from(clipboardData.types).includes(richMimeType)
    : clipboardData.getData(richMimeType).length > 0

  return text.length > 0 && hasRichMarkup ? text : null
}

export function useEditorPasteHandler(options: {
  editable: boolean
  editor: TitleHeadingEditor
  runEditorAction: EditorActionRunner
}) {
  const { editable, editor, runEditorAction } = options

  return useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (handleFreshListItemPlainTextPaste({
      editable,
      editor,
      event,
      runEditorAction,
    })) return
    if (!editable) return

    const target = eventTargetElement(event.target)
    if (!target) return

    const titleHeading = findTitleHeadingElement(target)
    if (!titleHeading || !event.currentTarget.contains(titleHeading)) return

    const text = richClipboardPlainText(event.clipboardData)
    if (!text) return

    event.preventDefault()
    runEditorAction(() => {
      prepareTitleHeadingRichPaste(titleHeading, editor)
      editor.insertInlineContent(text, { updateSelection: true })
    })
  }, [editable, editor, runEditorAction])
}

export function queueTitleHeadingCursorRepair(
  target: HTMLElement,
  editor: TitleHeadingEditor,
): boolean {
  const titleHeading = findTitleHeadingElement(target)
  if (!titleHeading) return false

  queueMicrotask(() => {
    if (isSelectionInsideElement(titleHeading)) return
    const firstBlock = editor.document[0]
    if (firstBlock?.type !== 'heading' || typeof firstBlock.id !== 'string') return

    try {
      editor.setTextCursorPosition(firstBlock.id, 'end')
    } catch {
      return
    }
    editor.focus()
  })

  return true
}
