import { describe, expect, it, vi } from 'vitest'
import {
  applyStoredThemeMode,
  applyThemeModeToDocument,
  LEGACY_THEME_MODE_STORAGE_KEY,
  normalizeThemeMode,
  readStoredThemeMode,
  resolveThemeMode,
  THEME_MODE_STORAGE_KEY,
  writeStoredThemeMode,
} from './themeMode'

function makeStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

describe('themeMode', () => {
  it('normalizes only supported theme modes', () => {
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('system')).toBe('system')
    expect(resolveThemeMode('system', makeMatchMedia(true))).toBe('dark')
    expect(resolveThemeMode('system', makeMatchMedia(false))).toBe('light')
    expect(resolveThemeMode('sepia')).toBe('light')
  })

  it('reads and writes the current storage key', () => {
    const storage = makeStorage()

    writeStoredThemeMode(storage, 'system')

    expect(readStoredThemeMode(storage)).toBe('system')
    expect(storage.setItem).toHaveBeenCalledWith(THEME_MODE_STORAGE_KEY, 'system')
  })

  it('migrates the legacy storage key', () => {
    const storage = makeStorage({ [LEGACY_THEME_MODE_STORAGE_KEY]: 'dark' })

    expect(readStoredThemeMode(storage)).toBe('dark')
    expect(storage.setItem).toHaveBeenCalledWith(THEME_MODE_STORAGE_KEY, 'dark')
  })

  it('applies theme attributes and shadcn dark class', () => {
    applyThemeModeToDocument(document, 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')

    applyThemeModeToDocument(document, 'light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('bootstraps stored theme mode onto the document', () => {
    const storage = makeStorage({ [THEME_MODE_STORAGE_KEY]: 'dark' })

    expect(applyStoredThemeMode(document, storage)).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('bootstraps system mode to the current OS appearance without storing system in data-theme', () => {
    const storage = makeStorage({ [THEME_MODE_STORAGE_KEY]: 'system' })

    expect(applyStoredThemeMode(document, storage, makeMatchMedia(true))).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')
  })
})

function makeMatchMedia(matches: boolean): Window['matchMedia'] {
  return ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })) as Window['matchMedia']
}
