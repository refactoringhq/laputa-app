import { useRef, useLayoutEffect, useCallback, useState } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import { useRawMode } from '../hooks/useRawMode'
import { clearTableResizeState } from './tableResizeState'
import {
  buildCodeMirrorRestoreState,
  captureRawCodeMirrorRestoreState,
  captureRawEditorPositionSnapshot,
  captureRichEditorPositionSnapshot,
  type CodeMirrorRestoreState,
  type RawEditorPositionSnapshot,
} from './editorModePosition'
import {
  type PendingRawExitContent,
  buildPendingRawExitContent,
  rememberPendingRawExitContent,
  syncActiveTabIntoRawBuffer,
} from './editorRawModeSync'
import { useEditorModePositionSync } from './useEditorModePositionSync'

interface PendingRoundTripRawRestore {
  path: string
  state: CodeMirrorRestoreState
}

function getRoundTripRawRestore({
  activeTabPath,
  pendingRoundTripRawRestore,
}: {
  activeTabPath: string | null
  pendingRoundTripRawRestore: PendingRoundTripRawRestore | null
}) {
  if (!activeTabPath) return null
  return pendingRoundTripRawRestore?.path === activeTabPath
    ? pendingRoundTripRawRestore.state
    : null
}

function buildPendingRawRestore({
  activeTabContent,
  activeTabPath,
  editor,
  pendingRoundTripRawRestore,
  syncedContent,
}: {
  activeTabContent: string | null
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  pendingRoundTripRawRestore: PendingRoundTripRawRestore | null
  syncedContent: string | null
}) {
  const roundTripRestore = getRoundTripRawRestore({
    activeTabPath,
    pendingRoundTripRawRestore,
  })
  if (roundTripRestore) return roundTripRestore

  const nextContent = syncedContent ?? activeTabContent
  if (!nextContent) return null

  const richSnapshot = captureRichEditorPositionSnapshot(editor, document)
  return richSnapshot
    ? buildCodeMirrorRestoreState(editor, nextContent, richSnapshot)
    : null
}

function capturePendingRoundTripRawRestore(activeTabPath: string | null): PendingRoundTripRawRestore | null {
  if (!activeTabPath) return null

  const rawRestoreState = captureRawCodeMirrorRestoreState(document)
  return rawRestoreState
    ? { path: activeTabPath, state: rawRestoreState }
    : null
}

function useTrackRawBuffer({
  activeTabContent,
  activeTabPath,
  rawInitialContentRef,
  rawBufferPathRef,
  rawLatestContentRef,
  rawSourceContentRef,
}: {
  activeTabContent: string | null
  activeTabPath: string | null
  rawInitialContentRef: React.MutableRefObject<string | null>
  rawBufferPathRef: React.MutableRefObject<string | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawSourceContentRef: React.MutableRefObject<string | null>
}) {
  useLayoutEffect(() => {
    if (!activeTabPath) {
      rawLatestContentRef.current = null
      rawInitialContentRef.current = null
      rawBufferPathRef.current = null
      rawSourceContentRef.current = null
      return
    }

    if (rawBufferPathRef.current === activeTabPath) {
      return
    }

    rawLatestContentRef.current = activeTabContent
    rawInitialContentRef.current = activeTabContent
    rawBufferPathRef.current = activeTabContent === null ? null : activeTabPath
    rawSourceContentRef.current = activeTabContent
  }, [activeTabContent, activeTabPath, rawBufferPathRef, rawInitialContentRef, rawLatestContentRef, rawSourceContentRef])
}

function resetRawBufferState({
  rawInitialContentRef,
  rawBufferPathRef,
  rawLatestContentRef,
  rawSourceContentRef,
}: {
  rawInitialContentRef: React.MutableRefObject<string | null>
  rawBufferPathRef: React.MutableRefObject<string | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawSourceContentRef: React.MutableRefObject<string | null>
}) {
  rawInitialContentRef.current = null
  rawBufferPathRef.current = null
  rawLatestContentRef.current = null
  rawSourceContentRef.current = null
}

