import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'

vi.mock('../components/DynamicPropertiesPanel', () => ({
  containsWikilinks: (value: unknown) => {
    if (Array.isArray(value)) {
      return value.some((item) => String(item).includes('[['))
    }
    return String(value).includes('[[')
  },
}))

import { initDisplayModeOverrides } from '../utils/propertyTypes'
import { usePropertyPanelState } from './usePropertyPanelState'

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

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/note.md',
    filename: 'note.md',
    title: 'Note',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1700000000,
    createdAt: 1700000000,
    fileSize: 1,
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
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

describe('usePropertyPanelState', () => {
  beforeEach(() => {
    localStorage.clear()
    initDisplayModeOverrides({})
  })

  it('derives visible properties, available types, statuses, and aggregated tags', () => {
    const entries = [
      makeEntry({ title: 'Topic', isA: 'Type', color: '#334455', icon: 'book' }),
      makeEntry({ title: 'Project', isA: 'Type', color: '#112233', icon: 'rocket' }),
      makeEntry({
        title: 'Alpha',
        status: 'Doing',
        properties: {
          Tags: ['alpha', 'beta'],
          Areas: ['ops'],
        },
      }),
      makeEntry({
        title: 'Beta',
        status: 'Review',
        properties: {
          Tags: ['beta', 'gamma'],
        },
      }),
    ]

    const frontmatter = {
      _icon: 'sparkles',
      icon: 'duplicate',
      title: 'Hidden',
      Count: 3,
      Custom: 'value',
      'Related to': '[[Alpha]]',
    }

    const { result } = renderHook(() =>
      usePropertyPanelState({
        entries,
        entryIsA: 'Project',
        frontmatter,
      }),
    )

    expect(result.current.availableTypes).toEqual(['Project', 'Topic'])
    expect(result.current.customColorKey).toBe('#112233')
    expect(result.current.typeIconKeys.Project).toBe('rocket')
    expect(result.current.vaultStatuses).toEqual(['Doing', 'Review'])
    expect(result.current.vaultTagsByKey).toEqual({
      Areas: ['ops'],
      Tags: ['alpha', 'beta', 'gamma'],
    })
    expect(result.current.propertyEntries).toEqual([
      ['_icon', 'sparkles'],
      ['Count', 3],
      ['Custom', 'value'],
    ])
  })

  it('derives missing instance property placeholders from its type entry', () => {
    const entries = [
      makeEntry({
        title: 'Book',
        isA: 'Type',
        properties: {
          'start date': null,
          Rating: 5,
        },
      }),
      makeEntry({
        title: 'Dune',
        isA: 'Book',
        properties: {
          Rating: 4,
        },
      }),
    ]

    const { result } = renderHook(() =>
      usePropertyPanelState({
        entries,
        entryIsA: 'Book',
        frontmatter: {
          Rating: 4,
        },
      }),
    )

    expect(result.current.propertyEntries).toEqual([
      ['Rating', 4],
    ])
    expect(result.current.typeDerivedPropertyEntries).toEqual([
      ['start date', null],
    ])
  })

  it('saves scalar and list properties through the correct handlers', () => {
    const onUpdateProperty = vi.fn()
    const onDeleteProperty = vi.fn()

    const { result } = renderHook(() =>
      usePropertyPanelState({
        entries: [],
        entryIsA: null,
        frontmatter: {
          Count: 7,
          Flag: false,
          Title: 'kept',
        },
        onUpdateProperty,
        onDeleteProperty,
      }),
    )

    act(() => {
      result.current.setEditingKey('Count')
      result.current.handleSaveValue('Count', '  ')
    })
    expect(result.current.editingKey).toBeNull()
    expect(onDeleteProperty).toHaveBeenCalledWith('Count')

    act(() => {
      result.current.handleSaveValue('Flag', 'true')
    })
    expect(onUpdateProperty).toHaveBeenCalledWith('Flag', true)

    act(() => {
      result.current.handleSaveList('Tags', [])
      result.current.handleSaveList('Tags', ['solo'])
      result.current.handleSaveList('Tags', ['solo', 'duo'])
    })

    expect(onDeleteProperty).toHaveBeenCalledWith('Tags')
    expect(onUpdateProperty).toHaveBeenCalledWith('Tags', 'solo')
    expect(onUpdateProperty).toHaveBeenCalledWith('Tags', ['solo', 'duo'])
  })

  it('adds properties, persists non-text display modes, and supports clearing overrides', () => {
    const onAddProperty = vi.fn()

    const { result } = renderHook(() =>
      usePropertyPanelState({
        entries: [],
        entryIsA: null,
        frontmatter: {},
        onAddProperty,
      }),
    )

    act(() => {
      result.current.setShowAddDialog(true)
      result.current.handleAdd('  ', 'ignored', 'text')
    })
    expect(onAddProperty).not.toHaveBeenCalled()

    act(() => {
      result.current.handleAdd('Rating', '42', 'number')
    })
    expect(onAddProperty).toHaveBeenCalledWith('Rating', 42)
    expect(result.current.displayOverrides.Rating).toBe('number')
    expect(result.current.showAddDialog).toBe(false)

    act(() => {
      result.current.handleAdd('Labels', 'alpha, beta', 'tags')
    })
    expect(onAddProperty).toHaveBeenCalledWith('Labels', ['alpha', 'beta'])
    expect(result.current.displayOverrides.Labels).toBe('tags')

    act(() => {
      result.current.handleDisplayModeChange('Rating', null)
    })
    expect(result.current.displayOverrides.Rating).toBeUndefined()
  })
})
