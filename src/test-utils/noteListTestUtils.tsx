import type { ComponentProps } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { NoteList } from '../components/NoteList'
import type { NoteListFilter } from '../utils/noteListHelpers'
import type { VaultEntry, SidebarSelection } from '../types'

type NoteListProps = ComponentProps<typeof NoteList>

export const allSelection: SidebarSelection = { kind: 'filter', filter: 'all' }

export const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/test.md',
  filename: 'test.md',
  title: 'Test',
  isA: null,
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: null,
  createdAt: null,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  filenameTemplate: null,
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
})

export const mockEntries: VaultEntry[] = [
  makeEntry({
    path: '/Users/luca/Laputa/project/26q1-laputa-app.md',
    filename: '26q1-laputa-app.md',
    title: 'Build Laputa App',
    isA: 'Project',
    relatedTo: ['[[topic/software-development]]'],
    status: 'Active',
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 1024,
    snippet: 'Build a personal knowledge management app.',
    relationships: {
      'Related to': ['[[topic/software-development]]'],
    },
  }),
  makeEntry({
    path: '/Users/luca/Laputa/note/facebook-ads-strategy.md',
    filename: 'facebook-ads-strategy.md',
    title: 'Facebook Ads Strategy',
    isA: 'Note',
    belongsTo: ['[[project/26q1-laputa-app]]'],
    relatedTo: ['[[topic/growth]]'],
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 847,
    snippet: 'Lookalike audiences convert 3x better.',
    relationships: {
      'Belongs to': ['[[project/26q1-laputa-app]]'],
      'Related to': ['[[topic/growth]]'],
    },
  }),
  makeEntry({
    path: '/Users/luca/Laputa/person/matteo-cellini.md',
    filename: 'matteo-cellini.md',
    title: 'Matteo Cellini',
    isA: 'Person',
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 320,
    snippet: 'Sponsorship manager.',
  }),
  makeEntry({
    path: '/Users/luca/Laputa/event/2026-02-14-kickoff.md',
    filename: '2026-02-14-kickoff.md',
    title: 'Kickoff Meeting',
    isA: 'Event',
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 512,
    snippet: 'Project kickoff meeting notes.',
  }),
  makeEntry({
    path: '/Users/luca/Laputa/topic/software-development.md',
    filename: 'software-development.md',
    title: 'Software Development',
    isA: 'Topic',
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 256,
    snippet: 'Frontend, backend, and systems programming.',
  }),
]

export const makeIndexedEntry = (index: number, overrides?: Partial<VaultEntry>): VaultEntry =>
  makeEntry({
    path: `/vault/note/note-${index}.md`,
    filename: `note-${index}.md`,
    title: `Note ${index}`,
    isA: 'Note',
    modifiedAt: 1700000000 - index * 60,
    fileSize: 500,
    snippet: `Content of note ${index}`,
    ...overrides,
  })

export const makeTypeDefinition = (title: string, displayProps: string[] = []): VaultEntry =>
  makeEntry({
    path: `/vault/type/${title.toLowerCase()}.md`,
    filename: `${title.toLowerCase()}.md`,
    title,
    isA: 'Type',
    listPropertiesDisplay: displayProps,
  })

export function createNoteListSpies() {
  return {
    onSelectNote: vi.fn(),
    onReplaceActiveTab: vi.fn(),
    onEnterNeighborhood: vi.fn(),
    onCreateNote: vi.fn(),
    onNoteListFilterChange: vi.fn(),
  }
}

export function buildNoteListProps(overrides: Partial<NoteListProps> = {}) {
  const spies = createNoteListSpies()
  const props: NoteListProps = {
    entries: mockEntries,
    selection: allSelection,
    selectedNote: null,
    noteListFilter: 'open' as NoteListFilter,
    onNoteListFilterChange: spies.onNoteListFilterChange,
    onSelectNote: spies.onSelectNote,
    onReplaceActiveTab: spies.onReplaceActiveTab,
    onEnterNeighborhood: spies.onEnterNeighborhood,
    onCreateNote: spies.onCreateNote,
    ...overrides,
  }

  return { props, ...spies }
}

export function renderNoteList(overrides: Partial<NoteListProps> = {}) {
  const built = buildNoteListProps(overrides)
  return {
    ...render(<NoteList {...built.props} />),
    ...built,
  }
}
