import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { SidebarSelection, VaultEntry } from '../types'
import {
  useNeighborhoodEntry,
  useNeighborhoodEscape,
  useSelectionSanitizer,
} from './useNeighborhoodSelection'

function buildEntry(path: string, title: string): VaultEntry {
  return {
    path,
    filename: `${title.toLowerCase()}.md`,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    owner: null,
    cadence: null,
    modifiedAt: 1,
    createdAt: null,
    fileSize: 1,
    snippet: '',
    wordCount: 1,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
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

function ref<T>(current: T): MutableRefObject<T> {
  return { current }
}

const inboxSelection: SidebarSelection = { kind: 'filter', filter: 'inbox' }
const alphaSelection: SidebarSelection = { kind: 'entity', entry: buildEntry('/vault/alpha.md', 'Alpha') }
const betaSelection: SidebarSelection = { kind: 'entity', entry: buildEntry('/vault/beta.md', 'Beta') }

function renderNeighborhoodEntry(
  currentSelection: SidebarSelection,
  history: SidebarSelection[],
) {
  const selectionRef = ref(currentSelection)
  const historyRef = ref<SidebarSelection[]>(history)
  const setSelection = vi.fn((selection: SidebarSelection) => {
    selectionRef.current = selection
  })
  const hook = renderHook(() => useNeighborhoodEntry({
    neighborhoodHistoryRef: historyRef,
    selectionRef,
    setSelection,
  }))

  return { historyRef, hook, setSelection }
}

describe('useNeighborhoodEntry', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    document.body.innerHTML = '<div data-testid="note-list-container" tabindex="-1"></div>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('toggles the repeated active neighborhood action back to the previous list', () => {
    const { historyRef, hook, setSelection } = renderNeighborhoodEntry(alphaSelection, [inboxSelection])

    act(() => hook.result.current(alphaSelection.entry))

    expect(setSelection).toHaveBeenCalledWith(inboxSelection, { preserveNeighborhoodHistory: true })
    expect(historyRef.current).toEqual([])
    expect(document.activeElement).toBe(document.querySelector('[data-testid="note-list-container"]'))
  })

  it('uses the same stacked history as Escape when toggling the active neighborhood off', () => {
    const { historyRef, hook, setSelection } = renderNeighborhoodEntry(betaSelection, [inboxSelection, alphaSelection])

    act(() => hook.result.current(betaSelection.entry))

    expect(setSelection).toHaveBeenCalledWith(alphaSelection, { preserveNeighborhoodHistory: true })
    expect(historyRef.current).toEqual([inboxSelection])
  })

  it('switches between neighborhoods without collapsing to all notes', () => {
    const { historyRef, hook, setSelection } = renderNeighborhoodEntry(alphaSelection, [inboxSelection])

    act(() => hook.result.current(betaSelection.entry))

    expect(setSelection).toHaveBeenCalledWith(betaSelection, { preserveNeighborhoodHistory: true })
    expect(historyRef.current).toEqual([inboxSelection, alphaSelection])
  })
})

describe('useNeighborhoodEscape', () => {
  it('routes Escape to neighborhood history when focus is already outside editable controls', () => {
    const onBack = vi.fn(() => true)
    renderHook(() => useNeighborhoodEscape({
      onBack,
      selectionRef: ref(alphaSelection),
      shouldBlockNeighborhoodEscape: false,
    }))

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(onBack).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('useSelectionSanitizer', () => {
  it('does not rewrite structurally equivalent selections', () => {
    const selection: SidebarSelection = { kind: 'filter', filter: 'all' }
    const effectiveSelection: SidebarSelection = { kind: 'filter', filter: 'all' }
    const setSelection = vi.fn()
    const setNoteListFilter = vi.fn()

    renderHook(() => useSelectionSanitizer({
      effectiveSelection,
      neighborhoodHistoryRef: ref([inboxSelection]),
      selection,
      selectionRef: ref(selection),
      setNoteListFilter,
      setSelection,
    }))

    expect(setSelection).not.toHaveBeenCalled()
    expect(setNoteListFilter).not.toHaveBeenCalled()
  })
})
