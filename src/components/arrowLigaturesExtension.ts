import { createExtension } from '@blocknote/core'
import { resolveArrowLigatureInput } from '../utils/arrowLigatures'

const PREFIX_CONTEXT_LENGTH = 2

interface CodeContextSelection {
  $from?: {
    depth: number
    node: (depth?: number) => {
      type?: {
        name?: string
        spec?: { code?: boolean }
      }
    }
  }
}

function isInsertedCharacter(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText' && typeof event.data === 'string'
}

function isCodeContext(selection: CodeContextSelection): boolean {
  const position = selection.$from
  if (!position) return false

  for (let depth = position.depth; depth >= 0; depth--) {
    const type = position.node(depth).type
    if (type?.spec?.code || type?.name === 'codeBlock') return true
  }

  return false
}

function hasWritableCursor(selection: { from: number; to: number }): boolean {
  return selection.from === selection.to
}

function isComposingInput({
  event,
  view,
}: {
  event: InputEvent
  view: { composing?: boolean }
}): boolean {
  return event.isComposing || Boolean(view.composing)
}

export const createArrowLigaturesExtension = createExtension(({ editor }) => {
  let literalAsciiCursor: number | null = null

  const handleBeforeInput = (event: InputEvent) => {
    if (!isInsertedCharacter(event)) {
      return
    }

    const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
    if (!view) {
      return
    }
    if (isComposingInput({ event, view })) {
      return
    }

    const { from } = view.state.selection
    if (!hasWritableCursor(view.state.selection)) {
      return
    }
    if (isCodeContext(view.state.selection)) {
      literalAsciiCursor = null
      return
    }

    const beforeText = view.state.doc.textBetween(
      Math.max(0, from - PREFIX_CONTEXT_LENGTH),
      from,
      '',
      '',
    )
    const resolution = resolveArrowLigatureInput({
      beforeText,
      cursor: from,
      inputText: event.data,
      literalAsciiCursor,
    })
    literalAsciiCursor = resolution.nextLiteralAsciiCursor

    if (!resolution.change) {
      return
    }

    event.preventDefault()
    view.dispatch(
      view.state.tr.insertText(
        resolution.change.insert,
        resolution.change.from,
        resolution.change.to,
      ),
    )
  }

  return {
    key: 'arrowLigatures',
    mount: ({ dom, signal }) => {
      dom.addEventListener('beforeinput', handleBeforeInput as EventListener, {
        capture: true,
        signal,
      })
    },
  } as const
})
