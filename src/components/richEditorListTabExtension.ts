import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import {
  consumeKeyboardEvent,
  createCaptureKeydownMount,
  isComposingKeyboardEvent,
  type RichEditorView,
} from './richEditorKeyboard'

const LIST_BLOCK_TYPES = new Set([
  'bulletListItem',
  'checkListItem',
  'numberedListItem',
  'toggleListItem',
])

type EditorLike = ReturnType<typeof useCreateBlockNote>
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

function shouldHandle(event: ListTabEvent, editor: ListTabEditor, view?: RichEditorView | null): boolean {
  return isTabWithoutNavigationModifier(event)
    && !isComposingKeyboardEvent(event, view)
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

  return {
    key: 'richEditorListTab',
    mount: createCaptureKeydownMount(richEditor, (event, view) => {
      if (!shouldHandle(event, richEditor, view)) return
      applyIndent(richEditor, event.shiftKey)
      consumeKeyboardEvent(event)
    }),
  } as const
})
