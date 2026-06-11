import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { resolveTypeDeleteRequest } from './typeDeletion'

function makeEntry(overrides: Partial<VaultEntry> & Pick<VaultEntry, 'path' | 'title' | 'isA'>): VaultEntry {
  return {
    path: overrides.path,
    filename: overrides.path.split('/').pop() ?? 'note.md',
    title: overrides.title,
    isA: overrides.isA,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    relationships: {},
    outgoingLinks: [],
    status: null,
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 100,
    wordCount: 0,
    snippet: '',
    archived: false,
    trashed: false,
    trashedAt: null,
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    hasH1: true,
    properties: {},
    ...overrides,
  }
}

describe('resolveTypeDeleteRequest', () => {
  it('blocks deleting a type document while notes still use that type', () => {
    const request = resolveTypeDeleteRequest([
      makeEntry({ path: '/vault/project.md', title: 'Project', isA: 'Type' }),
      makeEntry({ path: '/vault/build.md', title: 'Build', isA: 'Project' }),
    ], 'Project')

    expect(request).toEqual({
      kind: 'blocked',
      reason: 'type-in-use',
      instanceCount: 1,
    })
  })

  it('blocks generated sidebar types that have no type document to delete', () => {
    const request = resolveTypeDeleteRequest([
      makeEntry({ path: '/vault/book.md', title: 'Book', isA: 'Reading' }),
    ], 'Reading')

    expect(request).toEqual({
      kind: 'blocked',
      reason: 'type-in-use',
      instanceCount: 1,
    })
  })

  it('blocks stale type rows that have no type document or instances', () => {
    expect(resolveTypeDeleteRequest([], 'Reading')).toEqual({
      kind: 'blocked',
      reason: 'missing-type-document',
      instanceCount: 0,
    })
  })

  it('allows deleting an unused type document', () => {
    const typeEntry = makeEntry({ path: '/vault/archive.md', title: 'Archive', isA: 'Type' })

    expect(resolveTypeDeleteRequest([typeEntry], 'Archive')).toEqual({
      kind: 'delete',
      typeEntry,
    })
  })
})
