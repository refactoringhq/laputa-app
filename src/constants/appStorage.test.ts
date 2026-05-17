import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS, copyLegacyAppStorageKeys, getAppStorageItem } from './appStorage'

describe('appStorage legacy migration', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    })
  })

  it('copies legacy values to Tolaria keys without overwriting existing values', () => {
    store[LEGACY_APP_STORAGE_KEYS.theme] = 'dark'
    store[LEGACY_APP_STORAGE_KEYS.zoom] = '125'
    store[APP_STORAGE_KEYS.zoom] = '100'

    copyLegacyAppStorageKeys()

    expect(store[APP_STORAGE_KEYS.theme]).toBe('dark')
    expect(store[APP_STORAGE_KEYS.zoom]).toBe('100')
    expect(store[APP_STORAGE_KEYS.legacyMigrationFlag]).toBe('1')
  })

  it('falls back to legacy values when the Tolaria key is absent', () => {
    store[LEGACY_APP_STORAGE_KEYS.viewMode] = 'editor-list'

    expect(getAppStorageItem('viewMode')).toBe('editor-list')
  })

  it('returns safely when localStorage is restricted', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('SecurityError') }),
      setItem: vi.fn(() => { throw new Error('SecurityError') }),
    })

    expect(() => copyLegacyAppStorageKeys()).not.toThrow()
    expect(getAppStorageItem('theme')).toBeNull()
  })
})
