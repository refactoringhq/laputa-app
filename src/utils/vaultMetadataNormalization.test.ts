import { describe, expect, it } from 'vitest'
import { normalizeVaultEntries } from './vaultMetadataNormalization'

describe('normalizeVaultEntries', () => {
  it('repairs missing string metadata when the entry path is present', () => {
    const entries = normalizeVaultEntries([
      {
        path: '/vault/alpha-project.md',
        filename: undefined,
        title: undefined,
        aliases: undefined,
      },
    ], '/vault')

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      path: '/vault/alpha-project.md',
      filename: 'alpha-project.md',
      title: 'alpha-project',
      aliases: [],
    })
  })

  it('drops malformed reload entries that do not include a usable path', () => {
    const entries = normalizeVaultEntries([
      { path: '/vault/valid.md', filename: 'valid.md', title: 'Valid' },
      { filename: 'missing-path.md', title: 'Missing Path' },
      { path: '', filename: 'empty-path.md', title: 'Empty Path' },
      { path: 42, filename: 'numeric-path.md', title: 'Numeric Path' },
      null,
    ], '/vault')

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      path: '/vault/valid.md',
      filename: 'valid.md',
      title: 'Valid',
    })
  })
})
