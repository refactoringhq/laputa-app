import { isTauri } from '../mock-tauri'
import { shouldUseLinuxWindowChrome } from './platform'
import { rememberNoteWindowParams } from './windowMode'

const MACOS_TRAFFIC_LIGHT_POSITION = { x: 18, y: 24 } as const

export function buildNoteWindowUrl(notePath: string, vaultPath: string, noteTitle: string, windowLabel?: string): string {
  const params = new URLSearchParams({
    window: 'note',
    path: notePath,
    vault: vaultPath,
    title: noteTitle,
  })

  if (windowLabel) {
    params.set('windowLabel', windowLabel)
  }

  return `/?${params.toString()}`
}

/**
 * Opens a note in a new Tauri window with a minimal editor-only layout.
 * In browser mode (non-Tauri), this is a no-op.
 */
export async function openNoteInNewWindow(notePath: string, vaultPath: string, noteTitle: string): Promise<void> {
  if (!isTauri()) return

  const { LogicalPosition } = await import('@tauri-apps/api/dpi')
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = `note-${Date.now()}`
  rememberNoteWindowParams(label, { notePath, vaultPath, noteTitle })

  new WebviewWindow(label, {
    url: buildNoteWindowUrl(notePath, vaultPath, noteTitle, label),
    title: noteTitle,
    width: 800,
    height: 700,
    resizable: true,
    titleBarStyle: 'overlay',
    trafficLightPosition: new LogicalPosition(MACOS_TRAFFIC_LIGHT_POSITION.x, MACOS_TRAFFIC_LIGHT_POSITION.y),
    hiddenTitle: true,
    decorations: !shouldUseLinuxWindowChrome(),
  })
}
