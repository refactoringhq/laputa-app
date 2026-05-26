import { useEffect } from 'react'
import { focusEditorWithRetries, type FocusableEditor } from './editorFocusUtils'

const TAB_SWAP_EVENT_NAME = 'laputa:editor-tab-swapped'
const FOCUS_EVENT_NAME = 'laputa:focus-editor'
const SWAP_WAIT_FALLBACK_MS = 250

interface FocusEventDetail {
  t0?: number
  selectTitle?: boolean
  path?: string | null
}

function scheduleEditorFocus(
  editor: FocusableEditor,
  editorMountedRef: React.RefObject<boolean>,
  selectTitle: boolean,
  t0: number | undefined,
): void {
  if (editorMountedRef.current) {
    requestAnimationFrame(() => focusEditorWithRetries(editor, selectTitle, t0))
    return
  }
  setTimeout(() => focusEditorWithRetries(editor, selectTitle, t0), 80)
}

function registerPendingTabFocus(
  targetPath: string,
  scheduleFocus: () => void,
  pendingCleanups: Set<() => void>,
): void {
  const handleTabSwap = (event: Event) => {
    const swapPath = (event as CustomEvent).detail?.path
    if (swapPath !== targetPath) return
    cleanupPending()
    scheduleFocus()
  }

  const fallbackTimer = window.setTimeout(() => {
    cleanupPending()
    scheduleFocus()
  }, SWAP_WAIT_FALLBACK_MS)

  const cleanupPending = () => {
    window.clearTimeout(fallbackTimer)
    window.removeEventListener(TAB_SWAP_EVENT_NAME, handleTabSwap)
    pendingCleanups.delete(cleanupPending)
  }

  pendingCleanups.add(cleanupPending)
  window.addEventListener(TAB_SWAP_EVENT_NAME, handleTabSwap)
}

/**
 * Focus editor when a new note is created (signaled via custom event).
 * Uses adaptive timing: fast rAF path when editor is already mounted,
 * short timeout when waiting for first mount.
 * When selectTitle is true, also selects all text in the first H1 block.
 */
export function useEditorFocus(
  editor: FocusableEditor,
  editorMountedRef: React.RefObject<boolean>,
) {
  useEffect(() => {
    const pendingCleanups = new Set<() => void>()

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as FocusEventDetail | undefined
      const t0 = detail?.t0
      const selectTitle = detail?.selectTitle ?? false
      const targetPath = detail?.path ?? null
      const scheduleFocus = () => scheduleEditorFocus(editor, editorMountedRef, selectTitle, t0)

      if (!targetPath) {
        scheduleFocus()
        return
      }
      registerPendingTabFocus(targetPath, scheduleFocus, pendingCleanups)
    }

    window.addEventListener(FOCUS_EVENT_NAME, handler)
    return () => {
      window.removeEventListener(FOCUS_EVENT_NAME, handler)
      for (const cleanup of pendingCleanups) {
        cleanup()
      }
      pendingCleanups.clear()
    }
  }, [editor, editorMountedRef])
}
