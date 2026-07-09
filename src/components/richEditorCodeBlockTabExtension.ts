import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'

const CODE_BLOCK_TYPE = 'codeBlock'
const CODE_BLOCK_INDENT = '  '

type EditorLike = ReturnType<typeof useCreateBlockNote>
type EditorViewLike = NonNullable<EditorLike['prosemirrorView']>
type CodeBlockTabEditor = EditorLike & {
  isEditable?: boolean
}
type CodeBlockTabEvent = Pick<
  KeyboardEvent,
  'altKey'
  | 'ctrlKey'
  | 'isComposing'
  | 'key'
  | 'keyCode'
  | 'metaKey'
  | 'preventDefault'
  | 'shiftKey'
  | 'stopImmediatePropagation'
>
type CodeBlockIndentTransaction = {
  insertText: (text: string) => void
}

function isPlainTabKey(event: CodeBlockTabEvent): boolean {
  return event.key === 'Tab'
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}

function isComposingKeyEvent(event: CodeBlockTabEvent, view?: EditorViewLike | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEditable(editor: CodeBlockTabEditor): boolean {
  return editor.isEditable !== false
}

function readCurrentBlockType(editor: CodeBlockTabEditor): string | null {
  try {
    const position = editor.getTextCursorPosition()
    return typeof position.block.type === 'string' ? position.block.type : null
  } catch {
    return null
  }
}

function isCodeBlockCursor(editor: CodeBlockTabEditor): boolean {
  return readCurrentBlockType(editor) === CODE_BLOCK_TYPE
}

function insertCodeBlockIndent(editor: CodeBlockTabEditor): boolean {
  return editor.transact((tr: CodeBlockIndentTransaction) => {
    if (!isCodeBlockCursor(editor)) return false

    tr.insertText(CODE_BLOCK_INDENT)
    return true
  })
}

function shouldHandleCodeBlockTab(
  event: CodeBlockTabEvent,
  editor: CodeBlockTabEditor,
  view?: EditorViewLike | null,
): boolean {
  return isPlainTabKey(event)
    && isEditable(editor)
    && !isComposingKeyEvent(event, view)
    && isCodeBlockCursor(editor)
}

export const createRichEditorCodeBlockTabExtension = createExtension(({ editor }) => {
  const richEditor = editor as CodeBlockTabEditor
  const readView = () => richEditor._tiptapEditor?.view ?? richEditor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!shouldHandleCodeBlockTab(event, richEditor, readView())) return
    if (!insertCodeBlockIndent(richEditor)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  return {
    key: 'richEditorCodeBlockTab',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
    },
  } as const
})
