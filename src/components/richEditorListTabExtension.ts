import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'

const LIST_BLOCK_TYPES = new Set([
  'bulletListItem',
  'checkListItem',
  'numberedListItem',
  'toggleListItem',
])

type EditorLike = ReturnType<typeof useCreateBlockNote>
type EditorViewLike = NonNullable<EditorLike['prosemirrorView']>
type ListTabEditor = EditorLike & { isEditable?: boolean }
type ListTabEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'ctrlKey'
  | 'isComposing'
  | 'key'
  | 'keyCode'
  | 'metaKey'
  | 'preventDefault'
  | 'stopImmediatePropagation'
>

function isListCursor(editor: ListTabEditor): boolean {
  try {
    return LIST_BLOCK_TYPES.has(editor.getTextCursorPosition().block.type)
  } catch {
    return false
  }
}

function isTabWithoutNavigationModifier(event: ListTabEvent): boolean {
  return event.key === 'Tab' && ![event.altKey, event.ctrlKey, event.metaKey].some(Boolean)
}

function isComposing(event: ListTabEvent, view?: EditorViewLike | null): boolean {
  return [event.isComposing, event.keyCode === 229, view?.composing].some(Boolean)
}

function shouldHandle(event: ListTabEvent, editor: ListTabEditor, view?: EditorViewLike | null): boolean {
  return isTabWithoutNavigationModifier(event)
    && !isComposing(event, view)
    && editor.isEditable !== false
    && isListCursor(editor)
}

function applyIndent(editor: ListTabEditor, outdent: boolean): void {
  if (outdent) {
    if (editor.canUnnestBlock()) editor.unnestBlock()
    return
  }

  if (editor.canNestBlock()) editor.nestBlock()
}

export const createRichEditorListTabExtension = createExtension(({ editor }) => {
  const richEditor = editor as ListTabEditor
  const readView = () => richEditor._tiptapEditor?.view ?? richEditor.prosemirrorView
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!shouldHandle(event, richEditor, readView())) return

    applyIndent(richEditor, event.shiftKey)
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  return {
    key: 'richEditorListTab',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, { capture: true, signal })
    },
  } as const
})
