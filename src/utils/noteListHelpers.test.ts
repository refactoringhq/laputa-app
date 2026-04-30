import { describe, expect, it } from 'vitest'
import { buildRelationshipGroups, countAllByFilter, countAllNotesByFilter, countByFilter, filterEntries } from './noteListHelpers'
import { allSelection, makeEntry, mockEntries } from '../test-utils/noteListTestUtils'

describe('filterEntries', () => {
  it('returns empty for entity selections because entity view uses grouped relationships', () => {
    const result = filterEntries(mockEntries, { kind: 'entity', entry: mockEntries[4] })
    expect(result).toHaveLength(0)
  })

  it('filters section groups by open sub-filter', () => {
    const entries = [
      makeEntry({ path: '/1.md', title: 'Active', isA: 'Project' }),
      makeEntry({ path: '/2.md', title: 'Archived', isA: 'Project', archived: true }),
      makeEntry({ path: '/4.md', title: 'Other', isA: 'Note' }),
    ]

    const result = filterEntries(entries, { kind: 'sectionGroup', type: 'Project' }, { subFilter: 'open' })
    expect(result.map((entry) => entry.title)).toEqual(['Active'])
  })

  it('filters section groups by archived sub-filter', () => {
    const entries = [
      makeEntry({ path: '/1.md', title: 'Active', isA: 'Project' }),
      makeEntry({ path: '/2.md', title: 'Archived', isA: 'Project', archived: true }),
      makeEntry({ path: '/4.md', title: 'Other', isA: 'Note' }),
    ]

    const result = filterEntries(entries, { kind: 'sectionGroup', type: 'Project' }, { subFilter: 'archived' })
    expect(result.map((entry) => entry.title)).toEqual(['Archived'])
  })

  it('defaults section groups to active notes when no sub-filter is provided', () => {
    const entries = [
      makeEntry({ path: '/1.md', title: 'Active', isA: 'Project' }),
      makeEntry({ path: '/2.md', title: 'Archived', isA: 'Project', archived: true }),
      makeEntry({ path: '/4.md', title: 'Other', isA: 'Note' }),
    ]

    const result = filterEntries(entries, { kind: 'sectionGroup', type: 'Project' })
    expect(result.map((entry) => entry.title)).toEqual(['Active'])
  })

  it('filters all notes by open sub-filter', () => {
    const entries = [
      makeEntry({ path: '/1.md', title: 'Active', isA: 'Project' }),
      makeEntry({ path: '/2.md', title: 'Archived', isA: 'Project', archived: true }),
      makeEntry({ path: '/4.md', title: 'Other', isA: 'Note' }),
    ]

    const result = filterEntries(entries, allSelection, { subFilter: 'open' })
    expect(result.map((entry) => entry.title)).toEqual(['Active', 'Other'])
  })

  it('filters all notes by archived sub-filter', () => {
    const entries = [
      makeEntry({ path: '/1.md', title: 'Active', isA: 'Project' }),
      makeEntry({ path: '/2.md', title: 'Archived', isA: 'Project', archived: true }),
      makeEntry({ path: '/4.md', title: 'Other', isA: 'Note' }),
    ]

    const result = filterEntries(entries, allSelection, { subFilter: 'archived' })
    expect(result.map((entry) => entry.title)).toEqual(['Archived'])
  })

  it('excludes attachments-folder markdown from the All Notes view', () => {
    const entries = [
      makeEntry({ path: '/vault/note/real-note.md', title: 'Real Note', isA: 'Note' }),
      makeEntry({ path: '/vault/attachments/reference.md', title: 'Attachment Markdown', isA: 'Note' }),
      makeEntry({ path: '/vault/attachments/nested/diagram.md', title: 'Nested Attachment Markdown', isA: 'Note' }),
      makeEntry({ path: 'C:\\Users\\luca\\Vault\\attachments\\windows.md', title: 'Windows Attachment Markdown', isA: 'Note' }),
    ]

    const result = filterEntries(entries, allSelection, { subFilter: 'open' })
    expect(result.map((entry) => entry.title)).toEqual(['Real Note'])
  })

  it('hides PDFs, images, and unsupported files from All Notes by default', () => {
    const entries = [
      makeEntry({ path: '/vault/note.md', filename: 'note.md', title: 'Note', fileKind: 'markdown' }),
      makeEntry({ path: '/vault/Guide.PDF', filename: 'Guide.PDF', title: 'PDF', fileKind: 'binary' }),
      makeEntry({ path: '/vault/Cover.JpG', filename: 'Cover.JpG', title: 'Image', fileKind: 'binary' }),
      makeEntry({ path: '/vault/config.yml', filename: 'config.yml', title: 'Text', fileKind: 'text' }),
      makeEntry({ path: '/vault/archive.zip', filename: 'archive.zip', title: 'Archive', fileKind: 'binary' }),
    ]

    const result = filterEntries(entries, allSelection, { subFilter: 'open' })

    expect(result.map((entry) => entry.title)).toEqual(['Note'])
  })

  it('shows selected non-Markdown categories in All Notes without swallowing PDFs or images into unsupported files', () => {
    const entries = [
      makeEntry({ path: '/vault/note.md', filename: 'note.md', title: 'Note', fileKind: 'markdown' }),
      makeEntry({ path: '/vault/Guide.PDF', filename: 'Guide.PDF', title: 'PDF', fileKind: 'binary' }),
      makeEntry({ path: '/vault/Cover.JpG', filename: 'Cover.JpG', title: 'Image', fileKind: 'binary' }),
      makeEntry({ path: '/vault/config.yml', filename: 'config.yml', title: 'Text', fileKind: 'text' }),
      makeEntry({ path: '/vault/archive.zip', filename: 'archive.zip', title: 'Archive', fileKind: 'binary' }),
    ]

    expect(
      filterEntries(entries, allSelection, {
        subFilter: 'open',
        allNotesFileVisibility: {
          pdfs: true,
          images: false,
          unsupported: false,
        },
      }).map((entry) => entry.title),
    ).toEqual(['Note', 'PDF'])
    expect(
      filterEntries(entries, allSelection, {
        subFilter: 'open',
        allNotesFileVisibility: {
          pdfs: false,
          images: true,
          unsupported: false,
        },
      }).map((entry) => entry.title),
    ).toEqual(['Note', 'Image'])
    expect(
      filterEntries(entries, allSelection, {
        subFilter: 'open',
        allNotesFileVisibility: {
          pdfs: false,
          images: false,
          unsupported: true,
        },
      }).map((entry) => entry.title),
    ).toEqual(['Note', 'Text', 'Archive'])
  })

  it('matches slash-based folder selections against Windows entry paths', () => {
    const entries = [
      makeEntry({ path: 'C:\\Users\\luca\\Vault\\Client Work\\Alpha.md', title: 'Alpha' }),
      makeEntry({ path: 'C:\\Users\\luca\\Vault\\Client Work\\Nested\\Beta.md', title: 'Beta' }),
      makeEntry({ path: 'C:\\Users\\luca\\Vault\\Client Work Archive\\Old.md', title: 'Archive' }),
      makeEntry({ path: 'C:\\Users\\luca\\Vault\\客户\\计划.md', title: 'Unicode' }),
    ]

    expect(filterEntries(entries, { kind: 'folder', path: 'Client Work' }).map((entry) => entry.title)).toEqual(['Alpha', 'Beta'])
    expect(filterEntries(entries, { kind: 'folder', path: '客户' }).map((entry) => entry.title)).toEqual(['Unicode'])
  })

  it('shows only direct root-level files when selecting the vault root folder', () => {
    const entries = [
      makeEntry({ path: '/Users/luca/Laputa/root-note.md', title: 'Root Note', fileKind: 'markdown' }),
      makeEntry({ path: '/Users/luca/Laputa/config.json', title: 'config.json', fileKind: 'text' }),
      makeEntry({ path: '/Users/luca/Laputa/projects/nested.md', title: 'Nested Note', fileKind: 'markdown' }),
      makeEntry({ path: '/Users/luca/Laputa/assets/logo.png', title: 'Logo', fileKind: 'binary' }),
    ]

    const result = filterEntries(entries, { kind: 'folder', path: '', rootPath: '/Users/luca/Laputa' })

    expect(result.map((entry) => entry.title)).toEqual(['Root Note', 'config.json'])
  })

  it('keeps folder browsing independent from All Notes file visibility', () => {
    const entries = [
      makeEntry({ path: '/vault/assets/spec.PDF', filename: 'spec.PDF', title: 'Spec', fileKind: 'binary' }),
      makeEntry({ path: '/vault/assets/logo.PNG', filename: 'logo.PNG', title: 'Logo', fileKind: 'binary' }),
      makeEntry({ path: '/vault/assets/data.sqlite', filename: 'data.sqlite', title: 'Data', fileKind: 'binary' }),
    ]

    const result = filterEntries(entries, { kind: 'folder', path: 'assets' })

    expect(result.map((entry) => entry.title)).toEqual(['Spec', 'Logo', 'Data'])
  })
})

