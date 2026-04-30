import { describe, it, expect } from 'vitest'
import { buildGraphData, type UseGraphDataOptions } from './useGraphData'
import type { VaultEntry } from '../../types'

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/note.md',
    filename: 'note.md',
    title: 'Note',
    isA: null,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 0,
    createdAt: 0,
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
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: false,
    ...overrides,
  }
}

const defaults: Omit<UseGraphDataOptions, 'entries' | 'mode' | 'focus'> = {
  depth: 1,
  showArchived: false,
  showOrphans: true,
  query: '',
}

describe('buildGraphData (global)', () => {
  it('builds nodes for every non-archived markdown entry', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A' }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/a.md', '/b.md'])
  })

  it('omits archived entries when showArchived is false', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A' }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B', archived: true }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.nodes.map((n) => n.id)).toEqual(['/a.md'])
  })

  it('includes archived entries when showArchived is true', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A' }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B', archived: true }),
    ]
    const data = buildGraphData({
      entries,
      mode: 'global',
      focus: null,
      ...defaults,
      showArchived: true,
    })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/a.md', '/b.md'])
  })

  it('skips binary files', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A' }),
      makeEntry({ path: '/img.png', filename: 'img.png', title: 'Image', fileKind: 'binary' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.nodes.map((n) => n.id)).toEqual(['/a.md'])
  })

  it('builds links from outgoingLinks', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', outgoingLinks: ['B'] }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.links).toHaveLength(1)
    expect(data.links[0].source).toBe('/a.md')
    expect(data.links[0].target).toBe('/b.md')
  })

  it('collapses bidirectional links into one with bidirectional flag', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', outgoingLinks: ['B'] }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B', outgoingLinks: ['A'] }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.links).toHaveLength(1)
    expect(data.links[0].bidirectional).toBe(true)
  })

  it('builds links from frontmatter relationships (belongsTo)', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', belongsTo: ['[[B]]'] }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.links).toHaveLength(1)
  })

  it('builds links from custom dynamic relationships', () => {
    const entries = [
      makeEntry({
        path: '/a.md',
        filename: 'a.md',
        title: 'A',
        relationships: { 'Key People': ['[[Alice]]'] },
      }),
      makeEntry({ path: '/alice.md', filename: 'alice.md', title: 'Alice' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    expect(data.links).toHaveLength(1)
    expect(data.links[0].target).toBe('/alice.md')
  })

  it('hides orphans when showOrphans is false, keeping connected nodes', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', outgoingLinks: ['B'] }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B' }),
      makeEntry({ path: '/orphan.md', filename: 'orphan.md', title: 'Orphan' }),
    ]
    const data = buildGraphData({
      entries,
      mode: 'global',
      focus: null,
      ...defaults,
      showOrphans: false,
    })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/a.md', '/b.md'])
  })

  it('filters by query against title (case-insensitive)', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'Apple' }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'Banana' }),
    ]
    const data = buildGraphData({
      entries,
      mode: 'global',
      focus: null,
      ...defaults,
      query: 'app',
    })
    expect(data.nodes.map((n) => n.id)).toEqual(['/a.md'])
  })

  it('filters by query matching alias', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'Apple', aliases: ['Pomme'] }),
    ]
    const data = buildGraphData({
      entries,
      mode: 'global',
      focus: null,
      ...defaults,
      query: 'pomme',
    })
    expect(data.nodes).toHaveLength(1)
  })

  it('records degree counts for each node', () => {
    const entries = [
      makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', outgoingLinks: ['B', 'C'] }),
      makeEntry({ path: '/b.md', filename: 'b.md', title: 'B', outgoingLinks: ['C'] }),
      makeEntry({ path: '/c.md', filename: 'c.md', title: 'C' }),
    ]
    const data = buildGraphData({ entries, mode: 'global', focus: null, ...defaults })
    const c = data.nodes.find((n) => n.id === '/c.md')
    expect(c?.degree).toBe(2)
  })
})

describe('buildGraphData (local)', () => {
  const triangle = [
    makeEntry({ path: '/a.md', filename: 'a.md', title: 'A', outgoingLinks: ['B'] }),
    makeEntry({ path: '/b.md', filename: 'b.md', title: 'B', outgoingLinks: ['C'] }),
    makeEntry({ path: '/c.md', filename: 'c.md', title: 'C' }),
    makeEntry({ path: '/island.md', filename: 'island.md', title: 'Island' }),
  ]

  it('depth 1 includes only direct neighbors of focus', () => {
    const focus = triangle[0]
    const data = buildGraphData({ entries: triangle, mode: 'local', focus, ...defaults })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/a.md', '/b.md'])
  })

  it('depth 2 reaches second-hop neighbors', () => {
    const focus = triangle[0]
    const data = buildGraphData({
      entries: triangle,
      mode: 'local',
      focus,
      ...defaults,
      depth: 2,
    })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/a.md', '/b.md', '/c.md'])
  })

  it('local mode excludes unrelated islands at any depth', () => {
    const focus = triangle[0]
    const data = buildGraphData({
      entries: triangle,
      mode: 'local',
      focus,
      ...defaults,
      depth: 3,
    })
    expect(data.nodes.map((n) => n.id)).not.toContain('/island.md')
  })

  it('marks focal node with isFocus=true', () => {
    const focus = triangle[0]
    const data = buildGraphData({ entries: triangle, mode: 'local', focus, ...defaults })
    const focal = data.nodes.find((n) => n.id === '/a.md')
    expect(focal?.isFocus).toBe(true)
  })

  it('walks inbound edges as well as outbound when expanding', () => {
    const focus = triangle[2]
    const data = buildGraphData({
      entries: triangle,
      mode: 'local',
      focus,
      ...defaults,
      depth: 1,
    })
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['/b.md', '/c.md'])
  })
})
