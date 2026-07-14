import { useState, useCallback, useRef } from 'react'
import type { VaultEntry } from '../types'

export interface MultiSelectState {
  selectedPaths: Set<string>
  isMultiSelecting: boolean
  toggle: (path: string) => void
  selectRange: (toPath: string) => void
  clear: () => void
  setAnchor: (path: string) => void
  selectAll: () => void
}

function clearSelectedPaths(prev: Set<string>): Set<string> {
  return prev.size === 0 ? prev : new Set()
}

export function useMultiSelect(visibleEntries: VaultEntry[], activePath: string | null = null): MultiSelectState {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<string | null>(null)

  const toggle = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    lastClickedRef.current = path
  }, [])

  const selectRange = useCallback((toPath: string) => {
    const fromPath = lastClickedRef.current ?? activePath
    if (!fromPath) {
      toggle(toPath)
      return
    }
    const paths = visibleEntries.map((e) => e.path)
    const fromIdx = paths.indexOf(fromPath)
    const toIdx = paths.indexOf(toPath)
    if (fromIdx === -1 || toIdx === -1) {
      toggle(toPath)
      return
    }
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      for (let i = start; i <= end; i++) {
        const path = paths.at(i)
        if (path) next.add(path)
      }
      return next
    })
    lastClickedRef.current = toPath
  }, [visibleEntries, activePath, toggle])

  const clear = useCallback(() => {
    setSelectedPaths(clearSelectedPaths)
    lastClickedRef.current = null
  }, [])

  const setAnchor = useCallback((path: string) => {
    lastClickedRef.current = path
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(visibleEntries.map((e) => e.path)))
  }, [visibleEntries])

  return {
    selectedPaths,
    isMultiSelecting: selectedPaths.size > 0,
    toggle,
    selectRange,
    clear,
    setAnchor,
    selectAll,
  }
}
