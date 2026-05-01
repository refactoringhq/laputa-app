import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  slugify,
  buildNewEntry,
  generateUntitledName,
  entryMatchesTarget,
  buildNoteContent,
  resolveNewNote,
  resolveNewType,
  resolveTemplate,
  DEFAULT_TEMPLATES,
  RAPID_CREATE_NOTE_SETTLE_MS,
  useNoteCreation,
} from './useNoteCreation'
import type { NoteCreationConfig } from './useNoteCreation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/test.md', filename: 'test.md', title: 'Test Note', isA: 'Note',
  aliases: [], belongsTo: [], relatedTo: [], status: 'Active', archived: false,
  modifiedAt: 1700000000, createdAt: 1700000000, fileSize: 100, snippet: '',
  wordCount: 0, relationships: {}, icon: null, color: null, order: null,
  outgoingLinks: [], template: null, sort: null, sidebarLabel: null,
  view: null, visible: null, properties: {}, organized: false, favorite: false,
  favoriteIndex: null, listPropertiesDisplay: [], hasH1: false,
  ...overrides,
})

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('preserves unicode letters when building filenames', () => {
    expect(slugify('停智慧')).toBe('停智慧')
  })

  it('removes special characters', () => {
    expect(slugify('My Project! @#$%')).toBe('my-project')
  })

  it('handles empty string with fallback', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('returns fallback for strings with only special characters', () => {
    expect(slugify('+++')).not.toBe('')
    expect(slugify('---')).not.toBe('')
  })
})

describe('buildNewEntry', () => {
  it('creates a VaultEntry with correct fields', () => {
    const entry = buildNewEntry({ path: '/vault/my-note.md', slug: 'my-note', title: 'My Note', type: 'Note', status: 'Active' })
    expect(entry.path).toBe('/vault/my-note.md')
    expect(entry.filename).toBe('my-note.md')
    expect(entry.title).toBe('My Note')
    expect(entry.isA).toBe('Note')
    expect(entry.status).toBe('Active')
    expect(entry.archived).toBe(false)
  })

  it('sets null status when provided', () => {
    const entry = buildNewEntry({ path: '/vault/ai.md', slug: 'ai', title: 'AI', type: 'Topic', status: null })
    expect(entry.status).toBeNull()
  })
})

describe('generateUntitledName', () => {
  it('returns base name when no conflicts', () => {
    expect(generateUntitledName({ entries: [], type: 'Note' })).toBe('Untitled note')
  })

  it('appends counter when base name exists', () => {
    expect(generateUntitledName({ entries: [makeEntry({ title: 'Untitled note' })], type: 'Note' })).toBe('Untitled note 2')
  })

  it('increments counter past existing numbered entries', () => {
    const entries = [
      makeEntry({ title: 'Untitled note' }),
      makeEntry({ title: 'Untitled note 2' }),
      makeEntry({ title: 'Untitled note 3' }),
    ]
    expect(generateUntitledName({ entries, type: 'Note' })).toBe('Untitled note 4')
  })

  it('avoids names in the pending set', () => {
    expect(generateUntitledName({ entries: [], type: 'Note', pendingTitles: new Set(['Untitled note']) })).toBe('Untitled note 2')
  })
})

describe('entryMatchesTarget', () => {
  it('matches by exact title (case-insensitive)', () => {
    expect(entryMatchesTarget({ entry: makeEntry({ title: 'My Project' }), target: 'my project' })).toBe(true)
  })

  it('matches by alias', () => {
    expect(entryMatchesTarget({ entry: makeEntry({ aliases: ['MP'] }), target: 'mp' })).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(entryMatchesTarget({ entry: makeEntry({ title: 'Something' }), target: 'nonexistent' })).toBe(false)
  })
})

describe('buildNoteContent', () => {
  it('generates frontmatter with title and status', () => {
    expect(buildNoteContent({ title: 'My Note', type: 'Note', status: 'Active' })).toBe('---\ntitle: My Note\ntype: Note\nstatus: Active\n---\n')
  })

  it('omits title when null', () => {
    expect(buildNoteContent({ title: null, type: 'Note', status: 'Active' })).toBe('---\ntype: Note\nstatus: Active\n---\n')
  })

  it('omits status when null', () => {
    expect(buildNoteContent({ title: 'AI', type: 'Topic', status: null })).toBe('---\ntitle: AI\ntype: Topic\n---\n')
  })

  it('includes template body when provided', () => {
    const content = buildNoteContent({ title: 'P', type: 'Project', status: 'Active', template: '## Objective\n\n' })
    expect(content).toContain('## Objective')
  })

  it('prepends an empty H1 when requested for untitled-note flows', () => {
    expect(buildNoteContent({ title: null, type: 'Note', status: 'Active', initialEmptyHeading: true })).toBe('---\ntype: Note\nstatus: Active\n---\n\n# \n\n')
  })

  it('keeps the empty H1 before any template content', () => {
    const content = buildNoteContent({
      title: null,
      type: 'Project',
      status: 'Active',
      template: '## Objective\n\n',
      initialEmptyHeading: true,
    })
    expect(content).toBe('---\ntype: Project\nstatus: Active\n---\n\n# \n\n## Objective\n\n')
  })
})

