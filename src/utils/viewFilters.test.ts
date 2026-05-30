import { afterEach, describe, it, expect, vi } from 'vitest'
import { evaluateView } from './viewFilters'
import type { FilterNode, VaultEntry, ViewDefinition } from '../types'

const NOW = Math.floor(Date.now() / 1000)

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/test.md', filename: 'test.md', title: 'Test', isA: null,
    aliases: [], belongsTo: [], relatedTo: [], status: null,
    archived: false,
    modifiedAt: NOW, createdAt: NOW, fileSize: 100, snippet: '',
    wordCount: 0, relationships: {}, icon: null, color: null,
    order: null, sidebarLabel: null, template: null, sort: null, view: null,
    visible: null, favorite: false, favoriteIndex: null,
    outgoingLinks: [], properties: {}, listPropertiesDisplay: [],
    ...overrides,
  }
}

function makeView(filters: ViewDefinition['filters'], name = 'Test'): ViewDefinition {
  return { name, icon: null, color: null, sort: null, filters }
}

function makeFilterView(filter: FilterNode, name = 'Test'): ViewDefinition {
  return makeView({ all: [filter] }, name)
}

function titlesFor(view: ViewDefinition, entries: VaultEntry[]): string[] {
  return evaluateView(view, entries).map((entry) => entry.title)
}

function expectFilterTitles(
  filter: FilterNode,
  entries: VaultEntry[],
  expectedTitles: string[],
  name?: string,
) {
  expect(titlesFor(makeFilterView(filter, name), entries)).toEqual(expectedTitles)
}

