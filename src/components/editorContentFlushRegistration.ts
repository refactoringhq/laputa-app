import { useCallback, useEffect } from 'react'
import type React from 'react'

type Tab = {
  entry: { path: string }
  content: string
}

export function useRegisterEditorContentFlushes({
  activeTab,
  flushPendingEditorChange,
  flushPendingEditorContentRef,
  rawLatestContentRef,
  rawMode,
  onContentChange,
  flushPendingRawContentRef,
}: {
  activeTab: Tab | null
  flushPendingEditorChange: () => boolean
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawMode: boolean
  onContentChange?: (path: string, content: string) => void
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
}) {
  useRegisterRichContentFlush({ activeTab, flushPendingEditorChange, flushPendingEditorContentRef })
  useRegisterRawContentFlush({ activeTab, rawLatestContentRef, rawMode, onContentChange, flushPendingRawContentRef })
}

function useRegisterRichContentFlush({
  activeTab,
  flushPendingEditorChange,
  flushPendingEditorContentRef,
}: {
  activeTab: Tab | null
  flushPendingEditorChange: () => boolean
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
}) {
  const flushPendingEditorContent = useCallback((path: string) => {
    if (!activeTab || activeTab.entry.path !== path) return
    flushPendingEditorChange()
  }, [activeTab, flushPendingEditorChange])

  useRegisteredFlushRef(flushPendingEditorContentRef, flushPendingEditorContent)
}

function useRegisterRawContentFlush({
  activeTab,
  rawLatestContentRef,
  rawMode,
  onContentChange,
  flushPendingRawContentRef,
}: {
  activeTab: Tab | null
  rawLatestContentRef: React.MutableRefObject<string | null>
  rawMode: boolean
  onContentChange?: (path: string, content: string) => void
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
}) {
  const flushPendingRawContent = useCallback((path: string) => {
    if (!rawMode || !activeTab || activeTab.entry.path !== path) return

    const latestContent = rawLatestContentRef.current
    if (latestContent === null || latestContent === activeTab.content) return

    onContentChange?.(path, latestContent)
  }, [activeTab, onContentChange, rawLatestContentRef, rawMode])

  useRegisteredFlushRef(flushPendingRawContentRef, flushPendingRawContent)
}

function useRegisteredFlushRef(
  ref: React.MutableRefObject<((path: string) => void) | null> | undefined,
  flush: (path: string) => void,
) {
  useEffect(() => {
    if (!ref) return

    ref.current = flush
    return () => {
      if (ref.current === flush) ref.current = null
    }
  }, [flush, ref])
}
