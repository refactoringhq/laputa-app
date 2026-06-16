import type { Settings } from '../types'

export function areAutomaticUpdateChecksEnabled(
  settings: Pick<Settings, 'automatic_update_checks_enabled'> | null | undefined,
): boolean {
  return settings?.automatic_update_checks_enabled !== false
}
