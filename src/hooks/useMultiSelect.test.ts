import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { useMultiSelect } from './useMultiSelect'

function makeEntry(path: string): VaultEntry {
  return {
    path,
    filename: path.split('/').at(-1) ?? 'note.md',
    title: path,
    isA: null,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
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
  }
}

const entries = [
  makeEntry('/vault/a.md'),
  makeEntry('/vault/b.md'),
]

describe('useMultiSelect', () => {
  it('keeps empty selection identity stable when clear is redundant', () => {
    const { result } = renderHook(() => useMultiSelect(entries))
    const initialSelection = result.current.selectedPaths

    act(() => {
      result.current.clear()
    })

    expect(result.current.selectedPaths).toBe(initialSelection)
  })

  it('clears selected paths once and keeps later empty clears stable', () => {
    const { result } = renderHook(() => useMultiSelect(entries))

    act(() => {
      result.current.toggle('/vault/a.md')
    })

    expect(result.current.selectedPaths.size).toBe(1)

    act(() => {
      result.current.clear()
    })

    const clearedSelection = result.current.selectedPaths
    expect(clearedSelection.size).toBe(0)

    act(() => {
      result.current.clear()
    })

    expect(result.current.selectedPaths).toBe(clearedSelection)
  })
})
