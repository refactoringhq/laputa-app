import { describe, expect, it } from 'vitest'
import type { ModifiedFile, SidebarSelection } from '../types'
import {
  activeVaultModifiedFiles,
  aiWorkspaceWindowContextForPath,
  canCustomizeColumnsForSelection,
  mergeModifiedFiles,
  shouldPreferOnboardingVaultPath,
} from './appOrchestration'

function modifiedFile(overrides: Partial<ModifiedFile>): ModifiedFile {
  return {
    path: `/vault/${overrides.relativePath ?? 'note.md'}`,
    relativePath: 'note.md',
    status: 'modified',
    ...overrides,
  }
}

describe('app orchestration helpers', () => {
  it('fills missing vault paths on active-vault modified files', () => {
    expect(activeVaultModifiedFiles([
      modifiedFile({ relativePath: 'a.md' }),
      modifiedFile({ relativePath: 'b.md', vaultPath: '/other' }),
    ], '/vault')).toEqual([
      modifiedFile({ relativePath: 'a.md', vaultPath: '/vault' }),
      modifiedFile({ relativePath: 'b.md', vaultPath: '/other' }),
    ])
  })

  it('deduplicates modified files by vault, path, and status with later groups winning', () => {
    expect(mergeModifiedFiles(
      [modifiedFile({ relativePath: 'a.md', status: 'modified', vaultPath: '/vault', addedLines: 1 })],
      [modifiedFile({ relativePath: 'a.md', status: 'modified', vaultPath: '/vault', addedLines: 2 })],
      [modifiedFile({ relativePath: 'a.md', status: 'deleted', vaultPath: '/vault' })],
    )).toEqual([
      modifiedFile({ relativePath: 'a.md', status: 'modified', vaultPath: '/vault', addedLines: 2 }),
      modifiedFile({ relativePath: 'a.md', status: 'deleted', vaultPath: '/vault' }),
    ])
  })

  it('prefers onboarding vault paths only before the switcher has registered them', () => {
    expect(shouldPreferOnboardingVaultPath({ status: 'ready', vaultPath: '/new' }, [{ path: '/old' }])).toBe(true)
    expect(shouldPreferOnboardingVaultPath({ status: 'ready', vaultPath: '/new' }, [{ path: '/new' }])).toBe(false)
    expect(shouldPreferOnboardingVaultPath({ status: 'loading', vaultPath: '/new' }, [])).toBe(false)
  })

  it('limits note-list column customization to supported selections', () => {
    const allSelection: SidebarSelection = { kind: 'filter', filter: 'all' }
    const inboxSelection: SidebarSelection = { kind: 'filter', filter: 'inbox' }
    const typeSelection: SidebarSelection = { kind: 'sectionGroup', type: 'Project' }
    const viewSelection: SidebarSelection = { kind: 'view', filename: 'focus.yml' }

    expect(canCustomizeColumnsForSelection(allSelection, false)).toBe(true)
    expect(canCustomizeColumnsForSelection(inboxSelection, false)).toBe(false)
    expect(canCustomizeColumnsForSelection(inboxSelection, true)).toBe(true)
    expect(canCustomizeColumnsForSelection(typeSelection, true)).toBe(false)
    expect(canCustomizeColumnsForSelection(viewSelection, false)).toBe(true)
  })

  it('builds AI workspace context from a resolved vault path', () => {
    expect(aiWorkspaceWindowContextForPath('/vault')).toEqual({ vaultPath: '/vault', vaultPaths: ['/vault'] })
    expect(aiWorkspaceWindowContextForPath('')).toEqual({ vaultPath: '', vaultPaths: [] })
  })
})
