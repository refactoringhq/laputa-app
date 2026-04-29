import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  useTabManagement,
  prefetchNoteContent,
  cacheNoteContent,
  clearPrefetchCache,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
} from './useTabManagement'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn().mockResolvedValue('# Mock content'),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
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
  template: null, sort: null,
  outgoingLinks: [],
  ...overrides,
})

type HookState = { current: ReturnType<typeof useTabManagement> }

async function selectNote(result: HookState, overrides: Partial<VaultEntry>) {
  await act(async () => {
    await result.current.handleSelectNote(makeEntry(overrides))
  })
}

async function replaceActiveNote(result: HookState, overrides: Partial<VaultEntry>) {
  await act(async () => {
    await result.current.handleReplaceActiveTab(makeEntry(overrides))
  })
}

async function prefetchResolvedContent(path: string, content: string) {
  mockNoteContent({ [path]: content })
  prefetchNoteContent(path)
  await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
  return mockInvoke
}

function mockNoteContent(contentByPath: Record<string, string>) {
  vi.mocked(mockInvoke).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = contentByPath[path] ?? '# Mock content'
    if (cmd === 'validate_note_content') {
      return Promise.resolve(content === args?.content)
    }
    return Promise.resolve(content)
  })
}

function expectSingleActiveTab(result: HookState, path: string) {
  expect(result.current.tabs).toHaveLength(1)
  expect(result.current.tabs[0].entry.path).toBe(path)
  expect(result.current.activeTabPath).toBe(path)
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeAsciiContent(byteCount: number): string {
  return 'x'.repeat(byteCount)
}

function seedCacheBeyondByteLimit() {
  const cachedContent = makeAsciiContent(Math.floor(NOTE_CONTENT_ENTRY_MAX_BYTES * 0.9))
  const cachedPaths = Array.from(
    { length: Math.floor(NOTE_CONTENT_CACHE_MAX_BYTES / cachedContent.length) + 2 },
    (_, index) => `/vault/note/cached-${index + 1}.md`,
  )

  for (const path of cachedPaths) {
    cacheNoteContent(path, cachedContent)
  }

  return {
    cachedContent,
    oldestPath: cachedPaths[0],
    newestPath: cachedPaths[cachedPaths.length - 1],
  }
}

describe('useTabManagement (single-note model)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearPrefetchCache()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(mockInvoke).mockResolvedValue('# Mock content')
    window.history.replaceState({}, '', '/')
  })

  it('starts with no note and null active path', () => {
    const { result } = renderHook(() => useTabManagement())
    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
  })

  describe('handleSelectNote', () => {
    it('opens a note and sets it active', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/a.md' })
      expectSingleActiveTab(result, '/vault/note/a.md')
    })

    it('switches the active path immediately while the next note is still loading', async () => {
      let resolveContent: (value: string) => void
      vi.mocked(mockInvoke).mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveContent = resolve }),
      )

      const { result } = renderHook(() => useTabManagement())
      void act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/pending.md', title: 'Pending' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/pending.md')
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        resolveContent!('# Pending content')
      })

      expect(result.current.tabs[0].entry.path).toBe('/vault/note/pending.md')
      expect(result.current.tabs[0].content).toBe('# Pending content')
    })

    it('replaces the current note when selecting a different one', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      expectSingleActiveTab(result, '/vault/b.md')
    })

    it('keeps a dirty already-open note in place when selecting it again', async () => {
      const entry = { path: '/vault/a.md' }
      const { result: dirtyResult } = renderHook(() => useTabManagement({
        hasUnsavedChanges: (path) => path === '/vault/a.md',
      }))
      await selectNote(dirtyResult, entry)
      act(() => {
        dirtyResult.current.setTabs(prev => prev.map(tab =>
          tab.entry.path === entry.path ? { ...tab, content: '# Local draft' } : tab
        ))
      })

      await act(async () => {
        await dirtyResult.current.handleSelectNote(makeEntry(entry))
      })

      expect(dirtyResult.current.tabs).toHaveLength(1)
      expect(dirtyResult.current.tabs[0].content).toBe('# Local draft')
    })

    it('handles load content failure gracefully', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('fail'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, {})

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('')
      warnSpy.mockRestore()
    })

    it('clears the active note when the file is missing on disk', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File does not exist: /vault/note/missing.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      await selectNote(result, { path: '/vault/note/missing.md', title: 'Missing Note' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/missing.md', title: 'Missing Note' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('returns to the empty state when note content is not valid UTF-8 text', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File is not valid UTF-8 text: /vault/note/bad.csv'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onUnreadableNoteContent = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onUnreadableNoteContent }))
      await selectNote(result, {
        path: '/vault/note/bad.csv',
        filename: 'bad.csv',
        title: 'bad.csv',
        fileKind: 'text',
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onUnreadableNoteContent).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/bad.csv', title: 'bad.csv' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('opens binary image files without trying to load them as text notes', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, {
        path: '/vault/assets/photo.png',
        filename: 'photo.png',
        title: 'photo.png',
        fileKind: 'binary',
      })

      expectSingleActiveTab(result, '/vault/assets/photo.png')
      expect(result.current.tabs[0].content).toBe('')
      expect(vi.mocked(mockInvoke)).not.toHaveBeenCalled()
    })

    it('returns to the empty state when no active vault is selected', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('No active vault selected'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/orphaned.md', title: 'Orphaned Note' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      warnSpy.mockRestore()
    })

    it('uses the note-window vault path when Tauri reloads the selected note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValue('# Window content')
      window.history.replaceState(
        {},
        '',
        '/?window=note&path=%2Fvault%2Fnote%2Ftest.md&vault=%2Fvault&title=Test+Note',
      )

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/test.md', title: 'Test Note' })

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_note_content', {
        path: '/vault/note/test.md',
        vaultPath: '/vault',
      })
      expect(result.current.tabs[0].content).toBe('# Window content')
    })
  })

  describe('handleReplaceActiveTab', () => {
    it('replaces the current note with a new entry', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await replaceActiveNote(result, { path: '/vault/b.md', title: 'B' })
      expectSingleActiveTab(result, '/vault/b.md')
    })

    it('treats /tmp and /private/tmp aliases as the same active note', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Stale before pull')
        .mockResolvedValueOnce('# Fresh after pull')
      const beforeNavigate = vi.fn().mockResolvedValue(undefined)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/private/tmp/vault/active.md', title: 'Active' })

      await act(async () => {
        await result.current.handleReplaceActiveTab(
          makeEntry({ path: '/tmp/vault/active.md', title: 'Active' }),
        )
      })

      expect(beforeNavigate).not.toHaveBeenCalled()
      expect(result.current.activeTabPath).toBe('/tmp/vault/active.md')
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Fresh after pull')
    })

    it('reloads content when replacing with the same entry', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Stale before pull')
        .mockResolvedValueOnce('# Fresh after pull')

      const { result } = renderHook(() => useTabManagement())
      const entry = { path: '/vault/a.md', title: 'A' }
      await selectNote(result, entry)

      await act(async () => {
        await result.current.handleReplaceActiveTab(makeEntry(entry))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Fresh after pull')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('clears the active note when a forced reload hits a missing file path', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Existing content')
        .mockRejectedValueOnce(new Error('File does not exist: /vault/a.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      const entry = makeEntry({ path: '/vault/a.md', title: 'A' })
      await selectNote(result, entry)

      await act(async () => {
        await result.current.handleReplaceActiveTab(entry)
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/a.md', title: 'A' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('opens a note when no note is active', async () => {
      const { result } = renderHook(() => useTabManagement())
      await replaceActiveNote(result, { path: '/vault/a.md' })
      expectSingleActiveTab(result, '/vault/a.md')
    })
  })

  describe('openTabWithContent', () => {
    it('opens a note with pre-loaded content', () => {
      const { result } = renderHook(() => useTabManagement())
      const entry = makeEntry({ path: '/vault/new.md' })

      act(() => {
        result.current.openTabWithContent(entry, '# New note')
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# New note')
      expect(result.current.activeTabPath).toBe('/vault/new.md')
    })
  })

  describe('setTabs entry sync', () => {
    it('updates note entry via setTabs mapper (vault entry sync pattern)', async () => {
      const { result } = renderHook(() => useTabManagement())
      const entry = makeEntry({ path: '/vault/a.md', archived: false })

      await act(async () => {
        await result.current.handleSelectNote(entry)
      })

      const freshEntry = { ...entry, archived: true }
      act(() => {
        result.current.setTabs(prev => prev.map(tab =>
          tab.entry.path === freshEntry.path ? { ...tab, entry: freshEntry } : tab
        ))
      })

      expect(result.current.tabs[0].entry.archived).toBe(true)
    })
  })

  describe('closeAllTabs', () => {
    it('clears the note and active path', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md' })

      act(() => {
        result.current.closeAllTabs()
      })

      expect(result.current.tabs).toHaveLength(0)
      expect(result.current.activeTabPath).toBeNull()
    })
  })

  describe('content prefetch cache', () => {
    it('prefetch validates cached content against disk before reuse', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/pre.md', '# Prefetched content')

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/pre.md', title: 'Pre' })

      expect(result.current.tabs[0].content).toBe('# Prefetched content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
      expect(vi.mocked(mockInvoke)).toHaveBeenLastCalledWith('validate_note_content', {
        path: '/vault/note/pre.md',
        content: '# Prefetched content',
      })
    })

    it('does not paint cached content until freshness validation passes', async () => {
      const freshness = createDeferred<boolean>()
      cacheNoteContent('/vault/note/stale.md', '# Stale cached content')
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return freshness.promise
        return Promise.resolve('# Fresh disk content')
      })

      const { result } = renderHook(() => useTabManagement())
      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/stale.md', title: 'Stale' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/stale.md')
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        freshness.resolve(false)
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(result.current.tabs[0].content).toBe('# Fresh disk content')
      })
    })

    it('clearPrefetchCache prevents stale content from being served', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/stale.md', '# Stale')

      clearPrefetchCache()
      mockNoteContent({ '/vault/note/stale.md': '# Fresh' })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/stale.md', title: 'Stale' })

      expect(result.current.tabs[0].content).toBe('# Fresh')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('deduplicates concurrent prefetch requests for same path', async () => {
      vi.mocked(mockInvoke).mockResolvedValue('# Content')

      prefetchNoteContent('/vault/note/dup.md')
      prefetchNoteContent('/vault/note/dup.md')
      prefetchNoteContent('/vault/note/dup.md')

      await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
    })

    it('swallows no-active-vault prefetch failures and lets a later open recover', async () => {
      vi.mocked(mockInvoke)
        .mockRejectedValueOnce(new Error('No active vault selected'))
        .mockResolvedValueOnce('# Recovered content')

      prefetchNoteContent('/vault/note/recovered.md')
      await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
      await Promise.resolve()
      await Promise.resolve()

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/recovered.md', title: 'Recovered' })

      expect(result.current.tabs[0].content).toBe('# Recovered content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('serves refreshed cached content after a save replaces stale prefetched data', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/saved.md', '# Stale prefetched content')
      mockNoteContent({ '/vault/note/saved.md': '# Persisted content' })

      cacheNoteContent('/vault/note/saved.md', '# Persisted content')

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/saved.md', title: 'Saved' })

      expect(result.current.tabs[0].content).toBe('# Persisted content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('activates a warmed note after validating cached content', async () => {
      const deferred = createDeferred<boolean>()
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return deferred.promise
        return Promise.resolve('# Warm content')
      })
      cacheNoteContent('/vault/note/warm.md', '# Warm content')

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/warm.md', title: 'Warm' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/warm.md')
      expect(result.current.tabs).toEqual([])
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve(true)
        await Promise.resolve()
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Warm content')
    })

    it('does not retain oversized notes in the prefetch cache', async () => {
      const largeContent = makeAsciiContent(NOTE_CONTENT_ENTRY_MAX_BYTES + 1)
      const mockInvoke = await prefetchResolvedContent('/vault/note/oversized.md', largeContent)
      const deferred = createDeferred<string>()
      vi.mocked(mockInvoke).mockImplementationOnce(() => deferred.promise)

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/oversized.md', title: 'Oversized' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/oversized.md')
      expect(result.current.tabs).toEqual([])
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)

      await act(async () => {
        deferred.resolve(largeContent)
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe(largeContent)
    })

    it('evicts the oldest cached notes when retained bytes exceed the cache budget', async () => {
      const { cachedContent, oldestPath } = seedCacheBeyondByteLimit()
      const deferred = createDeferred<string>()
      vi.mocked(mockInvoke).mockImplementationOnce(() => deferred.promise)

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: oldestPath, title: 'Oldest cached note' }))
      })

      expect(result.current.activeTabPath).toBe(oldestPath)
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        deferred.resolve(cachedContent)
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe(cachedContent)
    })

    it('keeps the newest cached notes warm when trimming to the byte budget', async () => {
      const { cachedContent, newestPath } = seedCacheBeyondByteLimit()
      const deferred = createDeferred<boolean>()
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return deferred.promise
        return Promise.resolve(cachedContent)
      })

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: newestPath, title: 'Newest cached note' }))
      })

      expect(result.current.activeTabPath).toBe(newestPath)
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        deferred.resolve(true)
        await Promise.resolve()
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe(cachedContent)
    })

    it('reuses cached content when reopening a recently loaded note', async () => {
      mockNoteContent({
        '/vault/a.md': '# A content',
        '/vault/b.md': '# B content',
      })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      await selectNote(result, { path: '/vault/a.md', title: 'A again' })

      expect(result.current.tabs[0].entry.path).toBe('/vault/a.md')
      expect(result.current.tabs[0].content).toBe('# A content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(3)
    })

    it('refreshes an already-open clean note when cached content is stale on disk', async () => {
      mockNoteContent({ '/vault/a.md': '# Original content' })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      mockNoteContent({ '/vault/a.md': '# External edit' })
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      expect(result.current.tabs[0].entry.path).toBe('/vault/a.md')
      expect(result.current.tabs[0].content).toBe('# External edit')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(mockInvoke)).toHaveBeenNthCalledWith(2, 'validate_note_content', {
        path: '/vault/a.md',
        content: '# Original content',
      })
    })

    it('falls back instead of reopening cached content when the note file disappeared', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Other note')
        .mockRejectedValueOnce(new Error('File does not exist: /vault/note/missing-cached.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      cacheNoteContent('/vault/note/missing-cached.md', '# Cached but stale')
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      await selectNote(result, { path: '/vault/other.md', title: 'Other' })
      await selectNote(result, { path: '/vault/note/missing-cached.md', title: 'Missing cached' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/missing-cached.md', title: 'Missing cached' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('deduplicates a late prefetch after note opening already started', async () => {
      let resolveContent!: (value: string) => void
      vi.mocked(mockInvoke).mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveContent = resolve }),
      )

      const { result } = renderHook(() => useTabManagement())

      await act(async () => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/rapid.md', title: 'Rapid' }))
        prefetchNoteContent('/vault/note/rapid.md')
        await Promise.resolve()
      })

      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveContent('# Rapid content')
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe('# Rapid content')
    })
  })

  describe('rapid switching safety', () => {
    it('only activates the last note when switching rapidly', async () => {
      let resolveA: (v: string) => void
      let resolveB: (v: string) => void
      vi.mocked(mockInvoke)
        .mockImplementationOnce(() => new Promise<string>((r) => { resolveA = r as (v: string) => void }))
        .mockImplementationOnce(() => new Promise<string>((r) => { resolveB = r as (v: string) => void }))

      const { result } = renderHook(() => useTabManagement())

      let selectADone = false
      await act(async () => {
        result.current.handleSelectNote(makeEntry({ path: '/vault/a.md', title: 'A' })).then(() => { selectADone = true })
        await Promise.resolve()
      })

      let selectBDone = false
      await act(async () => {
        result.current.handleSelectNote(makeEntry({ path: '/vault/b.md', title: 'B' })).then(() => { selectBDone = true })
        await Promise.resolve()
      })

      await act(async () => { resolveB!('# B content') })
      await act(async () => { resolveA!('# A content') })

      await vi.waitFor(() => expect(selectADone && selectBDone).toBe(true))

      expect(result.current.activeTabPath).toBe('/vault/b.md')
    })

    it('waits for beforeNavigate before switching away from the current note', async () => {
      const beforeNavigate = vi.fn(() => createDeferred<void>().promise)
      const deferred = createDeferred<void>()
      beforeNavigate.mockReturnValueOnce(deferred.promise)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      let replaceDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
          .then(() => { replaceDone = true })
        await Promise.resolve()
      })

      expect(beforeNavigate).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(replaceDone).toBe(false)

      await act(async () => {
        deferred.resolve(undefined)
        await Promise.resolve()
      })

      await vi.waitFor(() => expect(replaceDone).toBe(true))
      expectSingleActiveTab(result, '/vault/b.md')
    })

    it('keeps only the latest target when note switches overlap during beforeNavigate', async () => {
      const first = createDeferred<void>()
      const second = createDeferred<void>()
      const beforeNavigate = vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      let switchToBDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
          .then(() => { switchToBDone = true })
        await Promise.resolve()
      })

      let switchToCDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/c.md', title: 'C' }))
          .then(() => { switchToCDone = true })
        await Promise.resolve()
      })

      await act(async () => {
        first.resolve(undefined)
        await Promise.resolve()
      })
      expect(result.current.activeTabPath).toBe('/vault/a.md')

      await act(async () => {
        second.resolve(undefined)
        await Promise.resolve()
      })

      await vi.waitFor(() => expect(switchToBDone && switchToCDone).toBe(true))
      expect(result.current.activeTabPath).toBe('/vault/c.md')
    })

    it('keeps the current note active when beforeNavigate fails', async () => {
      const beforeNavigate = vi.fn().mockRejectedValueOnce(new Error('save failed'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      await act(async () => {
        await result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist note before navigation:',
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })
  })
})
