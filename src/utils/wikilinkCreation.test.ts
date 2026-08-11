import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { resolveWikilinkCreationRequest } from './wikilinkCreation'

const sourceEntry = {
  path: '/personal/projects/source.md',
  workspace: {
    path: '/personal',
  },
} as VaultEntry

const vaults = [
  { label: 'Personal', alias: 'personal', path: '/personal' },
  { label: 'Team', alias: 'team', path: '/team' },
]

describe('resolveWikilinkCreationRequest', () => {
  it('creates simple targets beside the source note', () => {
    expect(resolveWikilinkCreationRequest({
      fallbackVaultPath: '/personal',
      sourceEntry,
      target: 'new-note-topic',
      vaults,
    })).toEqual({
      destination: {
        relativePath: 'projects/new-note-topic.md',
        vaultPath: '/personal',
      },
      title: 'New Note Topic',
    })
  })

  it('uses explicit workspace and folder targets without using the visible alias as the title', () => {
    expect(resolveWikilinkCreationRequest({
      fallbackVaultPath: '/personal',
      sourceEntry,
      target: 'team/roadmap/new-topic|Visible Label',
      vaults,
    })).toEqual({
      destination: {
        relativePath: 'roadmap/new-topic.md',
        vaultPath: '/team',
      },
      title: 'New Topic',
    })
  })

  it('keeps path traversal inside the selected workspace', () => {
    expect(resolveWikilinkCreationRequest({
      fallbackVaultPath: '/personal',
      sourceEntry,
      target: '../../outside',
      vaults,
    })?.destination).toEqual({
      relativePath: 'outside.md',
      vaultPath: '/personal',
    })
  })
})
