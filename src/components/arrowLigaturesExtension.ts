import { createExtension } from '@blocknote/core'
import { resolveArrowLigatureInput } from '../utils/arrowLigatures'

const PREFIX_CONTEXT_LENGTH = 2

interface CodeContextSelection {
  from?: unknown
  to?: unknown
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

interface ArrowLigatureView {
  composing?: boolean
  dom?: { isConnected?: boolean }
  isDestroyed?: boolean
}

interface ArrowLigatureTransactionArgs<Transaction> {
  event: InputEvent & { data: string }
  literalAsciiCursor: number | null
  view: {
    state: {
      doc: {
        textBetween: (from: number, to: number, blockSeparator: string, leafText: string) => string
      }
      selection: CodeContextSelection
      tr: {
        insertText: (text: string, from: number, to: number) => Transaction
      }
    }
  }
}

interface ArrowLigatureTransactionResult<Transaction> {
  nextLiteralAsciiCursor: number | null
  transaction: Transaction | null
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

function getWritableCursor(selection: CodeContextSelection): number | null {
  const { from, to } = selection
  if (typeof from !== 'number' || typeof to !== 'number') return null
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null

  return from === to ? from : null
}

function isLiveEditorView(view: ArrowLigatureView): boolean {
  if (view.isDestroyed) return false
  if (view.dom?.isConnected === false) return false

  return true
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

function withoutTransaction<Transaction>(
  nextLiteralAsciiCursor: number | null,
): ArrowLigatureTransactionResult<Transaction> {
  return { nextLiteralAsciiCursor, transaction: null }
}

function buildArrowLigatureTransaction<Transaction>({
  event,
  literalAsciiCursor,
  view,
}: ArrowLigatureTransactionArgs<Transaction>): ArrowLigatureTransactionResult<Transaction> {
  try {
    const { state } = view
    const { selection } = state
    const from = getWritableCursor(selection)
    if (from === null) return withoutTransaction(literalAsciiCursor)
    if (isCodeContext(selection)) return withoutTransaction(null)

    const beforeText = state.doc.textBetween(
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
    if (!resolution.change) return withoutTransaction(resolution.nextLiteralAsciiCursor)

    return {
      nextLiteralAsciiCursor: resolution.nextLiteralAsciiCursor,
      transaction: state.tr.insertText(
        resolution.change.insert,
        resolution.change.from,
        resolution.change.to,
      ),
    }
  } catch {
    return withoutTransaction(null)
  }
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
    if (!isLiveEditorView(view)) {
      literalAsciiCursor = null
      return
    }
    if (isComposingInput({ event, view })) {
      return
    }

    const result = buildArrowLigatureTransaction({ event, literalAsciiCursor, view })
    literalAsciiCursor = result.nextLiteralAsciiCursor
    if (result.transaction === null) {
      return
    }

    try {
      view.dispatch(result.transaction)
      event.preventDefault()
    } catch {
      literalAsciiCursor = null
    }
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
