import { useEffect } from 'react'
import {
  applyThemeSelectionToDocument,
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  SYSTEM_THEME_MEDIA_QUERY,
  writeStoredThemeMode,
  type ThemeMode,
} from '../lib/themeMode'

function resolveRuntimeThemeMode(themeMode: ThemeMode | null | undefined): ThemeMode {
  if (themeMode) return themeMode
  if (typeof window === 'undefined') return DEFAULT_THEME_MODE
  return readStoredThemeMode(window.localStorage) ?? DEFAULT_THEME_MODE
}

function currentMatchMedia(): Window['matchMedia'] | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : undefined
}

function writeThemeModeMirror(themeMode: ThemeMode): void {
  if (typeof window === 'undefined') return
  writeStoredThemeMode(window.localStorage, themeMode)
}

function applySelectedThemeMode(themeMode: ThemeMode): void {
  applyThemeSelectionToDocument(document, themeMode, currentMatchMedia())
  writeThemeModeMirror(themeMode)
}

function getSystemThemeMediaQueryList(): MediaQueryList | null {
  const matchMedia = currentMatchMedia()
  if (!matchMedia) return null

  try {
    return matchMedia(SYSTEM_THEME_MEDIA_QUERY)
  } catch {
    return null
  }
}

function subscribeSystemThemeChanges(mediaQueryList: MediaQueryList): () => void {
  const handleSystemThemeChange = () => applySelectedThemeMode('system')

  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', handleSystemThemeChange)
    return () => mediaQueryList.removeEventListener('change', handleSystemThemeChange)
  }

  mediaQueryList.addListener(handleSystemThemeChange)
  return () => mediaQueryList.removeListener(handleSystemThemeChange)
}

export function useThemeMode(
  themeMode: ThemeMode | null | undefined,
  loaded: boolean,
): void {
  useEffect(() => {
    if (!loaded || typeof document === 'undefined') return

    const selectedMode = resolveRuntimeThemeMode(themeMode)
    applySelectedThemeMode(selectedMode)

    if (selectedMode !== 'system') return
    const mediaQueryList = getSystemThemeMediaQueryList()
    return mediaQueryList ? subscribeSystemThemeChanges(mediaQueryList) : undefined
  }, [loaded, themeMode])
}
