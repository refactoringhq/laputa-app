import { useSyncExternalStore } from 'react'
import {
  DEFAULT_THEME_MODE,
  normalizeResolvedThemeMode,
  type ResolvedThemeMode,
} from '../lib/themeMode'

function readDocumentThemeMode(): ResolvedThemeMode {
  if (typeof document === 'undefined') return DEFAULT_THEME_MODE
  return normalizeResolvedThemeMode(document.documentElement.getAttribute('data-theme')) ?? DEFAULT_THEME_MODE
}

function subscribeDocumentThemeMode(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }

  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: ['class', 'data-theme'],
    attributes: true,
  })

  return () => observer.disconnect()
}

export function useDocumentThemeMode(): ResolvedThemeMode {
  return useSyncExternalStore(
    subscribeDocumentThemeMode,
    readDocumentThemeMode,
    () => DEFAULT_THEME_MODE,
  )
}
