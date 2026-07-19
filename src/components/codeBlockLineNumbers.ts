const CODE_BLOCK_SELECTOR = '[data-content-type="codeBlock"]'
const LINE_NUMBER_LAYER_CLASS = 'editor__code-line-number-layer'

function codeBlockParts(block: Element) {
  const pre = block.querySelector<HTMLElement>('pre')
  const code = pre?.querySelector<HTMLElement>('code') ?? null
  return { code, pre }
}

function createLineNumbers(lineCount: number): HTMLElement {
  const gutter = document.createElement('span')
  gutter.setAttribute('data-code-line-numbers', '')
  gutter.setAttribute('contenteditable', 'false')
  gutter.setAttribute('aria-hidden', 'true')

  for (let line = 1; line <= lineCount; line += 1) {
    const number = document.createElement('span')
    number.textContent = String(line)
    gutter.appendChild(number)
  }
  return gutter
}

function textBoundaryAt(code: HTMLElement, targetOffset: number): [Node, number] {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
  let remaining = targetOffset
  let current = walker.nextNode()

  while (current) {
    const length = current.textContent?.length ?? 0
    if (remaining <= length) return [current, remaining]
    remaining -= length
    current = walker.nextNode()
  }
  return [code, code.childNodes.length]
}

function visualRowsForLine(code: HTMLElement, start: number, end: number): number {
  const range = document.createRange()
  const [startNode, startOffset] = textBoundaryAt(code, start)
  const [endNode, endOffset] = textBoundaryAt(code, end)
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  if (typeof range.getClientRects !== 'function') return 1

  const rowTops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)))
  return Math.max(rowTops.size, 1)
}

function updateLineHeights(code: HTMLElement, gutter: HTMLElement, lines: string[]): void {
  const computedLineHeight = Number.parseFloat(getComputedStyle(code).lineHeight)
  const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 20
  let offset = 0

  lines.forEach((line, index) => {
    const rows = visualRowsForLine(code, offset, offset + line.length)
    const number = gutter.children.item(index) as HTMLElement | null
    if (number) number.style.height = `${rows * lineHeight}px`
    offset += line.length + 1
  })
}

function positionGutter(pre: HTMLElement, host: HTMLElement, gutter: HTMLElement): void {
  const preRect = pre.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  gutter.style.left = `${preRect.left - hostRect.left + host.scrollLeft + 24}px`
  gutter.style.top = `${preRect.top - hostRect.top + host.scrollTop + 24}px`
}

export function syncCodeBlockLineNumbers(
  root: ParentNode,
  layer: HTMLElement,
  host: HTMLElement = layer.parentElement ?? layer,
): void {
  const gutters: HTMLElement[] = []
  root.querySelectorAll(CODE_BLOCK_SELECTOR).forEach((block) => {
    const { code, pre } = codeBlockParts(block)
    if (!code || !pre) return

    const lines = (code.textContent ?? '').split('\n')
    const gutter = createLineNumbers(lines.length)
    positionGutter(pre, host, gutter)
    updateLineHeights(code, gutter, lines)
    gutters.push(gutter)
  })
  layer.replaceChildren(...gutters)
}

export function installCodeBlockLineNumbers(root: HTMLElement, signal: AbortSignal): void {
  const host = root.parentElement ?? root
  const layer = document.createElement('div')
  layer.className = LINE_NUMBER_LAYER_CLASS
  host.classList.add('editor__code-line-number-host')
  host.appendChild(layer)

  const sync = () => syncCodeBlockLineNumbers(root, layer, host)
  const mutationObserver = new MutationObserver(sync)
  mutationObserver.observe(root, { childList: true, characterData: true, subtree: true })
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
  resizeObserver?.observe(root)
  root.ownerDocument.addEventListener('scroll', sync, { capture: true, signal })

  signal.addEventListener('abort', () => {
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
    layer.remove()
    host.classList.remove('editor__code-line-number-host')
  }, { once: true })
  sync()
}
