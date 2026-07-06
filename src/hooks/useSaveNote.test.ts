import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSaveNote } from './useSaveNote'
import { clearNoteContentCache, getCachedNoteContentEntry } from './noteContentCache'

const mockInvokeFn = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<null>>(() => Promise.resolve(null))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvokeFn(cmd, args),
  updateMockContent: vi.fn(),
}))

describe('useSaveNote', () => {
  let updateContent: (path: string, content: string) => void

  beforeEach(() => {
    updateContent = vi.fn<(path: string, content: string) => void>()
    mockInvokeFn.mockClear()
    clearNoteContentCache()
  })

  it('saves content immediately via Tauri command', async () => {
    const { result } = renderHook(() => useSaveNote(updateContent))

    await act(async () => {
      await result.current.saveNote('/test/note.md', '---\ntitle: Test\n---\n\n# Test\n\nContent')
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('save_note_content', {
      path: '/test/note.md',
      content: '---\ntitle: Test\n---\n\n# Test\n\nContent',
    })
    expect(updateContent).toHaveBeenCalledWith('/test/note.md', '---\ntitle: Test\n---\n\n# Test\n\nContent')
  })

  it('updates in-memory state after saving', async () => {
    const { result } = renderHook(() => useSaveNote(updateContent))

    await act(async () => {
      await result.current.saveNote('/test/a.md', 'content A')
      await result.current.saveNote('/test/b.md', 'content B')
    })

    expect(updateContent).toHaveBeenCalledTimes(2)
    expect(updateContent).toHaveBeenCalledWith('/test/a.md', 'content A')
    expect(updateContent).toHaveBeenCalledWith('/test/b.md', 'content B')
  })

  it('refreshes the note-open cache so tab swaps keep the just-saved content', async () => {
    const { result } = renderHook(() => useSaveNote(updateContent))

    await act(async () => {
      await result.current.saveNote('/test/swap.md', '# Draft saved before swapping tabs')
    })

    expect(getCachedNoteContentEntry('/test/swap.md')?.value).toBe('# Draft saved before swapping tabs')
  })

  it('propagates save errors to the caller', async () => {
    mockInvokeFn.mockRejectedValueOnce(new Error('File is read-only'))
    const { result } = renderHook(() => useSaveNote(updateContent))

    await expect(
      act(async () => {
        await result.current.saveNote('/test/readonly.md', 'content')
      })
    ).rejects.toThrow('File is read-only')

    expect(updateContent).not.toHaveBeenCalled()
  })
})
