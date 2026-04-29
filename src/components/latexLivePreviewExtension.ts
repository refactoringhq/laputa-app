import { createExtension } from '@blocknote/core'
import { renderMathToHtml } from '../utils/mathMarkdown'

const PREVIEW_CLASS = 'math-live-preview'
const PREVIEW_OFFSET = 8
const UPDATE_EVENTS = ['input', 'keyup', 'mouseup', 'selectionchange'] as const
const ACTIVE_BLOCK_SELECTOR = '.bn-block-content, [data-content-type]'

interface ActiveMathSource {
  displayMode: boolean
  latex: string
}

interface TextCursorContext {
  node: Text
  offset: number
  root: HTMLElement
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashCount++
  return slashCount % 2 === 1
}

function isSingleDollar(text: string, index: number): boolean {
  return text[index] === '$'
    && text[index - 1] !== '$'
    && text[index + 1] !== '$'
    && !isEscaped(text, index)
}

function findNextSingleDollar(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    if (isSingleDollar(text, index)) return index
  }
  return -1
}

function isDoubleDollar(text: string, index: number): boolean {
  return text.slice(index, index + 2) === '$$'
    && text[index - 1] !== '$'
    && text[index + 2] !== '$'
    && !isEscaped(text, index)
}

function findNextDoubleDollar(text: string, from: number): number {
  for (let index = from; index < text.length - 1; index++) {
    if (isDoubleDollar(text, index)) return index
  }
  return -1
}

function findInlineMath(text: string, cursorOffset: number): ActiveMathSource | null {
  for (let start = cursorOffset - 1; start >= 0; start--) {
    if (!isSingleDollar(text, start)) continue
    const closing = findNextSingleDollar(text, start + 1)
    if (closing !== -1 && closing < cursorOffset) return null

    const end = closing === -1 ? cursorOffset : closing
    const latex = text.slice(start + 1, end)
    return latex.trim() ? { displayMode: false, latex } : null
  }
  return null
}

function findDisplayMath(text: string, cursorOffset: number): ActiveMathSource | null {
  for (let start = cursorOffset - 2; start >= 0; start--) {
    if (!isDoubleDollar(text, start)) continue

    const closing = findNextDoubleDollar(text, start + 2)
    if (closing !== -1 && closing < cursorOffset) return null

    const end = closing === -1 ? cursorOffset : closing
    const latex = text.slice(start + 2, end)
    return latex.trim() ? { displayMode: true, latex } : null
  }
  return null
}

export function readActiveMathSource(text: string, cursorOffset: number): ActiveMathSource | null {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, text.length))
  return findDisplayMath(text, boundedOffset) ?? findInlineMath(text, boundedOffset)
}

function readTextCursorContext(dom: HTMLElement): TextCursorContext | null {
  const selection = dom.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || !selection.anchorNode) return null
  if (!dom.contains(selection.anchorNode)) return null

  const anchorNode = selection.anchorNode
  const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
  const root = anchorElement?.closest(ACTIVE_BLOCK_SELECTOR)
    ?? anchorElement?.closest('[contenteditable="true"]')
  if (!(root instanceof HTMLElement)) return null

  if (anchorNode instanceof Text) {
    return { node: anchorNode, offset: selection.anchorOffset, root }
  }
  return null
}

function readRootTextOffset({ node, offset, root }: TextCursorContext): number {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  const walker = root.ownerDocument.createTreeWalker(root, showText)
  let position = 0
  while (walker.nextNode()) {
    const current = walker.currentNode
    if (current === node) return position + offset
    position += current.textContent?.length ?? 0
  }
  return position
}

function ensurePreview(dom: HTMLElement): HTMLElement {
  const existing = dom.querySelector<HTMLElement>(`.${PREVIEW_CLASS}`)
  if (existing) return existing

  const preview = dom.ownerDocument.createElement('div')
  preview.className = PREVIEW_CLASS
  preview.setAttribute('aria-hidden', 'true')
  dom.append(preview)
  return preview
}

function hidePreview(dom: HTMLElement): void {
  const preview = dom.querySelector<HTMLElement>(`.${PREVIEW_CLASS}`)
  if (preview) preview.hidden = true
}

function positionPreview(preview: HTMLElement, dom: HTMLElement, range: Range): void {
  const caretRect = range.getBoundingClientRect()
  const containerRect = dom.getBoundingClientRect()
  preview.hidden = false
  preview.style.left = `${Math.max(0, caretRect.left - containerRect.left)}px`
  preview.style.top = `${Math.max(0, caretRect.top - containerRect.top - preview.offsetHeight - PREVIEW_OFFSET)}px`
}

function updatePreview(dom: HTMLElement): void {
  const context = readTextCursorContext(dom)
  if (!context) {
    hidePreview(dom)
    return
  }

  const text = context.root.textContent ?? ''
  const cursorOffset = readRootTextOffset(context)
  const math = readActiveMathSource(text, cursorOffset)
  if (!math) {
    hidePreview(dom)
    return
  }

  const preview = ensurePreview(dom)
  preview.innerHTML = renderMathToHtml(math)

  const range = dom.ownerDocument.createRange()
  range.setStart(context.node, context.offset)
  range.collapse(true)
  positionPreview(preview, dom, range)
}

export function bindLatexLivePreview(dom: HTMLElement, signal: AbortSignal): void {
  let pendingFrame: number | null = null
  const update = () => {
    if (pendingFrame !== null) return
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null
      updatePreview(dom)
    })
  }

  signal.addEventListener('abort', () => {
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame)
      pendingFrame = null
    }
  }, { once: true })

  for (const eventName of UPDATE_EVENTS) {
    const target = eventName === 'selectionchange' ? dom.ownerDocument : dom
    target.addEventListener(eventName, update, { signal })
  }
}

export const createLatexLivePreviewExtension = createExtension(() => ({
  key: 'latexLivePreview',
  mount: ({ dom, signal }) => {
    if (dom instanceof HTMLElement) {
      bindLatexLivePreview(dom, signal)
    }
  },
}))
