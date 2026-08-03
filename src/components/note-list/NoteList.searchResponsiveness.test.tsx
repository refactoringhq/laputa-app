import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeIndexedEntry, renderNoteList } from '../../test-utils/noteListTestUtils'

const { listViewRenderSpy } = vi.hoisted(() => ({
  listViewRenderSpy: vi.fn(),
}))

vi.mock('./NoteListViews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./NoteListViews')>()
  return {
    ...actual,
    ListView: (props: Parameters<typeof actual.ListView>[0]) => {
      listViewRenderSpy(props.searched.length)
      return <div data-testid="responsive-search-results" />
    },
  }
})

describe('NoteList search responsiveness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps rapid input updates local until the search debounce expires', async () => {
    renderNoteList({
      entries: Array.from({ length: 2_000 }, (_unused, index) => makeIndexedEntry(index)),
    })
    act(() => {
      fireEvent.click(screen.getByTitle('Search notes'))
    })
    listViewRenderSpy.mockClear()

    const input = screen.getByPlaceholderText('Search notes...')
    act(() => {
      fireEvent.change(input, { target: { value: 's' } })
      fireEvent.change(input, { target: { value: 'strat' } })
      fireEvent.change(input, { target: { value: 'strategy' } })
    })

    expect(input).toHaveValue('strategy')
    expect(listViewRenderSpy).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })
    expect(listViewRenderSpy).toHaveBeenCalled()
  })
})
