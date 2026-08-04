import { resolveArrowLigatureInput } from '../utils/arrowLigatures'
import {
  createRichEditorInputTransformExtension,
  type RichEditorInputTransform,
} from './richEditorInputTransform'

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getWritableCursor(selection: CodeContextSelection): number | null {
  const { from, to } = selection
  if (!isFiniteNumber(from) || !isFiniteNumber(to)) return null

  return from === to ? from : null
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

export function createArrowLigatureInputTransform(): RichEditorInputTransform {
  let literalAsciiCursor: number | null = null

  return {
    handleBeforeInput(event, { view }) {
      if (!isInsertedCharacter(event)) return null

      const result = buildArrowLigatureTransaction({ event, literalAsciiCursor, view })
      literalAsciiCursor = result.nextLiteralAsciiCursor
      if (result.transaction === null) return null

      return {
        ignoreDispatchError: true,
        onDispatchError: () => {
          literalAsciiCursor = null
        },
        preventDefault: true,
        transaction: result.transaction,
      }
    },
    reset() {
      literalAsciiCursor = null
    },
  }
}

export const createArrowLigaturesExtension = createRichEditorInputTransformExtension({
  createTransforms: () => [createArrowLigatureInputTransform()],
  key: 'arrowLigatures',
})
