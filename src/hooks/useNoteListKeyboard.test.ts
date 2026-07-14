import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useNoteListKeyboard } from './useNoteListKeyboard'

const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15'
const WINDOWS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'
const originalUserAgent = navigator.userAgent

function withUserAgent<T>(userAgent: string, callback: () => T): T {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  try {
    return callback()
  } finally {
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUserAgent, configurable: true })
  }
}

function makeEntry(path, title) {
  return {
    path,
    title,
    filename: `${title}.md`,
    isA: 'Note',
    aliases: [],
    tags: [],
    snippet: '',
    status: null,
    favorite: false,
    archived: false,
    createdAt: null,
    modifiedAt: null,
    fileSize: 100,
    color: null,
    icon: null,
    template: null, sort: null,
    outgoingLinks: [],
    relationships: {},
  }
}

function keyEvent(key, opts = {}) {
  return { key, preventDefault: vi.fn(), metaKey: false, ctrlKey: false, altKey: false, ...opts }
}

function installAnimationFrameStub() {
  let nextId = 1
  const callbacks = new Map()

  vi.stubGlobal('requestAnimationFrame', (callback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    callbacks.delete(id)
  })

  return {
    flushAnimationFrame: () => {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of pending) callback(0)
    },
  }
}

describe('useNoteListKeyboard', () => {
  const items = [makeEntry('/a.md', 'A'), makeEntry('/b.md', 'B'), makeEntry('/c.md', 'C')]
  const onOpen = vi.fn()
  let flushAnimationFrame

  function renderKeyboard(options = {}) {
    const open = options.onOpen ?? vi.fn()
    const hook = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true, ...options }),
    )
    return { ...hook, open }
  }

  function pressKey(result, key, opts = {}) {
    act(() => result.current.handleKeyDown(keyEvent(key, opts)))
  }

  function pressKeyTimes(result, key, times) {
    for (let index = 0; index < times; index++) pressKey(result, key)
  }

  function expectDeferredOpen(open, entry) {
    expect(open).not.toHaveBeenCalled()
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(entry)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ flushAnimationFrame } = installAnimationFrameStub())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes with no highlight', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    expect(result.current.highlightedPath).toBeNull()
  })

  it('ArrowDown highlights first item from no selection', () => {
    const { result, open } = renderKeyboard()
    pressKey(result, 'ArrowDown')
    expect(result.current.highlightedPath).toBe('/a.md')
    expectDeferredOpen(open, items[0])
  })

  it('ArrowDown advances highlight and opens the latest highlighted note on the next frame', () => {
    const { result, open } = renderKeyboard()
    pressKeyTimes(result, 'ArrowDown', 2)
    expect(result.current.highlightedPath).toBe('/b.md')
    expectDeferredOpen(open, items[1])
  })

  it('ArrowDown clamps at end of list', () => {
    const { result, open } = renderKeyboard()
    pressKeyTimes(result, 'ArrowDown', 4)
    expect(result.current.highlightedPath).toBe('/c.md')
    expectDeferredOpen(open, items[2])
  })

  it('ArrowUp highlights last item from no selection', () => {
    const { result, open } = renderKeyboard()
    pressKey(result, 'ArrowUp')
    expect(result.current.highlightedPath).toBe('/c.md')
    expectDeferredOpen(open, items[2])
  })

  it('scrolls the highlighted item into view with nearest-style behavior', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    const scrollIntoView = vi.fn()
    result.current.virtuosoRef.current = { scrollIntoView }

    pressKey(result, 'ArrowDown')

    expect(scrollIntoView).toHaveBeenCalledWith({ index: 0, behavior: 'auto' })
  })

  it('ArrowUp clamps at start of list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    pressKey(result, 'ArrowDown')
    pressKey(result, 'ArrowUp')
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('Enter opens highlighted note', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    pressKey(result, 'ArrowDown')
    pressKey(result, 'Enter')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(items[0])
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('Enter does nothing when no item highlighted', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    pressKey(result, 'Enter')
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: false }),
    )
    pressKey(result, 'ArrowDown')
    expect(result.current.highlightedPath).toBeNull()
  })

  it('does nothing with modifier keys', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    pressKey(result, 'ArrowDown', { metaKey: true })
    expect(result.current.highlightedPath).toBeNull()
  })

  it('toggles search with the macOS primary command shortcut only', () => {
    withUserAgent(MAC_USER_AGENT, () => {
      const toggleSearch = vi.fn()
      const { result } = renderKeyboard({ toggleSearch })

      const commandF = keyEvent('f', { code: 'KeyF', metaKey: true })
      act(() => result.current.handleKeyDown(commandF))
      expect(commandF.preventDefault).toHaveBeenCalledOnce()
      expect(toggleSearch).toHaveBeenCalledOnce()

      const fullscreenShortcut = keyEvent('f', { code: 'KeyF', metaKey: true, ctrlKey: true })
      act(() => result.current.handleKeyDown(fullscreenShortcut))
      expect(fullscreenShortcut.preventDefault).not.toHaveBeenCalled()
      expect(toggleSearch).toHaveBeenCalledOnce()
    })
  })

  it('toggles search with Ctrl+F on Windows', () => {
    withUserAgent(WINDOWS_USER_AGENT, () => {
      const toggleSearch = vi.fn()
      const { result } = renderKeyboard({ toggleSearch })
      const event = keyEvent('f', { code: 'KeyF', ctrlKey: true })

      act(() => result.current.handleKeyDown(event))

      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(toggleSearch).toHaveBeenCalledOnce()
    })
  })

  it('resets highlight when items change', () => {
    const { result, rerender } = renderHook(
      ({ items: hookItems }) => useNoteListKeyboard({ items: hookItems, selectedNotePath: null, onOpen, enabled: true }),
      { initialProps: { items } },
    )
    pressKey(result, 'ArrowDown')
    expect(result.current.highlightedPath).toBe('/a.md')

    rerender({ items: [makeEntry('/d.md', 'D')] })
    expect(result.current.highlightedPath).toBeNull()
  })

  it('handleFocus sets highlight to selected note', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/b.md', onOpen, enabled: true }),
    )
    act(() => result.current.handleFocus())
    expect(result.current.highlightedPath).toBe('/b.md')
  })

  it('handleFocus defaults to first item when no selected note', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleFocus())
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('does nothing on empty item list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items: [], selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBeNull()
  })

  it('responds to global arrow keys when no editable element is focused', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )

    act(() => {
      globalThis.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    expect(result.current.highlightedPath).toBe('/a.md')
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledWith(items[0])
  })

  it('ignores global arrow keys while an editable element is focused', () => {
    const open = vi.fn()
    const editor = globalThis.document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    globalThis.document.body.appendChild(editor)
    editor.focus()

    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )

    act(() => {
      globalThis.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    expect(result.current.highlightedPath).toBeNull()
    expect(open).not.toHaveBeenCalled()

    editor.remove()
  })

  it('coalesces rapid arrow navigation into a single open for the latest highlighted note', () => {
    const { result, open } = renderKeyboard()
    pressKeyTimes(result, 'ArrowDown', 3)

    expect(result.current.highlightedPath).toBe('/c.md')
    expectDeferredOpen(open, items[2])
  })
})
