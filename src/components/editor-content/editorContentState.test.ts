import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../../types'
import { deriveEditorContentState, type EditorContentTab } from './editorContentState'

const baseEntry: VaultEntry = {
  path: '/vault/project/legacy-project.md',
  filename: 'legacy-project.md',
  title: 'Legacy Project',
  isA: 'Project',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 1024,
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
}

function deriveState(tab: EditorContentTab | null, overrides?: Partial<VaultEntry>) {
  const entry = tab ? { ...baseEntry, ...overrides, ...tab.entry } : null
  return deriveEditorContentState({
    activeTab: entry ? { ...tab, entry } : null,
    entries: entry ? [entry] : [],
    rawMode: false,
    activeStatus: 'clean',
  })
}

function deriveStateForContent(entryOverrides: Partial<VaultEntry>, content: string) {
  const entry = { ...baseEntry, ...entryOverrides }
  return deriveEditorContentState({
    activeTab: { entry, content },
    entries: [entry],
    rawMode: false,
    activeStatus: 'clean',
  })
}

describe('deriveEditorContentState', () => {
  it('marks loaded content with a top-level H1 as titled', () => {
    const state = deriveState({
      entry: baseEntry,
      content: '---\ntitle: Legacy Project\n---\n# Legacy Project\n\nBody',
    })

    expect(state.hasH1).toBe(true)
    expect(state.showEditor).toBe(true)
  })

  it('keeps editor content visible for notes without an H1', () => {
    const state = deriveState({
      entry: baseEntry,
      content: '---\ntitle: Legacy Project\n---\nBody without a heading',
    })

    expect(state.hasH1).toBe(false)
    expect(state.showEditor).toBe(true)
  })

  it('keeps editor content visible when a legacy frontmatter title exists', () => {
    const state = deriveState({
      entry: baseEntry,
      content: '---\ntitle: Spring 2026\nstatus: Active\n---\n## Goals',
    })

    expect(state.hasH1).toBe(false)
    expect(state.showEditor).toBe(true)
  })

  it('does not fall back to a separate title section when the filename drives the display title', () => {
    const state = deriveState({
      entry: baseEntry,
      content: '---\nstatus: Active\n---\nBody without a heading',
    })

    expect(state.hasH1).toBe(false)
    expect(state.showEditor).toBe(true)
  })

  it('keeps untitled drafts in the editor even before they get an H1', () => {
    const draftEntry = {
      ...baseEntry,
      path: '/vault/untitled-note-1700000000.md',
      filename: 'untitled-note-1700000000.md',
      title: 'Untitled Note 1700000000',
    }

    const state = deriveEditorContentState({
      activeTab: {
        entry: draftEntry,
        content: '---\ntype: Note\n---\n',
      },
      entries: [draftEntry],
      rawMode: false,
      activeStatus: 'unsaved',
    })

    expect(state.hasH1).toBe(false)
    expect(state.showEditor).toBe(true)
  })

  it.each([
    ['marks markdown notes with sheet display as sheet editor content', 'Note', '---\ntype: Note\n_display: sheet\n---\nMetric,January', true],
    ['does not treat Sheet type metadata as sheet editor content', 'Sheet', '---\ntype: Sheet\n---\nMetric,January', false],
  ])('%s', (_label, isA, content, expectedIsSheet) => {
    const state = deriveStateForContent({ isA, fileKind: 'markdown' }, content)

    expect(state.isSheet).toBe(expectedIsSheet)
    expect(state.showEditor).toBe(true)
    if (expectedIsSheet) expect(state.effectiveRawMode).toBe(false)
  })

  it('does not use fresh entry type metadata as sheet editor content', () => {
    const activeEntry = {
      ...baseEntry,
      isA: 'Note',
      fileKind: 'markdown' as const,
    }
    const freshEntry = {
      ...activeEntry,
      isA: 'Sheet',
    }

    const state = deriveEditorContentState({
      activeTab: {
        entry: activeEntry,
        content: 'Metric,January',
      },
      entries: [freshEntry],
      rawMode: false,
      activeStatus: 'clean',
    })

    expect(state.isSheet).toBe(false)
    expect(state.showEditor).toBe(true)
  })

  it.each([
    ['uses indexed display metadata when loaded content is temporarily missing frontmatter', 'Metric,January', true],
    ['lets loaded display metadata override stale indexed display metadata', '---\n_display: text\n---\nMetric,January', false],
  ])('%s', (_label, content, expectedIsSheet) => {
    const state = deriveStateForContent({ display: 'sheet', fileKind: 'markdown' }, content)

    expect(state.isSheet).toBe(expectedIsSheet)
    expect(state.showEditor).toBe(true)
  })

  it('does not let text file classification override sheet display frontmatter', () => {
    const textState = deriveState({
      entry: {
        ...baseEntry,
        isA: 'Note',
        fileKind: 'text',
      },
      content: '---\ntype: Note\n_display: sheet\n---\nMetric,January',
    })

    expect(textState.isSheet).toBe(true)
    expect(textState.effectiveRawMode).toBe(false)
  })

  it('does not treat binary files as sheet nodes even if display metadata matches', () => {
    const binaryState = deriveState({
      entry: {
        ...baseEntry,
        isA: 'Note',
        fileKind: 'binary',
      },
      content: '---\n_display: sheet\n---\nMetric,January',
    })

    expect(binaryState.isSheet).toBe(false)
  })
})
