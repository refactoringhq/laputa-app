import { describe, it, expect } from 'vitest'
import {
  isOkfReservedFile,
  isOkfIndexFile,
  getOkfResource,
  getOkfTimestamp,
  getOkfVersion,
  isOkfBundle,
  formatOkfTimestamp,
  buildOkfDirectoryListing,
  exportOkfBundle,
  importOkfBundle,
} from './okf'
import type { VaultEntry } from '../types'
import type { ParsedFrontmatter } from './frontmatter'

function fm(overrides: Record<string, unknown> = {}): ParsedFrontmatter {
  return { type: 'Note', ...overrides } as ParsedFrontmatter
}

describe('isOkfReservedFile', () => {
  it('returns true for index.md', () => {
    expect(isOkfReservedFile('index.md')).toBe(true)
  })
  it('returns true for log.md', () => {
    expect(isOkfReservedFile('log.md')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isOkfReservedFile('Index.MD')).toBe(true)
    expect(isOkfReservedFile('LOG.md')).toBe(true)
  })
  it('returns false for regular notes', () => {
    expect(isOkfReservedFile('recipe.md')).toBe(false)
    expect(isOkfReservedFile('index.txt')).toBe(false)
  })
})

describe('isOkfIndexFile', () => {
  it('returns true for index.md only', () => {
    expect(isOkfIndexFile('index.md')).toBe(true)
    expect(isOkfIndexFile('log.md')).toBe(false)
  })
})

describe('getOkfResource', () => {
  it('extracts resource URL', () => {
    expect(getOkfResource(fm({ resource: 'https://example.com/table' }))).toBe('https://example.com/table')
  })
  it('returns null when absent', () => {
    expect(getOkfResource(fm())).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(getOkfResource(fm({ resource: '  ' }))).toBeNull()
  })
  it('returns null for non-string', () => {
    expect(getOkfResource(fm({ resource: 42 }))).toBeNull()
  })
})

describe('getOkfTimestamp', () => {
  it('extracts ISO timestamp', () => {
    expect(getOkfTimestamp(fm({ timestamp: '2026-05-28T00:00:00Z' }))).toBe('2026-05-28T00:00:00Z')
  })
  it('returns null when absent', () => {
    expect(getOkfTimestamp(fm())).toBeNull()
  })
})

describe('getOkfVersion', () => {
  it('extracts string version', () => {
    expect(getOkfVersion(fm({ okf_version: '0.1' }))).toBe('0.1')
  })
  it('extracts numeric version', () => {
    expect(getOkfVersion(fm({ okf_version: 0.1 }))).toBe('0.1')
  })
  it('returns null when absent', () => {
    expect(getOkfVersion(fm())).toBeNull()
  })
})

describe('isOkfBundle', () => {
  it('returns true when okf_version present', () => {
    expect(isOkfBundle(fm({ okf_version: '0.1' }))).toBe(true)
  })
  it('returns false when okf_version absent', () => {
    expect(isOkfBundle(fm())).toBe(false)
  })
})

describe('formatOkfTimestamp', () => {
  it('formats ISO timestamp', () => {
    expect(formatOkfTimestamp('2026-05-28T00:00:00Z')).toBe('2026-05-28 00:00:00Z')
  })
  it('returns raw string for invalid dates', () => {
    expect(formatOkfTimestamp('not-a-date')).toBe('not-a-date')
  })
})

describe('buildOkfDirectoryListing', () => {
  function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
    return {
      path: '/vault/test.md',
      filename: 'test.md',
      title: 'Test',
      workspace: undefined,
      isA: null,
      aliases: [],
      belongsTo: [],
      relatedTo: [],
      status: null,
      archived: false,
      modifiedAt: null,
      createdAt: null,
      fileSize: 0,
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
      visible: null,
      fileKind: 'markdown',
      ...overrides,
    } as VaultEntry
  }

  it('generates markdown listing with heading and notes', () => {
    const entries = [
      makeEntry({ path: '/vault/recipes/pasta.md', filename: 'pasta.md', title: 'Pasta Recipe' }),
      makeEntry({ path: '/vault/recipes/salad.md', filename: 'salad.md', title: 'Salad Recipe' }),
    ]
    const result = buildOkfDirectoryListing(entries, 'recipes')
    expect(result).toContain('# recipes')
    expect(result).toContain('Pasta Recipe')
    expect(result).toContain('Salad Recipe')
    expect(result).toContain('## Notes')
  })

  it('lists subdirectories', () => {
    const entries = [
      makeEntry({ path: '/vault/recipes/italian/pizza.md', filename: 'pizza.md', title: 'Pizza' }),
      makeEntry({ path: '/vault/recipes/pasta.md', filename: 'pasta.md', title: 'Pasta' }),
    ]
    const result = buildOkfDirectoryListing(entries, 'recipes')
    expect(result).toContain('## Directories')
    expect(result).toContain('italian')
  })

  it('excludes index.md and log.md from listing', () => {
    const entries = [
      makeEntry({ path: '/vault/recipes/index.md', filename: 'index.md', title: 'Index' }),
      makeEntry({ path: '/vault/recipes/log.md', filename: 'log.md', title: 'Log' }),
      makeEntry({ path: '/vault/recipes/pasta.md', filename: 'pasta.md', title: 'Pasta' }),
    ]
    const result = buildOkfDirectoryListing(entries, 'recipes')
    expect(result).not.toContain('Index')
    expect(result).not.toContain('Log')
    expect(result).toContain('Pasta')
  })

  it('returns heading only for empty folder', () => {
    const result = buildOkfDirectoryListing([], 'empty-folder')
    expect(result).toBe('# empty-folder\n')
  })
})

describe('exportOkfBundle', () => {
  it('is a function', () => {
    expect(typeof exportOkfBundle).toBe('function')
  })
})

describe('importOkfBundle', () => {
  it('is a function', () => {
    expect(typeof importOkfBundle).toBe('function')
  })
})