describe('resolveNewNote', () => {
  it('creates note at vault root', () => {
    const { entry, content } = resolveNewNote({ title: 'My Project', type: 'Project', vaultPath: '/vault' })
    expect(entry.path).toBe('/vault/my-project.md')
    expect(entry.isA).toBe('Project')
    expect(entry.status).toBeNull()
    expect(content).toContain('type: Project')
    expect(content).not.toContain('status:')
  })

  it('omits status for Topic type', () => {
    const { entry } = resolveNewNote({ title: 'ML', type: 'Topic', vaultPath: '/vault' })
    expect(entry.status).toBeNull()
  })

  it('does not add a default status for other regular types', () => {
    const { entry, content } = resolveNewNote({ title: 'Reflection', type: 'Journal', vaultPath: '/vault' })
    expect(entry.status).toBeNull()
    expect(content).not.toContain('status:')
  })
})

describe('resolveNewType', () => {
  it('creates a type entry at the vault root', () => {
    const { entry, content } = resolveNewType({ typeName: 'Recipe', vaultPath: '/vault' })
    expect(entry.path).toBe('/vault/recipe.md')
    expect(entry.isA).toBe('Type')
    expect(content).toContain('type: Type')
  })

  it('uses the unicode title when the type name has no ASCII characters', () => {
    const { entry } = resolveNewType({ typeName: '停智慧', vaultPath: '/vault' })
    expect(entry.path).toBe('/vault/停智慧.md')
    expect(entry.filename).toBe('停智慧.md')
  })
})

describe('resolveTemplate', () => {
  it('returns template from type entry when set', () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Recipe', template: '## Ingredients\n\n' })
    expect(resolveTemplate({ entries: [typeEntry], typeName: 'Recipe' })).toBe('## Ingredients\n\n')
  })

  it('falls back to DEFAULT_TEMPLATES', () => {
    expect(resolveTemplate({ entries: [], typeName: 'Project' })).toBe(DEFAULT_TEMPLATES.Project)
  })

  it('returns null when no template and no default', () => {
    expect(resolveTemplate({ entries: [], typeName: 'CustomType' })).toBeNull()
  })
})