describe('evaluateView', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters by type equals', () => {
    const entries = [
      makeEntry({ isA: 'Project', title: 'P1' }),
      makeEntry({ isA: 'Note', title: 'N1' }),
      makeEntry({ isA: 'Project', title: 'P2' }),
    ]
    expectFilterTitles({ field: 'type', op: 'equals', value: 'Project' }, entries, ['P1', 'P2'], 'Projects')
  })

  it('filters by status not_equals', () => {
    const entries = [
      makeEntry({ status: 'active', title: 'A' }),
      makeEntry({ status: 'done', title: 'D' }),
      makeEntry({ status: null, title: 'N' }),
    ]
    expectFilterTitles({ field: 'status', op: 'not_equals', value: 'done' }, entries, ['A', 'N'], 'Active')
  })

  it('filters by relationship contains wikilink', () => {
    const entries = [
      makeEntry({ title: 'Match', relationships: { 'Related to': ['[[laputa-app|Laputa App]]', '[[other]]'] } }),
      makeEntry({ title: 'No match', relationships: { 'Related to': ['[[something]]'] } }),
      makeEntry({ title: 'No rels', relationships: {} }),
    ]
    expectFilterTitles({ field: 'Related to', op: 'contains', value: '[[laputa-app]]' }, entries, ['Match'], 'Related')
  })

  it('evaluates nested AND/OR groups', () => {
    const view = makeView(
      {
        any: [
          { all: [{ field: 'type', op: 'equals', value: 'Project' }, { field: 'status', op: 'equals', value: 'active' }] },
          { all: [{ field: 'type', op: 'equals', value: 'Event' }] },
        ],
      },
      'Complex',
    )
    const entries = [
      makeEntry({ isA: 'Project', status: 'active', title: 'Active Proj' }),
      makeEntry({ isA: 'Project', status: 'done', title: 'Done Proj' }),
      makeEntry({ isA: 'Event', title: 'My Event' }),
      makeEntry({ isA: 'Note', title: 'Random' }),
    ]
    expect(titlesFor(view, entries)).toEqual(['Active Proj', 'My Event'])
  })

  it('filters by is_empty and is_not_empty', () => {
    const entries = [
      makeEntry({ status: 'active', title: 'Has' }),
      makeEntry({ status: null, title: 'Null' }),
      makeEntry({ status: '', title: 'Empty' }),
    ]
    expectFilterTitles({ field: 'status', op: 'is_not_empty' }, entries, ['Has'], 'Has Status')
  })

  it('excludes archived entries', () => {
    const entries = [
      makeEntry({ isA: 'Note', title: 'Active' }),
      makeEntry({ isA: 'Note', title: 'Archived', archived: true }),
    ]
    expectFilterTitles({ field: 'type', op: 'equals', value: 'Note' }, entries, ['Active'], 'All')
  })

  it('filters by property field', () => {
    const entries = [
      makeEntry({ title: 'Match', properties: { Owner: 'Luca' } }),
      makeEntry({ title: 'Other', properties: { Owner: 'Brian' } }),
      makeEntry({ title: 'None', properties: {} }),
    ]
    expectFilterTitles({ field: 'Owner', op: 'equals', value: 'Luca' }, entries, ['Match'], 'By Owner')
  })

  it('filters with any_of operator', () => {
    const entries = [
      makeEntry({ status: 'active', title: 'A' }),
      makeEntry({ status: 'In Progress', title: 'B' }),
      makeEntry({ status: 'done', title: 'C' }),
    ]
    expectFilterTitles({ field: 'status', op: 'any_of', value: ['active', 'in progress'] }, entries, ['A', 'B'], 'Multi')
  })

  it('contains on relationship uses substring match for plain text', () => {
    const entries = [
      makeEntry({ title: 'A', relationships: { 'belongs to': ['[[Monday Ideas]]'] } }),
      makeEntry({ title: 'B', relationships: { 'belongs to': ['[[Monday Recap]]'] } }),
      makeEntry({ title: 'C', relationships: { 'belongs to': ['[[Tuesday Ideas]]'] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'contains', value: 'Monday' }, entries, ['A', 'B'], 'Monday')
  })

  it('not_contains on relationship uses substring match for plain text', () => {
    const entries = [
      makeEntry({ title: 'A', relationships: { 'belongs to': ['[[Monday Ideas]]'] } }),
      makeEntry({ title: 'B', relationships: { 'belongs to': ['[[Tuesday Ideas]]'] } }),
      makeEntry({ title: 'C', relationships: { 'belongs to': [] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'not_contains', value: 'Monday' }, entries, ['B', 'C'], 'Not Monday')
  })

  it('contains on relationship uses exact match for wikilink syntax', () => {
    const entries = [
      makeEntry({ title: 'A', relationships: { 'belongs to': ['[[Monday Ideas]]'] } }),
      makeEntry({ title: 'B', relationships: { 'belongs to': ['[[Monday Recap]]'] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'contains', value: '[[Monday Ideas]]' }, entries, ['A'], 'Exact')
  })

  it('equals on relationship matches a single-item array by stem', () => {
    const view = makeView(
      {
        any: [
          { field: 'belongs_to', op: 'equals', value: 'svc-session-trail' },
          { field: 'related_to', op: 'equals', value: 'svc-session-trail' },
        ],
      },
      'session-trail',
    )
    const entries = [
      makeEntry({ title: 'Matches', relationships: { related_to: ['[[svc-session-trail]]'] } }),
      makeEntry({ title: 'Bracketed value also matches', relationships: { related_to: ['[[svc-session-trail|Trail]]'] } }),
      makeEntry({ title: 'Other relation', relationships: { related_to: ['[[unrelated]]'] } }),
      makeEntry({ title: 'No rels', relationships: {} }),
    ]
    expect(titlesFor(view, entries)).toEqual(['Matches', 'Bracketed value also matches'])
  })

  it('equals on relationship requires a single-item array (mirrors Rust semantics)', () => {
    const entries = [
      makeEntry({ title: 'Single', relationships: { related_to: ['[[svc-session-trail]]'] } }),
      makeEntry({ title: 'Multiple', relationships: { related_to: ['[[svc-session-trail]]', '[[other]]'] } }),
    ]
    expectFilterTitles({ field: 'related_to', op: 'equals', value: 'svc-session-trail' }, entries, ['Single'], 'single')
  })

  it('not_equals on relationship is the inverse of equals', () => {
    const entries = [
      makeEntry({ title: 'Single match', relationships: { related_to: ['[[svc-session-trail]]'] } }),
      makeEntry({ title: 'Multiple', relationships: { related_to: ['[[svc-session-trail]]', '[[other]]'] } }),
      makeEntry({ title: 'Other', relationships: { related_to: ['[[unrelated]]'] } }),
    ]
    expectFilterTitles(
      { field: 'related_to', op: 'not_equals', value: 'svc-session-trail' },
      entries,
      ['Multiple', 'Other'],
      'not-equals',
    )
  })

  it('any_of / none_of on relationship always use exact stem match', () => {
    const entries = [
      makeEntry({ title: 'Exact', relationships: { 'belongs to': ['[[Monday]]'] } }),
      makeEntry({ title: 'Partial', relationships: { 'belongs to': ['[[Monday Ideas]]'] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'any_of', value: ['[[Monday]]'] }, entries, ['Exact'], 'Exact list')
  })

  it('before operator works with ISO date strings in properties', () => {
    const entries = [
      makeEntry({ title: 'Early', properties: { Date: '2024-03-15' } }),
      makeEntry({ title: 'Late', properties: { Date: '2024-09-01' } }),
      makeEntry({ title: 'NoDate', properties: {} }),
    ]
    expectFilterTitles({ field: 'Date', op: 'before', value: '2024-06-01' }, entries, ['Early'], 'Before')
  })

  it('after operator works with ISO date strings in properties', () => {
    const entries = [
      makeEntry({ title: 'Early', properties: { Date: '2024-03-15' } }),
      makeEntry({ title: 'Late', properties: { Date: '2024-09-01' } }),
    ]
    expectFilterTitles({ field: 'Date', op: 'after', value: '2024-06-01' }, entries, ['Late'], 'After')
  })

  it('before/after works with ISO datetime strings', () => {
    const entries = [
      makeEntry({ title: 'Morning', properties: { Date: '2024-03-15T08:00:00' } }),
      makeEntry({ title: 'Evening', properties: { Date: '2024-03-15T18:00:00' } }),
    ]
    expectFilterTitles({ field: 'Date', op: 'before', value: '2024-03-15T12:00:00' }, entries, ['Morning'], 'Before datetime')
  })

  it('before/after works with numeric Unix timestamps', () => {
    // Unix timestamp for 2024-06-15 in seconds
    const ts = Math.floor(new Date('2024-06-15').getTime() / 1000)
    const entries = [
      makeEntry({ title: 'Match', properties: { Date: ts } }),
    ]
    expectFilterTitles({ field: 'Date', op: 'after', value: '2024-01-01' }, entries, ['Match'], 'After ts')
  })

  it('before/after accept natural-language relative date phrases', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T12:00:00Z'))

    const entries = [
      makeEntry({ title: 'Older', properties: { Date: '2026-03-20' } }),
      makeEntry({ title: 'Recent', properties: { Date: '2026-03-30' } }),
    ]
    expectFilterTitles({ field: 'Date', op: 'after', value: '10 days ago' }, entries, ['Recent'], 'Recent')
  })

  it('body contains filters on snippet text (case-insensitive)', () => {
    const entries = [
      makeEntry({ title: 'Match', snippet: 'This is the quarterly review summary' }),
      makeEntry({ title: 'No match', snippet: 'Daily standup notes' }),
      makeEntry({ title: 'Case match', snippet: 'QUARTERLY PLANNING session' }),
    ]
    expectFilterTitles({ field: 'body', op: 'contains', value: 'quarterly' }, entries, ['Match', 'Case match'], 'Body search')
  })

  it('body not_contains excludes matching notes', () => {
    const entries = [
      makeEntry({ title: 'Final', snippet: 'Final version of the document' }),
      makeEntry({ title: 'Draft', snippet: 'This is a draft version' }),
    ]
    expectFilterTitles({ field: 'body', op: 'not_contains', value: 'draft' }, entries, ['Final'], 'Body exclude')
  })

  it('body filter combines with property filters (AND)', () => {
    const view = makeView(
      { all: [
        { field: 'type', op: 'equals', value: 'Note' },
        { field: 'body', op: 'contains', value: 'important' },
      ] },
      'Combined',
    )
    const entries = [
      makeEntry({ title: 'Yes', isA: 'Note', snippet: 'This is important content' }),
      makeEntry({ title: 'Wrong type', isA: 'Project', snippet: 'This is important content' }),
      makeEntry({ title: 'No match', isA: 'Note', snippet: 'Regular content' }),
    ]
    expect(titlesFor(view, entries)).toEqual(['Yes'])
  })

  it('wikilink filter matches frontmatter with alias via path', () => {
    const entries = [
      makeEntry({ title: 'Match', relationships: { 'belongs to': ['[[monday-112|Monday #112]]'] } }),
      makeEntry({ title: 'No match', relationships: { 'belongs to': ['[[tuesday-200|Tuesday]]'] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'contains', value: '[[monday-112]]' }, entries, ['Match'], 'By path')
  })

  it('wikilink filter matches frontmatter with alias via alias', () => {
    const entries = [
      makeEntry({ title: 'Match', relationships: { 'belongs to': ['[[monday-112|Monday #112]]'] } }),
      makeEntry({ title: 'No match', relationships: { 'belongs to': ['[[tuesday-200|Tuesday]]'] } }),
    ]
    expectFilterTitles({ field: 'belongs to', op: 'contains', value: '[[Monday #112]]' }, entries, ['Match'], 'By alias')
  })

  it('wikilink filter with stem|title format matches frontmatter path', () => {
    const entries = [
      makeEntry({ title: 'Match', relationships: { 'belongs to': ['[[monday-112|Monday #112]]'] } }),
      makeEntry({ title: 'No match', relationships: { 'belongs to': ['[[other]]'] } }),
    ]
    expectFilterTitles(
      { field: 'belongs to', op: 'contains', value: '[[monday-112|Monday 112]]' },
      entries,
      ['Match'],
      'Stem format',
    )
  })

  it('any_of on relationship uses alias matching', () => {
    const entries = [
      makeEntry({ title: 'Match', relationships: { 'belongs to': ['[[monday-112|Monday #112]]'] } }),
      makeEntry({ title: 'No', relationships: { 'belongs to': ['[[other]]'] } }),
    ]
    expectFilterTitles(
      { field: 'belongs to', op: 'any_of', value: ['[[monday-112|Monday 112]]'] },
      entries,
      ['Match'],
      'Any of',
    )
  })

  it('body is_empty matches notes with empty snippet', () => {
    const entries = [
      makeEntry({ title: 'Empty', snippet: '' }),
      makeEntry({ title: 'Has content', snippet: 'Some text here' }),
    ]
    expectFilterTitles({ field: 'body', op: 'is_empty' }, entries, ['Empty'], 'Empty body')
  })

  it('supports regex matching on scalar fields', () => {
    const entries = [
      makeEntry({ title: 'Alpha Project' }),
      makeEntry({ title: 'Alpha Notes' }),
      makeEntry({ title: 'alpha project' }),
    ]
    expectFilterTitles(
      { field: 'title', op: 'contains', value: '^alpha\\s+project$', regex: true },
      entries,
      ['Alpha Project', 'alpha project'],
      'Regex title',
    )
  })

  it('supports regex matching on relationship aliases and stems', () => {
    const entries = [
      makeEntry({ title: 'Alias match', relationships: { 'belongs to': ['[[monday-112|Monday #112]]'] } }),
      makeEntry({ title: 'Stem match', relationships: { 'belongs to': ['[[monday-113]]'] } }),
      makeEntry({ title: 'No match', relationships: { 'belongs to': ['[[tuesday-200|Tuesday]]'] } }),
    ]
    expectFilterTitles(
      { field: 'belongs to', op: 'contains', value: 'monday-(112|113)|Monday #112', regex: true },
      entries,
      ['Alias match', 'Stem match'],
      'Regex relationship',
    )
  })

  it('treats invalid regex filters as matching nothing', () => {
    const entries = [
      makeEntry({ title: 'Alpha Project' }),
      makeEntry({ title: 'Beta Project' }),
    ]
    expectFilterTitles({ field: 'title', op: 'contains', value: '(', regex: true }, entries, [], 'Broken regex')
  })
})
