export const FRONTEND_READY_EVENT_NAME = 'tolaria:frontend-ready'
export const STARTUP_RELOAD_ATTEMPT_STORAGE_NAME = 'tolaria:startup-reload-attempted'

declare global {
  interface Window {
    __tolariaFrontendReady?: boolean
  }
}

type FrontendReadyOptions = {
  storage?: Storage
  win?: Window
}

type StartupReloadOptions = FrontendReadyOptions & {
  reload?: () => void
}

function getSessionStorage(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

function removeSessionItem(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Storage can be unavailable in hardened WebView/privacy modes.
  }
}

function readSessionItem(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeSessionItem(storage: Storage | null, key: string, value: string): boolean {
  try {
    storage?.setItem(key, value)
    return storage !== null
  } catch {
    return false
  }
}

export function markFrontendReady(options: FrontendReadyOptions = {}): void {
  const win = options.win ?? window
  const storage = options.storage ?? getSessionStorage(win)

  win.__tolariaFrontendReady = true
  removeSessionItem(storage, STARTUP_RELOAD_ATTEMPT_STORAGE_NAME)
  win.dispatchEvent(new Event(FRONTEND_READY_EVENT_NAME))
}

export function reloadFrontendOnceIfStartupFailed(
  options: StartupReloadOptions = {},
): boolean {
  const win = startupWindow(options.win)
  const storage = startupStorage(options.storage, win)
  if (!startupNeedsReload(win, storage)) return false
  if (!writeSessionItem(storage, STARTUP_RELOAD_ATTEMPT_STORAGE_NAME, '1')) return false
  const reload = startupReload(options.reload, win)
  reload()
  return true
}

function startupWindow(configuredWindow: Window | undefined): Window {
  if (configuredWindow) return configuredWindow
  return window
}

function startupStorage(configuredStorage: Storage | undefined, win: Window): Storage | null {
  if (configuredStorage) return configuredStorage
  return getSessionStorage(win)
}

function startupReload(configuredReload: (() => void) | undefined, win: Window): () => void {
  if (configuredReload) return configuredReload
  return () => win.location.reload()
}

function startupNeedsReload(win: Window, storage: Storage | null): boolean {
  if (win.__tolariaFrontendReady === true) return false
  return readSessionItem(storage, STARTUP_RELOAD_ATTEMPT_STORAGE_NAME) !== '1'
}
