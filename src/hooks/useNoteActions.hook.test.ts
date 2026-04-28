import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { RAPID_CREATE_NOTE_SETTLE_MS } from './useNoteCreation'
import { useNoteActions } from './useNoteActions'
import type { NoteActionsConfig } from './useNoteActions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))
vi.mock('./mockFrontmatterHelpers', () => ({
  updateMockFrontmatter: vi.fn().mockReturnValue('---\nupdated: true\n---\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/Users/luca/Laputa/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
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
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
  ...overrides,
})

describe('useNoteActions hook', () => {
  const addEntry = vi.fn()
  const removeEntry = vi.fn()
  const updateEntry = vi.fn()
  const setToastMessage = vi.fn()

  const makeConfig = (entries: VaultEntry[] = []): NoteActionsConfig => ({
    addEntry, removeEntry, entries, setToastMessage, updateEntry, vaultPath: '/test/vault',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.useRealTimers()
  })

  function renderActions(entries: VaultEntry[] = []) {
    return renderHook(() => useNoteActions(makeConfig(entries)))
  }

  async function flushAsyncWork() {
    await Promise.resolve()
    await Promise.resolve()
  }

  async function createImmediateEntry(type?: string) {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderActions()
    await act(async () => {
      result.current.handleCreateNoteImmediate(type)
      await flushAsyncWork()
    })
    const [createdEntry] = addEntry.mock.calls[0]
    vi.restoreAllMocks()
    return createdEntry as VaultEntry
  }

  it.each([
    {
      name: 'handleCreateNote',
      run: (result: ReturnType<typeof renderActions>['result']) => result.current.handleCreateNote('Test Note', 'Note'),
      expectedTitle: 'Test Note',
      expectedType: 'Note',
      expectedPathFragment: 'test-note.md',
    },
    {
      name: 'handleCreateType',
      run: (result: ReturnType<typeof renderActions>['result']) => result.current.handleCreateType('Recipe'),
      expectedTitle: 'Recipe',
      expectedType: 'Type',
      expectedPathFragment: 'recipe.md',
    },
  ])('$name creates the expected entry', ({ run, expectedTitle, expectedType, expectedPathFragment }) => {
    const { result } = renderActions()

    act(() => {
      run(result)
    })

    expect(addEntry).toHaveBeenCalledTimes(1)
    const [createdEntry] = addEntry.mock.calls[0]
    expect(createdEntry.title).toBe(expectedTitle)
    expect(createdEntry.isA).toBe(expectedType)
    expect(createdEntry.path).toContain(expectedPathFragment)
  })

  it('handleCreateNote opens tab immediately (before addEntry resolves)', () => {
    const callOrder: string[] = []
    const trackedAddEntry = vi.fn(() => { callOrder.push('addEntry') })
    const config = makeConfig()
    config.addEntry = trackedAddEntry

    const { result } = renderHook(() => useNoteActions(config))

    act(() => {
      result.current.handleCreateNote('Fast Note', 'Note')
    })

    // Tab should be open with the new note
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0].entry.title).toBe('Fast Note')
    expect(result.current.activeTabPath).toContain('fast-note.md')
  })

  it('handleNavigateWikilink finds entry by title', async () => {
    const target = makeEntry({ title: 'Target Note', path: '/vault/target.md' })

    const { result } = renderHook(() => useNoteActions(makeConfig([target])))

    await act(async () => {
      result.current.handleNavigateWikilink('Target Note')
    })

    expect(result.current.activeTabPath).toBe('/vault/target.md')
  })

  it('handleNavigateWikilink warns when target not found', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useNoteActions(makeConfig()))

    act(() => {
      result.current.handleNavigateWikilink('Nonexistent')
    })

    expect(warnSpy).toHaveBeenCalledWith('Navigation target not found: Nonexistent')
    warnSpy.mockRestore()
  })

  it('handleUpdateFrontmatter calls updateEntry with mapped patch', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Done' })
    expect(setToastMessage).toHaveBeenCalledWith('Property updated')
  })

  it('handleUpdateFrontmatter syncs is_a and color changes to entries', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'is_a', 'Project')
    })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { isA: 'Project' })

    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'color', 'blue')
    })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { color: 'blue' })
  })

  it('handleDeleteProperty calls updateEntry with null/default values', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleDeleteProperty('/vault/note.md', 'status')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: null })
    expect(setToastMessage).toHaveBeenCalledWith('Property deleted')
  })

  it('handleCreateNoteImmediate creates note with timestamp-based title', async () => {
    const createdEntry = await createImmediateEntry()
    expect(createdEntry.title).toBe('Untitled Note 1700000000')
    expect(createdEntry.filename).toBe('untitled-note-1700000000.md')
    expect(createdEntry.isA).toBe('Note')
  })

  it('handleCreateNoteImmediate generates unique names on rapid calls via timestamp', async () => {
    vi.useFakeTimers()
    let ts = 1700000000000
    vi.spyOn(Date, 'now').mockImplementation(() => { ts += 1000; return ts })
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      await flushAsyncWork()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS * 2)
      await flushAsyncWork()
    })

    expect(addEntry).toHaveBeenCalledTimes(3)
    const filenames = addEntry.mock.calls.map(([e]: [VaultEntry]) => e.filename)
    // Each call consumes Date.now() multiple times, so just verify uniqueness and pattern
    expect(new Set(filenames).size).toBe(3)
    for (const fn of filenames) {
      expect(fn).toMatch(/^untitled-note-\d+\.md$/)
    }
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate accepts custom type', async () => {
    const createdEntry = await createImmediateEntry('Project')
    expect(createdEntry.filename).toMatch(/^untitled-project-\d+\.md$/)
    expect(createdEntry.isA).toBe('Project')
  })

  it('handleCreateNote uses default template for Project type', () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    act(() => {
      result.current.handleCreateNote('My Project', 'Project')
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toContain('## Objective')
    expect(tabContent).toContain('## Key Results')
  })

  it('handleCreateNote uses custom template from type entry', () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Recipe', template: '## Ingredients\n\n## Steps\n\n' })
    const { result } = renderHook(() => useNoteActions(makeConfig([typeEntry])))

    act(() => {
      result.current.handleCreateNote('Pasta', 'Recipe')
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toContain('## Ingredients')
    expect(tabContent).toContain('## Steps')
  })

  it.each([
    ['Q&A', (entry: VaultEntry) => { expect(entry.isA).toBe('Q&A') }],
    ['+++', (entry: VaultEntry) => { expect(entry.filename).not.toBe('.md') }],
  ])('handleCreateNoteImmediate handles custom type "%s"', async (typeName, assertEntry) => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      expect(() => { result.current.handleCreateNoteImmediate(typeName) }).not.toThrow()
      await flushAsyncWork()
    })

    const [entry] = addEntry.mock.calls[0]
    expect(entry.path).not.toContain('//')
    assertEntry(entry)
  })

  it('handleCreateNoteImmediate uses template for typed notes', async () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Project', template: '## Custom Template\n\n' })
    const { result } = renderHook(() => useNoteActions(makeConfig([typeEntry])))

    await act(async () => {
      result.current.handleCreateNoteImmediate('Project')
      await flushAsyncWork()
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toContain('## Custom Template')
  })

  it('handleUpdateFrontmatter does not call updateEntry for unknown keys', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'custom_field', 'value')
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('Property updated')
  })

  describe('pending save lifecycle', () => {
    it.each([
      ['start', 'Pending Test', 'pending-test.md', 'addPendingSave'],
      ['completion', 'Persist OK', 'persist-ok.md', 'removePendingSave'],
    ])('createAndPersist calls pending-save callback on %s (non-Tauri)', async (
      _phase,
      title,
      pathFragment,
      callbackName,
    ) => {
      const addPendingSave = vi.fn()
      const removePendingSave = vi.fn()
      const config = makeConfig()
      config.addPendingSave = addPendingSave
      config.removePendingSave = removePendingSave

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        result.current.handleCreateNote(title, 'Note')
        await flushAsyncWork()
      })

      const callback = callbackName === 'addPendingSave' ? addPendingSave : removePendingSave
      expect(callback).toHaveBeenCalledWith(expect.stringContaining(pathFragment))
    })

    it('createAndPersist calls removePendingSave AND reverts when persist fails (Tauri)', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
      const addPendingSave = vi.fn()
      const removePendingSave = vi.fn()
      const config = makeConfig()
      config.addPendingSave = addPendingSave
      config.removePendingSave = removePendingSave

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        result.current.handleCreateNote('Fail Save', 'Note')
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(addPendingSave).toHaveBeenCalledWith(expect.stringContaining('fail-save.md'))
      expect(removePendingSave).toHaveBeenCalledWith(expect.stringContaining('fail-save.md'))
      expect(removeEntry).toHaveBeenCalledWith(expect.stringContaining('fail-save.md'))
      expect(setToastMessage).toHaveBeenCalledWith('Failed to create note — disk write error')
    })

    it('handleCreateNoteImmediate creates the backing file before opening the note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValueOnce(undefined)
      const addPendingSave = vi.fn()
      const removePendingSave = vi.fn()
      const onNewNotePersisted = vi.fn()
      const config = makeConfig()
      config.addPendingSave = addPendingSave
      config.removePendingSave = removePendingSave
      config.onNewNotePersisted = onNewNotePersisted

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        result.current.handleCreateNoteImmediate()
        await flushAsyncWork()
      })

      const createdPath = expect.stringMatching(/untitled-note-\d+\.md$/)
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_note_content', {
        path: createdPath,
        content: expect.stringContaining('type: Note'),
      })
      expect(addPendingSave).toHaveBeenCalledWith(createdPath)
      expect(removePendingSave).toHaveBeenCalledWith(createdPath)
      expect(onNewNotePersisted).toHaveBeenCalledOnce()
      expect(addEntry).toHaveBeenCalledTimes(1)
      expect(result.current.tabs[0].entry.path).toMatch(/untitled-note-\d+\.md$/)
    })

    it('calls onNewNotePersisted after successful disk write (non-Tauri)', async () => {
      const onNewNotePersisted = vi.fn()
      const config = makeConfig()
      config.onNewNotePersisted = onNewNotePersisted

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        result.current.handleCreateNote('Persist Callback', 'Note')
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(onNewNotePersisted).toHaveBeenCalledTimes(1)
    })

    it('does not call onNewNotePersisted when disk write fails (Tauri)', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
      const onNewNotePersisted = vi.fn()
      const config = makeConfig()
      config.onNewNotePersisted = onNewNotePersisted

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        result.current.handleCreateNote('Fail Persist', 'Note')
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(onNewNotePersisted).not.toHaveBeenCalled()
    })
  })

  describe('optimistic error recovery (Tauri mode)', () => {
    beforeEach(() => {
      vi.mocked(isTauri).mockReturnValue(true)
    })

    it.each([
      ['handleCreateNote', 'Failing Note', 'Note', 'failing-note.md'],
      ['handleCreateType', 'Recipe', 'Type', 'recipe.md'],
    ])('reverts optimistic creation via %s when disk write fails', async (method, title, type, pathFragment) => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'))
      const { result } = renderHook(() => useNoteActions(makeConfig()))

      await act(async () => {
        if (method === 'handleCreateNote') result.current.handleCreateNote(title, type)
        else result.current.handleCreateType(title)
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(addEntry).toHaveBeenCalledTimes(1)
      expect(removeEntry).toHaveBeenCalledWith(expect.stringContaining(pathFragment))
      expect(setToastMessage).toHaveBeenCalledWith(
        type === 'Type'
          ? 'Failed to create type — disk write error'
          : 'Failed to create note — disk write error',
      )
    })

    it('does not revert when disk write succeeds', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useNoteActions(makeConfig()))

      await act(async () => {
        result.current.handleCreateNote('Good Note', 'Note')
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(removeEntry).not.toHaveBeenCalled()
      expect(setToastMessage).not.toHaveBeenCalled()
    })

    it('handleCreateNoteImmediate writes each rapid note before opening it', async () => {
      vi.useFakeTimers()
      vi.mocked(invoke).mockResolvedValue(undefined)
      const { result } = renderHook(() => useNoteActions(makeConfig()))

      await act(async () => {
        result.current.handleCreateNoteImmediate()
        result.current.handleCreateNoteImmediate()
        result.current.handleCreateNoteImmediate()
        await flushAsyncWork()
      })
      await act(async () => {
        vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS * 2)
        await flushAsyncWork()
      })

      expect(addEntry).toHaveBeenCalledTimes(3)
      expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'create_note_content')).toHaveLength(3)
      expect(removeEntry).not.toHaveBeenCalled()
    })

  })

  describe('type change does not move file', () => {
    it('changing type only updates frontmatter, does not move file', async () => {
      const entry = makeEntry({ path: '/test/vault/my-note.md', filename: 'my-note.md', title: 'My Note', isA: 'Note' })
      const config = makeConfig([entry])
      vi.mocked(mockInvoke).mockResolvedValue('')

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleUpdateFrontmatter('/test/vault/my-note.md', 'type', 'Quarter')
      })

      expect(setToastMessage).toHaveBeenCalledWith('Property updated')
    })
  })

  describe('note open is read-only', () => {
    it('does not sync title or reload entry when opening or reopening a note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      const entry = makeEntry({ path: '/test/vault/qa-test.md', filename: 'qa-test.md', title: 'Qa Test' })
      vi.mocked(invoke).mockResolvedValueOnce('# Qa Test\n')

      const { result } = renderHook(() => useNoteActions(makeConfig([entry])))

      await act(async () => { await result.current.handleSelectNote(entry) })
      const callCountAfterFirstOpen = vi.mocked(invoke).mock.calls.length

      const desyncedEntry = { ...entry, title: 'Wrong Title Desynced' }
      await act(async () => { await result.current.handleSelectNote(desyncedEntry) })

      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(callCountAfterFirstOpen)
      expect(vi.mocked(invoke).mock.calls).toEqual([
        ['get_note_content', { path: '/test/vault/qa-test.md' }],
      ])
      expect(result.current.tabs[0].entry.title).toBe('Qa Test')
    })
  })

  describe('rename note updates wikilinks', () => {
    it('handleRenameNote passes entry title as old_title to rename_note', async () => {
      const entry = makeEntry({
        path: '/test/vault/weekly-review.md',
        filename: 'weekly-review.md',
        title: 'Weekly Review',
      })
      const replaceEntry = vi.fn()
      const config = makeConfig([entry])
      config.replaceEntry = replaceEntry

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'rename_note') return { new_path: '/test/vault/sprint-retro.md', updated_files: 2 }
        if (cmd === 'get_note_content') return '---\nIs A: Note\n---\n# Sprint Retro\n'
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleRenameNote(
          '/test/vault/weekly-review.md',
          'Sprint Retro',
          '/test/vault',
          replaceEntry,
        )
      })

      expect(mockInvoke).toHaveBeenCalledWith('rename_note', expect.objectContaining({
        vault_path: '/test/vault',
        old_path: '/test/vault/weekly-review.md',
        new_title: 'Sprint Retro',
        old_title: 'Weekly Review',
      }))
      expect(setToastMessage).toHaveBeenCalledWith('Updated 2 notes')
    })

    it('handleRenameNote passes null old_title when entry not found', async () => {
      const config = makeConfig([])

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'rename_note') return { new_path: '/test/vault/new.md', updated_files: 0 }
        if (cmd === 'get_note_content') return '# New\n'
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleRenameNote(
          '/test/vault/old.md', 'New', '/test/vault', vi.fn(),
        )
      })

      expect(mockInvoke).toHaveBeenCalledWith('rename_note', expect.objectContaining({
        old_title: null,
      }))
    })

    it('handleUpdateFrontmatter triggers rename when title key is changed', async () => {
      const entry = makeEntry({
        path: '/test/vault/old-name.md',
        filename: 'old-name.md',
        title: 'Old Name',
      })
      const onPathRenamed = vi.fn()
      const replaceEntry = vi.fn()
      const config = makeConfig([entry])
      config.onPathRenamed = onPathRenamed
      config.replaceEntry = replaceEntry

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'rename_note') return { new_path: '/test/vault/new-name.md', updated_files: 1 }
        if (cmd === 'get_note_content') return '---\ntitle: New Name\n---\n# New Name\n'
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      // Open a tab for the entry so the rename can find it via tabsRef
      await act(async () => { result.current.handleSelectNote(entry) })

      await act(async () => {
        await result.current.handleUpdateFrontmatter('/test/vault/old-name.md', 'title', 'New Name')
      })

      expect(mockInvoke).toHaveBeenCalledWith('rename_note', expect.objectContaining({
        old_path: '/test/vault/old-name.md',
        new_title: 'New Name',
        old_title: 'Old Name',
      }))
      expect(replaceEntry).toHaveBeenCalledWith(
        '/test/vault/old-name.md',
        expect.objectContaining({ path: '/test/vault/new-name.md', title: 'New Name' }),
      )
      expect(onPathRenamed).toHaveBeenCalledWith('/test/vault/old-name.md', '/test/vault/new-name.md')
    })

    it('handleUpdateFrontmatter does not trigger rename for non-title keys', async () => {
      const config = makeConfig()
      vi.mocked(mockInvoke).mockResolvedValue('')

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
      })

      expect(mockInvoke).not.toHaveBeenCalledWith('rename_note', expect.anything())
    })
  })
})
