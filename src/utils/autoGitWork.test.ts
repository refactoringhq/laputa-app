import { describe, expect, it } from 'vitest'
import type { GitRemoteStatus, ModifiedFile } from '../types'
import { autoGitWorkSignature, hasAutoGitWork } from './autoGitWork'

function modifiedFile(relativePath: string, vaultPath = '/vault'): ModifiedFile {
  return {
    path: `${vaultPath}/${relativePath}`,
    relativePath,
    status: 'modified',
    vaultPath,
  }
}

function remoteStatus(ahead: number): GitRemoteStatus {
  return {
    ahead,
    behind: 0,
    branch: 'main',
    hasRemote: true,
  }
}

function noRemoteStatus(): GitRemoteStatus {
  return {
    ahead: 3,
    behind: 0,
    branch: 'main',
    hasRemote: false,
  }
}

describe('autoGitWork', () => {
  it('detects dirty files in a single vault', () => {
    const input = {
      activeVaultPath: '/vault',
      modifiedFiles: [modifiedFile('note.md')],
      repositoryPaths: ['/vault'],
      remoteStatusForRepository: () => null,
    }

    expect(hasAutoGitWork(input)).toBe(true)
    expect(autoGitWorkSignature(input)).toBe('/vault:note.md:modified')
  })

  it('detects push-only work in every active repository', () => {
    const statuses = new Map([
      ['/personal', remoteStatus(1)],
      ['/team', remoteStatus(2)],
    ])

    expect(autoGitWorkSignature({
      activeVaultPath: '/personal',
      modifiedFiles: [],
      repositoryPaths: ['/personal', '/team'],
      remoteStatusForRepository: (path) => statuses.get(path) ?? null,
    })).toBe('/personal:1|/team:2')
  })

  it('ignores repositories without pushable remote commits', () => {
    expect(hasAutoGitWork({
      activeRemoteStatus: noRemoteStatus(),
      activeVaultPath: '/plain',
      modifiedFiles: [],
      repositoryPaths: ['/plain'],
      remoteStatusForRepository: () => noRemoteStatus(),
    })).toBe(false)
  })

  it('uses the active sync status when repository status has not been loaded yet', () => {
    expect(autoGitWorkSignature({
      activeRemoteStatus: remoteStatus(4),
      activeVaultPath: '/vault',
      modifiedFiles: [],
      repositoryPaths: [],
      remoteStatusForRepository: () => null,
    })).toBe('/vault:4')
  })
})
