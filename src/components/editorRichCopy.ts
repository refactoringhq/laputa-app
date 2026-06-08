import { selectedFragmentToHTML } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'

export const CODE_BLOCK_SELECTOR = '[data-content-type="codeBlock"]'
const CLIPBOARD_INLINE_FORMAT_SELECTOR = 'a, b, code, em, i, s, span, strong, u'
const CLIPBOARD_WIKILINK_SELECTOR = [
  '[data-inline-content-type="wikilink"][data-target]',
  '.wikilink[data-target]',
  '[data-wikilink-target]',
].join(',')
const MARKDOWN_WIKILINK_RE = /\[\[[^\]]+\]\]/

type RichEditor = ReturnType<typeof useCreateBlockNote>
type ClipboardWriter = Pick<DataTransfer, 'setData'>
type ClipboardWikilink = {
  label: string
  target: string
}

export type RichEditorClipboardPayload = {
  blocknoteHtml: string
  html: string
  markdown: string
}

export function richEditorClipboardPayload(editor: RichEditor): RichEditorClipboardPayload | null {
  try {
    const selection = editor.prosemirrorState?.selection
    const view = editor.prosemirrorView
    if (!selection || selection.empty || !view) return null

    const { clipboardHTML, externalHTML, markdown } = selectedFragmentToHTML(view, editor)
    if (clipboardHTML.length === 0 && externalHTML.length === 0) return null

    return {
      blocknoteHtml: clipboardHTML,
      html: externalHTML,
      markdown: restoreWikilinkMarkdown(markdown, externalHTML, clipboardHTML),
    }
  } catch {
    return null
  }
}

export function writeRichEditorClipboardPayload(
  clipboardData: ClipboardWriter,
  payload: RichEditorClipboardPayload,
) {
  clipboardData.setData('blocknote/html', payload.blocknoteHtml)
  clipboardData.setData('text/html', payload.html)
  if (MARKDOWN_WIKILINK_RE.test(payload.markdown)) {
    clipboardData.setData('text/markdown', payload.markdown)
  }
}

function restoreWikilinkMarkdown(
  markdown: string,
  externalHTML: string,
  blocknoteHtml: string,
): string {
  const wikilinks = clipboardWikilinksFromHtml(externalHTML)
    ?? clipboardWikilinksFromHtml(blocknoteHtml)
  if (!wikilinks) return markdown

  let restored = markdown
  let searchFrom = 0
  for (const wikilink of wikilinks) {
    const index = restored.indexOf(wikilink.label, searchFrom)
    if (index === -1) continue

    const replacement = `[[${wikilink.target}]]`
    restored = restored.slice(0, index) + replacement + restored.slice(index + wikilink.label.length)
    searchFrom = index + replacement.length
  }

  return restored
}

function clipboardWikilinksFromHtml(html: string): ClipboardWikilink[] | null {
  const ownerDocument = globalThis.document
  if (!ownerDocument || html.length === 0) return null

  const container = ownerDocument.createElement('div')
  container.innerHTML = html
  const wikilinks = Array.from(container.querySelectorAll<HTMLElement>(CLIPBOARD_WIKILINK_SELECTOR))
    .map(clipboardWikilinkFromElement)
    .filter((wikilink): wikilink is ClipboardWikilink => wikilink !== null)

  return wikilinks.length > 0 ? wikilinks : null
}

function clipboardWikilinkFromElement(element: HTMLElement): ClipboardWikilink | null {
  const target = element.getAttribute('data-target') ?? element.getAttribute('data-wikilink-target')
  const label = element.textContent
  if (!target || !label) return null

  return { label, target }
}

function nodeElement(node: Node | null): HTMLElement | null {
  if (!node) return null
  if (node instanceof HTMLElement) return node
  return node.parentElement
}

export function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null
  return nodeElement(target)
}

function hasSingleActiveRange(selection: Selection | null): selection is Selection {
  return Boolean(selection && selection.rangeCount === 1 && !selection.isCollapsed)
}

function closestCodeBlockInContainer(options: {
  range: Range
  container: HTMLElement
}): HTMLElement | null {
  const { range, container } = options
  const codeBlock = nodeElement(range.commonAncestorContainer)
    ?.closest<HTMLElement>(CODE_BLOCK_SELECTOR)

  return codeBlock && container.contains(codeBlock) ? codeBlock : null
}

function nodeBelongsToElement(node: Node, element: HTMLElement): boolean {
  const elementNode = nodeElement(node)
  return Boolean(elementNode && element.contains(elementNode))
}

function rangeBelongsToElement(range: Range, element: HTMLElement): boolean {
  return nodeBelongsToElement(range.startContainer, element)
    && nodeBelongsToElement(range.endContainer, element)
}

function selectedCodeBlockRange(options: {
  selection: Selection | null
  container: HTMLElement
}): Range | null {
  const { selection, container } = options
  if (!hasSingleActiveRange(selection)) return null

  const range = selection.getRangeAt(0)
  const codeBlock = closestCodeBlockInContainer({ range, container })
  if (!codeBlock || !rangeBelongsToElement(range, codeBlock)) return null

  return range
}

export function selectedCodeBlockText(options: {
  selection: Selection | null
  container: HTMLElement
}): string | null {
  const range = selectedCodeBlockRange(options)
  if (!range) return null

  return range.cloneContents().textContent || options.selection?.toString() || ''
}

export function selectedEditorRange(
  selection: Selection | null,
  container: HTMLElement,
): Range | null {
  if (!hasSingleActiveRange(selection)) return null

  const range = selection.getRangeAt(0)
  return rangeBelongsToElement(range, container) ? range : null
}

export function selectedEditorPlainText(selection: Selection, range: Range): string | null {
  const text = selection.toString() || range.cloneContents().textContent || ''
  if (text.length === 0) return null

  return text.replace(/\r?\n$/, '')
}

export function selectedEditorDomHtml(range: Range): string {
  const wrapper = document.createElement('div')
  const selectedContent = range.cloneContents()
  const commonElement = nodeElement(range.commonAncestorContainer)

  if (commonElement?.matches(CLIPBOARD_INLINE_FORMAT_SELECTOR)) {
    const inlineWrapper = commonElement.cloneNode(false)
    inlineWrapper.appendChild(selectedContent)
    wrapper.appendChild(inlineWrapper)
    return wrapper.innerHTML
  }

  wrapper.appendChild(selectedContent)
  return wrapper.innerHTML
}

export function codeBlockText(codeBlock: HTMLElement): string {
  const codeElement = codeBlock.querySelector<HTMLElement>('pre code')
  return codeElement?.textContent ?? ''
}
