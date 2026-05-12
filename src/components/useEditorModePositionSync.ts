import { useEffect } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import {
  restoreBlockNoteView,
  restoreCodeMirrorView,
  type CodeMirrorRestoreState,
  type RawEditorPositionSnapshot,
} from './editorModePosition'

const MAX_RAW_RESTORE_ATTEMPTS = 5

function useRawEditorRestoreEffect({
  activeTabPath,
  pendingRawRestoreRef,
  rawMode,
}: {
  activeTabPath: string | null
  pendingRawRestoreRef: React.MutableRefObject<CodeMirrorRestoreState | null>
  rawMode: boolean
}) {
  useEffect(() => {
    if (!rawMode || !pendingRawRestoreRef.current) return

    let frame = 0
    let attempts = 0

    const tryRestore = () => {
      const pendingState = pendingRawRestoreRef.current
      if (!pendingState) return
      if (restoreCodeMirrorView(document, pendingState)) {
        pendingRawRestoreRef.current = null
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
  }, [activeTabPath, pendingRawRestoreRef, rawMode])
}

function useBlockNoteRestoreEffect({
  activeTabPath,
  editor,
  pendingRoundTripRawRestoreRef,
  pendingRichRestoreRef,
  rawMode,
}: {
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  pendingRoundTripRawRestoreRef: React.MutableRefObject<{ path: string; state: CodeMirrorRestoreState } | null>
  pendingRichRestoreRef: React.MutableRefObject<RawEditorPositionSnapshot | null>
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
      const pendingSnapshot = pendingRichRestoreRef.current
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
        pendingRoundTripRawRestoreRef.current = null
        pendingRichRestoreRef.current = null
      })
    }

    window.addEventListener('laputa:editor-tab-swapped', handleEditorTabSwapped)
    return () => {
      cancelPendingRestore()
      window.removeEventListener('laputa:editor-tab-swapped', handleEditorTabSwapped)
    }
  }, [activeTabPath, editor, pendingRichRestoreRef, pendingRoundTripRawRestoreRef, rawMode])
}

export function useEditorModePositionSync({
  activeTabPath,
  editor,
  pendingRawRestoreRef,
  pendingRoundTripRawRestoreRef,
  pendingRichRestoreRef,
  rawMode,
}: {
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  pendingRawRestoreRef: React.MutableRefObject<CodeMirrorRestoreState | null>
  pendingRoundTripRawRestoreRef: React.MutableRefObject<{ path: string; state: CodeMirrorRestoreState } | null>
  pendingRichRestoreRef: React.MutableRefObject<RawEditorPositionSnapshot | null>
  rawMode: boolean
}) {
  useRawEditorRestoreEffect({ activeTabPath, pendingRawRestoreRef, rawMode })
  useBlockNoteRestoreEffect({ activeTabPath, editor, pendingRoundTripRawRestoreRef, pendingRichRestoreRef, rawMode })
}
