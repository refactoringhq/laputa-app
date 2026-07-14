import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { SidebarSelection, VaultEntry } from '../types'
import type { NoteListFilter } from '../utils/noteListHelpers'
import { trackEvent } from '../lib/telemetry'
import {
  focusNoteListContainer,
  isEditableElement,
  isEditorEscapeTarget,
  popNeighborhoodHistory,
  pushNeighborhoodHistory,
  resolveNeighborhoodSelection,
  selectionsEqual,
  shouldProcessNeighborhoodEscape,
} from '../utils/neighborhoodHistory'

interface SetSelectionOptions {
  preserveNeighborhoodHistory?: boolean
}

type SetSelection = (selection: SidebarSelection, options?: SetSelectionOptions) => void

interface NeighborhoodRefs {
  neighborhoodHistoryRef: MutableRefObject<SidebarSelection[]>
  selectionRef: MutableRefObject<SidebarSelection>
}

interface UseNeighborhoodEntryOptions extends NeighborhoodRefs {
  setSelection: SetSelection
}

interface UseSelectionSanitizerOptions extends NeighborhoodRefs {
  effectiveSelection: SidebarSelection
  selection: SidebarSelection
  setNoteListFilter: (filter: NoteListFilter) => void
  setSelection: (selection: SidebarSelection) => void
}

interface UseNeighborhoodHistoryBackOptions {
  neighborhoodHistoryRef: MutableRefObject<SidebarSelection[]>
  setSelection: SetSelection
}

interface UseNeighborhoodEscapeOptions {
  onBack: () => boolean
  selectionRef: MutableRefObject<SidebarSelection>
  shouldBlockNeighborhoodEscape: boolean
}

function focusNoteListOnNextFrame(): void {
  requestAnimationFrame(() => {
    focusNoteListContainer(document)
  })
}

export function useNeighborhoodEntry({
  neighborhoodHistoryRef,
  selectionRef,
  setSelection,
}: UseNeighborhoodEntryOptions) {
  return useCallback((entry: VaultEntry) => {
    const currentSelection = selectionRef.current
    const nextSelection = resolveNeighborhoodSelection(currentSelection, entry)
    trackEvent('neighborhood_mode_toggled', { action: nextSelection.action })

    if (nextSelection.action === 'exit') {
      const { previousSelection, nextHistory } = popNeighborhoodHistory(neighborhoodHistoryRef.current)
      neighborhoodHistoryRef.current = nextHistory
      setSelection(previousSelection ?? nextSelection.selection, previousSelection ? { preserveNeighborhoodHistory: true } : undefined)
      focusNoteListOnNextFrame()
      return
    }

    neighborhoodHistoryRef.current = pushNeighborhoodHistory(
      neighborhoodHistoryRef.current,
      currentSelection,
      nextSelection.selection,
    )
    setSelection(nextSelection.selection, { preserveNeighborhoodHistory: true })
  }, [neighborhoodHistoryRef, selectionRef, setSelection])
}

export function useSelectionSanitizer({
  effectiveSelection,
  neighborhoodHistoryRef,
  selection,
  selectionRef,
  setNoteListFilter,
  setSelection,
}: UseSelectionSanitizerOptions): void {
  useEffect(() => {
    selectionRef.current = effectiveSelection
  }, [effectiveSelection, selectionRef])

  useEffect(() => {
    if (selectionsEqual(effectiveSelection, selection)) return

    if (effectiveSelection.kind !== 'entity') {
      neighborhoodHistoryRef.current = []
    }
    setSelection(effectiveSelection)
    setNoteListFilter('open')
  }, [effectiveSelection, neighborhoodHistoryRef, selection, setNoteListFilter, setSelection])
}

export function useNeighborhoodHistoryBack({
  neighborhoodHistoryRef,
  setSelection,
}: UseNeighborhoodHistoryBackOptions) {
  return useCallback(() => {
    const { previousSelection, nextHistory } = popNeighborhoodHistory(neighborhoodHistoryRef.current)
    if (!previousSelection) return false

    neighborhoodHistoryRef.current = nextHistory
    setSelection(previousSelection, { preserveNeighborhoodHistory: true })
    focusNoteListOnNextFrame()
    return true
  }, [neighborhoodHistoryRef, setSelection])
}

export function useNeighborhoodEscape({
  onBack,
  selectionRef,
  shouldBlockNeighborhoodEscape,
}: UseNeighborhoodEscapeOptions): void {
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!shouldProcessNeighborhoodEscape(event, selectionRef.current, shouldBlockNeighborhoodEscape)) return

      const activeElement = document.activeElement
      if (isEditorEscapeTarget(activeElement)) {
        event.preventDefault()
        activeElement.blur()
        focusNoteListOnNextFrame()
        return
      }

      if (isEditableElement(activeElement)) return

      if (onBack()) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [onBack, selectionRef, shouldBlockNeighborhoodEscape])
}