describe('countByFilter', () => {
  it('counts open and archived entries for a type', () => {
    const entries = [
      makeEntry({ path: '/1.md', isA: 'Project' }),
      makeEntry({ path: '/2.md', isA: 'Project', archived: true }),
      makeEntry({ path: '/3.md', isA: 'Project' }),
      makeEntry({ path: '/4.md', isA: 'Note' }),
    ]

    expect(countByFilter(entries, 'Project')).toEqual({ open: 2, archived: 1 })
  })

  it('returns zeros when a type has no matching entries', () => {
    expect(countByFilter([], 'Project')).toEqual({ open: 0, archived: 0 })
  })
})

describe('countAllByFilter', () => {
  it('counts all entries by archive status', () => {
    const entries = [
      makeEntry({ path: '/1.md', isA: 'Project' }),
      makeEntry({ path: '/2.md', isA: 'Note' }),
      makeEntry({ path: '/3.md', isA: 'Project', archived: true }),
    ]

    expect(countAllByFilter(entries)).toEqual({ open: 2, archived: 1 })
  })

  it('excludes non-markdown files from counts', () => {
    const entries = [
      makeEntry({ path: '/1.md', isA: 'Note', fileKind: 'markdown' }),
      makeEntry({ path: '/2.yml', isA: undefined, fileKind: 'text' }),
      makeEntry({ path: '/3.png', isA: undefined, fileKind: 'binary' }),
    ]

    expect(countAllByFilter(entries)).toEqual({ open: 1, archived: 0 })
  })
})

