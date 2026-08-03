import { useEffect, useRef } from 'react'
import type { VaultEntry } from '../types'

interface KeyboardNavigationOptions {
  activeTabPath: string | null
  visibleNotesRef: React.RefObject<VaultEntry[]>
  onReplaceActiveTab: (entry: VaultEntry) => void
  onSelectNote: (entry: VaultEntry) => void
}

function navigateNote(
  visibleNotesRef: React.RefObject<VaultEntry[]>,
  activeTabPathRef: React.RefObject<string | null>,
  onReplace: React.RefObject<(entry: VaultEntry) => void>,
  onSelect: React.RefObject<(entry: VaultEntry) => void>,
  direction: 1 | -1,
) {
  const notes = visibleNotesRef.current
  if (notes.length === 0) return

  const currentPath = activeTabPathRef.current
  const currentIndex = notes.findIndex((n) => n.path === currentPath)

  const nextIndex = currentIndex === -1
    ? (direction === 1 ? 0 : notes.length - 1)
    : currentIndex + direction

  // Clamp to list bounds — don't wrap around
  if (nextIndex < 0 || nextIndex >= notes.length) return

  const nextNote = notes.at(nextIndex)
  if (!nextNote) return
  if (currentPath) {
    onReplace.current(nextNote)
  } else {
    onSelect.current(nextNote)
  }
}

function noteNavigationDirection(event: KeyboardEvent): 1 | -1 | null {
  if (!event.altKey || event.shiftKey) return null
  if (event.key === 'ArrowDown') return 1
  if (event.key === 'ArrowUp') return -1
  return null
}

function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref
}

export function useKeyboardNavigation({
  activeTabPath, visibleNotesRef,
  onReplaceActiveTab, onSelectNote,
}: KeyboardNavigationOptions) {
  const activeTabPathRef = useLatestRef(activeTabPath)
  const onReplaceRef = useLatestRef(onReplaceActiveTab)
  const onSelectNoteRef = useLatestRef(onSelectNote)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Cmd+Alt+ArrowUp/Down: navigate notes in the current list
      const direction = noteNavigationDirection(e)
      if (direction === null) return
      e.preventDefault()
      navigateNote(visibleNotesRef, activeTabPathRef, onReplaceRef, onSelectNoteRef, direction)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabPathRef, visibleNotesRef, onReplaceRef, onSelectNoteRef])
}
