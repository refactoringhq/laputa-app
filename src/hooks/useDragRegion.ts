import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef } from 'react'

const NO_DRAG_SELECTOR = [
  'button',
  'input',
  'select',
  'a',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[data-no-drag]',
].join(', ')

function isDragDisabledTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NO_DRAG_SELECTOR) !== null
}

function performCurrentWindowTitlebarDoubleClick(): Promise<void> {
  return invoke<void>('perform_current_window_titlebar_double_click')
}

/**
 * Returns a mousedown handler that triggers Tauri window drag via startDragging().
 * More reliable than data-tauri-drag-region with titleBarStyle: Overlay in Tauri v2.
 */
type DragRegionMouseEvent = React.MouseEvent | MouseEvent

export function useDragRegion<T extends HTMLElement = HTMLElement>() {
  const dragRegionRef = useRef<T | null>(null)
  const onMouseDown = useCallback((e: DragRegionMouseEvent) => {
    if (e.button !== 0) return
    if (isDragDisabledTarget(e.target)) return
    e.preventDefault()
    if (e.detail === 2) {
      void performCurrentWindowTitlebarDoubleClick().catch(() => {})
      return
    }
    void getCurrentWindow().startDragging().catch(() => {})
  }, [])

  useEffect(() => {
    const element = dragRegionRef.current
    if (!element) return
    element.addEventListener('mousedown', onMouseDown)
    return () => element.removeEventListener('mousedown', onMouseDown)
  }, [onMouseDown])

  return { dragRegionRef, onMouseDown }
}
