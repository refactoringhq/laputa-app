import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from './useEditorSave'
import type { VaultEntry } from '../types'
import { isTauri } from '../mock-tauri'
import { invoke } from '@tauri-apps/api/core'

const { startTransitionMock } = vi.hoisted(() => ({
  startTransitionMock: vi.fn((callback: () => void) => callback()),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    startTransition: startTransitionMock,
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  updateMockContent: vi.fn(),
}))

function makeEntry(path: string, title = 'Test', filename = 'test.md'): VaultEntry {
  return { path, title, filename, content: '', outgoingLinks: [], snippet: '', wordCount: 0, isA: 'Note', status: null, createdAt: null, modifiedAt: null, icon: null, tags: [] } as unknown as VaultEntry
}

function makeWorkspace(path: string, alias = 'workspace'): NonNullable<VaultEntry['workspace']> {
  return {
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
  }
}

describe('useAppSave', () => {
  const deps = {
    updateEntry: vi.fn(),
    setTabs: vi.fn(),
    handleSwitchTab: vi.fn(),
    setToastMessage: vi.fn(),
    loadModifiedFiles: vi.fn(),
    onInternalVaultWrite: vi.fn(),
    trackUnsaved: vi.fn(),
    clearUnsaved: vi.fn(),
    unsavedPaths: new Set<string>(),
    tabs: [] as Array<{ entry: VaultEntry; content: string }>,
    activeTabPath: null as string | null,
    handleRenameNote: vi.fn().mockResolvedValue(undefined),
    handleRenameFilename: vi.fn().mockResolvedValue(undefined),
    replaceEntry: vi.fn(),
    resolvedPath: '/vault',
    initialH1AutoRenameEnabled: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.mocked(isTauri).mockReturnValue(false)
    deps.unsavedPaths = new Set()
    deps.tabs = []
    deps.activeTabPath = null
    deps.trackUnsaved.mockReset()
    deps.onInternalVaultWrite.mockReset()
    deps.handleRenameNote.mockResolvedValue(undefined)
    deps.handleRenameFilename.mockResolvedValue(undefined)
    deps.initialH1AutoRenameEnabled = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderSave(overrides = {}) {
    return renderHook(() => useAppSave({ ...deps, ...overrides }))
  }

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
  }

  function setupUntitledRenameHarness(options?: {
    initialContent?: string
    diskContent?: string
    autoRenameResult?: Promise<{ new_path: string; updated_files: number } | null> | { new_path: string; updated_files: number } | null
    render?: boolean
  }) {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/vault/untitled-note-123.md'
    const newPath = '/vault/fresh-title.md'
    const initialContent = options?.initialContent ?? '# Fresh Title\n\nBody'
    const diskContent = options?.diskContent ?? initialContent
    const entry = makeEntry(oldPath, 'Untitled Note 123', 'untitled-note-123.md')
    let tabsState = [{ entry, content: initialContent }]
    const setTabs = vi.fn((updater: SetStateAction<typeof tabsState>) => {
      tabsState = typeof updater === 'function' ? updater(tabsState) : updater
    })

    vi.mocked(invoke).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'save_note_content') return undefined
      if (command === 'auto_rename_untitled') return options?.autoRenameResult ?? { new_path: newPath, updated_files: 0 }
      if (command === 'reload_vault_entry') return makeEntry(newPath, 'Fresh Title', 'fresh-title.md')
      if (command === 'get_note_content' && args?.path === newPath) return diskContent
      return undefined
    })

    const rendered = options?.render === false
      ? {}
      : renderSave({
          setTabs,
          tabs: tabsState,
          activeTabPath: oldPath,
          unsavedPaths: new Set([oldPath]),
        })

    return {
      ...rendered,
      entry,
      oldPath,
      newPath,
      setTabs,
      getTabs: () => tabsState,
      setTabsState: (nextTabs: typeof tabsState) => { tabsState = nextTabs },
    }
  }

  function renderMissingVaultDraft(path = 'C:\\Users\\Luca\\Notes\\draft.md') {
    vi.mocked(isTauri).mockReturnValue(true)
    const entry = makeEntry(path, 'Draft', 'draft.md')

    return {
      path,
      ...renderSave({
        resolvedPath: '',
        tabs: [{ entry, content: '# Draft\n\nBody' }],
        activeTabPath: path,
        unsavedPaths: new Set([path]),
      }),
    }
  }

  function renderAutoSaveScopeDraft({
    initialVaultPath,
    notePath,
  }: {
    initialVaultPath: string
    notePath: string
  }) {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    const entry = makeEntry(notePath, 'Draft', 'draft.md')
    const tabs = [{ entry, content: '# Draft' }]

    return {
      entry,
      ...renderHook(
        ({ vaultPath }: { vaultPath: string }) => useAppSave({
          ...deps,
          resolvedPath: vaultPath,
          tabs,
          activeTabPath: entry.path,
          unsavedPaths: new Set([entry.path]),
        }),
        { initialProps: { vaultPath: initialVaultPath } },
      ),
    }
  }

  function expectNoSaveNoteContent() {
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('save_note_content', expect.anything())
    expect(deps.clearUnsaved).not.toHaveBeenCalled()
  }

  async function expectPendingAutosaveDroppedAfterVaultChange(
    hook: ReturnType<typeof renderAutoSaveScopeDraft>,
    nextVaultPath: string,
  ) {
    act(() => {
      hook.result.current.handleContentChange(hook.entry.path, '# Draft\n\nUnsaved')
    })

    hook.rerender({ vaultPath: nextVaultPath })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expectNoSaveNoteContent()
  }

  it('exposes contentChangeRef', () => {
    const { result } = renderSave()
    expect(result.current.contentChangeRef).toBeDefined()
    expect(typeof result.current.contentChangeRef.current).toBe('function')
  })

  it('exposes handleSave', () => {
    const { result } = renderSave()
    expect(typeof result.current.handleSave).toBe('function')
  })

  it('exposes handleTitleSync', () => {
    const { result } = renderSave()
    expect(typeof result.current.handleTitleSync).toBe('function')
  })

  it('exposes flushBeforeAction', () => {
    const { result } = renderSave()
    expect(typeof result.current.flushBeforeAction).toBe('function')
  })

  it('handleSave calls save with no fallback when no active tab', async () => {
    const { result } = renderSave()

    await act(async () => { await result.current.handleSave() })

    // Should not throw — just a no-op save
  })

  it('handleSave provides fallback for unsaved active tab', async () => {
    const entry = makeEntry('/vault/note.md', 'note', 'note.md')
    const unsavedPaths = new Set(['/vault/note.md'])
    const tabs = [{ entry, content: '# Hello' }]

    const { result } = renderSave({
      tabs,
      activeTabPath: '/vault/note.md',
      unsavedPaths,
    })

    await act(async () => { await result.current.handleSave() })

    // Should complete without error
  })

  it('handles Windows invalid path save failures without clearing unsaved content', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = 'C:\\Users\\@raflymln\\notes\\untitled-note-1777236475.md'
    const entry = makeEntry(path, 'Untitled Note 1777236475', 'untitled-note-1777236475.md')
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('The filename, directory name, or volume label syntax is incorrect. (os error 123)'),
    )

    const { result } = renderSave({
      resolvedPath: 'C:\\Users\\@raflymln\\notes',
      tabs: [{ entry, content: '# Draft\n\nBody' }],
      activeTabPath: path,
      unsavedPaths: new Set([path]),
    })

    let saved = true
    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(false)
    expect(deps.setToastMessage).toHaveBeenCalledWith(
      'Save failed: The note path is invalid on this platform. Rename the note or move it to a valid folder, then try again.',
    )
    expect(deps.clearUnsaved).not.toHaveBeenCalled()
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('auto_rename_untitled', expect.anything())
    consoleSpy.mockRestore()
  })

  it('pauses manual saves when a stale editor has no active vault', async () => {
    const { result } = renderMissingVaultDraft()

    let saved = true
    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(false)
    expect(deps.setToastMessage).toHaveBeenCalledWith('Select or restore a vault before saving.')
    expectNoSaveNoteContent()
  })

  it('pauses stale auto-save timers when the active vault disappears before debounce fires', async () => {
    await expectPendingAutosaveDroppedAfterVaultChange(
      renderAutoSaveScopeDraft({ initialVaultPath: '/vault', notePath: '/vault/draft.md' }),
      '',
    )
  })

  it('drops pending auto-save content when the active vault changes', async () => {
    await expectPendingAutosaveDroppedAfterVaultChange(
      renderAutoSaveScopeDraft({ initialVaultPath: '/old-vault', notePath: '/old-vault/draft.md' }),
      '/new-vault',
    )
  })

  it('ignores stale editor changes outside the active vault', async () => {
    const { result, entry } = renderAutoSaveScopeDraft({
      initialVaultPath: '/new-vault',
      notePath: '/old-vault/draft.md',
    })

    act(() => {
      result.current.handleContentChange(entry.path, '# Draft\n\nStale edit')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expectNoSaveNoteContent()
    expect(deps.trackUnsaved).not.toHaveBeenCalled()
  })

  it('does not flush unsaved tab content to disk without an active vault', async () => {
    const { path, result } = renderMissingVaultDraft()

    await act(async () => {
      await result.current.flushBeforeAction(path)
    })

    expect(deps.setToastMessage).toHaveBeenCalledWith('Select or restore a vault before saving.')
    expectNoSaveNoteContent()
  })

  it('handleContentChange is a function', () => {
    const { result } = renderSave()
    expect(typeof result.current.handleContentChange).toBe('function')
  })

  it('marks the edited path as unsaved immediately on content change', () => {
    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')
    const { result } = renderSave({
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
    })

    act(() => {
      result.current.handleContentChange(entry.path, '# Note\n\nAfter')
    })

    expect(deps.trackUnsaved).toHaveBeenCalledWith(entry.path)
  })

  it('bumps modifiedAt in live entry state after saving', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T14:45:00Z'))

    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')
    const { result } = renderSave({
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Note\n\nAfter')
      await result.current.handleSave()
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(deps.updateEntry).toHaveBeenCalledWith(
      entry.path,
      expect.objectContaining({
        modifiedAt: Math.floor(new Date('2026-04-16T14:45:00Z').getTime() / 1000),
      }),
    )
  })

  it('debounces untitled H1 auto-rename until the user pauses typing', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'save_note_content') return undefined
      if (command === 'auto_rename_untitled') return { new_path: '/vault/fresh-title.md', updated_files: 0 }
      if (command === 'reload_vault_entry') return makeEntry('/vault/fresh-title.md', 'Fresh Title', 'fresh-title.md')
      if (command === 'get_note_content' && args?.path === '/vault/fresh-title.md') return '# Fresh Title\n\nBody'
      return undefined
    })

    const entry = makeEntry('/vault/untitled-note-123.md', 'Untitled Note 123', 'untitled-note-123.md')
    const tabs = [{ entry, content: '# Fresh Title\n\nBody' }]
    const { result } = renderSave({
      tabs,
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    act(() => {
      result.current.handleContentChange(entry.path, '# Fresh Title\n\nBody')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('auto_rename_untitled', expect.anything())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499)
    })
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('auto_rename_untitled', expect.anything())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('auto_rename_untitled', {
      args: {
        vaultPath: '/vault',
        notePath: entry.path,
      },
    })
    expect(deps.replaceEntry).toHaveBeenCalledWith(
      entry.path,
      expect.objectContaining({ path: '/vault/fresh-title.md', filename: 'fresh-title.md' }),
      '# Fresh Title\n\nBody',
    )
  })

  it('auto-renames untitled notes whose active vault path uses Windows separators', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = 'D:\\DEV\\sakuhinn\\untitled-note-1783087381.md'
    const newPath = 'D:\\DEV\\sakuhinn\\test.md'
    const vaultPath = 'D:\\DEV\\sakuhinn'
    const content = '# test\n\nBody'
    const entry = makeEntry(oldPath, 'Untitled Note 1783087381', 'untitled-note-1783087381.md')

    vi.mocked(invoke).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'save_note_content') return undefined
      if (command === 'auto_rename_untitled') return { new_path: newPath, updated_files: 0 }
      if (command === 'reload_vault_entry') return makeEntry(newPath, 'test', 'test.md')
      if (command === 'get_note_content' && args?.path === newPath) return content
      return undefined
    })

    const { result } = renderSave({
      resolvedPath: vaultPath,
      tabs: [{ entry, content }],
      activeTabPath: oldPath,
      unsavedPaths: new Set([oldPath]),
    })

    act(() => {
      result.current.handleContentChange(oldPath, content)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('auto_rename_untitled', {
      args: {
        vaultPath,
        notePath: oldPath,
      },
    })
    expect(deps.replaceEntry).toHaveBeenCalledWith(
      oldPath,
      expect.objectContaining({ path: newPath, filename: 'test.md' }),
      content,
    )
  })

  it('refreshes a pending untitled auto-rename when the H1 title changes before the timer fires', async () => {
    const partialTitleContent = '# Obsi\n'
    const revisedTitleContent = '# Obsidian\n\nBody starts after the title is complete'
    const { result, oldPath } = setupUntitledRenameHarness({
      initialContent: partialTitleContent,
      diskContent: revisedTitleContent,
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, partialTitleContent)
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_300)
      result.current.handleContentChange(oldPath, revisedTitleContent)
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'auto_rename_untitled')).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_note_content', {
      path: oldPath,
      content: revisedTitleContent,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'auto_rename_untitled')).toHaveLength(1)
  })

  it('does not auto-rename untitled notes when the H1 auto-rename preference is disabled', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      if (command === 'auto_rename_untitled') {
        throw new Error('auto_rename_untitled should not run when disabled')
      }
      return undefined
    })

    const entry = makeEntry('/vault/untitled-note-123.md', 'Untitled Note 123', 'untitled-note-123.md')
    const tabs = [{ entry, content: '# Fresh Title\n\nBody' }]
    const { result } = renderSave({
      tabs,
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
      initialH1AutoRenameEnabled: false,
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('auto_rename_untitled', expect.anything())
    expect(deps.replaceEntry).not.toHaveBeenCalled()
  })

  it('switches the active tab to the renamed path after untitled H1 auto-rename', async () => {
    const { result, newPath, getTabs } = setupUntitledRenameHarness()

    await act(async () => {
      result.current.handleContentChange('/vault/untitled-note-123.md', '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    expect(deps.handleSwitchTab).toHaveBeenCalledWith(newPath)
    expect(getTabs()[0].entry.path).toBe(newPath)
    expect(getTabs()[0].entry.filename).toBe('fresh-title.md')
    expect(getTabs()[0].content).toBe('# Fresh Title\n\nBody')
  })

  it('reconciles untitled auto-rename state in a React transition', async () => {
    const { result } = setupUntitledRenameHarness()

    await act(async () => {
      result.current.handleContentChange('/vault/untitled-note-123.md', '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    expect(startTransitionMock).toHaveBeenCalled()
  })

  it('cancels a pending untitled auto-rename when the user navigates away', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      if (command === 'auto_rename_untitled') return { new_path: '/vault/fresh-title.md', updated_files: 0 }
      return undefined
    })

    const entry = makeEntry('/vault/untitled-note-123.md', 'Untitled Note 123', 'untitled-note-123.md')
    const tabs = [{ entry, content: '# Fresh Title\n\nBody' }]
    const { result, rerender } = renderHook(
      ({ currentActiveTabPath }: { currentActiveTabPath: string | null }) => useAppSave({
        ...deps,
        tabs,
        activeTabPath: currentActiveTabPath,
        unsavedPaths: new Set([entry.path]),
      }),
      { initialProps: { currentActiveTabPath: entry.path } },
    )

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    rerender({ currentActiveTabPath: '/vault/other.md' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('auto_rename_untitled', expect.anything())
  })

  it('redirects stale editor saves to the latest renamed path', async () => {
    const { result, oldPath, newPath } = setupUntitledRenameHarness()

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody\n\nMore text')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: oldPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
  })

  it('tracks filename renames so follow-up saves do not recreate the old path', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/vault/fresh-title.md'
    const newPath = '/vault/manual-name.md'
    const entry = makeEntry(oldPath, 'Fresh Title', 'fresh-title.md')

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      return undefined
    })

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/vault')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n\nBody')
    })

    const { result } = renderSave({
      tabs: [{ entry, content: '# Fresh Title\n\nBody' }],
      activeTabPath: oldPath,
      unsavedPaths: new Set([oldPath]),
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody\n\nMore text')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: oldPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
    expect(deps.replaceEntry).toHaveBeenCalledWith(
      oldPath,
      expect.objectContaining({ path: newPath, filename: 'manual-name.md' }),
      '# Fresh Title\n\nBody',
    )
  })

  it('routes macOS alias-path editor saves to the renamed path', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/tmp/vault/fresh-title.md'
    const aliasOldPath = '/private/tmp/vault/fresh-title.md'
    const newPath = '/tmp/vault/manual-name.md'
    const entry = makeEntry(oldPath, 'Fresh Title', 'fresh-title.md')

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      return undefined
    })

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/tmp/vault')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n\nBody')
    })

    const { result } = renderSave({
      resolvedPath: '/tmp/vault',
      tabs: [{ entry, content: '# Fresh Title\n\nBody' }],
      activeTabPath: oldPath,
      unsavedPaths: new Set([oldPath]),
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    await act(async () => {
      result.current.handleContentChange(aliasOldPath, '# Fresh Title\n\nBody\n\nAlias edit')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: '# Fresh Title\n\nBody\n\nAlias edit' },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: aliasOldPath, content: '# Fresh Title\n\nBody\n\nAlias edit' },
    ])
  })

  it('passes the active tab workspace path to manual filename renames', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/team/fresh-title.md'
    const newPath = '/team/manual-name.md'
    const entry = {
      ...makeEntry(oldPath, 'Fresh Title', 'fresh-title.md'),
      workspace: makeWorkspace('/team', 'team'),
    }

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/team')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n')
    })

    const { result } = renderSave({
      resolvedPath: '/personal',
      tabs: [{ entry, content: '# Fresh Title\n' }],
      activeTabPath: oldPath,
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    expect(deps.handleRenameFilename).toHaveBeenCalledWith(
      oldPath,
      'manual-name',
      '/team',
      expect.any(Function),
    )
  })

  it('uses the latest active tab content when untitled auto-rename resolves after continued typing', async () => {
    const {
      oldPath,
      newPath,
      entry,
      setTabs,
      getTabs,
      setTabsState,
    } = setupUntitledRenameHarness({
      diskContent: '# Fresh Title\n\nBody from disk',
      render: false,
    })
    let currentTabs = [{ entry, content: '# Fresh Title\n\nBody' }]

    const { result, rerender } = renderHook(
      ({ currentTabs, currentActiveTabPath }: { currentTabs: typeof currentTabs; currentActiveTabPath: string | null }) => useAppSave({
        ...deps,
        setTabs,
        tabs: currentTabs,
        activeTabPath: currentActiveTabPath,
        unsavedPaths: new Set([oldPath]),
      }),
      {
        initialProps: {
          currentTabs,
          currentActiveTabPath: oldPath,
        },
      },
    )

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    currentTabs = [{ entry, content: '# Fresh Title\n\nBody that keeps changing while rename is pending' }]
    setTabsState(currentTabs)
    rerender({
      currentTabs,
      currentActiveTabPath: oldPath,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(deps.replaceEntry).toHaveBeenCalledWith(
      oldPath,
      expect.objectContaining({ path: newPath, filename: 'fresh-title.md' }),
      '# Fresh Title\n\nBody that keeps changing while rename is pending',
    )
    expect(getTabs()[0].entry.path).toBe(newPath)
    expect(getTabs()[0].content).toBe('# Fresh Title\n\nBody that keeps changing while rename is pending')
  })

  it('marks untitled auto-rename paths as internal vault writes', async () => {
    const { result, oldPath, newPath } = setupUntitledRenameHarness()

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    expect(deps.onInternalVaultWrite).toHaveBeenCalledWith(oldPath)
    expect(deps.onInternalVaultWrite).toHaveBeenCalledWith(newPath)
  })

  it('does not run markdown title-sync renames for non-markdown text files', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    const viewPath = '/vault/views/active-projects.yml'
    const viewContent = 'name: Active Projects\nicon: rocket\ncolor: blue\n'
    const viewEntry = {
      ...makeEntry(viewPath, 'Active Projects', 'active-projects.yml'),
      fileKind: 'text' as const,
    }

    const { result } = renderSave({
      tabs: [{ entry: viewEntry, content: viewContent }],
      activeTabPath: viewPath,
      unsavedPaths: new Set([viewPath]),
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_note_content', {
      path: viewPath,
      content: viewContent,
    })
    expect(deps.handleRenameNote).not.toHaveBeenCalled()
  })

  it('does not rename an existing markdown note when Cmd+S saves a desynced H1/title state', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    const notePath = '/vault/note-b.md'
    const noteContent = '# Breadcrumb Sync Target\n\nBody'
    const entry = makeEntry(notePath, 'Breadcrumb Sync Target', 'note-b.md')

    const { result } = renderSave({
      tabs: [{ entry, content: noteContent }],
      activeTabPath: notePath,
      unsavedPaths: new Set([notePath]),
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_note_content', {
      path: notePath,
      content: noteContent,
    })
    expect(deps.handleRenameNote).not.toHaveBeenCalled()
  })

  it('remaps a buffered auto-save to the renamed path when untitled rename lands mid-idle window', async () => {
    const initialContent = '# Fresh Title\n\nInitial body'
    const bufferedContent = '# Fresh Title\n\nBody typed right before rename'
    const { result, oldPath, newPath } = setupUntitledRenameHarness({
      initialContent,
      diskContent: initialContent,
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, initialContent)
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_300)
      result.current.handleContentChange(oldPath, bufferedContent)
      await vi.advanceTimersByTimeAsync(200)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 200)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: bufferedContent },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: oldPath, content: bufferedContent },
    ])
  })

  it('waits for an in-flight untitled rename before persisting body edits that arrive mid-rename', async () => {
    const renameDeferred = createDeferred<{ new_path: string; updated_files: number } | null>()
    const initialContent = '# Fresh Title\n\nInitial body'
    const bodyDuringRename = '# Fresh Title\n\nBody typed while rename is in flight'
    const { result, oldPath, newPath } = setupUntitledRenameHarness({
      initialContent,
      diskContent: initialContent,
      autoRenameResult: renameDeferred.promise,
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, initialContent)
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    const saveCallsBeforeRename = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCallsBeforeRename).toHaveLength(1)
    expect(saveCallsBeforeRename[0]).toEqual([
      'save_note_content',
      { path: oldPath, content: initialContent },
    ])

    await act(async () => {
      result.current.handleContentChange(oldPath, bodyDuringRename)
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    const saveCallsWhileRenamePending = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCallsWhileRenamePending).toHaveLength(1)

    await act(async () => {
      renameDeferred.resolve({ new_path: newPath, updated_files: 0 })
      await Promise.resolve()
      await Promise.resolve()
    })

    const finalSaveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(finalSaveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: bodyDuringRename },
    ])
    expect(finalSaveCalls).not.toContainEqual([
      'save_note_content',
      { path: oldPath, content: bodyDuringRename },
    ])
  })

  it('waits for an in-flight untitled rename before manual filename rename', async () => {
    const renameDeferred = createDeferred<{ new_path: string; updated_files: number } | null>()
    const { result, oldPath, newPath } = setupUntitledRenameHarness({
      autoRenameResult: renameDeferred.promise,
    })

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(newPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/vault')
      onEntryRenamed(path, { path: '/vault/manual-name.md', filename: 'manual-name.md' }, '# Fresh Title\n\nBody')
    })

    await act(async () => {
      result.current.handleContentChange(oldPath, '# Fresh Title\n\nBody')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 2_500)
    })

    let manualRenamePromise!: Promise<void>
    act(() => {
      manualRenamePromise = result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    expect(deps.handleRenameFilename).not.toHaveBeenCalled()

    await act(async () => {
      renameDeferred.resolve({ new_path: newPath, updated_files: 0 })
      await manualRenamePromise
    })

    expect(deps.handleRenameFilename).toHaveBeenCalledOnce()
  })
})
