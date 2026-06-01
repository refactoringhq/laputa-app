import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { trackEvent } from '../lib/telemetry'
import { MATH_BLOCK_TYPE, MATH_INLINE_TYPE, readCompletedInlineMathAtEnd } from '../utils/mathMarkdown'
import {
  isRecoverableEditorTransformError,
  reportRecoveredEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'

const INLINE_WHITESPACE_RE = /^[^\S\r\n]$/
const NEWLINE_INPUT_TYPES = new Set(['insertParagraph', 'insertLineBreak'])
const MATH_SELECTOR = '.math[data-latex]'
const MATH_NODE_SEARCH_RADIUS = 8
type EditorViewLike = NonNullable<ReturnType<typeof useCreateBlockNote>['prosemirrorView']>
type EditorLike = ReturnType<typeof useCreateBlockNote>
type MathKind = 'inline' | 'block'
type MathActivation = 'keyboard' | 'pointer'
type MathNodeLike = {
  attrs?: Record<string, unknown>
  nodeSize: number
  type: { name: string }
}
type MathNodeLocation = {
  from: number
  kind: MathKind
  latex: string
  node: MathNodeLike
  to: number
}
type MathSelection = {
  from: number
  node?: unknown
  to: number
}
type ReadEditorView = () => EditorViewLike | undefined
type MathExtensionContext = {
  editor: EditorLike
  readView: ReadEditorView
}

interface CursorText {
  beforeText: string
  parentStart: number
}

interface InlineMathReplacement {
  from: number
  latex: string
  to: number
}

function isInsertedInlineWhitespace(event: InputEvent): event is InputEvent & { data: string } {
  return event.inputType === 'insertText'
    && typeof event.data === 'string'
    && INLINE_WHITESPACE_RE.test(event.data)
}

function shouldHandleInput(event: InputEvent): boolean {
  return isInsertedInlineWhitespace(event) || NEWLINE_INPUT_TYPES.has(event.inputType)
}

function shouldSkipInput(event: InputEvent, view: EditorViewLike): boolean {
  if (event.isComposing) return true
  if (view.composing) return true
  return !shouldHandleInput(event)
}

function selectionHasCodeMark(view: EditorViewLike): boolean {
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
  return marks.some((mark: { type: { name: string } }) => mark.type.name === 'code')
}

function readCursorText(view: EditorViewLike): CursorText | null {
  const { from, to, $from } = view.state.selection
  if (from !== to) return null
  if (!$from.parent.isTextblock) return null

  return {
    beforeText: $from.parent.textBetween(0, $from.parentOffset, '', ''),
    parentStart: from - $from.parentOffset,
  }
}

function readInlineMathReplacement(view: EditorViewLike): InlineMathReplacement | null {
  if (selectionHasCodeMark(view)) return null

  const cursorText = readCursorText(view)
  if (!cursorText) return null

  const math = readCompletedInlineMathAtEnd({ text: cursorText.beforeText })
  if (!math) return null

  return {
    from: cursorText.parentStart + math.start,
    latex: math.latex,
    to: cursorText.parentStart + math.end + 1,
  }
}

function replaceCompletedInlineMath(
  view: EditorViewLike,
  trailingText?: string,
): EditorViewLike['state']['tr'] | null {
  const replacement = readInlineMathReplacement(view)
  const mathNodeType = Reflect.get(view.state.schema.nodes, MATH_INLINE_TYPE) as EditorViewLike['state']['schema']['nodes'][string] | undefined
  if (!replacement || !mathNodeType) return null

  const mathNode = mathNodeType.createChecked({ latex: replacement.latex })
  const transaction = view.state.tr.replaceWith(replacement.from, replacement.to, mathNode)

  if (trailingText !== undefined) {
    transaction.insertText(trailingText, replacement.from + mathNode.nodeSize)
  }

  return transaction.scrollIntoView()
}

function recoverTransformError(error: unknown): boolean {
  if (!isRecoverableEditorTransformError(error)) return false

  reportRecoveredEditorTransformError('transform_error', error)
  return true
}

function readMathInputTransaction(
  view: EditorViewLike,
  trailingText?: string,
): EditorViewLike['state']['tr'] | null {
  try {
    return replaceCompletedInlineMath(view, trailingText)
  } catch (error) {
    if (!recoverTransformError(error)) throw error
    return null
  }
}

function mathSource({ latex }: { latex: string }): string {
  return `$${latex}$`
}

function mathLatexSelectionRange({ from, latex }: { from: number; latex: string }) {
  const sourceStart = from + 1
  return { from: sourceStart, to: sourceStart + latex.length }
}

function mathKindForNode(node: MathNodeLike): MathKind | null {
  if (node.type.name === MATH_INLINE_TYPE) return 'inline'
  if (node.type.name === MATH_BLOCK_TYPE) return 'block'
  return null
}

function readLatexAttr(node: MathNodeLike): string | null {
  const latex = node.attrs?.latex
  return typeof latex === 'string' ? latex : null
}

function isMathNode(node: MathNodeLike, kind: MathKind): boolean {
  return mathKindForNode(node) === kind && readLatexAttr(node) !== null
}

function isMathNodeLike(node: unknown): node is MathNodeLike {
  if (!node || typeof node !== 'object') return false

  const candidate = node as Partial<MathNodeLike>
  return typeof candidate.nodeSize === 'number'
    && Boolean(candidate.type)
    && typeof candidate.type?.name === 'string'
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

function readRenderedMathTarget(target: EventTarget | null): { element: HTMLElement; kind: MathKind; latex: string } | null {
  const element = targetElement(target)?.closest<HTMLElement>(MATH_SELECTOR)
  const latex = element?.dataset.latex
  if (!element || latex === undefined) return null

  return {
    element,
    kind: element.classList.contains('math--block') ? 'block' : 'inline',
    latex,
  }
}

function searchMathNodeNearPosition({
  kind,
  latex,
  position,
  view,
}: {
  kind: MathKind
  latex: string
  position: number
  view: EditorViewLike
}): MathNodeLocation | null {
  const doc = view.state.doc
  const size = doc.content.size
  const from = Math.max(0, position - MATH_NODE_SEARCH_RADIUS)
  const to = Math.min(size, position + MATH_NODE_SEARCH_RADIUS)
  let fallback: MathNodeLocation | null = null
  let exact: MathNodeLocation | null = null

  doc.nodesBetween(from, to, (node: MathNodeLike, nodePos: number) => {
    if (!isMathNode(node, kind)) return true

    const nodeLatex = readLatexAttr(node) ?? latex
    const location = {
      from: nodePos,
      kind,
      latex,
      node,
      to: nodePos + node.nodeSize,
    }

    fallback ??= location
    if (nodeLatex === latex) {
      exact = location
      return false
    }

    return true
  })

  return exact ?? fallback
}

function readRenderedMathLocation({
  element,
  kind,
  latex,
  view,
}: {
  element: HTMLElement
  kind: MathKind
  latex: string
  view: EditorViewLike
}): MathNodeLocation | null {
  const position = view.posAtDOM(element, 0)
  if (!Number.isFinite(position)) return null

  return searchMathNodeNearPosition({ kind, latex, position, view })
}

function readSelectedMathLocation(view: EditorViewLike): MathNodeLocation | null {
  const selection = view.state.selection as MathSelection
  if (!isMathNodeLike(selection.node)) return null

  const kind = mathKindForNode(selection.node)
  const latex = readLatexAttr(selection.node)
  if (kind !== 'inline' || latex === null) return null

  return {
    from: selection.from,
    kind,
    latex,
    node: selection.node,
    to: selection.to,
  }
}

function replacementForMathSource(
  view: EditorViewLike,
  location: MathNodeLocation,
): ReturnType<EditorViewLike['state']['schema']['text']> {
  const source = mathSource(location)
  return view.state.schema.text(source)
}

function restoreMathSource({
  activation,
  editor,
  location,
  view,
}: {
  activation: MathActivation
  editor: EditorLike
  location: MathNodeLocation
  view: EditorViewLike
}): boolean {
  const replacement = replacementForMathSource(view, location)
  if (!replacement) return false

  const transaction = view.state.tr
    .replaceWith(location.from, location.to, replacement)
    .scrollIntoView()

  if (!dispatchMathInputTransaction(view, transaction)) return false

  editor._tiptapEditor?.commands?.setTextSelection?.(
    mathLatexSelectionRange(location),
  )
  trackEvent('math_source_edit_reopened', {
    activation,
    math_mode: location.kind,
  })
  return true
}

function handleBeforeInputEvent(event: InputEvent, readView: ReadEditorView) {
  const view = readView()
  if (!view || shouldSkipInput(event, view)) return

  const trailingText = isInsertedInlineWhitespace(event) ? event.data : undefined
  const transaction = readMathInputTransaction(view, trailingText)
  if (!transaction) return

  if (!dispatchMathInputTransaction(view, transaction)) return
  if (trailingText !== undefined) {
    event.preventDefault()
  }
}

function handleRenderedMathDoubleClick(
  event: MouseEvent,
  { editor, readView }: MathExtensionContext,
) {
  const target = readRenderedMathTarget(event.target)
  const view = readView()
  if (!target || target.kind !== 'inline' || !view) return

  const location = readRenderedMathLocation({ ...target, view })
  if (!location) return

  if (!restoreMathSource({ activation: 'pointer', editor, location, view })) return

  event.preventDefault()
  event.stopPropagation()
}

function handleMathKeyDown(
  event: KeyboardEvent,
  { editor, readView }: MathExtensionContext,
) {
  if (event.key !== 'Enter' && event.key !== 'F2') return

  const view = readView()
  const location = view ? readSelectedMathLocation(view) : null
  if (!view || !location) return

  if (!restoreMathSource({ activation: 'keyboard', editor, location, view })) return

  event.preventDefault()
  event.stopPropagation()
}

function dispatchMathInputTransaction(
  view: EditorViewLike,
  transaction: EditorViewLike['state']['tr'],
): boolean {
  try {
    view.dispatch(transaction)
    return true
  } catch (error) {
    if (!recoverTransformError(error)) throw error
    return false
  }
}

export const createMathInputExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView

  return {
    key: 'mathInput',
    mount: ({ dom, signal }) => {
      const context = { editor, readView }

      dom.addEventListener('beforeinput', ((event: InputEvent) => {
        handleBeforeInputEvent(event, readView)
      }) as EventListener, {
        capture: true,
        signal,
      })
      dom.addEventListener('dblclick', (event) => {
        handleRenderedMathDoubleClick(event, context)
      }, {
        capture: true,
        signal,
      })
      dom.addEventListener('keydown', (event) => {
        handleMathKeyDown(event, context)
      }, {
        capture: true,
        signal,
      })
    },
  } as const
})
