import { useEffect } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import {
  restoreBlockNoteView,
  restoreCodeMirrorView,
  type CodeMirrorRestoreState,
  type RawEditorPositionSnapshot,
} from './editorModePosition'

const MAX_RAW_RESTORE_ATTEMPTS = 5

export interface EditorModeRestoreTransition {
  rawRestore: CodeMirrorRestoreState | null
  roundTripRawRestore: { path: string; state: CodeMirrorRestoreState } | null
  richRestore: RawEditorPositionSnapshot | null
}

export function createEditorModeRestoreTransition(): EditorModeRestoreTransition {
  return {
    rawRestore: null,
    roundTripRawRestore: null,
    richRestore: null,
  }
}

function useRawEditorRestoreEffect({
  activeTabPath,
  restoreTransitionRef,
  rawMode,
}: {
  activeTabPath: string | null
  restoreTransitionRef: React.MutableRefObject<EditorModeRestoreTransition>
  rawMode: boolean
}) {
  useEffect(() => {
    if (!rawMode || !restoreTransitionRef.current.rawRestore) return

    let frame = 0
    let attempts = 0

    const tryRestore = () => {
      const pendingState = restoreTransitionRef.current.rawRestore
      if (!pendingState) return
      if (restoreCodeMirrorView(document, pendingState)) {
        restoreTransitionRef.current.rawRestore = null
        return
      }
      attempts += 1
      if (attempts < MAX_RAW_RESTORE_ATTEMPTS) {
        frame = window.requestAnimationFrame(tryRestore)
      }
    }

    frame = window.requestAnimationFrame(tryRestore)
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [activeTabPath, restoreTransitionRef, rawMode])
}

function useBlockNoteRestoreEffect({
  activeTabPath,
  editor,
  restoreTransitionRef,
  rawMode,
}: {
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  restoreTransitionRef: React.MutableRefObject<EditorModeRestoreTransition>
  rawMode: boolean
}) {
  useEffect(() => {
    if (rawMode) return

    let restoreFrame = 0
    let canceled = false

    const cancelPendingRestore = () => {
      canceled = true
      if (restoreFrame === 0) return

      window.cancelAnimationFrame(restoreFrame)
      restoreFrame = 0
    }

    const handleEditorTabSwapped = (event: Event) => {
      const pendingSnapshot = restoreTransitionRef.current.richRestore
      if (!activeTabPath || !pendingSnapshot) return

      const customEvent = event as CustomEvent<{ path: string }>
      if (customEvent.detail.path !== activeTabPath) return

      if (restoreFrame !== 0) {
        window.cancelAnimationFrame(restoreFrame)
      }

      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = 0
        if (canceled) return

        restoreBlockNoteView(editor, pendingSnapshot, document)
        restoreTransitionRef.current.roundTripRawRestore = null
        restoreTransitionRef.current.richRestore = null
      })
    }

    window.addEventListener('laputa:editor-tab-swapped', handleEditorTabSwapped)
    return () => {
      cancelPendingRestore()
      window.removeEventListener('laputa:editor-tab-swapped', handleEditorTabSwapped)
    }
  }, [activeTabPath, editor, restoreTransitionRef, rawMode])
}

export function useEditorModePositionSync({
  activeTabPath,
  editor,
  restoreTransitionRef,
  rawMode,
}: {
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  restoreTransitionRef: React.MutableRefObject<EditorModeRestoreTransition>
  rawMode: boolean
}) {
  useRawEditorRestoreEffect({ activeTabPath, restoreTransitionRef, rawMode })
  useBlockNoteRestoreEffect({ activeTabPath, editor, restoreTransitionRef, rawMode })
}
