import type { CSSProperties } from 'react'

const CONTEXT_MENU_VIEWPORT_PADDING = 8

export interface ContextMenuPoint {
  x: number
  y: number
}

export interface ContextMenuPositionOptions {
  maxWidth?: CSSProperties['maxWidth']
  minWidth?: CSSProperties['minWidth']
}

function parseZoomValue(source: string | undefined): number | null {
  if (!source || source === 'normal') return null
  const value = source.endsWith('%')
    ? Number.parseFloat(source) / 100
    : Number.parseFloat(source)
  return Number.isFinite(value) && value > 0 ? value : null
}

function getRootZoom(): number {
  const overlayZoom = parseZoomValue(
    getComputedStyle(document.documentElement).getPropertyValue('--tolaria-overlay-zoom-factor').trim(),
  )
  if (overlayZoom !== null) return overlayZoom

  const computedZoom = parseZoomValue(getComputedStyle(document.documentElement).zoom)
  if (computedZoom !== null) return computedZoom

  const inlineZoom = parseZoomValue(document.documentElement.style.getPropertyValue('zoom'))
  return inlineZoom ?? 1
}

function getViewportSize() {
  const zoom = getRootZoom()

  return {
    height: (window.visualViewport?.height ?? window.innerHeight) / zoom,
    width: (window.visualViewport?.width ?? window.innerWidth) / zoom,
    zoom,
  }
}

function clampToViewport(value: number, viewportSize: number): number {
  const max = Math.max(CONTEXT_MENU_VIEWPORT_PADDING, viewportSize - CONTEXT_MENU_VIEWPORT_PADDING)
  return Math.min(Math.max(value, CONTEXT_MENU_VIEWPORT_PADDING), max)
}

function trailingOffset(viewportSize: number, coordinate: number): number {
  return Math.max(CONTEXT_MENU_VIEWPORT_PADDING, viewportSize - coordinate)
}

function spaceBefore(coordinate: number): number {
  return Math.max(CONTEXT_MENU_VIEWPORT_PADDING, coordinate - CONTEXT_MENU_VIEWPORT_PADDING)
}

function spaceAfter(viewportSize: number, coordinate: number): number {
  return Math.max(CONTEXT_MENU_VIEWPORT_PADDING, viewportSize - coordinate - CONTEXT_MENU_VIEWPORT_PADDING)
}

export function getContextMenuPositionStyle(point: ContextMenuPoint, options: ContextMenuPositionOptions = {}): CSSProperties {
  const viewport = getViewportSize()
  const x = clampToViewport(point.x / viewport.zoom, viewport.width)
  const y = clampToViewport(point.y / viewport.zoom, viewport.height)
  const availableAbove = spaceBefore(y)
  const availableBelow = spaceAfter(viewport.height, y)
  const style: CSSProperties = {
    maxWidth: options.maxWidth ?? `calc(100vw - ${CONTEXT_MENU_VIEWPORT_PADDING * 2}px)`,
    overflowY: 'auto',
  }

  if (options.minWidth !== undefined) style.minWidth = options.minWidth

  if (x > viewport.width / 2) {
    style.right = trailingOffset(viewport.width, x)
  } else {
    style.left = x
  }

  if (availableAbove > availableBelow) {
    style.bottom = trailingOffset(viewport.height, y)
    style.maxHeight = availableAbove
  } else {
    style.top = y
    style.maxHeight = availableBelow
  }

  return style
}
