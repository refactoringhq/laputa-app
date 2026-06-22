import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'

type EditorLike = ReturnType<typeof useCreateBlockNote>
type EditorViewLike = NonNullable<EditorLike['prosemirrorView']>
type ShortcutEditor = EditorLike & {
  isEditable?: boolean
}
type ShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'keyCode' | 'metaKey' | 'shiftKey'
>

function hasCommandModifier(event: ShortcutEvent): boolean {
  return event.metaKey || event.ctrlKey
}

function isMKey(event: ShortcutEvent): boolean {
  return event.code === 'KeyM' || event.key.toLowerCase() === 'm'
}

export function isMarkdownHighlightShortcut(event: ShortcutEvent): boolean {
  return hasCommandModifier(event)
    && event.shiftKey
    && !event.altKey
    && isMKey(event)
}

function isComposingKeyEvent(event: ShortcutEvent, view?: EditorViewLike | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEditable(editor: ShortcutEditor): boolean {
  return editor.isEditable !== false
}

function toggleMarkdownHighlight(editor: ShortcutEditor): void {
  editor.focus()
  editor.toggleStyles({ [MARKDOWN_HIGHLIGHT_STYLE]: true } as never)
  trackEvent('markdown_highlight_shortcut_used', { source: 'keyboard' })
}

export const createMarkdownHighlightShortcutExtension = createExtension(({ editor }) => {
  const shortcutEditor = editor as ShortcutEditor
  const readView = () => shortcutEditor._tiptapEditor?.view ?? shortcutEditor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isMarkdownHighlightShortcut(event)) return
    if (!isEditable(shortcutEditor) || isComposingKeyEvent(event, readView())) return

    event.preventDefault()
    event.stopPropagation()
    toggleMarkdownHighlight(shortcutEditor)
  }

  return {
    key: 'markdownHighlightShortcut',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
    },
  } as const
})