function useHandleFlushPending({
  editor,
  activeTabPath,
  activeTabContent,
  rawInitialContentRef,
  rawLatestContentRef,
  rawSourceContentRef,
  flushPendingEditorChangeRef,
  pendingRawRestoreRef,
  pendingRoundTripRawRestoreRef,
  setRawModeContentOverride,
  vaultPath,
}: {
  editor: ReturnType<typeof useCreateBlockNote>
  activeTabPath: string | null
  activeTabContent: string | null
  rawInitialContentRef: React.MutableRefObject<string | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawSourceContentRef: React.MutableRefObject<string | null>
  flushPendingEditorChangeRef?: React.MutableRefObject<(() => boolean) | null>
  pendingRawRestoreRef: React.MutableRefObject<CodeMirrorRestoreState | null>
  pendingRoundTripRawRestoreRef: React.MutableRefObject<PendingRoundTripRawRestore | null>
  setRawModeContentOverride: React.Dispatch<React.SetStateAction<PendingRawExitContent | null>>
  vaultPath?: string
}) {
  return useCallback(async () => {
    rawSourceContentRef.current = activeTabContent
    const serializeRichEditorContent = flushPendingEditorChangeRef?.current?.() ?? true
    const syncedContent = syncActiveTabIntoRawBuffer({
      editor,
      activeTabPath,
      activeTabContent,
      rawLatestContentRef,
      serializeRichEditorContent,
      vaultPath,
    })
    rawInitialContentRef.current = syncedContent ?? activeTabContent
    pendingRawRestoreRef.current = buildPendingRawRestore({
      activeTabContent,
      activeTabPath,
      editor,
      pendingRoundTripRawRestore: pendingRoundTripRawRestoreRef.current,
      syncedContent,
    })
    pendingRoundTripRawRestoreRef.current = null
    setRawModeContentOverride(buildPendingRawExitContent(activeTabPath, syncedContent))
    clearTableResizeState(editor)
    return true
  }, [
    activeTabContent,
    activeTabPath,
    editor,
    flushPendingEditorChangeRef,
    pendingRawRestoreRef,
    pendingRoundTripRawRestoreRef,
    rawInitialContentRef,
    rawLatestContentRef,
    rawSourceContentRef,
    setRawModeContentOverride,
    vaultPath,
  ])
}

function useHandleBeforeRawEnd({
  activeTabPath,
  activeTabContent,
  onContentChange,
  rawInitialContentRef,
  rawBufferPathRef,
  rawLatestContentRef,
  rawSourceContentRef,
  pendingRawRestoreRef,
  pendingRichRestoreRef,
  pendingRoundTripRawRestoreRef,
  setPendingRawExitContent,
  setRawModeContentOverride,
}: {
  activeTabPath: string | null
  activeTabContent: string | null
  onContentChange?: (path: string, content: string) => void
  rawInitialContentRef: React.MutableRefObject<string | null>
  rawBufferPathRef: React.MutableRefObject<string | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawSourceContentRef: React.MutableRefObject<string | null>
  pendingRawRestoreRef: React.MutableRefObject<CodeMirrorRestoreState | null>
  pendingRichRestoreRef: React.MutableRefObject<RawEditorPositionSnapshot | null>
  pendingRoundTripRawRestoreRef: React.MutableRefObject<PendingRoundTripRawRestore | null>
  setPendingRawExitContent: React.Dispatch<React.SetStateAction<PendingRawExitContent | null>>
  setRawModeContentOverride: React.Dispatch<React.SetStateAction<PendingRawExitContent | null>>
}) {
  return useCallback(() => {
    pendingRoundTripRawRestoreRef.current = capturePendingRoundTripRawRestore(activeTabPath)
    pendingRichRestoreRef.current = captureRawEditorPositionSnapshot(document)
    pendingRawRestoreRef.current = null
    setPendingRawExitContent(rememberPendingRawExitContent({
      activeTabPath,
      activeTabContent,
      rawInitialContent: rawInitialContentRef.current,
      rawLatestContentRef,
      onContentChange,
    }))
    setRawModeContentOverride(null)
    resetRawBufferState({ rawInitialContentRef, rawBufferPathRef, rawLatestContentRef, rawSourceContentRef })
  }, [
    activeTabContent,
    activeTabPath,
    onContentChange,
    pendingRawRestoreRef,
    pendingRichRestoreRef,
    pendingRoundTripRawRestoreRef,
    rawInitialContentRef,
    rawBufferPathRef,
    rawLatestContentRef,
    rawSourceContentRef,
    setPendingRawExitContent,
    setRawModeContentOverride,
  ])
}

