import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useTauriDragDropEvent, type TauriDragDropEvent } from '../hooks/useTauriDragDropEvent'

interface NativePathDropOptions<T extends HTMLElement> {
  targetRef: RefObject<T | null>
  disabled?: boolean
  onPathDrop: (paths: string[]) => void
}

function pointInRect(point: { x: number; y: number }, rect: DOMRect): boolean {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom
}

function shouldCheckScaledPoint(scale: number): boolean {
  if (!Number.isFinite(scale)) return false
  if (scale <= 0) return false
  return scale !== 1
}

function nativeDropHitsTarget(target: HTMLElement, position: { x: number; y: number }): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false

  const rect = target.getBoundingClientRect()
  const points = [{ x: position.x, y: position.y }]
  const scale = window.devicePixelRatio
  if (shouldCheckScaledPoint(scale)) {
    points.push({ x: position.x / scale, y: position.y / scale })
  }

  return points.some((point) => pointInRect(point, rect))
}

function nativeDropTargetHasFocus(target: HTMLElement): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return activeElement === target || target.contains(activeElement)
}

function nativeDropTargetHasSelection(target: HTMLElement): boolean {
  const selectionAnchor = window.getSelection()?.anchorNode
  return selectionAnchor ? target === selectionAnchor || target.contains(selectionAnchor) : false
}

function shouldHandleNativePathDrop(target: HTMLElement, event: TauriDragDropEvent): boolean {
  if (event.payload.type !== 'drop') return false
  return nativeDropTargetHasFocus(target)
    || nativeDropTargetHasSelection(target)
    || nativeDropHitsTarget(target, event.payload.position)
}

function usableNativePaths(paths: string[]): string[] {
  return paths.map((path) => path.trim()).filter(Boolean)
}

function nativeDropPaths(event: TauriDragDropEvent): string[] | null {
  if (event.payload.type !== 'drop') return null
  return usableNativePaths(event.payload.paths)
}

export function useNativePathDrop<T extends HTMLElement>({
  targetRef,
  disabled = false,
  onPathDrop,
}: NativePathDropOptions<T>) {
  const disabledRef = useRef(disabled)
  const onPathDropRef = useRef(onPathDrop)

  useLayoutEffect(() => {
    disabledRef.current = disabled
    onPathDropRef.current = onPathDrop
  }, [disabled, onPathDrop])

  useTauriDragDropEvent((event) => {
    if (disabledRef.current) return

    const target = targetRef.current
    if (!target || !shouldHandleNativePathDrop(target, event)) return

    const paths = nativeDropPaths(event)
    if (paths && paths.length > 0) onPathDropRef.current(paths)
  })
}
