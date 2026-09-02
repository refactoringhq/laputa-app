import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../../types'
import { buildGraphPayload } from './graphModel'
import { applyGraphFilters, createDefaultGraphFilters } from './graphFilters'

function entry(overrides: Partial<VaultEntry> & Pick<VaultEntry, 'path' | 'title'>): VaultEntry {
  return {
    filename: overrides.path.split('/').at(-1) ?? 'note.md',
    workspace: {
      id: 'personal', label: 'Personal', alias: 'personal', path: '/vault', shortLabel: 'P',
      color: 'blue', icon: null, mounted: true, available: true, defaultForNewNotes: true,
    },
    isA: null, aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false,
    modifiedAt: null, createdAt: null, fileSize: 1, snippet: '', wordCount: 1,
    relationships: {}, icon: null, color: null, order: null, sidebarLabel: null,
    template: null, sort: null, view: null, visible: true, organized: true, favorite: false,
    favoriteIndex: null, listPropertiesDisplay: [], outgoingLinks: [], properties: {}, hasH1: true,
    ...overrides,
  }
}

describe('buildGraphPayload', () => {
  it('uses Tolaria wikilink resolution and keeps body and relationship edges distinct', () => {
    const target = entry({ path: '/vault/projects/alpha.md', title: 'Alpha', aliases: ['A'] })
    const source = entry({
      path: '/vault/source.md', title: 'Source', outgoingLinks: ['A'],
      relationships: { Owner: ['projects/alpha'] },
    })
    const payload = buildGraphPayload([source, target])

    expect(payload.nodes.filter((node) => node.exists)).toHaveLength(2)
    expect(payload.edges.map((edge) => [edge.kind, edge.label])).toEqual([
      ['body-link', null], ['relationship', 'Owner'],
    ])
    expect(payload.edges.every((edge) => edge.target === target.path)).toBe(true)
  })

  it('creates one workspace-scoped ghost and never renders self links', () => {
    const source = entry({
      path: '/vault/source.md', title: 'Source', outgoingLinks: ['Missing', 'Missing', 'Source'],
    })
    const payload = buildGraphPayload([source])

    expect(payload.nodes.filter((node) => !node.exists)).toHaveLength(1)
    expect(payload.edges).toHaveLength(1)
    expect(payload.stats.ghostCount).toBe(1)
  })
})

describe('applyGraphFilters', () => {
  it('builds an undirected neighborhood while retaining directed edges', () => {
    const a = entry({ path: '/vault/a.md', title: 'A', outgoingLinks: ['B'] })
    const b = entry({ path: '/vault/b.md', title: 'B', outgoingLinks: ['C'] })
    const c = entry({ path: '/vault/c.md', title: 'C' })
    const payload = buildGraphPayload([a, b, c])
    const filters = createDefaultGraphFilters()
    filters.localRoot = c.path
    filters.localDepth = 1

    const visible = applyGraphFilters(payload, filters)
    expect(visible.nodes.map((node) => node.label).sort()).toEqual(['B', 'C'])
    expect(visible.edges).toHaveLength(1)
    expect(visible.edges[0]).toMatchObject({ source: b.path, target: c.path })
  })
})
