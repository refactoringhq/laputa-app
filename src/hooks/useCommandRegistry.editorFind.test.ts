import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCommandRegistry } from './useCommandRegistry'

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    activeNoteModified: false,
    activeTabPath: '/vault/a.md',
    entries: [{ path: '/vault/a.md', title: 'A', fileKind: 'markdown' }],
    modifiedCount: 0,
    onArchiveNote: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateNoteOfType: vi.fn(),
    onDeleteNote: vi.fn(),
    onFindInNote: vi.fn(),
    onOpenSettings: vi.fn(),
    onQuickOpen: vi.fn(),
    onReplaceInNote: vi.fn(),
    onSave: vi.fn(),
    onSelect: vi.fn(),
    onSetViewMode: vi.fn(),
    onToggleInspector: vi.fn(),
    onUnarchiveNote: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    zoomLevel: 100,
    ...overrides,
  }
}

describe('useCommandRegistry editor find commands', () => {
  it('exposes note-scoped find and replace commands', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))

    const find = result.current.find((command) => command.id === 'find-in-note')
    const replace = result.current.find((command) => command.id === 'replace-in-note')

    expect(find).toMatchObject({
      enabled: true,
      group: 'Note',
      label: 'Find in Note',
      shortcut: 'Ctrl+F',
    })
    expect(replace).toMatchObject({
      enabled: true,
      group: 'Note',
      label: 'Replace in Note',
    })

    find?.execute()
    replace?.execute()
    expect(config.onFindInNote).toHaveBeenCalledOnce()
    expect(config.onReplaceInNote).toHaveBeenCalledOnce()
  })

  it('disables note find for binary files', () => {
    const config = makeConfig({
      activeTabPath: '/vault/photo.png',
      entries: [{ path: '/vault/photo.png', title: 'photo.png', fileKind: 'binary' }],
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(result.current.find((command) => command.id === 'find-in-note')?.enabled).toBe(false)
    expect(result.current.find((command) => command.id === 'replace-in-note')?.enabled).toBe(false)
  })

  it('disables note find until a note is active', () => {
    const config = makeConfig({ activeTabPath: null })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(result.current.find((command) => command.id === 'find-in-note')?.enabled).toBe(false)
    expect(result.current.find((command) => command.id === 'replace-in-note')?.enabled).toBe(false)
  })
})
