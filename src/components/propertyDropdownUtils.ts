import { useEffect, useLayoutEffect, type RefObject } from 'react'

const DEFAULT_DROPDOWN_MARGIN = 8

export function getAnchoredDropdownLeft(
  anchorRight: number,
  dropdownWidth: number,
  viewportWidth: number,
  margin = DEFAULT_DROPDOWN_MARGIN,
) {
  const rightAlignedLeft = anchorRight - dropdownWidth
  const minLeft = margin
  const maxLeft = viewportWidth - dropdownWidth - margin
  if (maxLeft < minLeft) return minLeft
  return Math.min(Math.max(rightAlignedLeft, minLeft), maxLeft)
}

export function getNextHighlightIndex(current: number, total: number) {
  if (total <= 0) return 0
  return current < total - 1 ? current + 1 : 0
}

export function getPreviousHighlightIndex(current: number, total: number) {
  if (total <= 0) return -1
  return current > 0 ? current - 1 : total - 1
}

export function isCreateOptionVisible(query: string, options: string[]) {
  const trimmed = query.trim()
  if (!trimmed) return false
  return !options.some((option) => option.toLowerCase() === trimmed.toLowerCase())
}

export function useAnchoredDropdownPosition({
  anchorRef,
  dropdownRef,
  width,
}: {
  anchorRef: RefObject<HTMLElement | null>
  dropdownRef: RefObject<HTMLElement | null>
  width: number
}) {
  useLayoutEffect(() => {
    const node = dropdownRef.current
    const anchor = anchorRef.current?.parentElement
    if (!node || !anchor) return

    const rect = anchor.getBoundingClientRect()
    node.style.top = `${rect.bottom + 4}px`
    node.style.left = `${getAnchoredDropdownLeft(rect.right, width, window.innerWidth)}px`
  }, [anchorRef, dropdownRef, width])
}

export function useAutoFocus<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    ref.current?.focus()
  }, [ref])
}
