import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarSelection, ViewFile } from '../types'
import { useSavedViewOrdering } from './useSavedViewOrdering'

const mockInvokeFn = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (...args: unknown[]) => mockInvokeFn(...args),
}))

function makeView(filename: string, name: string, order: number): ViewFile {
  return {
    filename,
    definition: {
      name,
      icon: null,
      color: null,
      order,
      sort: null,
      filters: { all: [] },
    },
  }
}

function renderOrdering(selection: SidebarSelection = { kind: 'view', filename: 'beta.yml' }) {
  const reloadViews = vi.fn().mockResolvedValue([])
  const loadModifiedFiles = vi.fn().mockResolvedValue(undefined)
  const onToast = vi.fn()
  const views = [
    makeView('alpha.yml', 'Alpha', 0),
    makeView('beta.yml', 'Beta', 1),
    makeView('gamma.yml', 'Gamma', 2),
  ]
  const hook = renderHook(() => useSavedViewOrdering({
    views,
    selection,
    vaultPath: '/vault',
    reloadViews,
    loadModifiedFiles,
    onToast,
  }))

  return { ...hook, reloadViews, loadModifiedFiles, onToast }
}

describe('useSavedViewOrdering', () => {
  beforeEach(() => {
    mockInvokeFn.mockReset()
    mockInvokeFn.mockResolvedValue(null)
  })

  it('persists a dense order when moving a saved view', async () => {
    const { result, reloadViews, loadModifiedFiles, onToast } = renderOrdering()

    await act(async () => {
      await result.current.onMoveView('beta.yml', 'up')
    })

    expect(mockInvokeFn).toHaveBeenCalledWith('save_view_cmd', {
      vaultPath: '/vault',
      filename: 'beta.yml',
      definition: expect.objectContaining({ name: 'Beta', order: 0 }),
    })
    expect(mockInvokeFn).toHaveBeenCalledWith('save_view_cmd', {
      vaultPath: '/vault',
      filename: 'alpha.yml',
      definition: expect.objectContaining({ name: 'Alpha', order: 1 }),
    })
    expect(reloadViews).toHaveBeenCalledOnce()
    expect(loadModifiedFiles).toHaveBeenCalledOnce()
    expect(onToast).toHaveBeenCalledWith('Views reordered')
  })

  it('exposes command state for the selected saved view', () => {
    const { result } = renderOrdering()

    expect(result.current.selectedViewName).toBe('Beta')
    expect(result.current.selectedViewFilename).toBe('beta.yml')
    expect(result.current.canMoveSelectedViewUp).toBe(true)
    expect(result.current.canMoveSelectedViewDown).toBe(true)
  })

  it('ignores invalid drag orders without writing view files', async () => {
    const { result, reloadViews } = renderOrdering()

    await act(async () => {
      await result.current.onReorderViews(['alpha.yml', 'alpha.yml', 'gamma.yml'])
    })

    expect(mockInvokeFn).not.toHaveBeenCalled()
    expect(reloadViews).not.toHaveBeenCalled()
  })
})
