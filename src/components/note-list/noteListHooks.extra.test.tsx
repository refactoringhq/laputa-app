import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModifiedFile, VaultEntry, ViewFile } from '../../types'
import { saveSortPreferences } from '../../utils/noteListHelpers'
import {
  useChangeStatusResolver,
  useListPropertyPicker,
  useMultiSelectKeyboard,
  useNoteListInteractions,
  useNoteListSearch,
  useNoteListSort,
} from './noteListHooks'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

const {
  multiSelectState,
  noteListKeyboardState,
  prefetchNoteContentMock,
  routeNoteClickMock,
} = vi.hoisted(() => ({
  multiSelectState: {
    clear: vi.fn(),
    selectAll: vi.fn(),
    selectRange: vi.fn(),
    setAnchor: vi.fn(),
    isMultiSelecting: false,
  },
  noteListKeyboardState: {
    highlightedPath: null as string | null,
    handleKeyDown: vi.fn(),
    lastOptions: null as null | Record<string, unknown>,
  },
  prefetchNoteContentMock: vi.fn(),
  routeNoteClickMock: vi.fn(),
}))

vi.mock('../../hooks/useMultiSelect', () => ({
  useMultiSelect: () => multiSelectState,
}))

vi.mock('../../hooks/useNoteListKeyboard', () => ({
  useNoteListKeyboard: (options: Record<string, unknown>) => {
    noteListKeyboardState.lastOptions = options
    return {
      highlightedPath: noteListKeyboardState.highlightedPath,
      handleKeyDown: noteListKeyboardState.handleKeyDown,
    }
  },
}))

vi.mock('../../hooks/useTabManagement', () => ({
  prefetchNoteContent: (entry: VaultEntry) => prefetchNoteContentMock(entry),
}))

vi.mock('./noteListUtils', async () => {
  const actual = await vi.importActual<typeof import('./noteListUtils')>('./noteListUtils')
  return {
    ...actual,
    routeNoteClick: (...args: unknown[]) => routeNoteClickMock(...args),
  }
})

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/note/a.md',
    filename: 'a.md',
    title: 'Alpha',
    isA: 'Project',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 100,
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
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

function makeDeletedEntry(): VaultEntry {
  return makeEntry({
    path: '/vault/note/deleted.md',
    filename: 'deleted.md',
    title: 'Deleted',
    __deletedNotePreview: true,
    __deletedRelativePath: 'note/deleted.md',
    __changeAddedLines: 0,
    __changeDeletedLines: 4,
    __changeBinary: false,
  } as Partial<VaultEntry>)
}

