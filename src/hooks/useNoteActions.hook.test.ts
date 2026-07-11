import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { RAPID_CREATE_NOTE_SETTLE_MS } from './useNoteCreation'
import { useNoteActions } from './useNoteActions'
import type { NoteActionsConfig } from './useNoteActions'
import { GITIGNORED_VISIBILITY_APPLIED_EVENT } from '../lib/gitignoredVisibilityEvents'
import { clearNoteContentCache, getCachedNoteContentEntry } from './noteContentCache'
import { updateMockFrontmatter } from './mockFrontmatterHelpers'

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

const makeWorkspace = (
  path: string,
  alias: string,
): NonNullable<VaultEntry['workspace']> => ({
  id: alias,
  label: alias,
  alias,
  path,
  shortLabel: alias.slice(0, 2).toUpperCase(),
  color: null,
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: false,
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
    vi.mocked(invoke).mockReset()
    vi.mocked(isTauri).mockReturnValue(false)
    clearNoteContentCache()
    vi.useRealTimers()
  })

  function renderActions(entries: VaultEntry[] = []) {
    return renderHook(() => useNoteActions(makeConfig(entries)))
  }

  async function flushAsyncWork() {
    await Promise.resolve()
    await Promise.resolve()
  }

  function savedNoteContentPaths() {
    return vi.mocked(mockInvoke).mock.calls.flatMap(([cmd, args]) => {
      if (cmd !== 'save_note_content') return []
      if (hasStringPath(args)) return [args.path]
      return []
    })
  }

  function hasStringPath(value: unknown): value is { path: string } {
    if (typeof value !== 'object') return false
    if (value === null) return false
    if (!('path' in value)) return false
    return typeof value.path === 'string'
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
  ])('$name creates the expected entry', async ({ run, expectedTitle, expectedType, expectedPathFragment }) => {
    const { result } = renderActions()

    await act(async () => {
      await run(result)
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

  it('keeps the active tab open when gitignored visibility reports a /tmp alias', async () => {
    const activeEntry = makeEntry({
      path: '/private/tmp/tolaria-vault/active.md',
      filename: 'active.md',
      title: 'Active',
    })
    const { result } = renderActions([activeEntry])

    await act(async () => {
      await result.current.handleSelectNote(activeEntry)
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(GITIGNORED_VISIBILITY_APPLIED_EVENT, {
        detail: {
          hide: true,
          visiblePaths: ['/tmp/tolaria-vault/active.md'],
        },
      }))
    })

    expect(result.current.activeTabPath).toBe('/private/tmp/tolaria-vault/active.md')
    expect(result.current.tabs).toHaveLength(1)
  })

  it('handleUpdateFrontmatter calls updateEntry with mapped patch', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Done' })
    expect(setToastMessage).toHaveBeenCalledWith('Property updated')
  })

  it('marks Tauri frontmatter writes as internal before invoking the command', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const order: string[] = []
    const onInternalVaultWrite = vi.fn((path: string) => {
      order.push(`mark:${path}`)
    })
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(`invoke:${String(command)}`)
      return '---\nstatus: Done\n---\nBody'
    })

    const { result } = renderHook(() => useNoteActions({
      ...makeConfig(),
      onInternalVaultWrite,
    }))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(onInternalVaultWrite).toHaveBeenCalledWith('/vault/note.md')
    expect(order).toEqual(['mark:/vault/note.md', 'invoke:update_frontmatter'])
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

  it('records successful frontmatter updates for undo and redo', async () => {
    const entry = makeEntry({ path: '/vault/note.md', status: 'Active' })
    const { result } = renderHook(() => useNoteActions(makeConfig([entry])))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.undoLabel).toBe('Update status')

    await act(async () => {
      await result.current.handleUndo()
    })
    await act(async () => {
      await result.current.handleRedo()
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Done' })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Active' })
    expect(updateEntry).toHaveBeenLastCalledWith('/vault/note.md', { status: 'Done' })
  })

  it('does not record silent or failed frontmatter updates', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const entry = makeEntry({ path: '/vault/note.md', status: 'Active' })
    const { result } = renderHook(() => useNoteActions(makeConfig([entry])))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done', { silent: true })
    })
    expect(result.current.canUndo).toBe(false)

    vi.mocked(updateMockFrontmatter).mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Blocked')
    })

    expect(result.current.canUndo).toBe(false)
    errorSpy.mockRestore()
  })

  it('handleDeleteProperty calls updateEntry with null/default values', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleDeleteProperty('/vault/note.md', 'status')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: null })
    expect(setToastMessage).toHaveBeenCalledWith('Property deleted')
  })

  it('ignores guarded inspector property deletes after the active note changes', async () => {
    const noteA = makeEntry({ path: '/vault/note-a.md', filename: 'note-a.md', title: 'Note A' })
    const noteB = makeEntry({ path: '/vault/note-b.md', filename: 'note-b.md', title: 'Note B' })
    const { result } = renderHook(() => useNoteActions(makeConfig([noteA, noteB])))

    act(() => {
      result.current.handleSwitchTab(noteB.path)
    })
    await act(async () => {
      await result.current.handleDeleteProperty(noteA.path, 'status', { requireActivePath: noteA.path })
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('keeps property-only frontmatter writes in the note cache after a note switch wins the apply guard', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const noteA = makeEntry({ path: '/vault/note-a.md', filename: 'note-a.md', title: 'Note A' })
    const noteB = makeEntry({ path: '/vault/note-b.md', filename: 'note-b.md', title: 'Note B' })
    const updatedContent = '---\nStatus: Done\n---\nBody'
    let resolveFrontmatterWrite: ((content: string) => void) | null = null
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => {
      resolveFrontmatterWrite = (content) => { resolve(content) }
    }))

    const { result } = renderHook(() => useNoteActions(makeConfig([noteA, noteB])))
    act(() => {
      result.current.handleSwitchTab(noteA.path)
    })

    let updatePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      updatePromise = result.current.handleUpdateFrontmatter(
        noteA.path,
        'Status',
        'Done',
        { requireActivePath: noteA.path },
      )
      await Promise.resolve()
    })
    act(() => {
      result.current.handleSwitchTab(noteB.path)
    })
    await act(async () => {
      resolveFrontmatterWrite?.(updatedContent)
      await updatePromise
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
    expect(getCachedNoteContentEntry(noteA.path)?.value).toBe(updatedContent)
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
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushAsyncWork()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
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

  it('handleCreateNote leaves Project body empty without an explicit type template', () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    act(() => {
      result.current.handleCreateNote('My Project', 'Project')
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toBe('---\ntitle: My Project\ntype: Project\n---\n')
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
        vaultPath: '/test/vault',
      })
      expect(addPendingSave).toHaveBeenCalledWith(createdPath)
      expect(removePendingSave).toHaveBeenCalledWith(createdPath)
      expect(onNewNotePersisted).toHaveBeenCalledOnce()
      expect(onNewNotePersisted).toHaveBeenCalledWith(createdPath)
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
      expect(onNewNotePersisted).toHaveBeenCalledWith(expect.stringContaining('persist-callback.md'))
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
        vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
        await flushAsyncWork()
      })
      await act(async () => {
        vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
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
    it('does not sync title or reload entry when reopening an identity-matched cached note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      const entry = makeEntry({ path: '/test/vault/qa-test.md', filename: 'qa-test.md', title: 'Qa Test' })
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === 'validate_note_content') return true
        if (command === 'get_note_content') return '# Qa Test\n'
        return null
      })

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

    it('exposes the workspace move handler from composed note actions', async () => {
      const sourceWorkspace = makeWorkspace('/test/vault', 'personal')
      const destinationWorkspace = makeWorkspace('/team/vault', 'team')
      const entry = makeEntry({
        path: '/test/vault/project.md',
        filename: 'project.md',
        title: 'Project',
        workspace: sourceWorkspace,
      })
      const replaceEntry = vi.fn()
      const config = makeConfig([entry])

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'move_note_to_workspace') {
          return { new_path: '/team/vault/project.md', updated_files: 0, failed_updates: 0 }
        }
        if (cmd === 'get_note_content') return '# Project\n'
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleMoveNoteToWorkspace(
          '/test/vault/project.md',
          destinationWorkspace,
          '/test/vault',
          replaceEntry,
        )
      })

      expect(mockInvoke).toHaveBeenCalledWith('move_note_to_workspace', expect.objectContaining({
        source_vault_path: '/test/vault',
        destination_vault_path: '/team/vault',
        old_path: '/test/vault/project.md',
      }))
      expect(replaceEntry).toHaveBeenCalledWith(
        '/test/vault/project.md',
        expect.objectContaining({ path: '/team/vault/project.md', workspace: destinationWorkspace }),
        '# Project\n',
      )
    })

    it('routes stale frontmatter saves to a note moved between workspaces', async () => {
      const sourcePath = '/test/vault/project.md'
      const destinationPath = '/team/vault/project.md'
      const sourceWorkspace = makeWorkspace('/test/vault', 'personal')
      const destinationWorkspace = makeWorkspace('/team/vault', 'team')
      const entry = makeEntry({
        path: sourcePath,
        filename: 'project.md',
        title: 'Project',
        workspace: sourceWorkspace,
      })
      const replaceEntry = vi.fn()
      const onPathRenamed = vi.fn()
      const config = makeConfig([entry])
      config.onPathRenamed = onPathRenamed

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'move_note_to_workspace') {
          return { new_path: destinationPath, updated_files: 0, failed_updates: 0 }
        }
        if (cmd === 'get_note_content') return '# Project\n'
        if (cmd === 'save_note_content') return undefined
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => {
        await result.current.handleMoveNoteToWorkspace(
          sourcePath,
          destinationWorkspace,
          sourceWorkspace.path,
          replaceEntry,
        )
        await result.current.handleUpdateFrontmatter(sourcePath, 'status', 'Done')
      })

      const savePaths = savedNoteContentPaths()

      expect(onPathRenamed).toHaveBeenCalledWith(sourcePath, destinationPath)
      expect(savePaths).toContain(destinationPath)
      expect(savePaths).not.toContain(sourcePath)
      expect(updateEntry).toHaveBeenCalledWith(destinationPath, expect.objectContaining({ status: 'Done' }))
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

    it('routes undoable frontmatter changes to the renamed note path', async () => {
      const oldPath = '/test/vault/old-name.md'
      const newPath = '/test/vault/new-name.md'
      const entry = makeEntry({
        path: oldPath,
        filename: 'old-name.md',
        title: 'Old Name',
        status: 'Active',
      })
      const config = makeConfig([entry])
      config.onPathRenamed = vi.fn()
      config.replaceEntry = vi.fn()

      vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'rename_note') return { new_path: newPath, updated_files: 1 }
        if (cmd === 'get_note_content') return '---\ntitle: New Name\nstatus: Done\n---\n# New Name\n'
        if (cmd === 'save_note_content') return undefined
        return ''
      })

      const { result } = renderHook(() => useNoteActions(config))

      await act(async () => { result.current.handleSelectNote(entry) })
      await act(async () => {
        await result.current.handleUpdateFrontmatter(oldPath, 'status', 'Done')
      })
      await act(async () => {
        await result.current.handleRenameNote(oldPath, 'New Name', '/test/vault', config.replaceEntry!)
      })
      vi.mocked(mockInvoke).mockClear()

      await act(async () => {
        await result.current.handleUndo()
      })

      const savePathsAfterUndo = savedNoteContentPaths()

      expect(savePathsAfterUndo).toContain(newPath)
      expect(savePathsAfterUndo).not.toContain(oldPath)
      expect(updateEntry).toHaveBeenCalledWith(newPath, expect.objectContaining({ status: 'Active' }))

      vi.mocked(mockInvoke).mockClear()
      vi.mocked(updateEntry).mockClear()

      await act(async () => {
        await result.current.handleRedo()
      })

      const savePathsAfterRedo = savedNoteContentPaths()

      expect(savePathsAfterRedo).toContain(newPath)
      expect(savePathsAfterRedo).not.toContain(oldPath)
      expect(updateEntry).toHaveBeenCalledWith(newPath, expect.objectContaining({ status: 'Done' }))
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
