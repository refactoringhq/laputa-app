import { useState, useCallback, useEffect } from 'react'
import { getAppStorageItem } from '../constants/appStorage'
import { getVaultConfig, updateVaultConfigField, subscribeVaultConfig } from '../utils/vaultConfigStore'

export type ViewMode = 'editor-only' | 'editor-list' | 'all'

function isViewMode(v: string | null | undefined): v is ViewMode {
  return v === 'editor-only' || v === 'editor-list' || v === 'all'
}

function loadViewMode(): ViewMode {
  const stored = getVaultConfig().view_mode
  if (isViewMode(stored)) return stored
  // Fallback to localStorage during initial load (before vault config is ready)
  const ls = getAppStorageItem('viewMode')
  if (isViewMode(ls)) return ls
  return 'all'
}

export function useViewMode(initialOverride?: ViewMode) {
  const [viewMode, setViewModeState] = useState<ViewMode>(initialOverride ?? loadViewMode)
  const [noteListHidden, setNoteListHidden] = useState(false)

  // Re-sync when vault config becomes available
  useEffect(() => {
    return subscribeVaultConfig(() => {
      const stored = getVaultConfig().view_mode
      if (isViewMode(stored)) {
        setViewModeState(stored)
        setNoteListHidden(false)
      }
    })
  }, [])

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    setNoteListHidden(false)
    updateVaultConfigField('view_mode', mode)
  }, [])

  const sidebarVisible = viewMode === 'all'
  const noteListVisible = viewMode === 'all' || viewMode === 'editor-list'
  const effectiveNoteListVisible = noteListVisible && !noteListHidden

  return { viewMode, setViewMode, sidebarVisible, noteListVisible, effectiveNoteListVisible, setNoteListHidden }
}
