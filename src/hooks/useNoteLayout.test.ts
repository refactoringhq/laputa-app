import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNoteLayout } from './useNoteLayout'
import { bindVaultConfigStore, getVaultConfig, resetVaultConfigStore } from '../utils/vaultConfigStore'

describe('useNoteLayout', () => {
  beforeEach(() => {
    resetVaultConfigStore()
    bindVaultConfigStore(
      { zoom: null, view_mode: null, editor_mode: null, note_layout: null, tag_colors: null, status_colors: null, property_display_modes: null },
      vi.fn(),
    )
  })

  it('defaults to centered note layout', () => {
    const { result } = renderHook(() => useNoteLayout())

    expect(result.current.noteLayout).toBe('centered')
  })

  it('loads persisted left note layout from vault config', () => {
    resetVaultConfigStore()
    bindVaultConfigStore(
      { zoom: null, view_mode: null, editor_mode: null, note_layout: 'left', tag_colors: null, status_colors: null, property_display_modes: null },
      vi.fn(),
    )

    const { result } = renderHook(() => useNoteLayout())

    expect(result.current.noteLayout).toBe('left')
  })

  it('sets note layout and persists it to vault config', () => {
    const { result } = renderHook(() => useNoteLayout())

    act(() => result.current.setNoteLayout('left'))

    expect(result.current.noteLayout).toBe('left')
    expect(getVaultConfig().note_layout).toBe('left')
  })

  it('toggles between centered and left note layout', () => {
    const { result } = renderHook(() => useNoteLayout())

    act(() => result.current.toggleNoteLayout())
    expect(result.current.noteLayout).toBe('left')

    act(() => result.current.toggleNoteLayout())
    expect(result.current.noteLayout).toBe('centered')
  })
})
