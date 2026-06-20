import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { patchSheetPointerEventCoordinates } from '../../utils/sheetPointerCoordinates'

interface UseSheetPointerCoordinatePatchingOptions {
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
}

export function useSheetPointerCoordinatePatching({
  sheetElementRef,
}: UseSheetPointerCoordinatePatchingOptions) {
  const sheetPointerActiveRef = useRef(false)

  useEffect(() => {
    const patchPointerEvent = (event: PointerEvent) => {
      const container = sheetElementRef.current
      if (!container) return

      const targetIsInsideSheet = event.target instanceof Node && container.contains(event.target)
      if (!targetIsInsideSheet && !sheetPointerActiveRef.current) return
      patchSheetPointerEventCoordinates(event, container)
    }

    document.addEventListener('pointerdown', patchPointerEvent, true)
    document.addEventListener('pointermove', patchPointerEvent, true)
    document.addEventListener('pointerup', patchPointerEvent, true)
    return () => {
      document.removeEventListener('pointerdown', patchPointerEvent, true)
      document.removeEventListener('pointermove', patchPointerEvent, true)
      document.removeEventListener('pointerup', patchPointerEvent, true)
    }
  }, [sheetElementRef])

  useEffect(() => {
    const scheduleAfterPointerInteraction = () => {
      if (!sheetPointerActiveRef.current) return
      sheetPointerActiveRef.current = false
    }

    document.addEventListener('pointerup', scheduleAfterPointerInteraction, true)
    return () => document.removeEventListener('pointerup', scheduleAfterPointerInteraction, true)
  }, [])

  return sheetPointerActiveRef
}
