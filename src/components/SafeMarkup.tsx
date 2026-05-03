import DOMPurify from 'dompurify'
import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'
import { RUNTIME_STYLE_NONCE } from '@/lib/runtimeStyleNonce'

interface SafeHtmlSpanProps extends HTMLAttributes<HTMLSpanElement> {
  html: string
}

interface SafeSvgDivProps extends HTMLAttributes<HTMLDivElement> {
  svg: string
}

function importSanitizedHtmlNodes(html: string): Node[] {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
  })
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  return Array.from(parsed.body.childNodes, (node) => document.importNode(node, true))
}

function importSanitizedSvgNode(svg: string): Node | null {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
  const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) return null

  const svgNode = document.importNode(parsed.documentElement, true)
  svgNode.querySelectorAll('style').forEach((style) => {
    style.setAttribute('nonce', RUNTIME_STYLE_NONCE)
  })
  return svgNode
}

export function SafeHtmlSpan({ html, ...props }: SafeHtmlSpanProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    ref.current?.replaceChildren(...importSanitizedHtmlNodes(html))
  }, [html])

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
