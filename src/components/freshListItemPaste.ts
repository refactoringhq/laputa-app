import type { ClipboardEvent } from 'react'

export type InlineContentEditor = {
  focus: () => void
  insertInlineContent: (content: string, options: { updateSelection: true }) => void
}

type FreshListItemPasteOptions = {
  editable: boolean
  editor: InlineContentEditor
  event: ClipboardEvent<HTMLDivElement>
  runEditorAction: (action: () => void) => void
}

const LIST_ITEM_SELECTOR = '[data-content-type="bulletListItem"], [data-content-type="checkListItem"]'

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  if (!(target instanceof Node)) return null
  return target.parentElement
}

export function handleFreshListItemPlainTextPaste({
  editable,
  editor,
  event,
  runEditorAction,
}: FreshListItemPasteOptions): boolean {
  if (!editable) return false

  const target = eventTargetElement(event.target)
  const listItem = target?.closest<HTMLElement>(LIST_ITEM_SELECTOR)
  if (!listItem || !event.currentTarget.contains(listItem)) return false
  if ((listItem.textContent ?? '').replace(/[\u200B\uFEFF]/g, '').trim().length > 0) return false

  const text = event.clipboardData.getData('text/plain')
  if (text.length === 0) return false

  event.preventDefault()
  runEditorAction(() => {
    editor.focus()
    editor.insertInlineContent(text, { updateSelection: true })
  })
  return true
}
