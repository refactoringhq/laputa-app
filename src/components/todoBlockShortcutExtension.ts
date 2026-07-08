import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { isMac } from '../utils/platform'
import {
  toggleCurrentBlockTodoType,
  type RichEditorBlockTypeCommandEditor,
} from './richEditorBlockTypeCommands'

type EditorLike = ReturnType<typeof useCreateBlockNote>
type EditorViewLike = NonNullable<EditorLike['prosemirrorView']>
type ShortcutEditor = EditorLike & {
  isEditable?: boolean
}
type ShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'keyCode' | 'metaKey' | 'shiftKey'
>
export type TodoBlockShortcutPlatform = 'mac' | 'non-mac'

function hasPlatformCommandModifier(event: ShortcutEvent, platform: TodoBlockShortcutPlatform): boolean {
  return platform === 'mac'
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

function isTKey(event: ShortcutEvent): boolean {
  return event.code === 'KeyT' || event.key.toLowerCase() === 't'
}

function currentShortcutPlatform(): TodoBlockShortcutPlatform {
  return isMac() ? 'mac' : 'non-mac'
}

export function isTodoBlockShortcut(
  event: ShortcutEvent,
  platform: TodoBlockShortcutPlatform = currentShortcutPlatform(),
): boolean {
  return hasPlatformCommandModifier(event, platform)
    && !event.shiftKey
    && !event.altKey
    && isTKey(event)
}

function isComposingKeyEvent(event: ShortcutEvent, view?: EditorViewLike | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEditable(editor: ShortcutEditor): boolean {
  return editor.isEditable !== false
}

export const createTodoBlockShortcutExtension = createExtension(({ editor }) => {
  const shortcutEditor = editor as ShortcutEditor
  const readView = () => shortcutEditor._tiptapEditor?.view ?? shortcutEditor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isTodoBlockShortcut(event)) return
    if (!isEditable(shortcutEditor) || isComposingKeyEvent(event, readView())) return
    if (!toggleCurrentBlockTodoType(shortcutEditor as RichEditorBlockTypeCommandEditor, 'keyboard_shortcut')) return

    event.preventDefault()
    event.stopPropagation()
  }

  return {
    key: 'todoBlockShortcut',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
    },
  } as const
})
