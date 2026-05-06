import { APP_STORAGE_KEYS, LEGACY_APP_STORAGE_KEYS } from '../constants/appStorage'

export const THEME_MODE_STORAGE_KEY = APP_STORAGE_KEYS.theme
export const LEGACY_THEME_MODE_STORAGE_KEY = LEGACY_APP_STORAGE_KEYS.theme
export const DEFAULT_THEME_MODE = 'light'
export const SYSTEM_THEME_MODE = 'system'
export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'

const RESOLVED_THEME_MODES = new Set(['light', 'dark'])
const THEME_MODES = new Set([...RESOLVED_THEME_MODES, SYSTEM_THEME_MODE])

export type ResolvedThemeMode = 'light' | 'dark'
export type ThemeMode = ResolvedThemeMode | typeof SYSTEM_THEME_MODE

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>
type ThemeDocument = Pick<Document, 'documentElement'>
type ThemeMatchMedia = Window['matchMedia']

export function normalizeThemeMode(value: unknown): ThemeMode | null {
  return typeof value === 'string' && THEME_MODES.has(value) ? value as ThemeMode : null
}

export function normalizeResolvedThemeMode(value: unknown): ResolvedThemeMode | null {
  const mode = normalizeThemeMode(value)
  return mode === 'light' || mode === 'dark' ? mode : null
}

function resolveMatchMedia(matchMedia?: ThemeMatchMedia): ThemeMatchMedia | null {
  if (matchMedia) return matchMedia
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia.bind(window)
}

export function resolveSystemThemeMode(matchMedia?: ThemeMatchMedia): ResolvedThemeMode {
  const resolvedMatchMedia = resolveMatchMedia(matchMedia)
  if (!resolvedMatchMedia) return DEFAULT_THEME_MODE

  try {
    return resolvedMatchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? 'dark' : 'light'
  } catch {
    return DEFAULT_THEME_MODE
  }
}

export function resolveThemeMode(value: unknown, matchMedia?: ThemeMatchMedia): ResolvedThemeMode {
  const mode = normalizeThemeMode(value)
  if (mode === SYSTEM_THEME_MODE) return resolveSystemThemeMode(matchMedia)
  return mode ?? DEFAULT_THEME_MODE
}

function safeGetThemeMode(storage: ThemeStorage, key: string): ThemeMode | null {
  try {
    return normalizeThemeMode(storage.getItem(key))
  } catch {
    return null
  }
}

function safeSetThemeMode(storage: ThemeStorage, key: string, mode: ThemeMode): void {
  try {
    storage.setItem(key, mode)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function readStoredThemeMode(storage: ThemeStorage): ThemeMode | null {
  const storedMode = safeGetThemeMode(storage, THEME_MODE_STORAGE_KEY)
  if (storedMode) return storedMode

  const legacyMode = safeGetThemeMode(storage, LEGACY_THEME_MODE_STORAGE_KEY)
  if (!legacyMode) return null

  safeSetThemeMode(storage, THEME_MODE_STORAGE_KEY, legacyMode)
  return legacyMode
}

export function writeStoredThemeMode(storage: ThemeStorage, mode: ThemeMode): void {
  safeSetThemeMode(storage, THEME_MODE_STORAGE_KEY, mode)
}

export function applyThemeModeToDocument(documentObject: ThemeDocument, mode: ResolvedThemeMode): void {
  const root = documentObject.documentElement
  root.setAttribute('data-theme', mode)
  root.classList.toggle('dark', mode === 'dark')
}

export function applyThemeSelectionToDocument(
  documentObject: ThemeDocument,
  mode: ThemeMode,
  matchMedia?: ThemeMatchMedia,
): ResolvedThemeMode {
  const resolvedMode = resolveThemeMode(mode, matchMedia)
  applyThemeModeToDocument(documentObject, resolvedMode)
  return resolvedMode
}

export function applyStoredThemeMode(
  documentObject: ThemeDocument,
  storage: ThemeStorage,
  matchMedia?: ThemeMatchMedia,
): ResolvedThemeMode {
  const mode = readStoredThemeMode(storage) ?? DEFAULT_THEME_MODE
  return applyThemeSelectionToDocument(documentObject, mode, matchMedia)
}
