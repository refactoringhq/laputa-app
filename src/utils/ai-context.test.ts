import { describe, it, expect } from 'vitest'
import { resolveTarget, collectLinkedEntries, buildContextualPrompt, buildContextSnapshot } from './ai-context'
import type { VaultEntry } from '../types'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  ...overrides,
})

describe('resolveTarget', () => {
  const entries = [
    makeEntry({ path: '/vault/a.md', title: 'Alpha', filename: 'a.md' }),
    makeEntry({ path: '/vault/b.md', title: 'Beta', filename: 'beta-note.md', aliases: ['B'] }),
  ]

  it('resolves by title (case-insensitive)', () => {
    expect(resolveTarget('alpha', entries)?.path).toBe('/vault/a.md')
    expect(resolveTarget('Alpha', entries)?.path).toBe('/vault/a.md')
  })

  it('resolves by alias (case-insensitive)', () => {
    expect(resolveTarget('B', entries)?.path).toBe('/vault/b.md')
    expect(resolveTarget('b', entries)?.path).toBe('/vault/b.md')
  })

  it('resolves by filename stem', () => {
    expect(resolveTarget('beta-note', entries)?.path).toBe('/vault/b.md')
  })

  it('returns undefined for unresolvable target', () => {
    expect(resolveTarget('nonexistent', entries)).toBeUndefined()
  })
})

describe('collectLinkedEntries', () => {
  const entryA = makeEntry({ path: '/vault/a.md', title: 'Alpha' })
  const entryB = makeEntry({ path: '/vault/b.md', title: 'Beta' })
  const entryC = makeEntry({ path: '/vault/c.md', title: 'Gamma' })
  const entryD = makeEntry({ path: '/vault/d.md', title: 'Delta' })
  const allEntries = [entryA, entryB, entryC, entryD]

  it('returns empty array when active has no links', () => {
    expect(collectLinkedEntries(entryA, allEntries)).toEqual([])
  })

  it('collects entries from outgoingLinks', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      outgoingLinks: ['Alpha', 'Beta'],
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Alpha', 'Beta'])
  })

  it('collects entries from relationships', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      relationships: { relatedTo: ['[[Alpha]]', '[[Gamma]]'] },
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Alpha', 'Gamma'])
  })

  it('collects entries from belongsTo', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      belongsTo: ['[[Delta]]'],
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Delta'])
  })

  it('collects entries from relatedTo', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      relatedTo: ['[[Beta]]'],
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Beta'])
  })

  it('deduplicates entries across all link sources', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      outgoingLinks: ['Alpha', 'Beta'],
      relationships: { people: ['[[Alpha]]'] },
      belongsTo: ['[[Beta]]'],
      relatedTo: ['[[Alpha]]'],
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Alpha', 'Beta'])
  })

  it('excludes the active note itself', () => {
    const active = makeEntry({
      path: '/vault/a.md', title: 'Alpha',
      outgoingLinks: ['Alpha'],
    })
    const linked = collectLinkedEntries(active, allEntries)
    expect(linked).toEqual([])
  })

  it('ignores unresolvable links', () => {
    const active = makeEntry({
      path: '/vault/main.md', title: 'Main',
      outgoingLinks: ['Alpha', 'Nonexistent'],
    })
    const linked = collectLinkedEntries(active, [...allEntries, active])
    expect(linked.map(e => e.title)).toEqual(['Alpha'])
  })
})

describe('buildContextualPrompt', () => {
  it('includes active note title and type', () => {
    const active = makeEntry({ path: '/vault/a.md', title: 'Alpha', isA: 'Project' })
    const prompt = buildContextualPrompt(active, [])
    expect(prompt).toContain('Alpha')
    expect(prompt).toContain('Project')
  })

  it('includes linked note titles', () => {
    const active = makeEntry({ path: '/vault/a.md', title: 'Alpha' })
    const linked = makeEntry({ path: '/vault/b.md', title: 'Beta', isA: 'Person' })
    const prompt = buildContextualPrompt(active, [linked])
    expect(prompt).toContain('Beta')
    expect(prompt).toContain('Person')
    expect(prompt).toContain('Linked Notes')
  })

  it('includes the system preamble', () => {
    const active = makeEntry({ path: '/vault/a.md', title: 'Alpha' })
    const prompt = buildContextualPrompt(active, [])
    expect(prompt).toContain('AI assistant integrated into Tolaria')
  })
})

