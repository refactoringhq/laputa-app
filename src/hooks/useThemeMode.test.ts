import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_MODE_STORAGE_KEY } from '../lib/themeMode'
import { useThemeMode } from './useThemeMode'

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: vi.fn(() => { values.clear() }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

describe('useThemeMode', () => {
  const localStorageMock = createStorageMock()

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
    installMatchMedia(false)
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
  })

  it('waits until settings have loaded', () => {
    renderHook(() => useThemeMode('dark', false))

    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })

  it('applies and mirrors the loaded settings mode', () => {
    renderHook(() => useThemeMode('dark', true))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('dark')
  })

  it('uses the storage mirror when persisted settings are empty', () => {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, 'dark')

    renderHook(() => useThemeMode(null, true))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('keeps system stored while applying the resolved OS appearance', () => {
    installMatchMedia(true)

    renderHook(() => useThemeMode('system', true))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('system')
  })

  it('updates the document theme when the OS appearance changes in system mode', () => {
    const media = installMatchMedia(true)

    const { unmount } = renderHook(() => useThemeMode('system', true))

    act(() => media.setMatches(false))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.documentElement).not.toHaveClass('dark')

    unmount()
    act(() => media.setMatches(true))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
})

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = '(prefers-color-scheme: dark)'
  const mediaQueryList: MediaQueryList = {
    get matches() { return matches },
    media,
    onchange: null,
    addEventListener: (_type, listener) => {
      if (_type !== 'change' || typeof listener !== 'function') return
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      if (_type !== 'change' || typeof listener !== 'function') return
      listeners.delete(listener)
    },
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQueryList),
  })

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      const event = new Event('change') as MediaQueryListEvent
      Object.defineProperties(event, {
        matches: { value: nextMatches },
        media: { value: media },
      })
      for (const listener of listeners) listener(event)
    },
  }
}
