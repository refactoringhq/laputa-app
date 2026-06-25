import { describe, expect, it } from 'vitest'
import type { ViewFile } from '../types'
import { makeEntry } from '../test-utils/noteListTestUtils'
import { collectionFromSelection } from './collectionFromSelection'
import { resolveCollectionEntries } from './resolveCollectionEntries'

describe('resolveCollectionEntries', () => {
  it('resolves ordinary collections through current note-list filtering', () => {
    const entries = [
      makeEntry({ path: '/vault/alpha.md', title: 'Alpha', isA: 'Project' }),
      makeEntry({ path: '/vault/beta.md', title: 'Beta', isA: 'Note' }),
    ]
    const collection = collectionFromSelection({ kind: 'sectionGroup', type: 'Project' })

    const resolved = resolveCollectionEntries(collection, entries)

    expect(resolved.entries.map((entry) => entry.title)).toEqual(['Alpha'])
    expect(resolved.entityEntry).toBeNull()
    expect(resolved.relationshipGroups).toEqual([])
  })

  it('keeps Changes and Inbox entries caller-supplied for existing transient flows', () => {
    const changes = [makeEntry({ path: '/vault/changed.md', title: 'Changed' })]
    const inbox = [makeEntry({ path: '/vault/inbox.md', title: 'Inbox' })]

    expect(
      resolveCollectionEntries(
        collectionFromSelection({ kind: 'filter', filter: 'changes' }),
        [],
        { changesEntries: changes },
      ).entries,
    ).toBe(changes)

    expect(
      resolveCollectionEntries(
        collectionFromSelection({ kind: 'filter', filter: 'inbox' }),
        [],
        { inboxEntries: inbox },
      ).entries,
    ).toBe(inbox)
  })

  it('resolves saved views using their existing YAML filters', () => {
    const entries = [
      makeEntry({ path: '/vault/alpha.md', title: 'Alpha', isA: 'Project' }),
      makeEntry({ path: '/vault/beta.md', title: 'Beta', isA: 'Note' }),
    ]
    const view: ViewFile = {
      filename: 'projects.yml',
      definition: {
        name: 'Projects',
        icon: null,
        color: null,
        sort: null,
        filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
      },
    }
    const collection = collectionFromSelection({ kind: 'view', filename: view.filename }, { views: [view] })

    const resolved = resolveCollectionEntries(collection, entries, { views: [view] })

    expect(resolved.entries.map((entry) => entry.title)).toEqual(['Alpha'])
  })

  it('resolves neighborhood collections into grouped relationship data', () => {
    const alpha = makeEntry({
      path: '/vault/alpha.md',
      title: 'Alpha',
      relationships: { related_to: ['[[beta]]'] },
    })
    const beta = makeEntry({ path: '/vault/beta.md', filename: 'beta.md', title: 'Beta' })
    const collection = collectionFromSelection({ kind: 'entity', entry: alpha })

    const resolved = resolveCollectionEntries(collection, [alpha, beta])

    expect(resolved.entries).toEqual([])
    expect(resolved.entityEntry).toBe(alpha)
    expect(resolved.relationshipGroups.some((group) => group.entries.includes(beta))).toBe(true)
  })
})
