import { createExtension } from '@blocknote/core'
import {
  consumeKeyboardEvent,
  createCaptureKeydownMount,
  isComposingKeyboardEvent,
  type RichEditorView,
} from './richEditorKeyboard'

const CODE_BLOCK_TYPE = 'codeBlock'
const CODE_BLOCK_INDENT = '  '

type CodeBlockTabEditor = {
  _tiptapEditor?: { view: RichEditorView }
  getTextCursorPosition: () => { block: { type: unknown } }
  isEditable?: boolean
  prosemirrorView?: RichEditorView
  transact: (callback: (transaction: CodeBlockIndentTransaction) => boolean) => boolean
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
  view?: RichEditorView | null,
): boolean {
  return isPlainTabKey(event)
    && isEditable(editor)
    && !isComposingKeyboardEvent(event, view)
    && isCodeBlockCursor(editor)
}

export const createRichEditorCodeBlockTabExtension = createExtension(({ editor }) => {
  const richEditor = editor as CodeBlockTabEditor

  return {
    key: 'richEditorCodeBlockTab',
    mount: createCaptureKeydownMount(richEditor, (event, view) => {
      if (!shouldHandleCodeBlockTab(event, richEditor, view)) return
      if (insertCodeBlockIndent(richEditor)) consumeKeyboardEvent(event)
    }),
  } as const
})
