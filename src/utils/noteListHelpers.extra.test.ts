import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'
import { allSelection, makeEntry } from '../test-utils/noteListTestUtils'
import {
  clearListSortFromLocalStorage,
  countInboxByPeriod,
  extractSortableProperties,
  filterEntries,
  filterInboxEntries,
  formatSearchSubtitle,
  formatSubtitle,
  getSortComparator,
  getSortOptionLabel,
  loadSortPreferences,
  parseSortConfig,
  relativeDate,
  saveSortPreferences,
  serializeSortConfig,
} from './noteListHelpers'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('noteListHelpers extra coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'))
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats relative dates across future, recent, and older timestamps', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)

    expect(relativeDate(nowSeconds + 86400)).toBe('Apr 22')
    expect(relativeDate(nowSeconds - 30)).toBe('just now')
    expect(relativeDate(nowSeconds - 5 * 60)).toBe('5m ago')
    expect(relativeDate(nowSeconds - 2 * 3600)).toBe('2h ago')
    expect(relativeDate(nowSeconds - 3 * 86400)).toBe('3d ago')
    expect(relativeDate(nowSeconds - 10 * 86400)).toBe('Apr 11')
  })

  it('builds note subtitles for empty, linked, and edited notes', () => {
    const modifiedEntry = makeEntry({
      title: 'Project',
      modifiedAt: Math.floor(Date.now() / 1000) - 3600,
      createdAt: Math.floor(Date.now() / 1000) - 86400 * 2,
      wordCount: 1200,
      outgoingLinks: ['alpha', 'beta'],
    })
    const emptyEntry = makeEntry({
      title: 'Empty',
      modifiedAt: null,
      createdAt: null,
      wordCount: 0,
      outgoingLinks: [],
    })

    expect(formatSubtitle(modifiedEntry)).toBe('1h ago · 1,200 words · 2 links')
    expect(formatSubtitle(emptyEntry)).toBe('Empty')
    expect(formatSearchSubtitle(modifiedEntry)).toBe('1h ago · Created 2d ago · 1,200 words · 2 links')
  })

  it('extracts sortable properties and labels custom property sort keys', () => {
    const entries = [
      makeEntry({ properties: { Priority: 'High', Owner: 'Luca' } }),
      makeEntry({ properties: { Estimate: 3, Priority: 'Low' } }),
    ]

    expect(extractSortableProperties(entries)).toEqual(['Estimate', 'Owner', 'Priority'])
    expect(getSortOptionLabel('property:Priority')).toBe('Priority')
    expect(getSortOptionLabel('title')).toBe('Title')
  })

  it('sorts entries by built-in and custom property comparators', () => {
    const entries = [
      makeEntry({
        title: 'Gamma',
        createdAt: 10,
        modifiedAt: 30,
        status: 'Done',
        properties: { Score: 5, Start: '2026-04-18', Enabled: true },
      }),
      makeEntry({
        title: 'Alpha',
        createdAt: 20,
        modifiedAt: 20,
        status: 'Active',
        properties: { Score: 2, Start: '2026-04-15', Enabled: false },
      }),
      makeEntry({
        title: 'Beta',
        createdAt: 15,
        modifiedAt: 25,
        status: null,
        properties: { Score: 8, Start: 'not-a-date', Enabled: true },
      }),
    ]

    expect([...entries].sort(getSortComparator('title', 'asc')).map((entry) => entry.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect([...entries].sort(getSortComparator('created', 'desc')).map((entry) => entry.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect([...entries].sort(getSortComparator('status', 'asc')).map((entry) => entry.title)).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect([...entries].sort(getSortComparator('property:Score', 'asc')).map((entry) => entry.title)).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect([...entries].sort(getSortComparator('property:Start', 'asc')).map((entry) => entry.title)).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect([...entries].sort(getSortComparator('property:Enabled', 'asc')).map((entry) => entry.title)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('serializes, parses, loads, and saves sort preferences with migration support', () => {
    const serialized = serializeSortConfig({ option: 'property:Priority', direction: 'desc' })
    expect(serialized).toBe('property:Priority:desc')
    expect(parseSortConfig(serialized)).toEqual({ option: 'property:Priority', direction: 'desc' })
    expect(parseSortConfig('broken')).toBeNull()
    expect(parseSortConfig('title:sideways')).toBeNull()

    localStorage.setItem(APP_STORAGE_KEYS.sortPreferences, JSON.stringify({
      '__list__': 'title',
      'type:Project': { option: 'created', direction: 'asc' },
    }))

    expect(loadSortPreferences()).toEqual({
      '__list__': { option: 'title', direction: 'asc' },
      'type:Project': { option: 'created', direction: 'asc' },
    })

    saveSortPreferences({
      '__list__': { option: 'modified', direction: 'desc' },
    })

    expect(localStorage.getItem(APP_STORAGE_KEYS.sortPreferences)).toBe(JSON.stringify({
      '__list__': { option: 'modified', direction: 'desc' },
    }))
    expect(localStorage.getItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)).toBeNull()

    clearListSortFromLocalStorage()
    expect(localStorage.getItem(APP_STORAGE_KEYS.sortPreferences)).toBeNull()
    expect(localStorage.getItem(LEGACY_APP_STORAGE_KEYS.sortPreferences)).toBeNull()
  })

  it('filters view, folder, favorites, and pulse selections', () => {
    const entries = [
      makeEntry({
        path: '/vault/notes/alpha.md',
        title: 'Alpha',
        fileKind: 'markdown',
        favorite: true,
      }),
      makeEntry({
        path: '/vault/projects/beta.md',
        title: 'Beta',
        fileKind: 'markdown',
      }),
      makeEntry({
        path: '/vault/attachments/diagram.png',
        title: 'Diagram',
        fileKind: 'binary',
      }),
    ]
    const views = [{
      filename: 'work.view',
      definition: {
        name: 'Work',
        icon: null,
        color: null,
        sort: null,
        filters: {
          all: [{ field: 'title', op: 'contains', value: 'Alpha' }],
        },
      },
    }]

    expect(filterEntries(entries, { kind: 'view', filename: 'work.view' }, { views }).map((entry) => entry.title)).toEqual(['Alpha'])
    expect(filterEntries(entries, { kind: 'folder', path: 'projects' }).map((entry) => entry.title)).toEqual(['Beta'])
    expect(filterEntries(entries, { kind: 'filter', filter: 'favorites' }).map((entry) => entry.title)).toEqual(['Alpha'])
    expect(filterEntries(entries, { kind: 'filter', filter: 'pulse' })).toEqual([])
    expect(filterEntries(entries, allSelection).map((entry) => entry.title)).toEqual(['Alpha', 'Beta'])
  })

  it('filters inbox entries by period and counts them', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const entries = [
      makeEntry({
        title: 'This Week',
        organized: false,
        archived: false,
        isA: 'Note',
        createdAt: nowSeconds - 2 * 86400,
      }),
      makeEntry({
        title: 'This Month',
        organized: false,
        archived: false,
        isA: 'Note',
        createdAt: nowSeconds - 20 * 86400,
      }),
      makeEntry({
        title: 'This Quarter',
        organized: false,
        archived: false,
        isA: 'Note',
        createdAt: nowSeconds - 80 * 86400,
      }),
      makeEntry({
        title: 'Organized',
        organized: true,
        archived: false,
        isA: 'Note',
        createdAt: nowSeconds - 2 * 86400,
      }),
      makeEntry({
        title: 'Type document',
        organized: false,
        archived: false,
        isA: 'Type',
        createdAt: nowSeconds - 2 * 86400,
      }),
    ]

    expect(filterInboxEntries(entries, 'week').map((entry) => entry.title)).toEqual(['This Week'])
    expect(filterInboxEntries(entries, 'month').map((entry) => entry.title)).toEqual(['This Week', 'This Month'])
    expect(filterInboxEntries(entries, 'quarter').map((entry) => entry.title)).toEqual(['This Week', 'This Month', 'This Quarter'])
    expect(countInboxByPeriod(entries)).toEqual({
      week: 1,
      month: 2,
      quarter: 3,
      all: 3,
    })
  })
})
