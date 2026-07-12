import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorSaveWithLinks } from './useEditorSaveWithLinks'

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

const mockHandleContentChange = vi.fn()
const mockHandleSave = vi.fn()
const mockSavePendingForPath = vi.fn()

vi.mock('./useEditorSave', () => ({
  useEditorSave: vi.fn(() => ({
    handleContentChange: mockHandleContentChange,
    handleSave: mockHandleSave,
    savePendingForPath: mockSavePendingForPath,
  })),
}))

let idleCallbacks = new Map<number, IdleRequestCallback>()
let nextIdleCallbackHandle = 1

function flushDeferredMetadata() {
  const callbacks = Array.from(idleCallbacks.values())
  idleCallbacks.clear()
  act(() => {
    for (const callback of callbacks) {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      })
    }
  })
}

describe('useEditorSaveWithLinks', () => {
  let updateEntry: Mock
  let setTabs: Mock
  let setToastMessage: Mock
  let onAfterSave: Mock

  beforeEach(() => {
    idleCallbacks = new Map()
    nextIdleCallbackHandle = 1
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      const handle = nextIdleCallbackHandle
      nextIdleCallbackHandle += 1
      idleCallbacks.set(handle, callback)
      return handle
    }))
    vi.stubGlobal('cancelIdleCallback', vi.fn((handle: number) => {
      idleCallbacks.delete(handle)
    }))
    updateEntry = vi.fn()
    setTabs = vi.fn()
    setToastMessage = vi.fn()
    onAfterSave = vi.fn()
    startTransitionMock.mockClear()
    mockHandleContentChange.mockClear()
    mockHandleSave.mockClear()
    mockSavePendingForPath.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderHookWithLinks() {
    return renderHook(() =>
      useEditorSaveWithLinks({
        updateEntry,
        setTabs,
        setToastMessage,
        onAfterSave,
      }),
    )
  }

  it('handleContentChange delegates to useEditorSave handleContentChange', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'no links here')
    })

    expect(mockHandleContentChange).toHaveBeenCalledWith('/note.md', 'no links here')
  })

  it('handleContentChange calls updateEntry with extracted outgoing links when links change', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'see [[PageA]] and [[PageB]]')
    })

    expect(updateEntry).not.toHaveBeenCalled()
    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      outgoingLinks: ['PageA', 'PageB'],
    })
  })

  it('handleContentChange does NOT call updateEntry again when links have not changed', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'text [[Alpha]] more text')
    })
    flushDeferredMetadata()
    expect(updateEntry).toHaveBeenCalledTimes(3)
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      outgoingLinks: ['Alpha'],
    })
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      firstImage: null,
    })
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })

    // Same link, different surrounding text
    act(() => {
      result.current.handleContentChange('/note.md', 'different text [[Alpha]] still')
    })
    flushDeferredMetadata()
    // updateEntry should NOT have been called again — links unchanged
    expect(updateEntry).toHaveBeenCalledTimes(3)
  })

  it('handleContentChange calls updateEntry again when links change on subsequent edit', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'see [[Alpha]]')
    })
    flushDeferredMetadata()
    expect(updateEntry).toHaveBeenCalledTimes(3)
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      outgoingLinks: ['Alpha'],
    })
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      firstImage: null,
    })
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })

    // Now links change
    act(() => {
      result.current.handleContentChange('/note.md', 'see [[Alpha]] and [[Beta]]')
    })
    flushDeferredMetadata()
    expect(updateEntry).toHaveBeenCalledTimes(4)
    expect(updateEntry).toHaveBeenLastCalledWith('/note.md', {
      outgoingLinks: ['Alpha', 'Beta'],
    })
  })

  it('handleContentChange updates the first image for card thumbnails immediately', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/recipe.md', '# Recipe\n\n![[goat-cookie.png]]')
    })
    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/recipe.md', {
      firstImage: 'attachments/goat-cookie.png',
    })
  })

  it('handleContentChange updates the fallback filename title on first call with no links', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'plain text no links')
    })

    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledTimes(2)
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      firstImage: null,
    })
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })
  })

  it('handles pipe-separated wikilinks (display text syntax)', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'see [[Target|Display Text]]')
    })

    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      outgoingLinks: ['Target'],
    })
  })

  it('handleContentChange calls updateEntry with frontmatter patch when type changes', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', '---\ntype: Project\nstatus: Active\n---\nBody')
    })

    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      isA: 'Project',
      status: 'Active',
    }))
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })
  })

  it('handleContentChange does NOT call updateEntry for frontmatter when unchanged', () => {
    const { result } = renderHookWithLinks()
    const content = '---\ntype: Essay\n---\nBody text'

    act(() => { result.current.handleContentChange('/note.md', content) })
    flushDeferredMetadata()
    const callCount = updateEntry.mock.calls.length

    act(() => { result.current.handleContentChange('/note.md', content + ' more') })
    flushDeferredMetadata()
    // Same frontmatter, only body changed — no extra updateEntry for frontmatter
    expect(updateEntry).toHaveBeenCalledTimes(callCount)
  })

  it('handleContentChange updates entry when type changes in frontmatter', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', '---\ntype: Essay\n---\nBody')
    })
    flushDeferredMetadata()
    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      isA: 'Essay',
    }))
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })

    act(() => {
      result.current.handleContentChange('/note.md', '---\ntype: Note\n---\nBody')
    })
    flushDeferredMetadata()
    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      isA: 'Note',
    }))
    expect(updateEntry).toHaveBeenCalledWith('/note.md', {
      title: 'Note',
      hasH1: false,
    })
  })

  it('syncs custom relationships and properties from raw frontmatter immediately', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', '---\nOwner: [[person/alice]]\ncustom: value\n---\nBody')
    })

    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      properties: { Owner: '[[person/alice]]', custom: 'value' },
      relationships: { Owner: ['[[person/alice]]'] },
    }))
  })

  it('clears stale note-list and inspector metadata when raw frontmatter is removed', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', '---\nstatus: Active\nOwner: [[person/alice]]\ncustom: value\n---\nBody')
    })
    flushDeferredMetadata()

    updateEntry.mockClear()

    act(() => {
      result.current.handleContentChange('/note.md', 'Body without frontmatter')
    })
    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      belongsTo: [],
      properties: {},
      relationships: {},
      relatedTo: [],
      status: null,
    }))
  })

  it('keeps the last derived entry state while the raw frontmatter is temporarily incomplete', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', '---\nstatus: Active\nOwner: [[person/alice]]\n---\nBody')
    })
    flushDeferredMetadata()

    updateEntry.mockClear()

    act(() => {
      result.current.handleContentChange('/note.md', '---\nstatus: Active\nOwner: [[person/alice]]\nBody')
    })
    flushDeferredMetadata()

    expect(updateEntry).not.toHaveBeenCalled()
  })

  it.each([
    ['/old-title.md', '# Renamed Note\n\nBody', { title: 'Renamed Note', hasH1: true }],
    ['/renamed-note.md', 'Body without a heading', { title: 'Renamed Note', hasH1: false }],
  ])('handleContentChange derives the displayed title for %s', (path, content, expected) => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange(path, content)
    })

    flushDeferredMetadata()

    expect(updateEntry).toHaveBeenCalledWith(path, expected)
  })

  it('defers H1 title sync updates in a transition so typing stays responsive', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/old-title.md', '# Renamed Note\n\nBody')
    })

    expect(startTransitionMock).not.toHaveBeenCalled()
    expect(updateEntry).not.toHaveBeenCalled()
    flushDeferredMetadata()

    expect(startTransitionMock).toHaveBeenCalledTimes(2)
    expect(updateEntry).toHaveBeenCalledWith('/old-title.md', {
      firstImage: null,
    })
    expect(updateEntry).toHaveBeenCalledWith('/old-title.md', {
      title: 'Renamed Note',
      hasH1: true,
    })
  })

  it('spreads all properties from useEditorSave onto the return value', () => {
    const { result } = renderHookWithLinks()

    // handleSave and savePendingForPath should be passed through from the mock
    expect(result.current.handleSave).toBeDefined()
    expect(result.current.savePendingForPath).toBeDefined()
  })
})