describe('useNoteCreation hook', () => {
  const addEntry = vi.fn()
  const removeEntry = vi.fn()
  const setToastMessage = vi.fn()
  const openTabWithContent = vi.fn()
  const makeConfig = (entries: VaultEntry[] = []): NoteCreationConfig => ({
    addEntry, removeEntry, entries, setToastMessage, vaultPath: '/test/vault',
  })

  const tabDeps = { openTabWithContent }
  const flushImmediateCreate = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.useRealTimers()
  })

  it('handleCreateNote creates entry and opens tab', () => {
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    act(() => { result.current.handleCreateNote('Test Note', 'Note') })
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(openTabWithContent).toHaveBeenCalledTimes(1)
    const [createdEntry] = addEntry.mock.calls[0]
    expect(createdEntry.title).toBe('Test Note')
    expect(createdEntry.isA).toBe('Note')
    expect(createdEntry.status).toBeNull()
    expect(openTabWithContent.mock.calls[0][1]).toBe('---\ntitle: Test Note\ntype: Note\n---\n')
  })

  it('handleCreateNoteImmediate generates timestamp-based title', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    await act(async () => {
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(addEntry.mock.calls[0][0].title).toBe('Untitled Note 1700000000')
    expect(addEntry.mock.calls[0][0].filename).toBe('untitled-note-1700000000.md')
    expect(addEntry.mock.calls[0][0].status).toBeNull()
    expect(openTabWithContent.mock.calls[0][1]).toBe('---\ntype: Note\n---\n\n# \n\n')
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate generates unique names on rapid calls via timestamp', async () => {
    vi.useFakeTimers()
    let ts = 1700000000000
    vi.spyOn(Date, 'now').mockImplementation(() => { ts += 1000; return ts })
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    await act(async () => {
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS * 2)
      await flushImmediateCreate()
    })
    const filenames = addEntry.mock.calls.map(([e]: [VaultEntry]) => e.filename)
    // Each call consumes Date.now() multiple times (filename + buildNewEntry), so just verify uniqueness
    expect(new Set(filenames).size).toBe(3)
    for (const fn of filenames) {
      expect(fn).toMatch(/^untitled-note-\d+\.md$/)
    }
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate avoids filename collisions when called twice in the same second', async () => {
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushImmediateCreate()
    })

    const filenames = addEntry.mock.calls.map(([entry]: [VaultEntry]) => entry.filename)
    expect(filenames).toEqual([
      'untitled-note-1700000000.md',
      'untitled-note-1700000000-2.md',
    ])

    vi.restoreAllMocks()
  })

  it('serializes rapid immediate-create bursts after the first note', async () => {
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })

    expect(addEntry).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushImmediateCreate()
    })
    expect(addEntry).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushImmediateCreate()
    })
    expect(addEntry).toHaveBeenCalledTimes(3)

    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate accepts custom type', async () => {
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    await act(async () => {
      result.current.handleCreateNoteImmediate('Project')
      await flushImmediateCreate()
    })
    expect(addEntry.mock.calls[0][0].isA).toBe('Project')
    expect(addEntry.mock.calls[0][0].status).toBeNull()
    expect(openTabWithContent.mock.calls[0][1]).toBe('---\ntype: Project\n---\n\n# \n\n## Objective\n\n\n\n## Key Results\n\n\n\n## Notes\n\n')
  })

  it('handleCreateNoteImmediate persists typed notes under Windows verbatim vault roots', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const windowsVaultPath = String.raw`\\?\C:\Users\alex\Documents\Tolaria`
    const createdPath = String.raw`\\?\C:\Users\alex\Documents\Tolaria/untitled-project-1700000000.md`
    const { result } = renderHook(() => useNoteCreation({
      ...makeConfig(),
      vaultPath: windowsVaultPath,
    }, tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate('Project')
      await flushImmediateCreate()
    })

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
      path: createdPath,
      content: expect.stringContaining('type: Project'),
    })
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: createdPath,
      filename: 'untitled-project-1700000000.md',
      isA: 'Project',
    }))
    expect(setToastMessage).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate slugifies custom type names for filenames', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate('Q&A / Ops')
      await flushImmediateCreate()
    })

    expect(addEntry.mock.calls[0][0].filename).toBe('untitled-q-a-ops-1700000000.md')
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate creates the backing file before opening the note', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const addPendingSave = vi.fn()
    const removePendingSave = vi.fn()
    const onNewNotePersisted = vi.fn()
    const config = {
      ...makeConfig(),
      addPendingSave,
      removePendingSave,
      onNewNotePersisted,
    }
    const { result } = renderHook(() => useNoteCreation(config, tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })

    const createdPath = expect.stringMatching(/untitled-note-\d+\.md$/)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
      path: createdPath,
      content: expect.stringContaining('type: Note'),
    })
    expect(addPendingSave).toHaveBeenCalledWith(createdPath)
    expect(removePendingSave).toHaveBeenCalledWith(createdPath)
    expect(onNewNotePersisted).toHaveBeenCalledOnce()
    expect(onNewNotePersisted).toHaveBeenCalledWith(createdPath)
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(openTabWithContent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(invoke).mock.invocationCallOrder[0]).toBeLessThan(
      openTabWithContent.mock.invocationCallOrder[0],
    )
  })

  it('handleCreateNoteImmediate does not open an optimistic note when disk creation fails', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })

    expect(addEntry).not.toHaveBeenCalled()
    expect(openTabWithContent).not.toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('Failed to create note — disk write error')
  })

  it('handleCreateNoteImmediate requests editor focus for the new path', async () => {
    const focusListener = vi.fn()
    window.addEventListener('laputa:focus-editor', focusListener)
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      await flushImmediateCreate()
    })

    expect(focusListener).toHaveBeenCalledTimes(1)
    const event = focusListener.mock.calls[0][0] as CustomEvent
    expect(event.detail.path).toMatch(/\/test\/vault\/untitled-note-\d+\.md$/)
    expect(event.detail.selectTitle).toBe(true)

    window.removeEventListener('laputa:focus-editor', focusListener)
  })

  it('handleCreateType creates type entry', () => {
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    act(() => { result.current.handleCreateType('Recipe') })
    expect(addEntry.mock.calls[0][0].isA).toBe('Type')
    expect(addEntry.mock.calls[0][0].title).toBe('Recipe')
  })

  it('handleCreateType blocks when the target type file already exists', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('File already exists: /test/vault/briefing.md'))
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))

    let created = true
    await act(async () => {
      created = await result.current.handleCreateType('Briefing')
    })

    expect(created).toBe(false)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
      path: '/test/vault/briefing.md',
      content: expect.stringContaining('type: Type'),
    })
    expect(removeEntry).toHaveBeenCalledWith('/test/vault/briefing.md')
    expect(setToastMessage).toHaveBeenCalledWith('Cannot create type "Briefing" because briefing.md already exists')
  })

  it('handleCreateType lets disk creation decide when a stale entry collides with the target type path', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const staleEntry = makeEntry({
      path: '/test/vault/pttep.md',
      filename: 'pttep.md',
      title: 'Stale cache entry',
      isA: 'Note',
    })
    const { result } = renderHook(() => useNoteCreation(makeConfig([staleEntry]), tabDeps))

    let created = false
    await act(async () => {
      created = await result.current.handleCreateType('PTTEP')
    })

    expect(created).toBe(true)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
      path: '/test/vault/pttep.md',
      content: expect.stringContaining('type: Type'),
    })
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: '/test/vault/pttep.md',
      filename: 'pttep.md',
      title: 'PTTEP',
      isA: 'Type',
    }))
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('handleCreateType writes new type entries to the vault root even when older type entries live in a folder', async () => {
    const existingType = makeEntry({
      path: '/test/vault/types/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
    })
    const { result } = renderHook(() => useNoteCreation(makeConfig([existingType]), tabDeps))

    await act(async () => {
      await result.current.handleCreateType('Hotel')
    })

    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: '/test/vault/hotel.md',
      filename: 'hotel.md',
      title: 'Hotel',
      isA: 'Type',
    }))
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('handleCreateType ignores an existing untitled draft when a unicode filename is unique', async () => {
    const existing = makeEntry({ path: '/test/vault/untitled.md', filename: 'untitled.md', title: 'Untitled', isA: 'Note' })
    const { result } = renderHook(() => useNoteCreation(makeConfig([existing]), tabDeps))

    let created = false
    await act(async () => {
      created = await result.current.handleCreateType('停智慧')
    })

    expect(created).toBe(true)
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: '/test/vault/停智慧.md',
      filename: '停智慧.md',
      title: '停智慧',
      isA: 'Type',
    }))
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('createTypeEntrySilent persists without opening tab', async () => {
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    const entry = await act(async () => result.current.createTypeEntrySilent('Recipe'))
    expect(addEntry).toHaveBeenCalledTimes(1)
    expect(openTabWithContent).not.toHaveBeenCalled()
    expect(entry.isA).toBe('Type')
  })

  it('createTypeEntrySilent reuses an existing slug-equivalent type', async () => {
    const existing = makeEntry({ path: '/test/vault/briefing.md', filename: 'briefing.md', title: 'Briefing', isA: 'Type' })
    const { result } = renderHook(() => useNoteCreation(makeConfig([existing]), tabDeps))

    const entry = await act(async () => result.current.createTypeEntrySilent('briefing'))

    expect(entry).toBe(existing)
    expect(addEntry).not.toHaveBeenCalled()
    expect(openTabWithContent).not.toHaveBeenCalled()
  })

  it('handleCreateNoteForRelationship blocks when the generated filename already exists', async () => {
    const existing = makeEntry({ path: '/test/vault/briefing.md', filename: 'briefing.md', title: 'Existing Briefing', isA: 'Note' })
    const { result } = renderHook(() => useNoteCreation(makeConfig([existing]), tabDeps))

    let created = true
    await act(async () => {
      created = await result.current.handleCreateNoteForRelationship('Briefing')
    })

    expect(created).toBe(false)
    expect(addEntry).not.toHaveBeenCalled()
    expect(openTabWithContent).not.toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('Cannot create note "Briefing" because briefing.md already exists')
  })

  it('reverts optimistic creation when disk write fails (Tauri)', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useNoteCreation(makeConfig(), tabDeps))
    await act(async () => {
      result.current.handleCreateNote('Failing Note', 'Note')
      await new Promise(r => setTimeout(r, 0))
    })
    expect(removeEntry).toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('Failed to create note — disk write error')
  })

})
