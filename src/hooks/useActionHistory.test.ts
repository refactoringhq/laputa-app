import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useActionHistory } from './useActionHistory'

describe('useActionHistory', () => {
  it('reveals the target note before undoing a persisted action', async () => {
    const calls: string[] = []
    const onRevealTarget = vi.fn(async () => {
      calls.push('reveal')
    })
    const undo = vi.fn(async () => {
      calls.push('undo')
    })
    const { result } = renderHook(() => useActionHistory({ onRevealTarget }))

    act(() => {
      result.current.recordAction({
        id: 'organize:/vault/a.md',
        label: 'Mark as Organized',
        path: '/vault/a.md',
        undo,
        redo: vi.fn(),
      })
    })

    await act(async () => {
      await result.current.undo()
    })

    expect(onRevealTarget).toHaveBeenCalledWith(expect.objectContaining({ path: '/vault/a.md' }))
    expect(calls).toEqual(['reveal', 'undo'])
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
  })

  it('preserves the undo stack when replay fails', async () => {
    const onToast = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useActionHistory({ onToast }))

    act(() => {
      result.current.recordAction({
        id: 'favorite:/vault/a.md',
        label: 'Add to Favorites',
        path: '/vault/a.md',
        undo: vi.fn(async () => {
          throw new Error('disk full')
        }),
        redo: vi.fn(),
      })
    })

    await act(async () => {
      await result.current.undo()
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    expect(onToast).toHaveBeenCalledWith('Failed to undo add to favorites')
    warnSpy.mockRestore()
  })

  it('clears redo history when a new action is recorded', async () => {
    const { result } = renderHook(() => useActionHistory())

    act(() => {
      result.current.recordAction({
        id: 'first',
        label: 'First',
        undo: vi.fn(),
        redo: vi.fn(),
      })
    })
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.recordAction({
        id: 'second',
        label: 'Second',
        undo: vi.fn(),
        redo: vi.fn(),
      })
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })
})
