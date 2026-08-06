import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HighlightBoundaryColorControl } from './markdownHighlightBoundaryControl'
import { ToolbarHighlightColorControl } from './markdownHighlightToolbarControl'
import type { HighlightEditor } from './markdownHighlightModel'

export {
  applyMarkdownHighlightColor,
  toggleDefaultMarkdownHighlight,
} from './markdownHighlightModel'
export { readMarkdownHighlightRange } from './markdownHighlightRange'

function unmountControl(root: Root, host: HTMLElement) {
  queueMicrotask(() => {
    root.unmount()
    host.remove()
  })
}

function mountToolbarControl(
  editor: HighlightEditor,
  container: Element,
  ownerDocument: Document,
): { host: HTMLElement; root: Root } {
  const host = ownerDocument.createElement('div')
  host.className = 'markdown-highlight-toolbar-color-host'
  ownerDocument.body.appendChild(host)

  const root = createRoot(host)
  root.render(createElement(ToolbarHighlightColorControl, { container, editor }))
  return { host, root }
}

function mountBoundaryControl(editor: HighlightEditor, ownerDocument: Document): {
  host: HTMLElement
  root: Root
} {
  const host = ownerDocument.createElement('div')
  host.className = 'markdown-highlight-boundary-host'
  ownerDocument.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(HighlightBoundaryColorControl, { editor }))
  return { host, root }
}

export function mountMarkdownHighlightControls({
  dom,
  editor,
  signal,
}: {
  dom: HTMLElement
  editor: HighlightEditor
  signal: AbortSignal
}) {
  const container = dom.closest('.editor__blocknote-container') ?? dom.parentElement
  if (!container) return

  const toolbarControl = mountToolbarControl(editor, container, dom.ownerDocument)
  const boundaryControl = mountBoundaryControl(editor, dom.ownerDocument)
  signal.addEventListener('abort', () => {
    unmountControl(toolbarControl.root, toolbarControl.host)
    unmountControl(boundaryControl.root, boundaryControl.host)
  }, { once: true })
}