describe('noteListHooks extra', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    multiSelectState.isMultiSelecting = false
    noteListKeyboardState.highlightedPath = null
    noteListKeyboardState.lastOptions = null
    routeNoteClickMock.mockImplementation((
      entry: VaultEntry,
      _event: unknown,
      actions: { onReplace: (value: VaultEntry) => void },
    ) => {
      actions.onReplace(entry)
    })
  })

  it('toggles search visibility and clears the search when closing it', () => {
    const { result } = renderHook(() => useNoteListSearch())

    act(() => {
      result.current.toggleSearch()
      result.current.setSearch('  HELLO  ')
    })

    expect(result.current.searchVisible).toBe(true)
    expect(result.current.query).toBe('hello')

    act(() => {
      result.current.toggleSearch()
    })

    expect(result.current.searchVisible).toBe(false)
    expect(result.current.search).toBe('')
  })

  it('migrates stored list sorting into type documents', async () => {
    const typeDocument = makeEntry({
      path: '/vault/types/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      sort: null,
    })
    const projectEntry = makeEntry()
    const onUpdateTypeSort = vi.fn()
    const updateEntry = vi.fn()

    saveSortPreferences({
      __list__: { option: 'title', direction: 'asc' },
    })

    const { result } = renderHook(() =>
      useNoteListSort({
        entries: [typeDocument, projectEntry],
        selection: { kind: 'sectionGroup', type: 'Project', label: 'Projects' },
        modifiedPathSet: new Set<string>(),
        modifiedSuffixes: [],
        onUpdateTypeSort,
        updateEntry,
      }),
    )

    await waitFor(() => {
      expect(onUpdateTypeSort).toHaveBeenCalledWith(typeDocument.path, 'sort', 'title:asc')
      expect(updateEntry).toHaveBeenCalledWith(typeDocument.path, { sort: 'title:asc' })
    })

    act(() => {
      result.current.handleSortChange('__list__', 'modified', 'desc')
    })

    expect(onUpdateTypeSort).toHaveBeenCalledWith(typeDocument.path, 'sort', 'modified:desc')
    expect(updateEntry).toHaveBeenCalledWith(typeDocument.path, { sort: 'modified:desc' })
  })

  it('stores list sorting locally when no persistence target is available', () => {
    const entry = makeEntry({ isA: 'Note' })
    const { result } = renderHook(() =>
      useNoteListSort({
        entries: [entry],
        selection: { kind: 'filter', filter: 'all' },
        modifiedPathSet: new Set<string>(),
        modifiedSuffixes: [],
      }),
    )

    act(() => {
      result.current.handleSortChange('__list__', 'title', 'asc')
    })

    expect(result.current.sortPrefs.__list__).toEqual({ option: 'title', direction: 'asc' })
  })

  it('prefers selected view sort config and persists list sort changes back to the view definition', () => {
    const onUpdateViewDefinition = vi.fn()
    const view: ViewFile = {
      filename: 'work.view',
      definition: {
        name: 'Work',
        icon: null,
        color: null,
        sort: 'title:asc',
        filters: { all: [] },
      },
    }

    const { result } = renderHook(() =>
      useNoteListSort({
        entries: [makeEntry()],
        selection: { kind: 'view', filename: view.filename },
        modifiedPathSet: new Set<string>(),
        modifiedSuffixes: [],
        views: [view],
        onUpdateViewDefinition,
      }),
    )

    expect(result.current.listSort).toBe('title')
    expect(result.current.listDirection).toBe('asc')

    act(() => {
      result.current.handleSortChange('__list__', 'modified', 'desc')
    })

    expect(onUpdateViewDefinition).toHaveBeenCalledWith(view.filename, { sort: 'modified:desc' })
  })

  it('handles keyboard shortcuts for multi-select flows and ignores select-all in focused inputs', () => {
    const onArchive = vi.fn()
    const onDelete = vi.fn()

    multiSelectState.isMultiSelecting = true
    renderHook(() => useMultiSelectKeyboard(multiSelectState as never, false, onArchive, onDelete))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }))
    })
    expect(multiSelectState.clear).toHaveBeenCalled()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })
    expect(multiSelectState.selectAll).not.toHaveBeenCalled()

    input.blur()
    input.remove()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'e',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })

    expect(multiSelectState.selectAll).toHaveBeenCalledOnce()
    expect(onArchive).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('matches change status by relative path suffix and returns undefined outside the changes view', () => {
    const modifiedFiles: ModifiedFile[] = [
      { path: '/vault/changes/note/alpha.md', relativePath: 'note/alpha.md', status: 'deleted' },
    ]

    const enabled = renderHook(() => useChangeStatusResolver(true, modifiedFiles))
    expect(enabled.result.current('/mirror/worktree/note/alpha.md')).toBe('deleted')

    const disabled = renderHook(() => useChangeStatusResolver(false, modifiedFiles))
    expect(disabled.result.current('/vault/changes/note/alpha.md')).toBeUndefined()
  })

  it('returns undefined for change-status lookups that do not match any modified file', () => {
    const modifiedFiles: ModifiedFile[] = [
      { path: '/vault/note/a.md', relativePath: 'note/a.md', status: 'modified' },
    ]
    const { result } = renderHook(() => useChangeStatusResolver(true, modifiedFiles))

    expect(result.current('/vault/note/a.md')).toBe('modified')
    expect(result.current('/vault/note/missing.md')).toBeUndefined()
  })

  it('builds a type property picker that persists the chosen columns', () => {
    const typeDocument = makeEntry({
      path: '/vault/types/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      listPropertiesDisplay: ['status'],
    })
    const projectEntry = makeEntry({
      properties: { priority: 'High' },
      relationships: { related_to: ['Beta'] },
    })
    const onUpdateTypeSort = vi.fn()

    const { result } = renderHook(() =>
      useListPropertyPicker({
        entries: [typeDocument, projectEntry],
        selection: { kind: 'sectionGroup', type: 'Project', label: 'Projects' },
        inboxPeriod: 'month',
        typeDocument,
        typeEntryMap: { Project: typeDocument },
        onUpdateTypeSort,
      }),
    )

    expect(result.current.propertyPicker?.scope).toBe('type')

    act(() => {
      result.current.propertyPicker?.onSave(['status', 'priority'])
    })

    expect(onUpdateTypeSort).toHaveBeenCalledWith(
      typeDocument.path,
      '_list_properties_display',
      ['status', 'priority'],
    )
  })

  it('uses the view property picker and saves view-specific list property display overrides', () => {
    const onUpdateViewDefinition = vi.fn()
    const view: ViewFile = {
      filename: 'focus.view',
      definition: {
        name: 'Focus',
        icon: null,
        color: null,
        sort: null,
        filters: { all: [] },
        listPropertiesDisplay: [],
      },
    }
    const focusTypeDocument = makeEntry({
      path: '/vault/types/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      listPropertiesDisplay: ['status'],
    })
    const projectEntry = makeEntry({
      properties: { priority: 'High' },
      relationships: { related_to: ['Beta'] },
    })

    const { result } = renderHook(() =>
      useListPropertyPicker({
        entries: [focusTypeDocument, projectEntry],
        selection: { kind: 'view', filename: view.filename },
        inboxPeriod: 'month',
        typeDocument: null,
        typeEntryMap: { Project: focusTypeDocument },
        views: [view],
        onUpdateViewDefinition,
      }),
    )

    expect(result.current.propertyPicker?.scope).toBe('view')

    act(() => {
      result.current.propertyPicker?.onSave(null)
    })

    expect(onUpdateViewDefinition).toHaveBeenCalledWith(view.filename, {
      listPropertiesDisplay: [],
    })
  })

  it('routes deleted-note interactions through the deleted preview handlers and auto-triggers diffs for live changes', () => {
    vi.useFakeTimers()
    const deletedEntry = makeDeletedEntry()
    const liveEntry = makeEntry({ path: '/vault/note/live.md', filename: 'live.md', title: 'Live' })
    const imageEntry = makeEntry({
      path: '/vault/assets/photo.png',
      filename: 'photo.png',
      title: 'photo.png',
      fileKind: 'binary',
    })
    const onReplaceActiveTab = vi.fn()
    const onOpenDeletedNote = vi.fn()
    const onAutoTriggerDiff = vi.fn()

    const { result } = renderHook(() =>
      useNoteListInteractions({
        searched: [deletedEntry, liveEntry],
        searchedGroups: [],
        selectedNotePath: deletedEntry.path,
        selection: { kind: 'filter', filter: 'changes' },
        noteListFilter: 'open',
        isChangesView: true,
        entityEntry: null,
        searchVisible: false,
        toggleSearch: vi.fn(),
        onReplaceActiveTab,
        onOpenDeletedNote,
        onAutoTriggerDiff,
        openContextMenuForEntry: vi.fn(),
        onCreateNote: vi.fn(),
      }),
    )

    const keyboardOptions = noteListKeyboardState.lastOptions as {
      onOpen: (entry: VaultEntry) => void
      onPrefetch: (entry: VaultEntry) => void
    }

    act(() => {
      keyboardOptions.onOpen(deletedEntry)
      keyboardOptions.onPrefetch(liveEntry)
      keyboardOptions.onPrefetch(imageEntry)
      routeNoteClickMock.mockImplementationOnce((
        entry: VaultEntry,
        _event: unknown,
        actions: { onEnterNeighborhood?: (value: VaultEntry) => void },
      ) => {
        actions.onEnterNeighborhood?.(entry)
      })
      result.current.handleClickNote(deletedEntry, {} as React.MouseEvent)
      result.current.handleClickNote(liveEntry, {} as React.MouseEvent)
      vi.advanceTimersByTime(50)
    })

    expect(onOpenDeletedNote).toHaveBeenCalledWith(deletedEntry)
    expect(onReplaceActiveTab).toHaveBeenCalledWith(liveEntry)
    expect(onAutoTriggerDiff).toHaveBeenCalledOnce()
    expect(prefetchNoteContentMock).toHaveBeenCalledWith(liveEntry)
    expect(prefetchNoteContentMock).not.toHaveBeenCalledWith(imageEntry)

    vi.useRealTimers()
  })

  it('opens live notes into Neighborhood mode and routes deleted clicks through the deleted preview action', async () => {
    const deletedEntry = makeDeletedEntry()
    const liveEntry = makeEntry({ path: '/vault/note/live.md', filename: 'live.md', title: 'Live' })
    const onReplaceActiveTab = vi.fn(async () => {})
    const onEnterNeighborhood = vi.fn()
    const onOpenDeletedNote = vi.fn()

    routeNoteClickMock.mockImplementation((
      _entry: VaultEntry,
      _event: unknown,
      actions: { onEnterNeighborhood: () => void },
    ) => {
      actions.onEnterNeighborhood()
    })

    const { result } = renderHook(() =>
      useNoteListInteractions({
        searched: [deletedEntry, liveEntry],
        searchedGroups: [],
        selectedNotePath: liveEntry.path,
        selection: { kind: 'filter', filter: 'changes' },
        noteListFilter: 'open',
        isChangesView: true,
        entityEntry: null,
        searchVisible: false,
        toggleSearch: vi.fn(),
        onReplaceActiveTab,
        onEnterNeighborhood,
        onOpenDeletedNote,
        openContextMenuForEntry: vi.fn(),
        onCreateNote: vi.fn(),
      }),
    )

    const keyboardOptions = noteListKeyboardState.lastOptions as {
      onEnterNeighborhood: (entry: VaultEntry) => Promise<void>
    }

    await act(async () => {
      await keyboardOptions.onEnterNeighborhood(deletedEntry)
      await keyboardOptions.onEnterNeighborhood(liveEntry)
      result.current.handleClickNote(deletedEntry, {} as React.MouseEvent)
    })

    expect(onReplaceActiveTab).toHaveBeenCalledWith(liveEntry)
    expect(onEnterNeighborhood).toHaveBeenCalledWith(liveEntry)
    expect(onOpenDeletedNote).toHaveBeenCalledWith(deletedEntry)
  })
})
