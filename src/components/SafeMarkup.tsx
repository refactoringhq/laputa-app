import DOMPurify from 'dompurify'
import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'
import { RUNTIME_STYLE_NONCE } from '@/lib/runtimeStyleNonce'

interface SafeHtmlSpanProps extends HTMLAttributes<HTMLSpanElement> {
  markup: string
}

interface SafeSvgDivProps extends HTMLAttributes<HTMLDivElement> {
  svg: string
}

const MERMAID_SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignObject'],
  ADD_ATTR: ['xmlns'],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
}

const KATEX_MARKUP_SANITIZE_CONFIG = {
  // KaTeX uses inline SVG paths for stretched radicals such as \sqrt{x}.
  USE_PROFILES: { html: true, mathMl: true, svg: true },
}

function importSanitizedMarkupNodes(markup: string): Node[] {
  const sanitized = DOMPurify.sanitize(markup, KATEX_MARKUP_SANITIZE_CONFIG)
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  return Array.from(parsed.body.childNodes, (node) => document.importNode(node, true))
}

function importSanitizedSvgNode(svg: string): Node | null {
  const sanitized = DOMPurify.sanitize(svg, MERMAID_SVG_SANITIZE_CONFIG)
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  const parsedSvg = parsed.body.querySelector('svg')
  if (!parsedSvg) return null

  const svgNode = document.importNode(parsedSvg, true)
  svgNode.querySelectorAll('style').forEach((style) => {
    style.setAttribute('nonce', RUNTIME_STYLE_NONCE)
  })
  return svgNode
}

export function SafeHtmlSpan({ markup, ...props }: SafeHtmlSpanProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    ref.current?.replaceChildren(...importSanitizedMarkupNodes(markup))
  }, [markup])

  return <span {...props} ref={ref} />
}

export function SafeSvgDiv({ svg, ...props }: SafeSvgDivProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = importSanitizedSvgNode(svg)
    ref.current?.replaceChildren(...(node ? [node] : []))
  }, [svg])

  return <div {...props} ref={ref} />
}