describe('countAllNotesByFilter', () => {
  it('excludes attachments-folder files from All Notes totals', () => {
    const entries = [
      makeEntry({ path: '/vault/note/real-note.md', isA: 'Note' }),
      makeEntry({ path: '/vault/attachments/reference.md', isA: 'Note' }),
      makeEntry({ path: '/vault/attachments/archive.md', isA: 'Note', archived: true }),
      makeEntry({ path: '/vault/attachments/image.png', fileKind: 'binary' }),
      makeEntry({ path: '/vault/archive/real-archive.md', isA: 'Note', archived: true }),
    ]

    expect(countAllNotesByFilter(entries)).toEqual({ open: 1, archived: 1 })
  })

  it('counts enabled All Notes file categories by archive status', () => {
    const entries = [
      makeEntry({ path: '/vault/note.md', filename: 'note.md', fileKind: 'markdown' }),
      makeEntry({ path: '/vault/spec.pdf', filename: 'spec.pdf', fileKind: 'binary' }),
      makeEntry({ path: '/vault/photo.PNG', filename: 'photo.PNG', fileKind: 'binary', archived: true }),
      makeEntry({ path: '/vault/data.bin', filename: 'data.bin', fileKind: 'binary', archived: true }),
    ]

    expect(countAllNotesByFilter(entries, {
      pdfs: true,
      images: true,
      unsupported: false,
    })).toEqual({ open: 2, archived: 1 })
  })
})

