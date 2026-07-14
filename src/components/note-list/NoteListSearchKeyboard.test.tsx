import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeIndexedEntry, renderNoteList } from '../../test-utils/noteListTestUtils'

const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15'
const originalUserAgent = navigator.userAgent

function withUserAgent<T>(userAgent: string, callback: () => T): T {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  try {
    return callback()
  } finally {
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUserAgent, configurable: true })
  }
}

function installAnimationFrameStub() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })

  return {
    flushAnimationFrame: () => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => {
        callback(0)
      })
    },
  }
}

describe('NoteList search keyboard behavior', () => {
  let flushAnimationFrame: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ flushAnimationFrame } = installAnimationFrameStub())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('toggles note-list search with Cmd+F while the note list is active', () => {
    withUserAgent(MAC_USER_AGENT, () => {
      renderNoteList()
      const noteList = screen.getByTestId('note-list-container')

      act(() => {
        noteList.focus()
        fireEvent.focus(noteList)
        fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true })
      })

      const searchInput = screen.getByPlaceholderText('Search notes...')
      act(() => {
        flushAnimationFrame()
      })
      expect(searchInput).toHaveFocus()

      act(() => {
        fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true })
        flushAnimationFrame()
      })

      expect(screen.queryByPlaceholderText('Search notes...')).not.toBeInTheDocument()
      expect(noteList).toHaveFocus()
    })
  })

  it('leaves macOS Cmd+Ctrl+F for native fullscreen while the note list is active', () => {
    withUserAgent(MAC_USER_AGENT, () => {
      renderNoteList()
      const noteList = screen.getByTestId('note-list-container')

      act(() => {
        noteList.focus()
        fireEvent.focus(noteList)
        fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true, ctrlKey: true })
      })

      expect(screen.queryByPlaceholderText('Search notes...')).not.toBeInTheDocument()
      expect(noteList).toHaveFocus()
    })
  })

  it('debounces note-list filtering and shows loading feedback while waiting', async () => {
    const entries = [
      makeIndexedEntry(0, { title: 'Alpha Strategy' }),
      ...Array.from({ length: 200 }, (_, index) => makeIndexedEntry(index + 1)),
      makeIndexedEntry(999, { title: 'Beta Strategy' }),
    ]

    renderNoteList({ entries })
    act(() => {
      fireEvent.click(screen.getByTitle('Search notes'))
    })

    const searchInput = screen.getByPlaceholderText('Search notes...')
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Strategy' } })
    })

    expect(screen.getByTestId('note-list-search-loading')).toBeInTheDocument()
    expect(screen.getByText('Note 1')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(180)
      flushAnimationFrame()
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(screen.queryByTestId('note-list-search-loading')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha Strategy')).toBeInTheDocument()
    expect(screen.getByText('Beta Strategy')).toBeInTheDocument()
    expect(screen.queryByText('Note 1')).not.toBeInTheDocument()
  })

  it('clears note-list search immediately from the keyboard-reachable clear action', () => {
    const entries = [
      makeIndexedEntry(0, { title: 'Alpha Strategy' }),
      makeIndexedEntry(1, { title: 'Note 1' }),
    ]

    renderNoteList({ entries })
    act(() => {
      fireEvent.click(screen.getByTitle('Search notes'))
    })

    const searchInput = screen.getByPlaceholderText('Search notes...')
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Strategy' } })
    })

    act(() => {
      vi.advanceTimersByTime(180)
      flushAnimationFrame()
    })

    expect(screen.getByText('Alpha Strategy')).toBeInTheDocument()
    expect(screen.queryByText('Note 1')).not.toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    act(() => {
      clearButton.focus()
    })
    expect(clearButton).toHaveFocus()

    act(() => {
      fireEvent.click(clearButton)
    })
    expect(searchInput).toHaveValue('')
    expect(screen.queryByTestId('note-list-search-loading')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha Strategy')).toBeInTheDocument()
    expect(screen.getByText('Note 1')).toBeInTheDocument()

    act(() => {
      flushAnimationFrame()
    })

    expect(searchInput).toHaveFocus()
  })
})
