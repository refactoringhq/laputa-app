import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import type { ResolvedThemeMode } from './themeMode'

export async function syncAppIconThemeMode(themeMode: ResolvedThemeMode): Promise<void> {
  if (!isTauri()) return

  try {
    await invoke('update_app_icon', { themeMode })
  } catch (error) {
    console.warn('Failed to update app icon for theme mode', error)
  }
}