function useSyncRawModeContentOverride({
  activeTabContent,
  activeTabPath,
  rawSourceContentRef,
  setRawModeContentOverride,
}: {
  activeTabContent: string | null
  activeTabPath: string | null
  rawSourceContentRef: React.MutableRefObject<string | null>
  setRawModeContentOverride: React.Dispatch<React.SetStateAction<PendingRawExitContent | null>>
}) {
  useLayoutEffect(() => {
    if (!activeTabPath || activeTabContent === null) return
    if (rawSourceContentRef.current === null || activeTabContent === rawSourceContentRef.current) return
    const nextContent = activeTabContent

    setRawModeContentOverride((current) => {
      if (!current) return current
      if (current.path !== activeTabPath || current.content === nextContent) return current
      return { path: activeTabPath, content: nextContent }
    })
  }, [activeTabContent, activeTabPath, rawSourceContentRef, setRawModeContentOverride])
}

export function useRawModeWithFlush(
  editor: ReturnType<typeof useCreateBlockNote>,
  activeTabPath: string | null,
  activeTabContent: string | null,
  onContentChange?: (path: string, content: string) => void,
  vaultPath?: string,
  flushPendingEditorChangeRef?: React.MutableRefObject<(() => boolean) | null>,
) {
  const rawLatestContentRef = useRef<string | null>(null)
  const rawInitialContentRef = useRef<string | null>(null)
  const rawBufferPathRef = useRef<string | null>(null)
  const rawSourceContentRef = useRef<string | null>(null)
  const pendingRawRestoreRef = useRef<CodeMirrorRestoreState | null>(null)
  const pendingRichRestoreRef = useRef<RawEditorPositionSnapshot | null>(null)
  const pendingRoundTripRawRestoreRef = useRef<PendingRoundTripRawRestore | null>(null)
  const [pendingRawExitContent, setPendingRawExitContent] = useState<PendingRawExitContent | null>(null)
  const [rawModeContentOverride, setRawModeContentOverride] = useState<PendingRawExitContent | null>(null)
  useTrackRawBuffer({
    activeTabContent,
    activeTabPath,
    rawInitialContentRef,
    rawBufferPathRef,
    rawLatestContentRef,
    rawSourceContentRef,
  })
  useSyncRawModeContentOverride({
    activeTabContent,
    activeTabPath,
    rawSourceContentRef,
    setRawModeContentOverride,
  })

  const handleFlushPending = useHandleFlushPending({
    editor,
    activeTabPath,
    activeTabContent,
    rawInitialContentRef,
    rawLatestContentRef,
    rawSourceContentRef,
    flushPendingEditorChangeRef,
    pendingRawRestoreRef,
    pendingRoundTripRawRestoreRef,
    setRawModeContentOverride,
    vaultPath,
  })
  const handleBeforeRawEnd = useHandleBeforeRawEnd({
    activeTabPath,
    activeTabContent,
    onContentChange,
    rawInitialContentRef,
    rawBufferPathRef,
    rawLatestContentRef,
    rawSourceContentRef,
    pendingRawRestoreRef,
    pendingRichRestoreRef,
    pendingRoundTripRawRestoreRef,
    setPendingRawExitContent,
    setRawModeContentOverride,
  })

  const { rawMode, handleToggleRaw } = useRawMode({
    activeTabPath,
    onFlushPending: handleFlushPending,
    onBeforeRawEnd: handleBeforeRawEnd,
  })
  useEditorModePositionSync({
    activeTabPath,
    editor,
    pendingRawRestoreRef,
    pendingRoundTripRawRestoreRef,
    pendingRichRestoreRef,
    rawMode,
  })

  return { rawMode, handleToggleRaw, rawLatestContentRef, pendingRawExitContent, setPendingRawExitContent, rawModeContentOverride }
}
