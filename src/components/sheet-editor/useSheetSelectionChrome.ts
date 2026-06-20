import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { cancelFrame, requestFrame } from '../../utils/sheetBrowserScheduling'
import { patchIronCalcSelectionChrome } from '../../utils/sheetSelectionChrome'
import type { SheetWorkbookState } from './sheetEditorTypes'

interface UseSheetSelectionChromeOptions {
  refreshWorkbook: () => void
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  workbook: SheetWorkbookState | null
}

function useSelectionChromePatchScheduler(sheetElementRef: MutableRefObject<HTMLDivElement | null>) {
  const selectionPatchFrameRef = useRef<number | null>(null)

  const scheduleSelectionChromePatch = useCallback(() => {
    if (selectionPatchFrameRef.current !== null) return
    selectionPatchFrameRef.current = requestFrame(() => {
      selectionPatchFrameRef.current = null
      patchIronCalcSelectionChrome(sheetElementRef.current)
    })
  }, [sheetElementRef])

  useEffect(() => () => {
    if (selectionPatchFrameRef.current !== null) {
      cancelFrame(selectionPatchFrameRef.current)
      selectionPatchFrameRef.current = null
    }
  }, [])

  return scheduleSelectionChromePatch
}

function useSelectionChromeObserver({
  scheduleSelectionChromePatch,
  sheetElementRef,
  workbook,
}: Pick<UseSheetSelectionChromeOptions, 'sheetElementRef' | 'workbook'> & {
  scheduleSelectionChromePatch: () => void
}) {
  useEffect(() => {
    if (workbook) scheduleSelectionChromePatch()
  }, [scheduleSelectionChromePatch, workbook])

  useEffect(() => {
    const container = sheetElementRef.current
    if (!container || !workbook) return undefined

    const observer = new MutationObserver((mutations) => {
      if (mutations.length > 0) scheduleSelectionChromePatch()
    })

    patchIronCalcSelectionChrome(container)
    observer.observe(container, {
      attributeFilter: ['class', 'style'],
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => observer.disconnect()
  }, [scheduleSelectionChromePatch, sheetElementRef, workbook])
}

function useZoomSelectionChromeRefresh({
  refreshWorkbook,
  scheduleSelectionChromePatch,
}: Pick<UseSheetSelectionChromeOptions, 'refreshWorkbook'> & {
  scheduleSelectionChromePatch: () => void
}) {
  const zoomRefreshFrameRef = useRef<number | null>(null)
  const refreshForCurrentZoom = useCallback(() => {
    if (zoomRefreshFrameRef.current !== null) cancelFrame(zoomRefreshFrameRef.current)
    zoomRefreshFrameRef.current = requestFrame(() => {
      zoomRefreshFrameRef.current = null
      refreshWorkbook()
      scheduleSelectionChromePatch()
    })
  }, [refreshWorkbook, scheduleSelectionChromePatch])

  useEffect(() => {
    window.addEventListener('laputa-zoom-change', refreshForCurrentZoom)
    window.addEventListener('resize', refreshForCurrentZoom)

    return () => {
      window.removeEventListener('laputa-zoom-change', refreshForCurrentZoom)
      window.removeEventListener('resize', refreshForCurrentZoom)
      if (zoomRefreshFrameRef.current !== null) {
        cancelFrame(zoomRefreshFrameRef.current)
        zoomRefreshFrameRef.current = null
      }
    }
  }, [refreshForCurrentZoom])
}

export function useSheetSelectionChrome({
  refreshWorkbook,
  sheetElementRef,
  workbook,
}: UseSheetSelectionChromeOptions) {
  const scheduleSelectionChromePatch = useSelectionChromePatchScheduler(sheetElementRef)
  useSelectionChromeObserver({ scheduleSelectionChromePatch, sheetElementRef, workbook })
  useZoomSelectionChromeRefresh({ refreshWorkbook, scheduleSelectionChromePatch })

  return scheduleSelectionChromePatch
}
