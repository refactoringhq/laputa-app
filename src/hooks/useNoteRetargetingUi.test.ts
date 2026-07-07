import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import { makeEntry } from '../test-utils/noteListTestUtils'
import { useNoteRetargetingUi } from './useNoteRetargetingUi'

const vaultPath = '/Users/luca/Laputa'
const activeEntry = makeEntry({
  path: `${vaultPath}/projects/alpha.md`,
  filename: 'alpha.md',
  title: 'Alpha',
})

function renderUi(overrides: {
  activeEntry?: VaultEntry | null
  entries?: VaultEntry[]
  folders?: FolderNode[]
  selection?: SidebarSelection
  vaultPath?: string
} = {}) {
  return renderHook(() => useNoteRetargetingUi({
    activeEntry: overrides.activeEntry ?? activeEntry,
    activeNoteBlocked: false,
    entries: overrides.entries ?? [activeEntry],
    folders: overrides.folders ?? [],
    selection: overrides.selection ?? { kind: 'filter', filter: 'all' },
    setSelection: vi.fn(),
    setToastMessage: vi.fn(),
    vaultPath: overrides.vaultPath ?? vaultPath,
    updateFrontmatter: vi.fn(),
    moveNoteToFolder: vi.fn(),
  }))
}

describe('useNoteRetargetingUi', () => {
  it('offers the vault root as a folder move destination for nested notes', () => {
    const { result } = renderUi()

    expect(result.current.canMoveActiveNoteToFolder).toBe(true)

    act(() => {
      result.current.openMoveNoteToFolderDialog()
    })

    expect(result.current.folderOptions).toEqual([
      expect.objectContaining({
        current: false,
        id: '',
        label: 'Laputa',
      }),
    ])
  })

  it('marks the current Windows-style folder with the same normalization used by drops', () => {
    const windowsVaultPath = 'C:\\Users\\luca\\Laputa'
    const windowsEntry = makeEntry({
      path: `${windowsVaultPath}\\projects\\alpha.md`,
      filename: 'alpha.md',
      title: 'Alpha',
    })

    const { result } = renderUi({
      activeEntry: windowsEntry,
      entries: [windowsEntry],
      folders: [{ name: 'projects', path: 'projects', children: [] }],
      vaultPath: windowsVaultPath,
    })

    act(() => {
      result.current.openMoveNoteToFolderDialog()
    })

    expect(result.current.canMoveActiveNoteToFolder).toBe(true)
    expect(result.current.folderOptions).toEqual([
      expect.objectContaining({
        current: false,
        id: '',
        label: 'Laputa',
      }),
      expect.objectContaining({
        current: true,
        id: 'projects',
        label: 'projects',
      }),
    ])
  })
})