describe('buildRelationshipGroups', () => {
  it('omits computed neighborhood groups when they are absent', () => {
    const standalone = makeEntry({
      path: '/vault/solo.md',
      filename: 'solo.md',
      title: 'Standalone',
      isA: 'Note',
    })

    const groups = buildRelationshipGroups(standalone, [standalone])

    expect(groups).toEqual([])
  })

  it('allows the same note to appear in multiple relationship groups', () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
      relationships: { 'Related to': ['[[shared-note]]'] },
    })
    const shared = makeEntry({
      path: '/vault/shared-note.md',
      filename: 'shared-note.md',
      title: 'Shared Note',
      isA: 'Note',
      relatedTo: ['[[parent]]'],
    })

    const groups = buildRelationshipGroups(parent, [parent, shared])

    expect(groups.find((group) => group.label === 'Related to')?.entries).toEqual([shared])
    expect(groups.find((group) => group.label === 'Referenced by')?.entries).toEqual([shared])
  })

  it('normalizes canonical inverse relationship keys without duplicating raw inverse groups', () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
    })
    const child = makeEntry({
      path: '/vault/child.md',
      filename: 'child.md',
      title: 'Child',
      isA: 'Note',
      belongsTo: ['[[parent]]'],
      relationships: {
        belongs_to: ['[[parent]]'],
      },
    })
    const related = makeEntry({
      path: '/vault/related.md',
      filename: 'related.md',
      title: 'Related',
      isA: 'Note',
      relatedTo: ['[[parent]]'],
      relationships: {
        related_to: ['[[parent]]'],
      },
    })

    const groups = buildRelationshipGroups(parent, [parent, child, related])

    expect(groups.find((group) => group.label === 'Children')?.entries).toEqual([child])
    expect(groups.find((group) => group.label === 'Referenced by')?.entries).toEqual([related])
    expect(groups.find((group) => group.label === '← belongs_to')).toBeUndefined()
    expect(groups.find((group) => group.label === '← related_to')).toBeUndefined()
  })

  it('includes all inverse relationship groups for non-core relationship keys', () => {
    const parent = makeEntry({
      path: '/vault/parent.md',
      filename: 'parent.md',
      title: 'Parent',
      isA: 'Project',
    })
    const topicNote = makeEntry({
      path: '/vault/topic-note.md',
      filename: 'topic-note.md',
      title: 'Topic Note',
      isA: 'Note',
      relationships: { Topics: ['[[parent]]'] },
    })
    const mentorNote = makeEntry({
      path: '/vault/mentor-note.md',
      filename: 'mentor-note.md',
      title: 'Mentor Note',
      isA: 'Note',
      relationships: { Mentors: ['[[parent]]'] },
    })
    const hostEvent = makeEntry({
      path: '/vault/host-event.md',
      filename: 'host-event.md',
      title: 'Host Event',
      isA: 'Event',
      relationships: { Hosts: ['[[parent]]'] },
    })

    const groups = buildRelationshipGroups(parent, [parent, topicNote, mentorNote, hostEvent])

    expect(groups.find((group) => group.label === '← Topics')?.entries).toEqual([topicNote])
    expect(groups.find((group) => group.label === '← Mentors')?.entries).toEqual([mentorNote])
    expect(groups.find((group) => group.label === '← Hosts')?.entries).toEqual([hostEvent])
  })

  it('does not treat path-qualified refs for a different note as reverse matches', () => {
    const parent = makeEntry({
      path: '/vault/projects/alpha.md',
      filename: 'alpha.md',
      title: 'Alpha',
      isA: 'Project',
    })
    const archiveAlpha = makeEntry({
      path: '/vault/archive/alpha.md',
      filename: 'alpha.md',
      title: 'Alpha Archive',
      isA: 'Project',
    })
    const unrelatedChild = makeEntry({
      path: '/vault/notes/child.md',
      filename: 'child.md',
      title: 'Child Note',
      isA: 'Note',
      belongsTo: ['[[archive/alpha]]'],
    })
    const unrelatedEvent = makeEntry({
      path: '/vault/events/event.md',
      filename: 'event.md',
      title: 'Review',
      isA: 'Event',
      relatedTo: ['[[archive/alpha]]'],
    })

    const groups = buildRelationshipGroups(parent, [parent, archiveAlpha, unrelatedChild, unrelatedEvent])

    expect(groups).toEqual([])
  })
})
