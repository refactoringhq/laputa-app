/**
 * Vault dialog utilities.
 * In Tauri mode, uses the native dialog plugin for folder picking.
 * In browser mode, falls back to window.prompt() for testing.
 */

import { isTauri } from '../mock-tauri'
import {
  isRestartRequiredAfterUpdate,
  markRestartRequiredAfterUpdate,
  RESTART_REQUIRED_FOLDER_PICKER_MESSAGE,
} from '../lib/appUpdater'

const NS_OPEN_PANEL_UNAVAILABLE_MARKER = 'unexpected NULL returned from +[NSOpenPanel openPanel]'

export class NativeFolderPickerBlockedError extends Error {
  constructor(message = RESTART_REQUIRED_FOLDER_PICKER_MESSAGE) {
    super(message)
    this.name = 'NativeFolderPickerBlockedError'
  }
}

export function isNativeFolderPickerBlockedError(
  error: unknown,
): error is NativeFolderPickerBlockedError {
  return error instanceof NativeFolderPickerBlockedError
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return ''
}

function isUnavailableNativeFolderPicker(error: unknown): boolean {
  return errorMessage(error).includes(NS_OPEN_PANEL_UNAVAILABLE_MARKER)
}

export function formatFolderPickerActionError(
  action: string,
  error: unknown,
): string {
  if (isNativeFolderPickerBlockedError(error)) {
    return error.message
  }

  const message = errorMessage(error)

  return message ? `${action}: ${message}` : action
}

function normalizePickedFolderPath(selected: string | string[] | null): string | null {
  const selectedPath = Array.isArray(selected)
    ? (typeof selected[0] === 'string' ? selected[0] : null)
    : selected

  if (typeof selectedPath !== 'string') {
    return null
  }

  if (!selectedPath.startsWith('file://')) {
    return selectedPath
  }

  try {
    const parsed = new URL(selectedPath)
    if (parsed.protocol !== 'file:') {
      return selectedPath
    }

    const decodedPath = decodeURIComponent(parsed.pathname)
    if (parsed.hostname) {
      return `//${parsed.hostname}${decodedPath}`
    }

    if (/^\/[A-Za-z]:/.test(decodedPath)) {
      return decodedPath.slice(1)
    }

    return decodedPath
  } catch {
    return selectedPath
  }
}

let folderPickerRequestInFlight = false

async function pickNativeFolder(title?: string): Promise<string | null> {
  if (isRestartRequiredAfterUpdate()) {
    throw new NativeFolderPickerBlockedError()
  }

  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: title ?? 'Select folder',
    })
    return normalizePickedFolderPath(selected)
  } catch (error) {
    if (isUnavailableNativeFolderPicker(error)) {
      markRestartRequiredAfterUpdate()
      throw new NativeFolderPickerBlockedError()
    }
    throw error
  }
}

/**
 * Opens a native folder picker dialog (Tauri) or falls back to prompt (browser).
 * Returns the selected folder path, or null if the user cancelled.
 */
export async function pickFolder(title?: string): Promise<string | null> {
  if (folderPickerRequestInFlight) return null

  folderPickerRequestInFlight = true
  try {
    if (isTauri()) {
      return await pickNativeFolder(title)
    }
    return normalizePickedFolderPath(prompt(title ?? 'Enter folder path:'))
  } finally {
    folderPickerRequestInFlight = false
  }
}
