import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigationHistory } from './useNavigationHistory'
import { useNavigationGestures } from './useNavigationGestures'
import type { VaultEntry } from '../types'

interface UseAppNavigationParams {
  entries: VaultEntry[]
  activeTabPath: string | null
  onSelectNote: (entry: VaultEntry) => void
}

/**
 * Encapsulates browser-style back/forward navigation for the app:
 * - Navigation history (push on note change, back/forward traversal)
 * - Mouse button & trackpad gesture bindings
 * - O(1) path->entry lookup map
 */
export function useAppNavigation({
  entries,
  activeTabPath,
  onSelectNote,
}: UseAppNavigationParams) {
  const navHistory = useNavigationHistory()

  // Push to navigation history whenever the active note changes (user-initiated)
  const navFromHistoryRef = useRef(false)
  useEffect(() => {
    if (activeTabPath && !navFromHistoryRef.current) {
      navHistory.push(activeTabPath)
    }
    navFromHistoryRef.current = false
  }, [activeTabPath, navHistory.push]) // eslint-disable-line react-hooks/exhaustive-deps -- navHistory.push is stable

  const isEntryExists = useCallback(
    (path: string) => entries.some(e => e.path === path),
    [entries],
  )

  const handleGoBack = useCallback(() => {
    const target = navHistory.goBack(isEntryExists)
    if (target) {
      navFromHistoryRef.current = true
      const entry = entries.find(e => e.path === target)
      if (entry) onSelectNote(entry)
    }
  }, [navHistory, isEntryExists, entries, onSelectNote])

  const handleGoForward = useCallback(() => {
    const target = navHistory.goForward(isEntryExists)
    if (target) {
      navFromHistoryRef.current = true
      const entry = entries.find(e => e.path === target)
      if (entry) onSelectNote(entry)
    }
  }, [navHistory, isEntryExists, entries, onSelectNote])

  useNavigationGestures({ onGoBack: handleGoBack, onGoForward: handleGoForward })

  // O(1) path lookup map — rebuilt only when entries change
  const entriesByPath = useMemo(() => {
    const map = new Map<string, VaultEntry>()
    for (const e of entries) map.set(e.path, e)
    return map
  }, [entries])

  return {
    handleGoBack,
    handleGoForward,
    canGoBack: navHistory.canGoBack,
    canGoForward: navHistory.canGoForward,
    entriesByPath,
  }
}