describe('buildContextSnapshot', () => {
  const active = makeEntry({ path: '/vault/a.md', title: 'Alpha', isA: 'Project', status: 'active', properties: { Owner: 'Alice' } })
  const entries = [
    active,
    makeEntry({ path: '/vault/b.md', title: 'Beta', isA: 'Person' }),
    makeEntry({ path: '/vault/c.md', title: 'Gamma', isA: 'Note' }),
  ]

  it('includes activeNote with body and frontmatter', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries, activeNoteContent: '---\ntitle: Alpha\n---\n# Alpha\nProject content.' })
    expect(result).toContain('Alpha')
    expect(result).toContain('Project content.')
    expect(result).toContain('"type": "Project"')
    expect(result).toContain('"status": "active"')
    expect(result).toContain('"owner": "Alice"')
  })

  it('includes system preamble', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries })
    expect(result).toContain('AI assistant integrated into Tolaria')
    expect(result).toContain('Context Snapshot')
  })

  it('includes vault summary with types and totalNotes', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.vault.totalNotes).toBe(3)
    expect(json.vault.types).toContain('Project')
    expect(json.vault.types).toContain('Person')
    expect(json.vault.types).toContain('Note')
  })

  it('includes openTabs excluding active note', () => {
    const tab = makeEntry({ path: '/vault/b.md', title: 'Beta', isA: 'Person' })
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      openTabs: [active, tab],
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.openTabs).toHaveLength(1)
    expect(json.openTabs[0].title).toBe('Beta')
  })

  it('omits openTabs when none besides active', () => {
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      openTabs: [active],
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.openTabs).toBeUndefined()
  })

  it('includes noteListFilter when present', () => {
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      noteListFilter: { type: 'Project', query: 'search' },
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.noteListFilter.type).toBe('Project')
    expect(json.noteListFilter.query).toBe('search')
  })

  it('omits noteListFilter when empty', () => {
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      noteListFilter: { type: null, query: '' },
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.noteListFilter).toBeUndefined()
  })

  it('includes referencedNotes metadata', () => {
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      references: [
        { title: 'Beta', path: '/vault/b.md', type: 'Person' },
        { title: 'Gamma', path: '/vault/c.md', type: null },
      ],
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.referencedNotes).toHaveLength(2)
    expect(json.referencedNotes[0].title).toBe('Beta')
    expect(json.referencedNotes[1].type).toBe('Note') // null fallback
  })

  it('omits referencedNotes when no references provided', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.referencedNotes).toBeUndefined()
  })

  it('includes noteList when provided', () => {
    const noteList = [
      { path: '/vault/a.md', title: 'Alpha', type: 'Project' },
      { path: '/vault/b.md', title: 'Beta', type: 'Person' },
    ]
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      noteList,
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.noteList).toHaveLength(2)
    expect(json.noteList[0].title).toBe('Alpha')
    expect(json.noteList[1].type).toBe('Person')
  })

  it('truncates noteList at 100 items', () => {
    const noteList = Array.from({ length: 150 }, (_, i) => ({
      path: `/vault/note-${i}.md`, title: `Note ${i}`, type: 'Note',
    }))
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      noteList,
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.noteList).toHaveLength(100)
    expect(json.noteListTruncated).toEqual({ shown: 100, total: 150 })
  })

  it('omits noteList when empty', () => {
    const result = buildContextSnapshot({
      activeEntry: active, entries,
      noteList: [],
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.noteList).toBeUndefined()
  })

  it('strips frontmatter from activeNoteContent before setting body', () => {
    const result = buildContextSnapshot({
      activeEntry: active,
      entries,
      activeNoteContent: '---\ntitle: Alpha\n---\n\n# Alpha\nProject content from tab.',
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toContain('Project content from tab.')
    expect(json.activeNote.body).not.toContain('---')
    expect(json.activeNote.body).not.toContain('title: Alpha')
  })

  it('returns empty body when raw content is frontmatter-only (bug case)', () => {
    const result = buildContextSnapshot({
      activeEntry: active,
      entries,
      activeNoteContent: '---\ntitle: Alpha\nis_a: Project\nstatus: active\n---\n',
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toBe('')
  })

  it('uses activeNoteContent for body', () => {
    const result = buildContextSnapshot({
      activeEntry: active,
      entries,
      activeNoteContent: '---\ntitle: Alpha\n---\nFresh editor content',
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toBe('Fresh editor content')
  })

  it('compacts large active note bodies and points agents at the full note tool', () => {
    const largeBody = [
      'Opening section '.repeat(900),
      'Middle section that should not be fully embedded '.repeat(900),
      'Closing section '.repeat(900),
    ].join('\n')
    const result = buildContextSnapshot({
      activeEntry: makeEntry({
        path: '/vault/large-note.md',
        title: 'Large Note',
        wordCount: 2700,
      }),
      entries,
      activeNoteContent: largeBody,
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])

    expect(json.activeNote.body.length).toBeLessThan(largeBody.length)
    expect(json.activeNote.body).toContain('Opening section')
    expect(json.activeNote.body).toContain('Closing section')
    expect(json.activeNote.body).toContain('get_note("/vault/large-note.md")')
    expect(json.activeNote.bodyTruncated).toEqual({
      shownChars: expect.any(Number),
      totalChars: largeBody.trim().length,
      strategy: 'head-tail',
    })
  })

  it('returns empty body when no activeNoteContent', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toBe('')
  })

  it('includes wordCount in activeNote', () => {
    const entryWithWords = makeEntry({ path: '/vault/a.md', title: 'Alpha', wordCount: 206 })
    const result = buildContextSnapshot({ activeEntry: entryWithWords, entries })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.wordCount).toBe(206)
  })

  it('handles content with no frontmatter (plain markdown)', () => {
    const result = buildContextSnapshot({
      activeEntry: active,
      entries,
      activeNoteContent: '# Just a heading\n\nSome plain content.',
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toBe('# Just a heading\n\nSome plain content.')
  })

  it('includes defensive body when body is empty but wordCount > 0', () => {
    const entryWithWords = makeEntry({
      path: '/vault/a.md', title: 'Alpha', wordCount: 206,
    })
    const result = buildContextSnapshot({
      activeEntry: entryWithWords,
      entries,
      activeNoteContent: '---\ntitle: Alpha\n---\n',
    })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.body).toContain('get_note')
    expect(json.activeNote.body).toContain('206 words')
  })

  it('includes wikilink instruction in preamble', () => {
    const result = buildContextSnapshot({ activeEntry: active, entries })
    expect(result).toContain('[[Note Title]]')
    expect(result).toContain('wikilink')
  })

  it('includes belongsTo and relatedTo in frontmatter', () => {
    const entryWithRels = makeEntry({
      path: '/vault/a.md', title: 'Alpha',
      belongsTo: ['[[Parent]]'],
      relatedTo: ['[[Sibling]]'],
      relationships: { people: ['[[Alice]]'] },
    })
    const result = buildContextSnapshot({ activeEntry: entryWithRels, entries })
    const json = JSON.parse(result.split('```json\n')[1].split('\n```')[0])
    expect(json.activeNote.frontmatter.belongsTo).toEqual(['[[Parent]]'])
    expect(json.activeNote.frontmatter.relatedTo).toEqual(['[[Sibling]]'])
    expect(json.activeNote.frontmatter.relationships).toEqual({ people: ['[[Alice]]'] })
  })
})
