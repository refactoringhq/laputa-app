import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { useNoteWindowLifecycle } from './useNoteWindowLifecycle'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

const missingFileError = 'File does not exist'

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/project/missing.md',
    filename: 'missing.md',
    title: 'Missing Note',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1_700_000_000,
    createdAt: null,
    fileSize: 256,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

describe('useNoteWindowLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('contains rejected fallback selection when note-window content disappears', async () => {
    const entry = makeEntry()
    vi.mocked(mockInvoke).mockImplementation(async (command: string) => {
      if (command === 'reload_vault_entry') return entry
      if (command === 'get_note_content') throw missingFileError
      return null
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unhandledRejection = vi.fn()
    const handleSelectNote = vi.fn(async () => {
      throw missingFileError
    })

    process.on('unhandledRejection', unhandledRejection)
    try {
      renderHook(() => useNoteWindowLifecycle({
        activeTabPath: null,
        handleSelectNote,
        noteWindowParams: {
          notePath: entry.path,
          vaultPath: '/vault',
          noteTitle: entry.title,
        },
        openTabWithContent: vi.fn(),
        setToastMessage: vi.fn(),
        tabs: [],
      }))

      await waitFor(() => {
        expect(handleSelectNote).toHaveBeenCalledWith(entry)
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandledRejection).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to select note after note-window content fallback:',
        missingFileError,
      )
    } finally {
      process.removeListener('unhandledRejection', unhandledRejection)
      warnSpy.mockRestore()
    }
  })
})
