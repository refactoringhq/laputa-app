import { useCallback, useEffect, useState } from 'react'
import type { NoteLayout } from '../types'
import { getVaultConfig, subscribeVaultConfig, updateVaultConfigField } from '../utils/vaultConfigStore'

function isNoteLayout(value: string | null | undefined): value is NoteLayout {
  return value === 'centered' || value === 'left'
}

function loadNoteLayout(): NoteLayout {
  const stored = getVaultConfig().note_layout
  return isNoteLayout(stored) ? stored : 'centered'
}

export function useNoteLayout() {
  const [noteLayout, setNoteLayoutState] = useState<NoteLayout>(loadNoteLayout)

  useEffect(() => {
    return subscribeVaultConfig(() => {
      setNoteLayoutState(loadNoteLayout())
    })
  }, [])

  const setNoteLayout = useCallback((layout: NoteLayout) => {
    setNoteLayoutState(layout)
    updateVaultConfigField('note_layout', layout)
  }, [])

  const toggleNoteLayout = useCallback(() => {
    setNoteLayout(noteLayout === 'left' ? 'centered' : 'left')
  }, [noteLayout, setNoteLayout])

  return { noteLayout, setNoteLayout, toggleNoteLayout }
}
