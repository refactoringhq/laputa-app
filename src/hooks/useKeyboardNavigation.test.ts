import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useKeyboardNavigation } from './useKeyboardNavigation'

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
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
  properties: {},
  ...overrides,
})

describe('useKeyboardNavigation', () => {
  const onReplaceActiveTab = vi.fn()
  const onSelectNote = vi.fn()

  const entries = [
    makeEntry({ path: '/vault/a.md', title: 'A', modifiedAt: 1700000003 }),
    makeEntry({ path: '/vault/b.md', title: 'B', modifiedAt: 1700000002 }),
    makeEntry({ path: '/vault/c.md', title: 'C', modifiedAt: 1700000001 }),
  ]

  let addedListeners: { type: string; handler: EventListenerOrEventListenerObject }[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    addedListeners = []
    const origAdd = window.addEventListener
    const origRemove = window.removeEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      addedListeners.push({ type, handler })
      origAdd.call(window, type, handler, opts)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, handler: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
      origRemove.call(window, type, handler, opts)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderNav(activeTabPath: string | null, noteList: VaultEntry[] = entries) {
    const visibleNotesRef = { current: noteList }
    return renderHook(() =>
      useKeyboardNavigation({
        activeTabPath,
        visibleNotesRef,
        onReplaceActiveTab,
        onSelectNote,
      })
    )
  }

  function dispatchKeydown(eventInit: KeyboardEventInit) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ...eventInit,
      }))
    })
  }

  function dispatchNoteNavigation(key: 'ArrowDown' | 'ArrowUp') {
    dispatchKeydown({ key, metaKey: true, altKey: true })
  }

  it('registers keydown listener on mount', () => {
    renderNav('/vault/a.md')
    expect(addedListeners.some(l => l.type === 'keydown')).toBe(true)
  })

  it('navigates to next note on Cmd+Alt+ArrowDown', () => {
    renderNav('/vault/a.md')

    dispatchNoteNavigation('ArrowDown')

    expect(onReplaceActiveTab).toHaveBeenCalledWith(entries[1])
  })

  it('supports Ctrl+Alt note navigation for non-macOS keyboard layouts', () => {
    renderNav('/vault/a.md')

    dispatchKeydown({ key: 'ArrowDown', ctrlKey: true, altKey: true })

    expect(onReplaceActiveTab).toHaveBeenCalledWith(entries[1])
  })

  it('navigates to previous note on Cmd+Alt+ArrowUp', () => {
    renderNav('/vault/b.md')

    dispatchNoteNavigation('ArrowUp')

    expect(onReplaceActiveTab).toHaveBeenCalledWith(entries[0])
  })

  it('does not wrap when at the last note and pressing Down', () => {
    renderNav('/vault/c.md')

    dispatchNoteNavigation('ArrowDown')

    expect(onReplaceActiveTab).not.toHaveBeenCalled()
    expect(onSelectNote).not.toHaveBeenCalled()
  })

  it('does not wrap when at the first note and pressing Up', () => {
    renderNav('/vault/a.md')

    dispatchNoteNavigation('ArrowUp')

    expect(onReplaceActiveTab).not.toHaveBeenCalled()
    expect(onSelectNote).not.toHaveBeenCalled()
  })

  it('selects first note when no active tab and pressing Down', () => {
    renderNav(null)

    dispatchNoteNavigation('ArrowDown')

    expect(onSelectNote).toHaveBeenCalledWith(entries[0])
  })

  it('selects last note when no active tab and pressing Up', () => {
    renderNav(null)

    dispatchNoteNavigation('ArrowUp')

    expect(onSelectNote).toHaveBeenCalledWith(entries[2])
  })

  it('does nothing without modifier keys', () => {
    renderNav('/vault/a.md')

    dispatchKeydown({ key: 'ArrowRight' })

    expect(onReplaceActiveTab).not.toHaveBeenCalled()
    expect(onSelectNote).not.toHaveBeenCalled()
  })

  it('navigates in the order provided by visibleNotesRef (not by modifiedAt)', () => {
    // Provide notes in reverse-alpha order (C, B, A) regardless of modifiedAt
    const customOrder = [entries[2], entries[1], entries[0]]
    renderNav('/vault/c.md', customOrder)

    dispatchNoteNavigation('ArrowDown')

    // Should navigate to B (next in custom order), not based on modifiedAt
    expect(onReplaceActiveTab).toHaveBeenCalledWith(entries[1])
  })

  it('does nothing when note list is empty', () => {
    renderNav('/vault/a.md', [])

    dispatchNoteNavigation('ArrowDown')

    expect(onReplaceActiveTab).not.toHaveBeenCalled()
    expect(onSelectNote).not.toHaveBeenCalled()
  })
})
