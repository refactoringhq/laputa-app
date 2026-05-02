import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import {
  wikilinkTarget,
  wikilinkDisplay,
  resolveEntry,
  relativePathStem,
  slugifyWikilinkTarget,
  canonicalWikilinkTargetForEntry,
  canonicalWikilinkTargetForTitle,
  formatWikilinkRef,
} from './wikilink'

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/note.md', filename: 'note.md', title: 'Note', isA: null,
    aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false,
    modifiedAt: null, createdAt: null, fileSize: 100, snippet: '', wordCount: 0,
    relationships: {}, icon: null, color: null, order: null, template: null,
    sort: null, outgoingLinks: [], sidebarLabel: null, view: null, visible: null,
    properties: {},
    ...overrides,
  }
}

describe('wikilinkTarget', () => {
  it('strips brackets', () => {
    expect(wikilinkTarget('[[foo]]')).toBe('foo')
  })
  it('returns target before pipe', () => {
    expect(wikilinkTarget('[[path|display]]')).toBe('path')
  })
  it('handles bare text without brackets', () => {
    expect(wikilinkTarget('just text')).toBe('just text')
  })
})

describe('wikilinkDisplay', () => {
  it('returns text after pipe', () => {
    expect(wikilinkDisplay('[[path|My Title]]')).toBe('My Title')
  })
  it('humanises slug when no pipe', () => {
    expect(wikilinkDisplay('[[my-note]]')).toBe('My Note')
  })
})

describe('resolveEntry', () => {
  const alice = makeEntry({ path: '/vault/person/alice.md', filename: 'alice.md', title: 'Alice', isA: 'Person', aliases: ['Alice Smith'] })
  const bob = makeEntry({ path: '/vault/person/bob.md', filename: 'bob.md', title: 'Bob', isA: 'Person' })
  const project = makeEntry({ path: '/vault/project/my-project.md', filename: 'my-project.md', title: 'My Project', isA: 'Project' })
  const entries = [alice, bob, project]

  it('matches by title (case-insensitive)', () => {
    expect(resolveEntry(entries, 'alice')).toBe(alice)
    expect(resolveEntry(entries, 'ALICE')).toBe(alice)
    expect(resolveEntry(entries, 'Alice')).toBe(alice)
  })

  it('matches by alias (case-insensitive)', () => {
    expect(resolveEntry(entries, 'alice smith')).toBe(alice)
    expect(resolveEntry(entries, 'Alice Smith')).toBe(alice)
  })

  it('matches by filename stem (case-insensitive)', () => {
    expect(resolveEntry(entries, 'my-project')).toBe(project)
    expect(resolveEntry(entries, 'My-Project')).toBe(project)
  })

  it('matches legacy path-style targets via last segment', () => {
    expect(resolveEntry(entries, 'person/alice')).toBe(alice)
    expect(resolveEntry(entries, 'project/my-project')).toBe(project)
  })

  it('handles pipe syntax: uses target part for lookup', () => {
    expect(resolveEntry(entries, 'person/alice|Alice S.')).toBe(alice)
    expect(resolveEntry(entries, 'Alice|A')).toBe(alice)
  })

  it('returns undefined for non-existent target', () => {
    expect(resolveEntry(entries, 'Does Not Exist')).toBeUndefined()
  })

  it('returns undefined for empty entries', () => {
    expect(resolveEntry([], 'Alice')).toBeUndefined()
  })

  it('matches by filename stem from last segment of path target', () => {
    // If target is "person/alice", the last segment "alice" should match filename stem
    expect(resolveEntry(entries, 'person/alice')).toBe(alice)
  })

  it('matches title-as-words from kebab-case target', () => {
    // "my-project" → "my project" should match title "My Project"
    expect(resolveEntry(entries, 'my-project')).toBe(project)
  })

  it('prefers filename stem over title when ambiguous', () => {
    // Entry has filename "foo.md" but title "Bar"
    const fooEntry = makeEntry({ path: '/vault/foo.md', filename: 'foo.md', title: 'Bar' })
    // Entry has filename "bar.md" but title "Foo"
    const barEntry = makeEntry({ path: '/vault/bar.md', filename: 'bar.md', title: 'Foo' })
    const ambiguous = [fooEntry, barEntry]
    // Searching for "foo" should match fooEntry (by filename stem) not barEntry (by title)
    expect(resolveEntry(ambiguous, 'foo')).toBe(fooEntry)
    // Searching for "bar" should match barEntry (by filename stem) not fooEntry (by title)
    expect(resolveEntry(ambiguous, 'bar')).toBe(barEntry)
  })

  it('resolves path-style target by matching path suffix', () => {
    const adr = makeEntry({ path: '/vault/docs/adr/0031-foo.md', filename: '0031-foo.md', title: '0031 Foo' })
    const flat = makeEntry({ path: '/vault/hello.md', filename: 'hello.md', title: 'Hello' })
    expect(resolveEntry([adr, flat], 'docs/adr/0031-foo')).toBe(adr)
  })

  it('disambiguates same-name files in different subfolders via path', () => {
    const alpha = makeEntry({ path: '/vault/projects/alpha.md', filename: 'alpha.md', title: 'Alpha' })
    const alphaArchived = makeEntry({ path: '/vault/archive/alpha.md', filename: 'alpha.md', title: 'Alpha' })
    expect(resolveEntry([alpha, alphaArchived], 'projects/alpha')).toBe(alpha)
    expect(resolveEntry([alpha, alphaArchived], 'archive/alpha')).toBe(alphaArchived)
  })
})

