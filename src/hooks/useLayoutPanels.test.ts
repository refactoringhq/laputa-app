import { beforeEach, describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLayoutPanels, COLUMN_MIN_WIDTHS } from './useLayoutPanels'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

type ExpectedPanelWidths = {
  sidebar: number
  noteList: number
  inspector: number
}

function storePanelWidths(key: string, widths: ExpectedPanelWidths): void {
  localStorage.setItem(key, JSON.stringify(widths))
}

function expectPanelWidths(
  result: { current: ReturnType<typeof useLayoutPanels> },
  widths: ExpectedPanelWidths,
): void {
  expect(result.current.sidebarWidth).toBe(widths.sidebar)
  expect(result.current.noteListWidth).toBe(widths.noteList)
  expect(result.current.inspectorWidth).toBe(widths.inspector)
}

describe('useLayoutPanels', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exports column minimum widths', () => {
    expect(COLUMN_MIN_WIDTHS.sidebar).toBe(220)
    expect(COLUMN_MIN_WIDTHS.noteList).toBe(220)
    expect(COLUMN_MIN_WIDTHS.editor).toBe(800)
    expect(COLUMN_MIN_WIDTHS.inspector).toBe(240)
  })

  it('returns default widths', () => {
    const { result } = renderHook(() => useLayoutPanels())
    expectPanelWidths(result, { sidebar: 250, noteList: 300, inspector: 280 })
  })

  it('clamps sidebar resize to minimum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleSidebarResize(-500))
    expect(result.current.sidebarWidth).toBe(COLUMN_MIN_WIDTHS.sidebar)
  })

  it('clamps note list resize to minimum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleNoteListResize(-500))
    expect(result.current.noteListWidth).toBe(COLUMN_MIN_WIDTHS.noteList)
  })

  it('clamps inspector resize to minimum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleInspectorResize(500))
    expect(result.current.inspectorWidth).toBe(COLUMN_MIN_WIDTHS.inspector)
  })

  it('clamps sidebar resize to maximum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleSidebarResize(500))
    expect(result.current.sidebarWidth).toBe(400)
  })

  it('clamps note list resize to maximum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleNoteListResize(500))
    expect(result.current.noteListWidth).toBe(500)
  })

  it('clamps inspector resize to maximum', () => {
    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleInspectorResize(-500))
    expect(result.current.inspectorWidth).toBe(500)
  })

  it('defaults inspector to collapsed', () => {
    const { result } = renderHook(() => useLayoutPanels())
    expect(result.current.inspectorCollapsed).toBe(true)
  })

  it('accepts initial inspector collapsed override', () => {
    const { result } = renderHook(() => useLayoutPanels({ initialInspectorCollapsed: false }))
    expect(result.current.inspectorCollapsed).toBe(false)
  })

  it('restores persisted panel widths', () => {
    storePanelWidths(APP_STORAGE_KEYS.layoutPanels, {
      sidebar: 280,
      noteList: 360,
      inspector: 320,
    })

    const { result } = renderHook(() => useLayoutPanels())

    expectPanelWidths(result, { sidebar: 280, noteList: 360, inspector: 320 })
  })

  it('clamps persisted panel widths to supported ranges', () => {
    storePanelWidths(APP_STORAGE_KEYS.layoutPanels, {
      sidebar: 120,
      noteList: 700,
      inspector: 90,
    })

    const { result } = renderHook(() => useLayoutPanels())

    expectPanelWidths(result, {
      sidebar: COLUMN_MIN_WIDTHS.sidebar,
      noteList: 500,
      inspector: COLUMN_MIN_WIDTHS.inspector,
    })
  })

  it('falls back to defaults when persisted panel widths are malformed', () => {
    localStorage.setItem(APP_STORAGE_KEYS.layoutPanels, '{not json')

    const { result } = renderHook(() => useLayoutPanels())

    expectPanelWidths(result, { sidebar: 250, noteList: 300, inspector: 280 })
  })

  it('persists resized panel widths with the Tolaria storage key', () => {
    storePanelWidths(LEGACY_APP_STORAGE_KEYS.layoutPanels, {
      sidebar: 260,
      noteList: 340,
      inspector: 300,
    })

    const { result } = renderHook(() => useLayoutPanels())
    act(() => result.current.handleSidebarResize(24))

    expect(JSON.parse(localStorage.getItem(APP_STORAGE_KEYS.layoutPanels) ?? '{}')).toEqual({
      sidebar: 284,
      noteList: 340,
      inspector: 300,
    })
    expect(localStorage.getItem(LEGACY_APP_STORAGE_KEYS.layoutPanels)).toBeNull()
  })
})
