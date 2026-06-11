import type { CSSProperties } from 'react'

const CONTEXT_MENU_VIEWPORT_PADDING = 8

export interface ContextMenuPoint {
  x: number
  y: number
}

export interface ContextMenuPositionOptions {
  maxWidth?: CSSProperties['maxWidth']
  minWidth: CSSProperties['minWidth']
}

function getViewportSize() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
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

export function getContextMenuPositionStyle(
  point: ContextMenuPoint,
  { maxWidth, minWidth }: ContextMenuPositionOptions,
): CSSProperties {
  const viewport = getViewportSize()
  const x = clampToViewport(point.x, viewport.width)
  const y = clampToViewport(point.y, viewport.height)
  const availableAbove = spaceBefore(y)
  const availableBelow = spaceAfter(viewport.height, y)
  const style: CSSProperties = {
    maxWidth: maxWidth ?? `calc(100vw - ${CONTEXT_MENU_VIEWPORT_PADDING * 2}px)`,
    minWidth,
    overflowY: 'auto',
  }

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
