import { describe, expect, it } from 'vitest'
import { canWritePathToVault, isPathInsideVaultRoot } from './vaultPathContainment'

describe('vault path containment', () => {
  it('matches expanded note paths against tilde vault roots', () => {
    expect(canWritePathToVault(
      '/Users/luca/Workspace/refactoring-vault/notes/example.md',
      '~/Workspace/refactoring-vault',
    )).toBe(true)
  })

  it('rejects expanded paths outside a tilde vault root', () => {
    expect(isPathInsideVaultRoot(
      '/Users/luca/Workspace/refactoring-vault-archive/notes/example.md',
      '~/Workspace/refactoring-vault',
    )).toBe(false)
  })
})
