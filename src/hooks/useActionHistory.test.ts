import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useActionHistory } from './useActionHistory'

describe('useActionHistory', () => {
  it('undos and redos entries in stack order', async () => {
    const calls: string[] = []
    const { result } = renderHook(() => useActionHistory())

    act(() => {
      result.current.record({
        label: 'First',
        undo: () => calls.push('undo:first'),
        redo: () => calls.push('redo:first'),
      })
      result.current.record({
        label: 'Second',
        undo: () => calls.push('undo:second'),
        redo: () => calls.push('redo:second'),
      })
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.undoLabel).toBe('Second')

    await act(async () => {
      expect(await result.current.undo()).toBe(true)
    })
    expect(calls).toEqual(['undo:second'])
    expect(result.current.redoLabel).toBe('Second')

    await act(async () => {
      expect(await result.current.undo()).toBe(true)
      expect(await result.current.redo()).toBe(true)
    })

    expect(calls).toEqual(['undo:second', 'undo:first', 'redo:first'])
    expect(result.current.undoLabel).toBe('First')
    expect(result.current.redoLabel).toBe('Second')
  })

  it('does not record nested actions while replaying', async () => {
    const nested = vi.fn()
    const { result } = renderHook(() => useActionHistory())

    act(() => {
      result.current.record({
        label: 'Outer',
        undo: () => {
          result.current.record({
            label: 'Nested',
            undo: nested,
            redo: nested,
          })
        },
        redo: vi.fn(),
      })
    })

    await act(async () => {
      await result.current.undo()
    })

    expect(result.current.canUndo).toBe(false)
    expect(result.current.redoLabel).toBe('Outer')
    expect(nested).not.toHaveBeenCalled()
  })
})
