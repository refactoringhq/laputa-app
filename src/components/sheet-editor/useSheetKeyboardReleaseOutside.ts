import { useEffect } from 'react'
import type { MutableRefObject } from 'react'

interface UseSheetKeyboardReleaseOutsideOptions {
  releaseSheetKeyboard: () => void
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
}

export function useSheetKeyboardReleaseOutside({
  releaseSheetKeyboard,
  sheetElementRef,
}: UseSheetKeyboardReleaseOutsideOptions) {
  useEffect(() => {
    const releaseWhenOutsideSheet = (event: PointerEvent | FocusEvent) => {
      const container = sheetElementRef.current
      if (!container) return
      if (event.target instanceof Node && container.contains(event.target)) return
      releaseSheetKeyboard()
    }

    document.addEventListener('focusin', releaseWhenOutsideSheet, true)
    document.addEventListener('pointerdown', releaseWhenOutsideSheet, true)
    return () => {
      document.removeEventListener('focusin', releaseWhenOutsideSheet, true)
      document.removeEventListener('pointerdown', releaseWhenOutsideSheet, true)
    }
  }, [releaseSheetKeyboard, sheetElementRef])
}