describe('relativePathStem', () => {
  it('extracts relative path stem from absolute path and vault path', () => {
    expect(relativePathStem('/Users/luca/Vault/note.md', '/Users/luca/Vault')).toBe('note')
  })

  it('preserves subdirectory structure', () => {
    expect(relativePathStem('/Users/luca/Vault/docs/adr/0031.md', '/Users/luca/Vault')).toBe('docs/adr/0031')
  })

  it('normalizes Windows extended-length paths before extracting the vault-relative stem', () => {
    expect(
      relativePathStem(
        '\\\\?\\C:\\Users\\lrfno\\Documents\\tolaria-vault\\application-design-and-build.md',
        'C:\\Users\\lrfno\\Documents\\tolaria-vault',
      ),
    ).toBe('application-design-and-build')
  })

  it('keeps nested Windows note paths vault-relative with slash separators', () => {
    expect(
      relativePathStem(
        'C:\\Users\\lrfno\\Documents\\Tolaria Vault\\projects\\application-design-and-build.md',
        'c:/users/lrfno/documents/tolaria vault',
      ),
    ).toBe('projects/application-design-and-build')
  })

  it('falls back to filename stem when vault path does not match', () => {
    expect(relativePathStem('/other/path/note.md', '/Users/luca/Vault')).toBe('note')
  })
})

describe('slugifyWikilinkTarget', () => {
  it('slugifies a human title to a canonical target', () => {
    expect(slugifyWikilinkTarget('Weekly Review')).toBe('weekly-review')
  })

  it('preserves Unicode titles when no existing entry resolves them', () => {
    expect(slugifyWikilinkTarget('你好')).toBe('你好')
  })

  it('falls back to untitled when the title has no slug characters', () => {
    expect(slugifyWikilinkTarget('+++')).toBe('untitled')
  })
})

describe('canonicalWikilinkTargetForEntry', () => {
  it('returns a vault-relative path stem', () => {
    const entry = makeEntry({ path: '/vault/projects/alpha.md', filename: 'alpha.md', title: 'Alpha' })
    expect(canonicalWikilinkTargetForEntry(entry, '/vault')).toBe('projects/alpha')
  })
})

describe('canonicalWikilinkTargetForTitle', () => {
  const project = makeEntry({ path: '/vault/projects/alpha.md', filename: 'alpha.md', title: 'Alpha Project' })

  it('resolves an existing entry to its canonical path target', () => {
    expect(canonicalWikilinkTargetForTitle('Alpha Project', [project], '/vault')).toBe('projects/alpha')
  })

  it('keeps a canonical path input canonical', () => {
    expect(canonicalWikilinkTargetForTitle('projects/alpha', [project], '/vault')).toBe('projects/alpha')
  })

  it('falls back to a slug for a newly created note title', () => {
    expect(canonicalWikilinkTargetForTitle('Brand New Note', [], '/vault')).toBe('brand-new-note')
  })

  it('falls back to a Unicode-preserving slug for a newly created note title', () => {
    expect(canonicalWikilinkTargetForTitle('你好', [], '/vault')).toBe('你好')
  })
})

describe('formatWikilinkRef', () => {
  it('wraps a canonical target in wikilink syntax', () => {
    expect(formatWikilinkRef('projects/alpha')).toBe('[[projects/alpha]]')
  })
})
